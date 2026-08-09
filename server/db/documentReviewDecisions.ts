/**
 * PR C.2B — Persistência do ledger IMUTÁVEL de decisões de revisão/aprovação documental.
 * Append-only, tenant-aware. Idempotência na fronteira do banco via UNIQUE
 * (organizationId, idempotencyKey): uma reexecução da MESMA chave não cria 2ª linha.
 * Degrada com segurança sem DB (getDb() → null).
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  documentReviewDecisionsTable,
  type DocumentReviewDecisionRow,
  type InsertDocumentReviewDecision,
} from "../../drizzle/schema";

export type DocumentReviewAction =
  | "submit_for_review"
  | "approve"
  | "reject"
  | "request_changes";

/** Anexa uma decisão ao ledger imutável (append-only). Retorna a linha inserida (ou null sem DB). */
export async function insertDocumentReviewDecision(
  params: InsertDocumentReviewDecision,
): Promise<DocumentReviewDecisionRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [inserted] = await db.insert(documentReviewDecisionsTable).values(params).$returningId();
  const rows = await db
    .select()
    .from(documentReviewDecisionsTable)
    .where(
      and(
        eq(documentReviewDecisionsTable.organizationId, params.organizationId),
        eq(documentReviewDecisionsTable.id, inserted.id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Trilha completa (append-only, ordem cronológica) de decisões de um documento — tenant-scoped. */
export async function getDocumentReviewDecisions(
  organizationId: number,
  documentId: number,
): Promise<DocumentReviewDecisionRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(documentReviewDecisionsTable)
    .where(
      and(
        eq(documentReviewDecisionsTable.organizationId, organizationId),
        eq(documentReviewDecisionsTable.documentId, documentId),
      ),
    )
    .orderBy(asc(documentReviewDecisionsTable.createdAt), asc(documentReviewDecisionsTable.id));
}
