/**
 * RC-5.1 (correção) — "Tirar Dúvidas" · Service (persistência institucional).
 *
 * Orquestra a consulta REUTILIZANDO integralmente a infraestrutura existente (RC-5.0) e PERSISTE
 * o resultado no banco (fonte de verdade), com estados explícitos, identidade de execução/replay e
 * observabilidade durável. Não cria IA/pipeline/engine. Multi-tenant, replay-safe, auditável.
 */

import { createHash } from "crypto";
import { buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "./officialCorpus/officialCorpusBuilder";
import { executeCognitiveTaskWithInstitutionalContext } from "./institutionalIntegration/institutionalKnowledgeIntegration";
import type { ContextPackage } from "../domain/institutionalIntegration/contextPackage";
import {
  buildConsultationAnswer, sanitizeQuestion, normalizeQuestion, sanitizeErrorMessage,
  computeExecutionId, computeReplayId, CONSULTATION_DOMAIN_CODE,
  type InstitutionalConsultationAnswer, type ConsultationRecord, type ConsultationSource,
} from "../domain/institutionalConsultation";
import { getConsultationRepository } from "./institutionalConsultationRepository";

/** Corpus oficial memoizado (build determinístico único por processo — não é RAG/cache paralelo). */
let _corpus: OfficialCorpusBuildResult | null = null;
export function getOfficialCorpus(): OfficialCorpusBuildResult {
  if (!_corpus) _corpus = buildOfficialKnowledgeCorpus({ correlationId: "consultation-corpus" });
  return _corpus;
}
export function __setOfficialCorpusForTests(corpus: OfficialCorpusBuildResult | null): void { _corpus = corpus; }

const TASK_TYPE = "LEGAL_ANALYSIS";

function buildSources(tenantId: number, consultationId: string, pkg: ContextPackage, createdAt: string): ConsultationSource[] {
  const docById = new Map(pkg.documents.map(d => [d.documentId, d]));
  return pkg.retrievedPassages.map((p, i) => {
    const doc = docById.get(p.documentId);
    const cit = pkg.citations[i];
    const id = createHash("sha256").update(`icsrc:${tenantId}:${consultationId}:${i}`).digest("hex").slice(0, 32);
    return {
      id, tenantId, consultationId, documentId: p.documentId, documentVersion: doc?.version ?? cit?.version ?? "",
      documentTitle: doc?.title ?? "", documentType: doc?.bindingLevel ?? "", authority: doc?.authority ?? cit?.authority ?? "",
      jurisdiction: doc?.jurisdiction ?? cit?.jurisdiction ?? "", bindingLevel: doc?.bindingLevel ?? cit?.bindingLevel ?? "",
      citation: cit?.reference ?? "", passage: p.text, lineage: cit?.lineageId ?? "", sourceOrder: i, createdAt,
    };
  });
}

function buildSnapshot(pkg: ContextPackage): string {
  return JSON.stringify({
    schemaVersion: pkg.contract, contextReplayHash: pkg.replayHash, createdAt: pkg.contextId,
    documents: pkg.documents.map(d => ({ documentId: d.documentId, version: d.version, authority: d.authority, jurisdiction: d.jurisdiction, bindingLevel: d.bindingLevel })),
    citations: pkg.citations.map(c => ({ reference: c.reference, lineageId: c.lineageId })),
    passages: pkg.retrievedPassages.map(p => ({ blockId: p.blockId, identifier: p.identifier, score: p.score })),
  });
}

export interface AnswerConsultationParams {
  organizationId: number;
  userId: number;
  question: string;
  correlationId: string;
  userContext?: { state?: string | null; municipality?: string | null };
  now?: () => number;
  createdAt?: () => string;
  /** Replay real de uma execução anterior (define replayOfExecutionId + replayId). */
  replayOfExecutionId?: string | null;
}

/**
 * Responde uma consulta institucional e PERSISTE (pending → processing → completed/limited | failed).
 * Cada chamada é uma execução independente (executionId distinto por correlationId). Nunca marca
 * concluída sem persistir as fontes; em falha, registra `failed` com mensagem sanitizada.
 */
export async function answerConsultation(params: AnswerConsultationParams): Promise<InstitutionalConsultationAnswer> {
  const repo = getConsultationRepository();
  const question = sanitizeQuestion(params.question);
  if (question.length === 0) throw new Error("Pergunta vazia.");
  const normalizedQuestion = normalizeQuestion(params.question);
  const clock = params.now ?? (() => 0);
  const nowIso = params.createdAt ?? (() => new Date().toISOString());

  const executionId = computeExecutionId(params.organizationId, params.correlationId);
  const replayOfExecutionId = params.replayOfExecutionId ?? null;
  const replayId = replayOfExecutionId ? computeReplayId(params.correlationId, replayOfExecutionId) : null;
  const createdAt = nowIso();

  // Estado inicial: pending → processing.
  const pending: ConsultationRecord = {
    id: executionId, tenantId: params.organizationId, userId: params.userId, question, normalizedQuestion,
    answer: "", status: "pending", limitationReason: "", contextPackageVersion: "", contextReplayHash: "",
    executionId, answerId: "", replayId, replayOfExecutionId, correlationId: params.correlationId,
    businessDomain: CONSULTATION_DOMAIN_CODE, taskType: TASK_TYPE, documentsCount: 0, passagesCount: 0,
    retrievalDurationMs: 0, executionDurationMs: 0, totalDurationMs: 0, contextSnapshot: null,
    errorCode: "", errorMessage: "", createdAt, startedAt: null, completedAt: null, failedAt: null, updatedAt: createdAt,
  };
  await repo.createConsultation(pending);
  const startedAtIso = nowIso();
  await repo.markProcessing(params.organizationId, executionId, startedAtIso);

  const t0 = clock();
  try {
    const { execution, contextPackage } = await executeCognitiveTaskWithInstitutionalContext(getOfficialCorpus(), {
      tenantId: params.organizationId, businessDomain: CONSULTATION_DOMAIN_CODE, taskType: TASK_TYPE,
      query: question, correlationId: params.correlationId, userContext: params.userContext,
      cognitive: { task: "LEGAL_ANALYSIS", userId: String(params.userId), query: question },
    });
    const t1 = clock();

    const answer = buildConsultationAnswer({
      tenantId: params.organizationId, userId: params.userId, question, engineContent: execution.response.content,
      contextPackage, executionId, replayId, replayOfExecutionId, createdAt,
    });
    const sources = buildSources(params.organizationId, executionId, contextPackage, createdAt);
    const t2 = clock();
    const completedAt = nowIso();

    const completed: ConsultationRecord = {
      ...pending, answer: answer.answer, status: answer.status, limitationReason: answer.limitations[0] ?? "",
      contextPackageVersion: contextPackage.contract, contextReplayHash: contextPackage.replayHash, answerId: answer.answerId,
      documentsCount: answer.documents.length, passagesCount: answer.passages.length,
      retrievalDurationMs: Math.max(0, t1 - t0), executionDurationMs: Math.max(0, t2 - t1), totalDurationMs: Math.max(0, t2 - t0),
      contextSnapshot: buildSnapshot(contextPackage), startedAt: startedAtIso, completedAt, updatedAt: completedAt,
    };
    await repo.completeConsultation(completed, sources);
    return answer;
  } catch (e) {
    const failedAt = nowIso();
    await repo.failConsultation(params.organizationId, executionId, "EXECUTION_ERROR", sanitizeErrorMessage(e instanceof Error ? e.message : String(e)), failedAt);
    throw e;
  }
}

// ── Leituras (histórico durável via repository) ───────────────────────────────

export function getConsultationForTenant(tenantId: number, id: string) {
  return getConsultationRepository().findByIdForTenant(tenantId, id);
}
export function getConsultationSources(tenantId: number, consultationId: string) {
  return getConsultationRepository().getSourcesForTenant(tenantId, consultationId);
}
export function listTenantHistory(tenantId: number, opts?: { limit?: number; offset?: number }) {
  return getConsultationRepository().listByTenant(tenantId, opts);
}
export function listUserHistory(tenantId: number, userId: number, opts?: { limit?: number; offset?: number }) {
  return getConsultationRepository().listByUserForTenant(tenantId, userId, opts);
}
export function findReplayCandidate(tenantId: number, contextReplayHash: string) {
  return getConsultationRepository().findReplayCandidate(tenantId, contextReplayHash);
}

/**
 * Replay REAL de uma execução anterior: nova execução vinculada à original (replayOfExecutionId),
 * com replayId próprio, preservando o contexto/versões (o mesmo fluxo institucional é reexecutado).
 * Distinto de "nova execução" e de "reuso de resultado persistido".
 */
export async function replayConsultation(params: { organizationId: number; userId: number; originalExecutionId: string; correlationId: string }): Promise<InstitutionalConsultationAnswer> {
  const repo = getConsultationRepository();
  const original = await repo.findByIdForTenant(params.organizationId, params.originalExecutionId);
  if (!original) throw new Error("Execução original não encontrada para replay.");
  return answerConsultation({
    organizationId: params.organizationId, userId: params.userId, question: original.question,
    correlationId: params.correlationId, replayOfExecutionId: original.executionId,
  });
}
