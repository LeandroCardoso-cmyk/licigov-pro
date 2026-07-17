/**
 * RC-5.1 (correção) — "Tirar Dúvidas" · Repository MySQL (fonte de verdade).
 *
 * Persistência real (Drizzle/MySQL) das consultas institucionais e das fontes utilizadas. Padrão
 * getDb(): degrada graciosamente sem DB (retorna null/[]/no-op). Multi-tenant por organization_id —
 * TODA query exige tenantId como boundary; nenhum método busca por id sem validar o tenant.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { institutionalConsultationsTable, institutionalConsultationSourcesTable } from "../../drizzle/schema";
import type { ConsultationRecord, ConsultationSource, ConsultationRepository, ConsultationStatus, ListOpts } from "../domain/institutionalConsultation";

type Row = typeof institutionalConsultationsTable.$inferSelect;
type SrcRow = typeof institutionalConsultationSourcesTable.$inferSelect;

function rowToRecord(r: Row): ConsultationRecord {
  return {
    id: r.id, tenantId: r.organizationId, userId: r.userId, question: r.question ?? "", normalizedQuestion: r.normalizedQuestion ?? "",
    answer: r.answer ?? "", status: r.status as ConsultationStatus, limitationReason: r.limitationReason,
    contextPackageVersion: r.contextPackageVersion, contextReplayHash: r.contextReplayHash, executionId: r.executionId,
    answerId: r.answerId, replayId: r.replayId ?? null, replayOfExecutionId: r.replayOfExecutionId ?? null,
    correlationId: r.correlationId, businessDomain: r.businessDomain, taskType: r.taskType,
    documentsCount: r.documentsCount, passagesCount: r.passagesCount, retrievalDurationMs: r.retrievalDurationMs,
    executionDurationMs: r.executionDurationMs, totalDurationMs: r.totalDurationMs, contextSnapshot: r.contextSnapshot ?? null,
    errorCode: r.errorCode, errorMessage: r.errorMessage, createdAt: r.createdAt, startedAt: r.startedAt ?? null,
    completedAt: r.completedAt ?? null, failedAt: r.failedAt ?? null, updatedAt: r.updatedAt,
  };
}
function rowToSource(r: SrcRow): ConsultationSource {
  return {
    id: r.id, tenantId: r.organizationId, consultationId: r.consultationId, documentId: r.documentId,
    documentVersion: r.documentVersion, documentTitle: r.documentTitle, documentType: r.documentType, authority: r.authority,
    jurisdiction: r.jurisdiction, bindingLevel: r.bindingLevel, citation: r.citation, passage: r.passage ?? "",
    lineage: r.lineage, sourceOrder: r.sourceOrder, createdAt: r.createdAt,
  };
}
function recordValues(rec: ConsultationRecord) {
  return {
    id: rec.id, organizationId: rec.tenantId, userId: rec.userId, question: rec.question, normalizedQuestion: rec.normalizedQuestion,
    answer: rec.answer, status: rec.status, limitationReason: rec.limitationReason, contextPackageVersion: rec.contextPackageVersion,
    contextReplayHash: rec.contextReplayHash, executionId: rec.executionId, answerId: rec.answerId, replayId: rec.replayId,
    replayOfExecutionId: rec.replayOfExecutionId, correlationId: rec.correlationId, businessDomain: rec.businessDomain, taskType: rec.taskType,
    documentsCount: rec.documentsCount, passagesCount: rec.passagesCount, retrievalDurationMs: rec.retrievalDurationMs,
    executionDurationMs: rec.executionDurationMs, totalDurationMs: rec.totalDurationMs, contextSnapshot: rec.contextSnapshot,
    errorCode: rec.errorCode, errorMessage: rec.errorMessage, createdAt: rec.createdAt, startedAt: rec.startedAt,
    completedAt: rec.completedAt, failedAt: rec.failedAt, updatedAt: rec.updatedAt,
  };
}

export const mysqlConsultationRepository: ConsultationRepository = {
  async createConsultation(rec) {
    const db = await getDb();
    if (!db) return rec;
    await db.insert(institutionalConsultationsTable).values(recordValues(rec))
      .onDuplicateKeyUpdate({ set: { status: rec.status, updatedAt: rec.updatedAt } });
    return rec;
  },

  async markProcessing(tenantId, id, startedAt) {
    const db = await getDb();
    if (!db) return;
    await db.update(institutionalConsultationsTable).set({ status: "processing", startedAt, updatedAt: startedAt })
      .where(and(eq(institutionalConsultationsTable.id, id), eq(institutionalConsultationsTable.organizationId, tenantId)));
  },

  async saveSources(sources) {
    const db = await getDb();
    if (!db || sources.length === 0) return;
    for (const s of sources) {
      await db.insert(institutionalConsultationSourcesTable).values({
        id: s.id, organizationId: s.tenantId, consultationId: s.consultationId, documentId: s.documentId,
        documentVersion: s.documentVersion, documentTitle: s.documentTitle, documentType: s.documentType, authority: s.authority,
        jurisdiction: s.jurisdiction, bindingLevel: s.bindingLevel, citation: s.citation, passage: s.passage,
        lineage: s.lineage, sourceOrder: s.sourceOrder, createdAt: s.createdAt,
      }).onDuplicateKeyUpdate({ set: { citation: s.citation, sourceOrder: s.sourceOrder } });
    }
  },

  async completeConsultation(rec, sources) {
    const db = await getDb();
    if (!db) return rec;
    // Ordem transacional: persiste fontes ANTES de marcar concluída (sem estado falsamente completo).
    await this.saveSources(sources);
    await db.update(institutionalConsultationsTable).set({
      answer: rec.answer, status: rec.status, limitationReason: rec.limitationReason, contextPackageVersion: rec.contextPackageVersion,
      contextReplayHash: rec.contextReplayHash, answerId: rec.answerId, replayId: rec.replayId, replayOfExecutionId: rec.replayOfExecutionId,
      documentsCount: rec.documentsCount, passagesCount: rec.passagesCount, retrievalDurationMs: rec.retrievalDurationMs,
      executionDurationMs: rec.executionDurationMs, totalDurationMs: rec.totalDurationMs, contextSnapshot: rec.contextSnapshot,
      completedAt: rec.completedAt, updatedAt: rec.updatedAt,
    }).where(and(eq(institutionalConsultationsTable.id, rec.id), eq(institutionalConsultationsTable.organizationId, rec.tenantId)));
    return rec;
  },

  async failConsultation(tenantId, id, errorCode, errorMessage, failedAt) {
    const db = await getDb();
    if (!db) return;
    await db.update(institutionalConsultationsTable).set({ status: "failed", errorCode, errorMessage, failedAt, updatedAt: failedAt })
      .where(and(eq(institutionalConsultationsTable.id, id), eq(institutionalConsultationsTable.organizationId, tenantId)));
  },

  async findByIdForTenant(tenantId, id) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(institutionalConsultationsTable)
      .where(and(eq(institutionalConsultationsTable.id, id), eq(institutionalConsultationsTable.organizationId, tenantId))).limit(1);
    return rows.length ? rowToRecord(rows[0]) : null;
  },

  async getSourcesForTenant(tenantId, consultationId) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(institutionalConsultationSourcesTable)
      .where(and(eq(institutionalConsultationSourcesTable.consultationId, consultationId), eq(institutionalConsultationSourcesTable.organizationId, tenantId)));
    return rows.map(rowToSource).sort((a, b) => a.sourceOrder - b.sourceOrder);
  },

  async listByTenant(tenantId, opts: ListOpts = {}) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(institutionalConsultationsTable)
      .where(eq(institutionalConsultationsTable.organizationId, tenantId))
      .orderBy(desc(institutionalConsultationsTable.createdAt)).limit(opts.limit ?? 50).offset(opts.offset ?? 0);
    return rows.map(rowToRecord);
  },

  async listByUserForTenant(tenantId, userId, opts: ListOpts = {}) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(institutionalConsultationsTable)
      .where(and(eq(institutionalConsultationsTable.organizationId, tenantId), eq(institutionalConsultationsTable.userId, userId)))
      .orderBy(desc(institutionalConsultationsTable.createdAt)).limit(opts.limit ?? 50).offset(opts.offset ?? 0);
    return rows.map(rowToRecord);
  },

  async findReplayCandidate(tenantId, contextReplayHash) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(institutionalConsultationsTable)
      .where(and(eq(institutionalConsultationsTable.organizationId, tenantId), eq(institutionalConsultationsTable.contextReplayHash, contextReplayHash), eq(institutionalConsultationsTable.status, "completed")))
      .orderBy(desc(institutionalConsultationsTable.createdAt)).limit(1);
    return rows.length ? rowToRecord(rows[0]) : null;
  },

  async verifyTenantOwnership(tenantId, id) {
    const db = await getDb();
    if (!db) return false;
    const rows = await db.select({ id: institutionalConsultationsTable.id }).from(institutionalConsultationsTable)
      .where(and(eq(institutionalConsultationsTable.id, id), eq(institutionalConsultationsTable.organizationId, tenantId))).limit(1);
    return rows.length > 0;
  },
};
