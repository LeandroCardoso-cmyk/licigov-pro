/**
 * RC-X.2 — Institutional Bootstrap Framework · Bootstrap Stages (Part 3).
 *
 * BootstrapStage (definição declarativa), BootstrapStep (execução de uma etapa) e BootstrapResult
 * (resultado global). Cada etapa possui id, name, description, dependencies, status, duration,
 * metadata. Determinístico. Sem regra de negócio, sem IA.
 */

import type { BootstrapHealth } from "./bootstrapHealth";
import type { PlatformState } from "./platformState";

export type BootstrapStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Definição declarativa de uma etapa (subsistema a inicializar). */
export interface BootstrapStage {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly metadata: Record<string, unknown>;
}

/** Execução de uma etapa (Part 3 + Part 10). */
export interface BootstrapStep {
  readonly stageId: string;
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly status: BootstrapStatus;
  readonly health: BootstrapHealth;
  /** Duração declarativa (ms) — EXCLUÍDA do replayHash (não determinística no tempo). */
  readonly duration: number;
  /** Ordem de execução (determinística). */
  readonly order: number;
  readonly detail: string;
  readonly metadata: Record<string, unknown>;
}

export interface BootstrapResult {
  readonly tenantId: number;
  readonly state: PlatformState;
  readonly health: BootstrapHealth;
  readonly steps: readonly BootstrapStep[];
  /** Ordem determinística das etapas (ids). */
  readonly order: readonly string[];
  /** Hash determinístico da execução lógica (SEM duração/tempo). */
  readonly replayHash: string;
}

export function createStage(params: {
  id: string; name?: string; description?: string; dependencies?: string[]; metadata?: Record<string, unknown>;
}): BootstrapStage {
  return {
    id: params.id, name: params.name ?? params.id, description: params.description ?? "",
    dependencies: params.dependencies ?? [], metadata: params.metadata ?? {},
  };
}

export function isCompleted(step: BootstrapStep): boolean {
  return step.status === "completed";
}
