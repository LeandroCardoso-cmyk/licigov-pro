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
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { createHash } from "crypto";
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

interface IndexIntegrity extends SnapshotIntegrity {
  kind: typeof INDEX_KIND; complete: boolean; pages: number; total: number | null; entries: number;
}

export interface CatalogIndexInfo {
  readonly snapshotId: string; readonly catalogType: OfficialCatalogType; readonly retrievedAt: string;
  readonly complete: boolean; readonly pages: number; readonly total: number | null; readonly entries: number; readonly checksum: string;
}

const parseMeta = <T>(v: unknown): T | null => (typeof v === "string" ? JSON.parse(v) : v) as T | null;

/**
 * Grava uma sincronização do índice: snapshot IMUTÁVEL (id pelo checksum do catálogo inteiro) + entradas da org 0.
 * Sincronização COMPLETA desativa as entradas que não vieram nela (código retirado da fonte). Parcial não desativa nada.
 */
export async function recordCatalogIndexSnapshot(p: {
  catalogType: OfficialCatalogType; entries: readonly OfficialCatalogEntry[]; checksum: string; retrievedAt: string;
  sourceUrl: string; pages: number; total: number | null; complete: boolean; pageSize: number; correlationId: string;
}): Promise<{ snapshotId: string; deactivated: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const snapshotId = catalogSnapshotId(GLOBAL_CATALOG_ORG, p.catalogType, `${INDEX_KIND}:${p.checksum}`);
  const integrity: IndexIntegrity = {
    checksumAlg: "sha256", verifiedAt: p.retrievedAt, isValid: true, source: OFFICIAL_CATALOG_SOURCE, sourceUrl: p.sourceUrl,
    query: { page: 1, pageSize: p.pageSize }, kind: INDEX_KIND, complete: p.complete, pages: p.pages, total: p.total, entries: p.entries.length,
  };
  await db.insert(catalogSnapshotsTable).values({
    id: snapshotId, organizationId: GLOBAL_CATALOG_ORG, catalogType: p.catalogType,
    version: `${INDEX_KIND}@${p.retrievedAt}`.slice(0, 50), checksum: p.checksum,
    totalEntries: p.entries.length, indexedEntries: p.entries.length, syncStatus: "synced",
    snapshotLineage: null, importLineage: [], integrityMetadata: integrity,
    cacheMetadata: { cachedAt: p.retrievedAt, expiresAt: p.retrievedAt, stale: false },
    correlationId: p.correlationId.slice(0, 64),
  }).onDuplicateKeyUpdate({ set: { syncStatus: "synced" } });
  const CHUNK = 200;
  for (let i = 0; i < p.entries.length; i += CHUNK) {
    const rows = p.entries.slice(i, i + CHUNK).map((e) => {
      const normalized = normalizeCatalogDescription(e.description);
      return {
        id: catalogEntryId(GLOBAL_CATALOG_ORG, p.catalogType, e.code), organizationId: GLOBAL_CATALOG_ORG, code: e.code,
        catalogType: p.catalogType, description: e.description, normalizedDescription: normalized,
        catalogGroup: e.group?.slice(0, 255) ?? null, aliases: [], tokens: normalized.split(" ").filter((w) => w.length > 2),
        active: e.active === true, snapshotId,
      };
    });
    await db.insert(catalogEntriesTable).values(rows).onDuplicateKeyUpdate({
      set: {
        description: sql`VALUES(description)`, normalizedDescription: sql`VALUES(normalized_description)`,
        catalogGroup: sql`VALUES(catalog_group)`, active: sql`VALUES(active)`, snapshotId: sql`VALUES(snapshot_id)`,
      },
    });
  }
  let deactivated = 0;
  if (p.complete) {
    const res = await db.update(catalogEntriesTable).set({ active: false }).where(and(
      eq(catalogEntriesTable.organizationId, GLOBAL_CATALOG_ORG), eq(catalogEntriesTable.catalogType, p.catalogType),
      ne(catalogEntriesTable.snapshotId, snapshotId), eq(catalogEntriesTable.active, true),
    ));
    deactivated = Number(((Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  }
  return { snapshotId, deactivated };
}

/** Sincronização mais recente do índice (ou null quando nunca sincronizado). */
export async function getLatestCatalogIndex(catalogType: OfficialCatalogType): Promise<CatalogIndexInfo | null> {
  const db = await getDb();
  if (!db) return null;
  const snaps = await db.select().from(catalogSnapshotsTable)
    .where(and(eq(catalogSnapshotsTable.organizationId, GLOBAL_CATALOG_ORG), eq(catalogSnapshotsTable.catalogType, catalogType)))
    .orderBy(desc(catalogSnapshotsTable.createdAt)).limit(20);
  for (const s of snaps) {
    const meta = parseMeta<Partial<IndexIntegrity>>(s.integrityMetadata);
    if (meta?.kind !== INDEX_KIND || meta.source !== OFFICIAL_CATALOG_SOURCE || typeof meta.verifiedAt !== "string") continue;
    return {
      snapshotId: s.id, catalogType, retrievedAt: meta.verifiedAt, complete: meta.complete === true, pages: meta.pages ?? 0,
      total: meta.total ?? null, entries: meta.entries ?? s.totalEntries, checksum: s.checksum,
    };
  }
  return null;
}

/** Entradas ATIVAS do índice (só para encontrar candidatos; a verificação é por código, na fonte). */
export async function loadCatalogIndexEntries(catalogType: OfficialCatalogType): Promise<OfficialCatalogEntry[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ code: catalogEntriesTable.code, description: catalogEntriesTable.description, group: catalogEntriesTable.catalogGroup })
    .from(catalogEntriesTable)
    .where(and(eq(catalogEntriesTable.organizationId, GLOBAL_CATALOG_ORG), eq(catalogEntriesTable.catalogType, catalogType), eq(catalogEntriesTable.active, true)));
  return rows.map((r) => ({ catalogType, code: r.code, description: r.description, active: true, group: r.group ?? null }));
}
