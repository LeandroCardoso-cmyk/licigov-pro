/**
 * RC-5.0 — Institutional Knowledge Integration Layer · API pública (Orchestrator seam).
 *
 * Única camada que integra o Kernel Cognitivo ao Official Knowledge Corpus, mantendo BAIXO
 * ACOPLAMENTO. Fluxo institucional obrigatório:
 *
 *   Business Domain → executeCognitiveTask() → Orchestrator → InstitutionalContextResolver →
 *   KnowledgeRetrieval → ContextPackage → AIExecutionEngine
 *
 * O Corpus JAMAIS é acessado diretamente por Copilots/AIExecutionEngine — apenas por esta camada.
 * Não executa IA, não interpreta documentos, não responde perguntas.
 */

import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContext, type InstitutionalContextInput } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge } from "./knowledgeRetrievalService";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import { executeCognitiveTask, type CognitiveTaskInput, type CognitiveExecution } from "../aiExecutionEngine";
import { recordIntegrationEvent } from "./institutionalIntegrationObservabilityService";

export interface ResolveContextPackageParams {
  tenantId: number;
  businessDomain?: string | null;
  taskType: string;
  query: string;
  correlationId: string;
  userContext?: { state?: string | null; municipality?: string | null };
  maxPassagesPerDocument?: number;
  maxPassageChars?: number;
}

/**
 * Resolve o ContextPackage institucional (Componentes 1+2+3) — o passo executado pelo Orchestrator
 * ANTES do AIExecutionEngine. Determinístico, replay-safe. `nowMs` (opcional) só para latência.
 */
export function resolveInstitutionalContextPackage(corpus: OfficialCorpusBuildResult, params: ResolveContextPackageParams): ContextPackage {
  const ctxInput: InstitutionalContextInput = {
    tenantId: params.tenantId, businessDomain: params.businessDomain, taskType: params.taskType, userContext: params.userContext,
  };
  const institutional = resolveInstitutionalContext(corpus.registry, ctxInput);
  const retrieval = retrieveKnowledge(corpus, institutional, { query: params.query, maxPassagesPerDocument: params.maxPassagesPerDocument, maxPassageChars: params.maxPassageChars });

  const pkg = createContextPackage({
    correlationId: params.correlationId, tenantId: params.tenantId, municipality: institutional.municipality,
    state: institutional.state, businessDomain: params.businessDomain ?? null, taskType: params.taskType,
    hierarchy: [...institutional.hierarchy], documents: [...retrieval.documents],
    retrievedPassages: [...retrieval.passages], citations: [...retrieval.citations],
    explainability: [...retrieval.explainability],
    metadata: {
      documentsLoaded: retrieval.documentsLoaded, documentsIgnored: retrieval.documentsIgnored, applicable: institutional.applicableDocuments.length,
      // RAG-QUALITY-001/002 — sinais de qualidade da recuperação (para a classificação de suficiência de evidência).
      coverageRatio: retrieval.coverageRatio, maxPassageScore: retrieval.maxPassageScore, searchRounds: retrieval.searchRounds,
      topPassageGenericContainer: retrieval.topPassageGenericContainer,
    },
  });

  // Observabilidade (Context Resolution + Knowledge Retrieval).
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextResolution", detail: `${institutional.applicableDocuments.length} documento(s) aplicável(is)`, count: institutional.applicableDocuments.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "knowledgeRetrieval", detail: `${retrieval.passages.length} trecho(s) recuperado(s)`, count: retrieval.passages.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "documentsLoaded", detail: retrieval.documentsLoaded.join(","), count: retrieval.documentsLoaded.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "documentsIgnored", detail: retrieval.documentsIgnored.join(","), count: retrieval.documentsIgnored.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextPackageBuilt", detail: pkg.contextId, count: pkg.documents.length, retrievalTimeMs: 0 });

  return pkg;
}

export interface ExecuteWithContextParams extends ResolveContextPackageParams {
  /** Entrada cognitiva (o AIExecutionEngine só CONSOME o ContextPackage resolvido). */
  cognitive: Omit<CognitiveTaskInput, "contextPackage" | "tenantId" | "correlationId">;
}

/**
 * Orchestrator seam completo: resolve o ContextPackage e executa o AIExecutionEngine consumindo-o.
 * O AIExecutionEngine permanece desacoplado — não resolve tenant/legislação/hierarquia/corpus.
 */
export async function executeCognitiveTaskWithInstitutionalContext(corpus: OfficialCorpusBuildResult, params: ExecuteWithContextParams): Promise<{ execution: CognitiveExecution; contextPackage: ContextPackage }> {
  const contextPackage = resolveInstitutionalContextPackage(corpus, params);
  const execution = await executeCognitiveTask({
    ...params.cognitive, tenantId: params.tenantId, correlationId: params.correlationId, contextPackage,
  });
  return { execution, contextPackage };
}
