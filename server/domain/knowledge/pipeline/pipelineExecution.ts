/**
 * RC-4.8 — Institutional Knowledge Pipeline · Execution (Fase 3).
 *
 * Executa um KnowledgePipeline de forma DETERMINÍSTICA sobre um contexto. Estágios rodam na ordem
 * do pipeline; um estágio que falha interrompe a execução (registrando failedStage). Quality gates
 * são aplicados por handlers padrão. Replay-safe (replayHash sem tempo). Sem conteúdo jurídico.
 */

import { createHash } from "crypto";
import type { KnowledgePipeline, KnowledgePipelineContext } from "./knowledgePipeline";
import type { PipelineStageId } from "./pipelineStages";
import { allBlocks } from "../knowledgeDocument";
import { computeQuality } from "../knowledgeQuality";
import { evaluateQualityGates } from "./qualityGates";

export type ExecutionStatus = "completed" | "failed";
export type StageStatus = "completed" | "failed" | "skipped" | "warning";

export interface StageOutcome {
  readonly status: StageStatus;
  readonly detail: string;
  readonly warnings?: readonly string[];
  readonly errors?: readonly string[];
}

export type StageHandler = (ctx: KnowledgePipelineContext) => StageOutcome;

export interface StageResult {
  readonly stageId: PipelineStageId;
  readonly name: string;
  readonly status: StageStatus;
  readonly detail: string;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly order: number;
}

export interface ExecutionMetrics {
  readonly totalStages: number;
  readonly executed: number;
  readonly warnings: number;
  readonly errors: number;
}

export interface KnowledgePipelineExecution {
  readonly pipelineExecutionId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: ExecutionStatus;
  readonly currentStage: PipelineStageId | null;
  readonly executedStages: readonly PipelineStageId[];
  readonly failedStage: PipelineStageId | null;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly metrics: ExecutionMetrics;
  readonly lineage: string;
  readonly replayHash: string;
}

export interface KnowledgePipelineResult {
  readonly execution: KnowledgePipelineExecution;
  readonly stageResults: readonly StageResult[];
}

const pass = (detail: string): StageOutcome => ({ status: "completed", detail });

/** Handlers padrão dos quality gates — aplicam a governança institucional. Determinísticos. */
export const DEFAULT_STAGE_HANDLERS: Partial<Record<PipelineStageId, StageHandler>> = {
  quality_validation: (ctx) => {
    const gates = evaluateQualityGates({ document: ctx.document, bindingConsistent: ctx.bindingConsistent });
    const cov = gates.failures.filter(f => f.gate === "coverage");
    return cov.length ? { status: "failed", detail: cov[0].detail, errors: cov.map(f => f.detail) } : pass("qualidade ok (cobertura 100%)");
  },
  consistency_validation: (ctx) => {
    const issues = computeQuality(ctx.document).consistency.issues;
    return issues.length ? { status: "failed", detail: "consistência falhou", errors: issues } : pass("consistência ok");
  },
  explainability_validation: (ctx) => {
    const present = allBlocks(ctx.document).some(b => b.kind === "Explainability");
    return present ? pass("explainability presente") : { status: "failed", detail: "explainability ausente", errors: ["bloco Explainability ausente"] };
  },
  approval: (ctx) => {
    const gates = evaluateQualityGates({ document: ctx.document, bindingConsistent: ctx.bindingConsistent });
    return gates.passed ? pass("aprovado (todos os gates)") : { status: "failed", detail: "aprovação bloqueada por gates", errors: gates.failures.map(f => `${f.gate}: ${f.detail}`) };
  },
};

/**
 * Executa o pipeline. `startedAt`/`finishedAt` são informados (não afetam o replayHash).
 * Determinístico: mesma entrada lógica → mesmo resultado (exceto tempos).
 */
export function executePipeline(
  pipeline: KnowledgePipeline,
  context: KnowledgePipelineContext,
  handlers: Partial<Record<PipelineStageId, StageHandler>> = {},
  times: { startedAt?: string; finishedAt?: string } = {},
): KnowledgePipelineResult {
  const merged = { ...DEFAULT_STAGE_HANDLERS, ...handlers };
  const stageResults: StageResult[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const executedStages: PipelineStageId[] = [];
  let failedStage: PipelineStageId | null = null;
  let currentStage: PipelineStageId | null = null;

  for (const stageId of pipeline.order) {
    const def = pipeline.definition.stages.find(s => s.id === stageId)!;
    currentStage = stageId;
    if (failedStage) {
      stageResults.push({ stageId, name: def.name, status: "skipped", detail: `pulado (falha anterior em ${failedStage})`, warnings: [], errors: [], order: def.order });
      continue;
    }
    const handler = merged[stageId] ?? ((): StageOutcome => pass(`${def.name} concluído`));
    const outcome = handler(context);
    const sWarn = [...(outcome.warnings ?? [])];
    const sErr = [...(outcome.errors ?? [])];
    warnings.push(...sWarn);
    errors.push(...sErr);
    stageResults.push({ stageId, name: def.name, status: outcome.status, detail: outcome.detail, warnings: sWarn, errors: sErr, order: def.order });
    if (outcome.status === "failed") failedStage = stageId;
    else executedStages.push(stageId);
  }

  const status: ExecutionStatus = failedStage ? "failed" : "completed";
  const metrics: ExecutionMetrics = { totalStages: pipeline.order.length, executed: executedStages.length, warnings: warnings.length, errors: errors.length };
  const replayHash = createHash("sha256").update(JSON.stringify({
    pipeline: pipeline.definition.id, tenant: context.tenantId, doc: context.document.replayHash,
    order: pipeline.order, results: stageResults.map(r => ({ id: r.stageId, status: r.status })),
  })).digest("hex").slice(0, 32);
  const pipelineExecutionId = createHash("sha256").update(`kexec:${context.tenantId}:${pipeline.definition.id}:${context.document.replayHash}:${context.correlationId}`).digest("hex").slice(0, 20);

  const execution: KnowledgePipelineExecution = {
    pipelineExecutionId, correlationId: context.correlationId,
    startedAt: times.startedAt ?? context.document.createdAt, finishedAt: times.finishedAt ?? context.document.updatedAt,
    status, currentStage, executedStages, failedStage, warnings, errors, metrics,
    lineage: context.document.lineageId, replayHash,
  };
  return { execution, stageResults };
}
