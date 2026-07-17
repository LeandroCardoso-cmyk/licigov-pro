/**
 * Sprint 5.0 — Workspace Orchestrator Service (Multi-Copilot Orchestrator)
 *
 * Coordena múltiplos copilotos dentro do Workspace. Os copilotos deixam de atuar
 * isoladamente: uma solicitação é classificada, os copilotos necessários são
 * selecionados, executados em paralelo, seus resultados têm conflitos resolvidos
 * e são consolidados em uma recomendação única entregue ao servidor.
 *
 * Fluxo: Solicitação → Classificação → Seleção → Execução paralela →
 *        Resolução de conflitos → Consolidação → Validação → Recomendação.
 */

import type { CopilotType } from "../domain/institutionalCopilot";
import { rankCopilots } from "./copilotOrchestratorService";
import { runCopilotReasoning } from "./copilotReasoningService";
import { aggregateRiskLevel, type RecommendationRisk } from "../domain/copilotRecommendation";
// RC-5.0 — Institutional Knowledge Integration Layer (Orchestrator → Resolver → ContextPackage).
import { resolveInstitutionalContextPackage } from "./institutionalIntegration/institutionalKnowledgeIntegration";
import type { ContextPackage } from "../domain/institutionalIntegration/contextPackage";
import type { OfficialCorpusBuildResult } from "./officialCorpus/officialCorpusBuilder";

export interface PerCopilotResult {
  readonly copilotType: CopilotType;
  readonly summary: string;
  readonly confidence: number;
  readonly riskLevel: "nenhum" | "baixo" | "medio" | "alto" | "critico";
  readonly suggestions: readonly string[];
  readonly legalBasis: readonly string[];
  readonly risks: readonly RecommendationRisk[];
  readonly groundingOnly: boolean;
}

export interface ConsolidatedRecommendation {
  readonly summary: string;
  readonly suggestions: readonly string[];
  readonly risks: readonly RecommendationRisk[];
  readonly legalBasis: readonly string[];
  readonly confidence: number;
  readonly participatingCopilots: readonly CopilotType[];
  readonly requiresHumanReview: boolean;
}

export interface MultiCopilotResult {
  readonly request: string;
  readonly selectedCopilots: readonly CopilotType[];
  readonly perCopilot: readonly PerCopilotResult[];
  readonly consolidated: ConsolidatedRecommendation;
  readonly conflicts: readonly string[];
  /** RC-5.0 — ContextPackage institucional resolvido (quando `institutional` é informado). */
  readonly contextPackage?: ContextPackage;
}

/** RC-5.0 — parâmetros de resolução do contexto institucional (opcional, aditivo). */
export interface InstitutionalOrchestrationInput {
  readonly corpus: OfficialCorpusBuildResult;
  readonly tenantId: number;
  readonly taskType: string;
  readonly businessDomain?: string | null;
  readonly query?: string;
  readonly userContext?: { state?: string | null; municipality?: string | null };
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Coordena múltiplos copilotos para uma solicitação e retorna uma recomendação
 * consolidada. Determinístico e replay-safe (ordena por tipo de copiloto).
 */
export async function orchestrateMultiCopilot(params: {
  organizationId: number;
  request: string;
  copilotTypes?: CopilotType[];
  correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
  /** RC-5.0 — quando presente, o Orchestrator resolve o ContextPackage institucional (Resolver → Retrieval). */
  institutional?: InstitutionalOrchestrationInput;
}): Promise<MultiCopilotResult> {
  const { organizationId: orgId, request, correlationId } = params;

  // RC-5.0 — passo institucional do Orchestrator: solicita o ContextPackage ANTES da execução.
  // O Corpus é acessado SOMENTE pela Integration Layer (nunca pelos copilotos/engine).
  const contextPackage: ContextPackage | undefined = params.institutional
    ? resolveInstitutionalContextPackage(params.institutional.corpus, {
        tenantId: params.institutional.tenantId, businessDomain: params.institutional.businessDomain,
        taskType: params.institutional.taskType, query: params.institutional.query ?? request,
        correlationId, userContext: params.institutional.userContext,
      })
    : undefined;

  // 1) Classificação + seleção dos copilotos necessários
  const selected = params.copilotTypes && params.copilotTypes.length > 0
    ? uniq(params.copilotTypes)
    : uniq(rankCopilots(request, 4).map(r => r.copilotType));

  // 2) Execução paralela
  const runs = await Promise.all(
    selected.map(copilotType =>
      runCopilotReasoning({
        organizationId: orgId,
        copilotType,
        sessionId: `mco:${copilotType}`,
        reasoningId: `mcor:${copilotType}`,
        query: request,
        correlationId,
        invoke: params.invoke,
      }).then(r => ({ copilotType, r })),
    ),
  );

  // Ordena por tipo para determinismo
  runs.sort((a, b) => (a.copilotType < b.copilotType ? -1 : a.copilotType > b.copilotType ? 1 : 0));

  const perCopilot: PerCopilotResult[] = runs.map(({ copilotType, r }) => ({
    copilotType,
    summary: r.recommendation.summary,
    confidence: r.recommendation.confidence,
    riskLevel: aggregateRiskLevel(r.recommendation),
    suggestions: r.recommendation.suggestions,
    legalBasis: r.recommendation.legalBasis,
    risks: r.recommendation.risks,
    groundingOnly: r.groundingOnly,
  }));

  // 3) Resolução de conflitos: divergência de nível de risco entre copilotos
  const conflicts: string[] = [];
  const riskRank: Record<string, number> = { nenhum: 0, baixo: 1, medio: 2, alto: 3, critico: 4 };
  for (let i = 0; i < perCopilot.length; i++) {
    for (let j = i + 1; j < perCopilot.length; j++) {
      const diff = Math.abs(riskRank[perCopilot[i].riskLevel] - riskRank[perCopilot[j].riskLevel]);
      if (diff >= 2) {
        conflicts.push(
          `Divergência de risco entre ${perCopilot[i].copilotType} (${perCopilot[i].riskLevel}) e ${perCopilot[j].copilotType} (${perCopilot[j].riskLevel}) — priorizar o maior risco.`,
        );
      }
    }
  }

  // 4) Consolidação (conservadora: mantém o maior risco, une sugestões/base legal)
  const allSuggestions = uniq(perCopilot.flatMap(p => [...p.suggestions]));
  const allLegal = uniq(perCopilot.flatMap(p => [...p.legalBasis]));
  const allRisks = perCopilot.flatMap(p => [...p.risks]);
  const avgConfidence = perCopilot.length > 0
    ? perCopilot.reduce((a, p) => a + p.confidence, 0) / perCopilot.length
    : 0;

  const consolidated: ConsolidatedRecommendation = {
    summary: `Recomendação consolidada de ${perCopilot.length} copiloto(s): ${selected.join(", ")}.`,
    suggestions: allSuggestions.slice(0, 8),
    risks: allRisks,
    legalBasis: allLegal,
    confidence: Math.max(0, Math.min(1, avgConfidence)),
    participatingCopilots: selected,
    requiresHumanReview: true,
  };

  return { request, selectedCopilots: selected, perCopilot, consolidated, conflicts, contextPackage };
}
