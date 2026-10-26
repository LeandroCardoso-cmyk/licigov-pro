/**
 * C.4B.1 — Repositório do LEDGER IMUTÁVEL de emissão oficial governada.
 *
 * Append-only: cada promoção humana (rascunho → official `emitido`) grava UMA linha em
 * `official_document_promotions`. Nunca atualiza/deleta. Multi-tenant por organization_id.
 * Aceita executor (tx externa) para compor o commit atômico da promoção (ver documentPromotionService).
 * Padrão getDb(): degrada graciosamente sem DB.
 */
import { and, desc, eq, inArray, max } from "drizzle-orm";
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

/**
 * M8 (homologação visual) — última versão oficial EMITIDA por (processo, tipo), em lote e tenant-scoped. Leitura pura do
 * ledger de promoções: a UI distingue "rascunho" de "emitido vN" sem N consultas por processo.
 */
export async function listLatestOfficialVersions(
  organizationId: number, processIds: readonly string[],
): Promise<Map<string, Partial<Record<string, number>>>> {
  const out = new Map<string, Partial<Record<string, number>>>();
  if (processIds.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({
    processId: officialDocumentPromotionsTable.processId,
    documentKind: officialDocumentPromotionsTable.documentKind,
    version: max(officialDocumentPromotionsTable.version),
  }).from(officialDocumentPromotionsTable)
    .where(and(
      eq(officialDocumentPromotionsTable.organizationId, organizationId),
      inArray(officialDocumentPromotionsTable.processId, [...processIds]),
    ))
    .groupBy(officialDocumentPromotionsTable.processId, officialDocumentPromotionsTable.documentKind);
  for (const r of rows) {
    if (r.version === null) continue;
    const m = out.get(r.processId) ?? {};
    m[r.documentKind] = Number(r.version);
    out.set(r.processId, m);
  }
  return out;
}
