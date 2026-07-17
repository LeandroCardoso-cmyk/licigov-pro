/**
 * RC-4.8 — Institutional Knowledge Pipeline · Explainability (Fase 10).
 *
 * Toda publicação/execução se EXPLICA: origem, pipeline utilizado, etapas executadas, validações,
 * motivo da aprovação/rejeição, versionamento e impacto. Nunca informação implícita. Determinístico.
 */

import type { KnowledgePipeline } from "./knowledgePipeline";
import type { KnowledgePipelineResult } from "./pipelineExecution";
import type { PublishOutcome } from "./publicationEngine";
import type { KnowledgeImpactAnalysis } from "./changeDetection";

export interface PipelineExplanation {
  readonly executionId: string;
  readonly origin: { readonly tenantId: number; readonly lineageId: string; readonly correlationId: string };
  readonly pipeline: { readonly id: string; readonly name: string; readonly version: string };
  readonly executedStages: readonly string[];
  readonly skippedStages: readonly string[];
  readonly failedStage: string | null;
  readonly validations: readonly { readonly stage: string; readonly status: string; readonly detail: string }[];
  readonly approvalReason: string | null;
  readonly rejectionReason: string | null;
  readonly versioning: { readonly published: boolean; readonly semver: string | null; readonly revision: number | null };
  readonly impact: KnowledgeImpactAnalysis | null;
  readonly summary: string;
}

/** Explica uma execução do pipeline (+ publicação e impacto opcionais). */
export function explainExecution(
  pipeline: KnowledgePipeline,
  result: KnowledgePipelineResult,
  publication?: PublishOutcome,
  impact?: KnowledgeImpactAnalysis,
): PipelineExplanation {
  const gateStages = result.stageResults.filter(r => pipeline.definition.stages.find(s => s.id === r.stageId)?.isGate);
  const approved = publication?.published === true;
  const rejection = result.execution.failedStage
    ? `Rejeitado no estágio ${result.execution.failedStage}: ${result.stageResults.find(r => r.stageId === result.execution.failedStage)?.errors.join("; ")}`
    : (publication && !publication.published ? `Publicação bloqueada por gates: ${publication.gates.failures.map(f => f.gate).join(", ")}` : null);

  return {
    executionId: result.execution.pipelineExecutionId,
    origin: { tenantId: pipeline.definition.tenantId, lineageId: result.execution.lineage, correlationId: result.execution.correlationId },
    pipeline: { id: pipeline.definition.id, name: pipeline.definition.name, version: pipeline.definition.version },
    executedStages: result.execution.executedStages,
    skippedStages: result.stageResults.filter(r => r.status === "skipped").map(r => r.stageId),
    failedStage: result.execution.failedStage,
    validations: gateStages.map(r => ({ stage: r.stageId, status: r.status, detail: r.detail })),
    approvalReason: approved ? "Todos os quality gates aprovados." : null,
    rejectionReason: rejection,
    versioning: {
      published: approved,
      semver: publication?.snapshot?.version.semver ?? null,
      revision: publication?.snapshot?.version.revision ?? null,
    },
    impact: impact ?? null,
    summary: `Execução ${result.execution.status} do pipeline "${pipeline.definition.name}": ${result.execution.executedStages.length}/${result.execution.metrics.totalStages} estágios; ${approved ? "publicado" : "não publicado"}.`,
  };
}
