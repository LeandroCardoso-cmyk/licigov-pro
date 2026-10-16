/**
 * Evidência de consultas ao catálogo OFICIAL CATMAT/CATSER, por órgão — reaproveita as tabelas existentes
 * `catalog_snapshots` (0070) e `catalog_entries` (0071), sem migration.
 *
 * - Cada consulta válida vira um SNAPSHOT imutável (id derivado do checksum da evidência): fonte, URL, consulta,
 *   instante, correlationId e checksum em `integrity_metadata`. Snapshots nunca são apagados nem reescritos.
 * - Cada código retornado vira/atualiza uma ENTRADA do órgão (descrição oficial, situação, snapshot mais recente).
 * - Leitura: só conta como evidência oficial a entrada cujo snapshot declara `source = api-comprasgov`.
 *
 * Tenant: tudo escopado por `organization_id`. Os dados do catálogo são públicos; a evidência é do órgão que consultou.
 *
 * ÍNDICE DE PESQUISA (CATSER — a API não tem filtro textual): cópia versionada do catálogo público sob a organização
 * GLOBAL 0 (convenção existente de `normalizeCatalogEntry`; nenhum órgão tem id 0 e nenhuma leitura de tenant consulta
 * a org 0). Serve só para ENCONTRAR candidatos; a verificação oficial continua por código, por órgão, na fonte.
 * PUBLICAÇÃO ATÔMICA: snapshot + entradas (versionadas POR SNAPSHOT) numa única transação, serializada por lock nomeado;
 * a leitura usa só o último snapshot PUBLICADO — o índice anterior vale até o novo ser publicado por inteiro.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { getDb } from "./connection";
import { catalogEntriesTable, catalogSnapshotsTable } from "../../drizzle/schema";
import {
  OFFICIAL_CATALOG_SOURCE, normalizeCatalogDescription,
  type CatalogEvidence, type OfficialCatalogEntry, type OfficialCatalogType,
} from "../domain/officialCatalog";

const id32 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export function catalogSnapshotId(organizationId: number, catalogType: OfficialCatalogType, checksum: string): string {
  return id32(`cs:${organizationId}:${catalogType}:${checksum}`);
}

export function catalogEntryId(organizationId: number, catalogType: OfficialCatalogType, code: string): string {
  return id32(`ce:${organizationId}:${catalogType}:${code}`);
}

interface SnapshotIntegrity {
  checksumAlg: string; verifiedAt: string; isValid: boolean; source: string; sourceUrl: string;
  query: { term?: string; code?: string; page: number; pageSize: number };
}

/** Registra a evidência de uma consulta oficial válida. Idempotente: mesma evidência ⇒ mesmo snapshot. */
export async function recordOfficialCatalogEvidence(p: {
  organizationId: number; catalogType: OfficialCatalogType; entries: readonly OfficialCatalogEntry[];
  checksum: string; retrievedAt: string; sourceUrl: string;
  query: { term?: string; code?: string; page: number; pageSize: number }; correlationId: string;
}): Promise<{ snapshotId: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const snapshotId = catalogSnapshotId(p.organizationId, p.catalogType, p.checksum);
  const integrity: SnapshotIntegrity = {
    checksumAlg: "sha256", verifiedAt: p.retrievedAt, isValid: true, source: OFFICIAL_CATALOG_SOURCE, sourceUrl: p.sourceUrl, query: p.query,
  };
  await db.insert(catalogSnapshotsTable).values({
    id: snapshotId, organizationId: p.organizationId, catalogType: p.catalogType,
    version: `${OFFICIAL_CATALOG_SOURCE}@${p.retrievedAt}`.slice(0, 50), checksum: p.checksum,
    totalEntries: p.entries.length, indexedEntries: p.entries.length, syncStatus: "synced",
    snapshotLineage: null, importLineage: [], integrityMetadata: integrity,
    cacheMetadata: { cachedAt: p.retrievedAt, expiresAt: p.retrievedAt, stale: false },
    correlationId: p.correlationId.slice(0, 64),
  }).onDuplicateKeyUpdate({ set: { syncStatus: "synced" } });
  for (const e of p.entries) {
    const normalized = normalizeCatalogDescription(e.description);
    const row = {
      description: e.description, normalizedDescription: normalized, catalogGroup: e.group?.slice(0, 255) ?? null,
      active: e.active === true, snapshotId,
    };
    await db.insert(catalogEntriesTable).values({
      id: catalogEntryId(p.organizationId, p.catalogType, e.code), organizationId: p.organizationId, code: e.code,
      catalogType: p.catalogType, ...row, aliases: [], tokens: normalized.split(" ").filter((w) => w.length > 2),
    }).onDuplicateKeyUpdate({ set: row });
  }
  return { snapshotId };
}

