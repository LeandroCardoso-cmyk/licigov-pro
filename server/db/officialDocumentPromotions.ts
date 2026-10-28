/**
 * C.4B.1 — Repositório do LEDGER IMUTÁVEL de emissão oficial governada.
 *
 * Append-only: cada promoção humana (rascunho → official `emitido`) grava UMA linha em
 * `official_document_promotions`. Nunca atualiza/deleta. Multi-tenant por organization_id.
 * Aceita executor (tx externa) para compor o commit atômico da promoção (ver documentPromotionService).
 * Padrão getDb(): degrada graciosamente sem DB.
 */
import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "./connection";
import { toDbDatetime } from "./institutionalConsultations";
import { officialDocumentPromotionsTable } from "../../drizzle/schema";

type PromoDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type PromotionExecutor = PromoDb | Parameters<Parameters<PromoDb["transaction"]>[0]>[0];

export interface OfficialPromotionRecord {
  organizationId: number;
  processId: string;
  officialDocumentId: string;
  lineageId: string;
  documentKind: string;
  version: number;
  contentHash: string;
  actorUserId: number;
  authorUserId: number | null;
  previousStatus: string;
  nextStatus: string;
  reason: string | null;
  correlationId: string;
  idempotencyKey: string;
  /** Instante (ISO) do ato. Ausente ⇒ default do banco (comportamento anterior). Emissão templated: instante oficial da transação. */
  createdAt?: string;
}

/** Insere UMA emissão no ledger (append-only). Idempotência garantida pela UNIQUE (org, idempotencyKey). */
export async function insertOfficialPromotion(rec: OfficialPromotionRecord, executor?: PromotionExecutor): Promise<void> {
  const db = executor ?? await getDb();
  if (!db) return;
  await db.insert(officialDocumentPromotionsTable).values({
    organizationId: rec.organizationId, processId: rec.processId, officialDocumentId: rec.officialDocumentId,
    lineageId: rec.lineageId, documentKind: rec.documentKind, version: rec.version, contentHash: rec.contentHash,
    actorUserId: rec.actorUserId, authorUserId: rec.authorUserId, previousStatus: rec.previousStatus,
    nextStatus: rec.nextStatus, reason: rec.reason, correlationId: rec.correlationId, idempotencyKey: rec.idempotencyKey,
    ...(rec.createdAt !== undefined ? { createdAt: toDbDatetime(rec.createdAt) ?? undefined } : {}),
  });
}

/** Última emissão oficial (mais recente) de um (processo, kind), tenant-scoped — para a UI e divergência. */
export async function getLatestOfficialPromotion(
  organizationId: number, processId: string, documentKind: string, executor?: PromotionExecutor,
): Promise<{ officialDocumentId: string; lineageId: string; version: number; contentHash: string; actorUserId: number; createdAt: string } | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentPromotionsTable)
    .where(and(
      eq(officialDocumentPromotionsTable.organizationId, organizationId),
      eq(officialDocumentPromotionsTable.processId, processId),
      eq(officialDocumentPromotionsTable.documentKind, documentKind),
    ))
    .orderBy(desc(officialDocumentPromotionsTable.version))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    officialDocumentId: r.officialDocumentId, lineageId: r.lineageId, version: r.version,
    contentHash: r.contentHash, actorUserId: r.actorUserId, createdAt: r.createdAt,
  };
}

/** Última emissão por tipo: revisão técnica da versão (`version`, numeração da linhagem) e QUANTAS emissões já houve. */
export interface LatestOfficialEmission { readonly version: number; readonly emissions: number }

/**
 * M8 (homologação visual) — última versão oficial EMITIDA por (processo, tipo), em lote e tenant-scoped. Leitura pura do
 * ledger de promoções (append-only, uma linha por emissão): além da revisão técnica, a CONTAGEM de emissões dá o número
 * ordinal da emissão vigente ("1ª emissão") — a linhagem numera também os snapshots técnicos, então a 1ª emissão costuma ser v2.
 */
export async function listLatestOfficialEmissions(
  organizationId: number, processIds: readonly string[],
): Promise<Map<string, Partial<Record<string, LatestOfficialEmission>>>> {
  const out = new Map<string, Partial<Record<string, LatestOfficialEmission>>>();
  if (processIds.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({
    processId: officialDocumentPromotionsTable.processId,
    documentKind: officialDocumentPromotionsTable.documentKind,
    version: max(officialDocumentPromotionsTable.version),
    emissions: count(officialDocumentPromotionsTable.id),
  }).from(officialDocumentPromotionsTable)
    .where(and(
      eq(officialDocumentPromotionsTable.organizationId, organizationId),
      inArray(officialDocumentPromotionsTable.processId, [...processIds]),
    ))
    .groupBy(officialDocumentPromotionsTable.processId, officialDocumentPromotionsTable.documentKind);
  for (const r of rows) {
    if (r.version === null) continue;
    const m = out.get(r.processId) ?? {};
    m[r.documentKind] = { version: Number(r.version), emissions: Number(r.emissions) };
    out.set(r.processId, m);
  }
  return out;
}

/** Projeções da mesma leitura: revisão técnica (`officialVersions`, contrato existente) e número de emissões (`officialEmissions`). */
export function officialVersionsOf(e: Partial<Record<string, LatestOfficialEmission>> | undefined): Partial<Record<string, number>> {
  return Object.fromEntries(Object.entries(e ?? {}).map(([k, v]) => [k, v!.version]));
}
export function officialEmissionsOf(e: Partial<Record<string, LatestOfficialEmission>> | undefined): Partial<Record<string, number>> {
  return Object.fromEntries(Object.entries(e ?? {}).map(([k, v]) => [k, v!.emissions]));
}

/** Contrato anterior (revisão técnica da última emissão por tipo), derivado da MESMA leitura. */
export async function listLatestOfficialVersions(
  organizationId: number, processIds: readonly string[],
): Promise<Map<string, Partial<Record<string, number>>>> {
  const all = await listLatestOfficialEmissions(organizationId, processIds);
  return new Map([...all].map(([pid, e]) => [pid, officialVersionsOf(e)]));
}

/** Quantas emissões oficiais (processo, tipo) já teve — o ordinal da emissão vigente. Tenant-scoped; 0 sem DB. */
export async function countOfficialPromotions(organizationId: number, processId: string, documentKind: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ n: count(officialDocumentPromotionsTable.id) }).from(officialDocumentPromotionsTable)
    .where(and(
      eq(officialDocumentPromotionsTable.organizationId, organizationId),
      eq(officialDocumentPromotionsTable.processId, processId),
      eq(officialDocumentPromotionsTable.documentKind, documentKind),
    ));
  return Number(rows[0]?.n ?? 0);
}
