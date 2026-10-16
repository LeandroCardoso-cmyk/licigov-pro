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
 */
import { and, eq, inArray } from "drizzle-orm";
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