/**
 * Evidência oficial vigente do órgão para os códigos informados. `active` só é `true` quando a fonte declarou o código
 * ativo NESTA evidência (a situação "não informada" é gravada como inativa — nunca confirmável).
 */
export async function getOfficialCatalogEvidence(organizationId: number, codes: readonly string[]): Promise<CatalogEvidence[]> {
  const db = await getDb();
  const unique = Array.from(new Set(codes.map((c) => c.trim()).filter((c) => /^\d{1,9}$/.test(c))));
  if (!db || unique.length === 0) return [];
  const entries = await db.select().from(catalogEntriesTable)
    .where(and(eq(catalogEntriesTable.organizationId, organizationId), inArray(catalogEntriesTable.code, unique)));
  const snapIds = Array.from(new Set(entries.map((e) => e.snapshotId).filter((s): s is string => !!s)));
  if (snapIds.length === 0) return [];
  const snaps = await db.select().from(catalogSnapshotsTable)
    .where(and(eq(catalogSnapshotsTable.organizationId, organizationId), inArray(catalogSnapshotsTable.id, snapIds)));
  const official = new Map<string, { checksum: string; verifiedAt: string }>();
  for (const s of snaps) {
    const meta = (typeof s.integrityMetadata === "string" ? JSON.parse(s.integrityMetadata) : s.integrityMetadata) as Partial<SnapshotIntegrity> | null;
    if (meta?.source === OFFICIAL_CATALOG_SOURCE && meta.isValid === true && typeof meta.verifiedAt === "string") {
      official.set(s.id, { checksum: s.checksum, verifiedAt: meta.verifiedAt });
    }
  }
  const out: CatalogEvidence[] = [];
  for (const e of entries) {
    const snap = e.snapshotId ? official.get(e.snapshotId) : undefined;
    if (!snap || (e.catalogType !== "catmat" && e.catalogType !== "catser")) continue;
    out.push({
      catalogType: e.catalogType, code: e.code, description: e.description, active: e.active ? true : false,
      snapshotId: e.snapshotId!, checksum: snap.checksum, retrievedAt: snap.verifiedAt,
    });
  }
  return out;
}

// ─── Índice de pesquisa (catálogo público, organização GLOBAL 0) ─────────────────

export const GLOBAL_CATALOG_ORG = 0;
export const INDEX_KIND = "indice" as const;
/** Lock nomeado por catálogo: no máximo UMA publicação de índice por vez (sem espera — a concorrente é recusada). */
export const catalogIndexLockKey = (t: OfficialCatalogType) => `licigov:catalog-index:${t}`;
export const CATALOG_INDEX_SYNC_IN_PROGRESS = "CATALOG_INDEX_SYNC_IN_PROGRESS";

interface IndexIntegrity extends SnapshotIntegrity {
  kind: typeof INDEX_KIND; complete: boolean; pages: number; total: number | null; entries: number; publishedAt: string;
}

