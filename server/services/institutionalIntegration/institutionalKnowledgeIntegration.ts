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
import { resolveInstitutionalContext, type InstitutionalContext, type InstitutionalContextInput } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge, type RetrievalResult } from "./knowledgeRetrievalService";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import { executeCognitiveTask, type CognitiveTaskInput, type CognitiveExecution } from "../aiExecutionEngine";
import { recordIntegrationEvent } from "./institutionalIntegrationObservabilityService";
import { decideSourceScope, classifyApplicability, type SourceScopeDecision, type SourceApplicabilityInfo } from "../../domain/institutionalIntegration/sourceScopeRouter";

export interface ResolveContextPackageParams {
  tenantId: number;
  businessDomain?: string | null;
  taskType: string;
  query: string;
  correlationId: string;
  userContext?: { state?: string | null; municipality?: string | null };
  maxPassagesPerDocument?: number;
  maxPassageChars?: number;
  /**
   * SOURCE-SCOPE-ROUTER-001 — quando true, aplica o roteamento determinístico de escopo documental
   * ANTES do retrieval (restringe a 1ª busca ao diploma citado; amplia no máximo uma vez). Opt-in:
   * outros fluxos (workspace/orchestrator) preservam o comportamento anterior (escopo completo).
   */
  enableSourceScopeRouting?: boolean;
}

/** SOURCE-SCOPE-ROUTER-001 — abaixo destes limiares a 1ª busca restrita é considerada insuficiente. */
const SCOPE_EXPAND_COVERAGE_THRESHOLD = 0.5;
const SCOPE_EXPAND_SCORE_THRESHOLD = 0.15;
/** Restrito a UM único diploma → mais vagas por documento (há menos documentos; cabe o cluster inteiro). */
const SINGLE_DIPLOMA_MAX_PASSAGES = 6;

function scopeApplyDocuments(ctx: InstitutionalContext, allowedNormIds: readonly string[] | null): InstitutionalContext {
  if (!allowedNormIds) return ctx;
  const allow = new Set(allowedNormIds);
  return { ...ctx, applicableDocuments: ctx.applicableDocuments.filter(d => allow.has(d.normId)) };
}

/**
 * SOURCE-SCOPE-ROUTER-001 (lacuna 1) — remove do universo de retrieval as fontes SRP-específicas
 * (ex.: Decreto 11.462/2023) quando a pergunta NÃO tem relação direta com o SRP e o diploma não foi
 * citado explicitamente. Evita apresentar regra de Registro de Preços em pergunta geral sem relação.
 */
