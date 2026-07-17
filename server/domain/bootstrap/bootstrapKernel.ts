/**
 * RC-X.2 — Institutional Bootstrap Framework · Bootstrap Kernel (Part 1).
 *
 * Coordena TODA a inicialização da plataforma: monta o pipeline, resolve dependências, executa as
 * etapas na ordem determinística, agrega saúde e estado, produz explainability e observabilidade.
 * NÃO executa regra de negócio, NÃO contém IA, NÃO conhece Lei 14.133. Determinístico, replay-safe.
 */

import { createHash } from "crypto";
import type { BootstrapRegistry } from "./bootstrapRegistry";
import { buildPipeline, type BootstrapPipeline } from "./bootstrapPipeline";
import { type BootstrapStep, type BootstrapResult, type BootstrapStatus } from "./bootstrapStage";
import { aggregateHealth, type BootstrapHealth } from "./bootstrapHealth";
import type { PlatformState } from "./platformState";
import { directDependencies } from "./bootstrapDependencyGraph";
import { recordBootstrapEvent } from "../../services/bootstrap/bootstrapObservabilityService";

export interface BootstrapKernel {
  readonly registry: BootstrapRegistry;
  readonly pipeline: BootstrapPipeline;
}

export function createBootstrapKernel(registry: BootstrapRegistry): BootstrapKernel {
  return { registry, pipeline: buildPipeline(registry) };
}

export interface RunBootstrapOptions {
  tenantId: number;
  correlationId?: string;
}

function computeReplayHash(tenantId: number, steps: readonly BootstrapStep[], order: readonly string[]): string {
  // Replay-safe: exclui duração/tempo. Considera apenas etapa, status, saúde e dependências.
  return createHash("sha256").update(JSON.stringify({
    tenant: tenantId, order,
    steps: steps.map(s => ({ id: s.stageId, status: s.status, health: s.health, deps: [...s.dependencies].sort() })),
  })).digest("hex").slice(0, 32);
}

/**
 * Executa o bootstrap de forma determinística. Uma etapa é PULADA se alguma dependência falhou/
 * foi pulada. O estado final é READY (todas concluídas) ou FAILED (alguma falhou). Emite
 * observabilidade quando um correlationId é fornecido.
 */
export function runBootstrap(kernel: BootstrapKernel, options: RunBootstrapOptions): BootstrapResult {
  const { tenantId, correlationId } = options;
  const emit = correlationId
    ? (type: Parameters<typeof recordBootstrapEvent>[0]["type"], subjectId: string, detail: string, count: number) =>
        recordBootstrapEvent({ correlationId, tenantId, type, subjectId, detail, count })
    : () => { /* noop */ };

  emit("bootstrapStarted", "platform", "bootstrap iniciado", kernel.pipeline.stages.length);

  const statusById = new Map<string, BootstrapStatus>();
  const steps: BootstrapStep[] = [];
  let anyFailed = false;

  kernel.pipeline.stages.forEach((stage, index) => {
    const deps = directDependencies(kernel.pipeline.graph, stage.id);
    for (const d of deps) emit("dependencyResolved", stage.id, `dependência ${d} resolvida`, 1);
    const blocked = deps.filter(d => statusById.get(d) !== "completed");

    emit("stageStarted", stage.id, `etapa ${stage.name} iniciada`, 1);

    let step: BootstrapStep;
    if (blocked.length > 0) {
      step = {
        stageId: stage.id, name: stage.name, description: stage.description, dependencies: stage.dependencies,
        status: "skipped", health: "UNKNOWN", duration: 0, order: index,
        detail: `Pulada: dependências não concluídas (${blocked.join(", ")}).`, metadata: stage.metadata,
      };
    } else {
      const subsystem = kernel.registry.subsystems.find(s => s.id === stage.id)!;
      const input = { tenantId, stageId: stage.id, metadata: stage.metadata };
      const outcome = subsystem.initializer(input);
      const health: BootstrapHealth = outcome.status === "completed" ? outcome.health : "FAILED";
      step = {
        stageId: stage.id, name: stage.name, description: stage.description, dependencies: stage.dependencies,
        status: outcome.status, health, duration: outcome.durationHint ?? 0, order: index,
        detail: outcome.detail, metadata: { ...stage.metadata, ...(outcome.metadata ?? {}) },
      };
      if (outcome.status === "completed") emit("subsystemLoaded", stage.id, `subsistema ${stage.name} carregado`, 1);
    }

    statusById.set(stage.id, step.status);
    if (step.status === "failed") anyFailed = true;
    steps.push(step);
    emit("stageFinished", stage.id, `etapa ${stage.name}: ${step.status}`, 1);
  });

  const state: PlatformState = anyFailed ? "FAILED" : "READY";
  const health = aggregateHealth(steps.map(s => s.health));
  const order = kernel.pipeline.order;
  const replayHash = computeReplayHash(tenantId, steps, order);

  if (anyFailed) emit("bootstrapFailed", "platform", "bootstrap falhou", steps.filter(s => s.status === "failed").length);
  else emit("bootstrapFinished", "platform", "bootstrap concluído", steps.length);

  return { tenantId, state, health, steps, order, replayHash };
}