export interface CatalogIndexInfo {
  readonly snapshotId: string; readonly catalogType: OfficialCatalogType; readonly retrievedAt: string; readonly publishedAt: string;
  readonly complete: boolean; readonly pages: number; readonly total: number | null; readonly entries: number; readonly checksum: string;
}

const parseMeta = <T>(v: unknown): T | null => (typeof v === "string" ? JSON.parse(v) : v) as T | null;

/** Resultado de `SELECT GET_LOCK(...) AS ok` via drizzle/mysql2 (`[rows, fields]` ou `rows`). */
function readLockResult(res: unknown): number | null {
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res) as Array<{ ok?: unknown }> | undefined;
  const v = Array.isArray(rows) ? rows[0]?.ok : undefined;
  return v === null || v === undefined ? null : Number(v);
}

/** Entradas do índice são POR SNAPSHOT (nunca reescrevem as do índice publicado). */
export const catalogIndexEntryId = (snapshotId: string, code: string) => id32(`cei:${snapshotId}:${code}`);

let indexWriteFault: ((written: number) => void | Promise<void>) | null = null;
/**
 * Testes: gancho chamado APÓS gravar cada lote de entradas, DENTRO da transação e com o lock retido — lançar simula
 * falha/encerramento no meio da persistência; aguardar (Promise) simula publicação longa (concorrência real).
 */
export function __setCatalogIndexWriteFaultForTests(f: ((written: number) => void | Promise<void>) | null): void { indexWriteFault = f; }

type IndexDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type IndexTx = Parameters<Parameters<IndexDb["transaction"]>[0]>[0];
type SnapshotRow = typeof catalogSnapshotsTable.$inferSelect;

/** Política de vigência: entre os snapshots `synced` do índice, vale o de `publishedAt` mais recente (ordem dos commits). */
function pickPublished(catalogType: OfficialCatalogType, snaps: readonly SnapshotRow[]): CatalogIndexInfo | null {
  let best: CatalogIndexInfo | null = null;
  for (const s of snaps) {
    if (s.syncStatus !== "synced") continue;
    const meta = parseMeta<Partial<IndexIntegrity>>(s.integrityMetadata);
    if (meta?.kind !== INDEX_KIND || meta.source !== OFFICIAL_CATALOG_SOURCE || typeof meta.verifiedAt !== "string" || typeof meta.publishedAt !== "string") continue;
    const info: CatalogIndexInfo = {
      snapshotId: s.id, catalogType, retrievedAt: meta.verifiedAt, publishedAt: meta.publishedAt, complete: meta.complete === true,
      pages: meta.pages ?? 0, total: meta.total ?? null, entries: meta.entries ?? s.totalEntries, checksum: s.checksum,
    };
    if (!best || info.publishedAt > best.publishedAt) best = info;
  }
  return best;
}

async function readPublishedSnapshots(q: IndexDb | IndexTx, catalogType: OfficialCatalogType): Promise<SnapshotRow[]> {
  return q.select().from(catalogSnapshotsTable)
    .where(and(
      eq(catalogSnapshotsTable.organizationId, GLOBAL_CATALOG_ORG), eq(catalogSnapshotsTable.catalogType, catalogType),
      eq(catalogSnapshotsTable.syncStatus, "synced"),
    ))
    .orderBy(desc(catalogSnapshotsTable.updatedAt)).limit(50);
}

/** Instante de publicação pelo relógio do MySQL (ordem dos commits, imune a relógio de processo). */
async function dbNowIso(tx: IndexTx): Promise<string> {
  const res = await tx.execute(sql`SELECT DATE_FORMAT(UTC_TIMESTAMP(6), '%Y-%m-%dT%H:%i:%s.%fZ') AS t`);
  const rows = (Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res) as Array<{ t?: string }>;
  return rows[0]?.t ?? new Date().toISOString();
}

export type IndexPublication =
  | { readonly status: "published" | "replayed" | "republished"; readonly snapshotId: string }
  | { readonly status: "refused_partial"; readonly snapshotId: string; readonly currentSnapshotId: string };