function applySrpRelevanceFilter(ctx: InstitutionalContext, scope: SourceScopeDecision, applicability: Record<string, SourceApplicabilityInfo>): InstitutionalContext {
  if (scope.srpRelated) return ctx;
  const requested = new Set(scope.requestedDiplomas);
  return {
    ...ctx,
    applicableDocuments: ctx.applicableDocuments.filter(d => {
      const info = applicability[d.normId];
      return !(info?.srpSpecific && !requested.has(d.normId));
    }),
  };
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

  // ── SOURCE-SCOPE-ROUTER-001 — decisão determinística de escopo (opt-in) ──────────────────────────
  const applicableNormIds = institutional.applicableDocuments.map(d => d.normId);
  const scope: SourceScopeDecision | null = params.enableSourceScopeRouting
    ? decideSourceScope({ question: params.query, availableNormIds: applicableNormIds })
    : null;

  // Aplicabilidade institucional de todas as fontes aplicáveis (auditoria + ressalvas).
  const applicability: Record<string, SourceApplicabilityInfo> = {};
  for (const d of institutional.applicableDocuments) applicability[d.normId] = classifyApplicability(d);

  // LACUNA 4 — ISOLAMENTO ESTRITO: verifica APENAS o tenant atual. Uma norma municipal foi vinculada
  // a ESTE tenant? `institutional.applicableDocuments` já é resolvido com escopo do tenant (municipal
  // só entra por tenantId próprio OU município do cadastro). NUNCA se consulta o corpus de outro
  // tenant — nem mesmo a EXISTÊNCIA (booleano) de fixture alheio (isso seria inferência cross-tenant).
  const municipalResolvedForTenant = institutional.applicableDocuments.some(d => d.jurisdiction === "municipal");

  // ── LACUNA 3 — pergunta ambígua: SOLICITAR ESCLARECIMENTO, sem retrieval conclusivo ──────────────
  if (scope && scope.ambiguous) {
    const emptyPkg = createContextPackage({
      correlationId: params.correlationId, tenantId: params.tenantId, municipality: institutional.municipality,
      state: institutional.state, businessDomain: params.businessDomain ?? null, taskType: params.taskType,
      hierarchy: [...institutional.hierarchy], documents: [], retrievedPassages: [], citations: [], explainability: [],
      metadata: {
        documentsLoaded: [], documentsIgnored: applicableNormIds, applicable: institutional.applicableDocuments.length,
        coverageRatio: 0, maxPassageScore: 0, searchRounds: 0, topPassageGenericContainer: false,
        sourceScope: {
          intent: scope.intent, requestedDiplomas: scope.requestedDiplomas, initialScopeNormIds: scope.initialScopeNormIds ?? applicableNormIds,
          expanded: false, expansionReason: null, includedNormIds: [], discardedNormIds: applicableNormIds.slice().sort(),
          applicability, reasoning: scope.reasoning,
          ambiguous: true, clarificationPrompt: scope.clarificationPrompt,
          municipalResolvedForTenant, municipalNormUnavailableForTenant: false,
        },
      },
    });
    recordIntegrationEvent({ correlationId: params.correlationId, replayId: emptyPkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextResolution", detail: `${institutional.applicableDocuments.length} documento(s) aplicável(is)`, count: institutional.applicableDocuments.length, retrievalTimeMs: 0 });
    recordIntegrationEvent({ correlationId: params.correlationId, replayId: emptyPkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "sourceScope", detail: `AMBÍGUA — esclarecimento solicitado; retrieval não executado; intent=${scope.intent}`, count: 0, retrievalTimeMs: 0 });
    recordIntegrationEvent({ correlationId: params.correlationId, replayId: emptyPkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextPackageBuilt", detail: emptyPkg.contextId, count: 0, retrievalTimeMs: 0 });
    return emptyPkg;
  }

  // LACUNA 1 — fontes SRP-específicas (ex.: Decreto 11.462) só entram quando a pergunta tem relação
  // DIRETA com o SRP, ou quando o diploma foi citado explicitamente. Filtro aplicado ao universo de
  // retrieval (1ª busca e ampliação) — evita apresentar regra de SRP em pergunta geral sem relação.
  const retrievalUniverse: InstitutionalContext = scope
    ? applySrpRelevanceFilter(institutional, scope, applicability)
    : institutional;

  const firstCtx = scope ? scopeApplyDocuments(retrievalUniverse, scope.initialScopeNormIds) : retrievalUniverse;
  // Restrito a um único diploma → cabe o cluster temático inteiro (ex.: arts. 72-75 da Contratação Direta).
  const firstMaxPer = scope && scope.initialScopeNormIds && firstCtx.applicableDocuments.length === 1
    ? Math.max(params.maxPassagesPerDocument ?? 3, SINGLE_DIPLOMA_MAX_PASSAGES)
    : params.maxPassagesPerDocument;

  let retrieval: RetrievalResult = retrieveKnowledge(corpus, firstCtx, { query: params.query, maxPassagesPerDocument: firstMaxPer, maxPassageChars: params.maxPassageChars });

  // Ampliação para fontes complementares — no MÁXIMO uma vez. Ocorre só quando a 1ª busca foi restrita
  // E (o usuário pediu fontes complementares OU a 1ª busca foi insuficiente). Determinístico.
  let expanded = false;
  let expansionReason: string | null = null;
  if (scope && scope.initialScopeNormIds && firstCtx.applicableDocuments.length < retrievalUniverse.applicableDocuments.length) {
    const insufficient = retrieval.passages.length === 0
      || retrieval.coverageRatio < SCOPE_EXPAND_COVERAGE_THRESHOLD
      || retrieval.maxPassageScore < SCOPE_EXPAND_SCORE_THRESHOLD;
    if (scope.expansionRequestedByUser || insufficient) {
      expanded = true;
      expansionReason = scope.expansionRequestedByUser ? "usuario_solicitou_fontes_complementares" : "primeira_busca_insuficiente";
      retrieval = retrieveKnowledge(corpus, retrievalUniverse, { query: params.query, maxPassagesPerDocument: params.maxPassagesPerDocument, maxPassageChars: params.maxPassageChars });
    }
  }

  // Auditoria de escopo: fontes efetivamente incluídas × descartadas + aplicabilidade institucional.
  const includedNormIds = [...new Set(retrieval.documents.map(d => d.normId))].sort();
  const includedSet = new Set(includedNormIds);
  const discardedNormIds = applicableNormIds.filter(n => !includedSet.has(n)).sort();
  // LACUNA 4 (isolamento estrito) — pergunta municipal cujo TENANT ATUAL não possui norma municipal
  // vinculada. Depende SOMENTE do tenant atual (nunca da existência de fixture de outro tenant).
  const municipalNormUnavailableForTenant = !!scope && scope.intent === "municipal" && !municipalResolvedForTenant;
  const sourceScopeAudit = scope
    ? {
        intent: scope.intent,
        requestedDiplomas: scope.requestedDiplomas,
        initialScopeNormIds: scope.initialScopeNormIds ?? applicableNormIds,
        expanded,
        expansionReason,
        includedNormIds,
        discardedNormIds,
        applicability,
        reasoning: scope.reasoning,
        ambiguous: false,
        clarificationPrompt: null,
        municipalResolvedForTenant,
        municipalNormUnavailableForTenant,
      }
    : undefined;

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
      // SOURCE-SCOPE-ROUTER-001 — decisão de escopo (persistida no contextSnapshot; parte do replayHash → replay-safe).
      ...(sourceScopeAudit ? { sourceScope: sourceScopeAudit } : {}),
    },
  });

  // Observabilidade (Context Resolution + Knowledge Retrieval).
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextResolution", detail: `${institutional.applicableDocuments.length} documento(s) aplicável(is)`, count: institutional.applicableDocuments.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "knowledgeRetrieval", detail: `${retrieval.passages.length} trecho(s) recuperado(s)`, count: retrieval.passages.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "documentsLoaded", detail: retrieval.documentsLoaded.join(","), count: retrieval.documentsLoaded.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "documentsIgnored", detail: retrieval.documentsIgnored.join(","), count: retrieval.documentsIgnored.length, retrievalTimeMs: 0 });
  recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "contextPackageBuilt", detail: pkg.contextId, count: pkg.documents.length, retrievalTimeMs: 0 });

  // SOURCE-SCOPE-ROUTER-001 — auditoria do escopo (intenção, diploma, incluídas/descartadas, ampliação).
  if (sourceScopeAudit) {
    recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "sourceScope", detail: `intent=${sourceScopeAudit.intent}; diplomas=[${sourceScopeAudit.requestedDiplomas.join(",")}]; incluídas=[${sourceScopeAudit.includedNormIds.join(",")}]; descartadas=[${sourceScopeAudit.discardedNormIds.join(",")}]`, count: sourceScopeAudit.includedNormIds.length, retrievalTimeMs: 0 });
    if (sourceScopeAudit.expanded) {
      recordIntegrationEvent({ correlationId: params.correlationId, replayId: pkg.replayId, tenantId: params.tenantId, businessDomain: params.businessDomain ?? null, taskType: params.taskType, type: "sourceScopeExpansion", detail: sourceScopeAudit.expansionReason ?? "", count: 1, retrievalTimeMs: 0 });
    }
  }

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
