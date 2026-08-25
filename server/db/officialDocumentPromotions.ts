/**
 * C.4B.1 — Repositório do LEDGER IMUTÁVEL de emissão oficial governada.
 *
 * Append-only: cada promoção humana (rascunho → official `emitido`) grava UMA linha em
 * `official_document_promotions`. Nunca atualiza/deleta. Multi-tenant por organization_id.
 * Aceita executor (tx externa) para compor o commit atômico da promoção (ver documentPromotionService).
 * Padrão getDb(): degrada graciosamente sem DB.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
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