/**
 * Publica uma sincronização do índice com EXCLUSIVIDADE até o commit/rollback efetivo:
 *   - UMA conexão dedicada do pool (o `GET_LOCK` pertence à conexão): GET_LOCK → transação nessa conexão →
 *     commit/rollback → RELEASE_LOCK → devolução da conexão. Nunca há janela entre liberar o lock e o commit;
 *   - lock ocupado ⇒ espera limitada (`lockWaitSeconds`); esgotada ⇒ recusa, nada gravado;
 *   - DENTRO da serialização: parcial sobre índice completo vigente ⇒ recusa; conteúdo idêntico ao vigente ⇒ replay sem
 *     escrita; conteúdo de um snapshot anterior (não vigente) ⇒ reconduzido a vigente (só metadado de publicação);
 *   - snapshot + entradas (ids por snapshot) gravados e marcados `synced` no MESMO commit; falha/encerramento ⇒ rollback:
 *     nenhum snapshot novo visível, índice anterior intacto, nada desativado. Snapshots publicados nunca são reescritos.
 */
export async function recordCatalogIndexSnapshot(p: {
  catalogType: OfficialCatalogType; entries: readonly OfficialCatalogEntry[]; checksum: string; retrievedAt: string;
  sourceUrl: string; pages: number; total: number | null; complete: boolean; pageSize: number; correlationId: string;
  lockWaitSeconds?: number;
}): Promise<IndexPublication | null> {
  const db = await getDb();
  if (!db) return null;
  const snapshotId = catalogSnapshotId(GLOBAL_CATALOG_ORG, p.catalogType, `${INDEX_KIND}:${p.checksum}`);
  const lockKey = catalogIndexLockKey(p.catalogType);
  const waitSeconds = Math.max(0, Math.min(120, Math.floor(p.lockWaitSeconds ?? 30)));
  const pool = (db as unknown as { $client: { promise: () => { getConnection: () => Promise<DedicatedConnection> } } }).$client;
  const conn = await pool.promise().getConnection();
  try {
    const [lockRows] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [lockKey, waitSeconds]);
    if (readLockResult([lockRows]) !== 1) {
      throw new Error(`${CATALOG_INDEX_SYNC_IN_PROGRESS}: outra publicação do índice ${p.catalogType} não terminou em ${waitSeconds}s.`);
    }
    try {
      // Transação NA MESMA conexão que detém o lock: o commit/rollback acontece antes do RELEASE_LOCK (finally abaixo).
      const single = drizzle(conn as never);
      return await single.transaction(async (tx) => {
        const current = pickPublished(p.catalogType, await readPublishedSnapshots(tx, p.catalogType));
        const existing = await tx.select({ id: catalogSnapshotsTable.id, syncStatus: catalogSnapshotsTable.syncStatus, integrityMetadata: catalogSnapshotsTable.integrityMetadata })
          .from(catalogSnapshotsTable).where(eq(catalogSnapshotsTable.id, snapshotId)).limit(1);
        if (current?.snapshotId === snapshotId) return { status: "replayed" as const, snapshotId };
        if (!p.complete && current?.complete) return { status: "refused_partial" as const, snapshotId, currentSnapshotId: current.snapshotId };
        const publishedAt = await dbNowIso(tx);
        if (existing[0]?.syncStatus === "synced") {
          // Conteúdo idêntico a um snapshot ANTERIOR: reconduz a vigente sem reescrever entradas (imutáveis).
          const meta = { ...(parseMeta<IndexIntegrity>(existing[0].integrityMetadata) ?? {}), publishedAt } as IndexIntegrity;
          await tx.update(catalogSnapshotsTable).set({ integrityMetadata: meta }).where(eq(catalogSnapshotsTable.id, snapshotId));
          return { status: "republished" as const, snapshotId };
        }
        const integrity: IndexIntegrity = {
          checksumAlg: "sha256", verifiedAt: p.retrievedAt, isValid: true, source: OFFICIAL_CATALOG_SOURCE, sourceUrl: p.sourceUrl,
          query: { page: 1, pageSize: p.pageSize }, kind: INDEX_KIND, complete: p.complete, pages: p.pages, total: p.total,
          entries: p.entries.length, publishedAt,
        };
        await tx.insert(catalogSnapshotsTable).values({
          id: snapshotId, organizationId: GLOBAL_CATALOG_ORG, catalogType: p.catalogType,
          version: `${INDEX_KIND}@${p.retrievedAt}`.slice(0, 50), checksum: p.checksum,
          totalEntries: p.entries.length, indexedEntries: p.entries.length, syncStatus: "syncing",
          snapshotLineage: current?.snapshotId ?? null, importLineage: [], integrityMetadata: integrity,
          cacheMetadata: { cachedAt: p.retrievedAt, expiresAt: p.retrievedAt, stale: false },
          correlationId: p.correlationId.slice(0, 64),
        }).onDuplicateKeyUpdate({ set: { syncStatus: "syncing", integrityMetadata: integrity } });
        const CHUNK = 200;
        for (let i = 0; i < p.entries.length; i += CHUNK) {
          const rows = p.entries.slice(i, i + CHUNK).map((e) => {
            const normalized = normalizeCatalogDescription(e.description);
            return {
              id: catalogIndexEntryId(snapshotId, e.code), organizationId: GLOBAL_CATALOG_ORG, code: e.code,
              catalogType: p.catalogType, description: e.description, normalizedDescription: normalized,
              catalogGroup: e.group?.slice(0, 255) ?? null, aliases: [], tokens: normalized.split(" ").filter((w) => w.length > 2),
              active: e.active === true, snapshotId,
            };
          });
          await tx.insert(catalogEntriesTable).values(rows).onDuplicateKeyUpdate({
            set: {
              description: sql`VALUES(description)`, normalizedDescription: sql`VALUES(normalized_description)`,
              catalogGroup: sql`VALUES(catalog_group)`, active: sql`VALUES(active)`,
            },
          });
          await indexWriteFault?.(Math.min(i + CHUNK, p.entries.length));
        }
        // Publicação: o snapshot só fica visível como válido junto com TODAS as suas entradas (mesmo commit).
        await tx.update(catalogSnapshotsTable).set({ syncStatus: "synced" }).where(eq(catalogSnapshotsTable.id, snapshotId));
        return { status: "published" as const, snapshotId };
      });
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockKey]).catch(() => undefined);
    }
  } finally {
    conn.release();
  }
}

interface DedicatedConnection {
  query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  release: () => void;
}

/** Último índice PUBLICADO (`synced`) do catálogo segundo a política de vigência, ou null quando nunca publicado. */
export async function getLatestCatalogIndex(catalogType: OfficialCatalogType): Promise<CatalogIndexInfo | null> {
  const db = await getDb();
  if (!db) return null;
  return pickPublished(catalogType, await readPublishedSnapshots(db, catalogType));
}

/** Entradas ATIVAS de UM snapshot publicado (só para encontrar candidatos; a verificação é por código, na fonte). */
export async function loadCatalogIndexEntries(catalogType: OfficialCatalogType, snapshotId: string): Promise<OfficialCatalogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ code: catalogEntriesTable.code, description: catalogEntriesTable.description, group: catalogEntriesTable.catalogGroup })
    .from(catalogEntriesTable)
    .where(and(
      eq(catalogEntriesTable.organizationId, GLOBAL_CATALOG_ORG), eq(catalogEntriesTable.catalogType, catalogType),
      eq(catalogEntriesTable.snapshotId, snapshotId), eq(catalogEntriesTable.active, true),
    ));
  return rows.map((r) => ({ catalogType, code: r.code, description: r.description, active: true, group: r.group ?? null }));
}
