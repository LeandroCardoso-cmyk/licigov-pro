/**
 * RC-5.1 — "Tirar Dúvidas" (Institutional Consultation) · Service.
 *
 * Orquestra a consulta institucional REUTILIZANDO integralmente a infraestrutura existente:
 *   executeCognitiveTask() → InstitutionalContextResolver → KnowledgeRetrievalService →
 *   ContextPackage → AIExecutionEngine
 * via a Institutional Knowledge Integration Layer (RC-5.0). NÃO cria pipeline/engine/IA novos.
 * Nenhum caminho alternativo: o Corpus e o AIExecutionEngine só são acessados pela camada.
 * Multi-tenant, replay-safe, auditável.
 */

import { buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "./officialCorpus/officialCorpusBuilder";
import { executeCognitiveTaskWithInstitutionalContext } from "./institutionalIntegration/institutionalKnowledgeIntegration";
import {
  buildConsultationAnswer, sanitizeQuestion, CONSULTATION_DOMAIN_CODE,
  type InstitutionalConsultationAnswer,
} from "../domain/institutionalConsultation";
import { recordConsultation, type ConsultationHistoryEntry } from "./institutionalConsultationObservabilityService";

/** Corpus oficial memoizado (build determinístico único por processo — não é RAG/cache paralelo). */
let _corpus: OfficialCorpusBuildResult | null = null;
export function getOfficialCorpus(): OfficialCorpusBuildResult {
  if (!_corpus) _corpus = buildOfficialKnowledgeCorpus({ correlationId: "consultation-corpus" });
  return _corpus;
}

/** Injeta um corpus (para testes determinísticos). */
export function __setOfficialCorpusForTests(corpus: OfficialCorpusBuildResult | null): void { _corpus = corpus; }

export interface AnswerConsultationParams {
  organizationId: number;
  userId: number;
  question: string;
  correlationId: string;
  userContext?: { state?: string | null; municipality?: string | null };
  /** Relógio determinístico opcional (ms) — só para telemetria; fora do replayHash. */
  now?: () => number;
  createdAt?: string;
}

/**
 * Responde uma consulta institucional. Toda execução passa OBRIGATORIAMENTE pelo fluxo institucional.
 * Registra histórico + observabilidade. Nunca inventa fundamento.
 */
export async function answerConsultation(params: AnswerConsultationParams): Promise<InstitutionalConsultationAnswer> {
  const question = sanitizeQuestion(params.question);
  if (question.length === 0) throw new Error("Pergunta vazia.");

  const corpus = getOfficialCorpus();
  const clock = params.now ?? (() => 0);
  const t0 = clock();

  // Fluxo institucional único (Componentes 1+2+3 + AIExecutionEngine).
  const { execution, contextPackage } = await executeCognitiveTaskWithInstitutionalContext(corpus, {
    tenantId: params.organizationId, businessDomain: CONSULTATION_DOMAIN_CODE, taskType: "LEGAL_ANALYSIS",
    query: question, correlationId: params.correlationId, userContext: params.userContext,
    cognitive: { task: "LEGAL_ANALYSIS", userId: String(params.userId), query: question },
  });
  const t1 = clock();

  const createdAt = params.createdAt ?? new Date().toISOString();
  const answer = buildConsultationAnswer({
    tenantId: params.organizationId, userId: params.userId, question,
    engineContent: execution.response.content, contextPackage, createdAt,
  });

  const t2 = clock();
  const entry: ConsultationHistoryEntry = {
    answerId: answer.answerId, correlationId: answer.correlationId, replayId: answer.replayId,
    tenantId: params.organizationId, userId: params.userId, question,
    documentCount: answer.documents.length, passageCount: answer.passages.length,
    hasSufficientBasis: answer.hasSufficientBasis, retrievalTimeMs: Math.max(0, t1 - t0), answerTimeMs: Math.max(0, t2 - t1),
    createdAt, answer,
  };
  recordConsultation(entry);

  return answer;
}
