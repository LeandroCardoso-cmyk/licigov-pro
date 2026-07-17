/**
 * RC-X.2 — Institutional Bootstrap Framework · Explainability (Part 10).
 *
 * Toda inicialização se EXPLICA: qual componente foi carregado, por que, qual dependência exigiu,
 * tempo de carregamento, ordem e resultado. Nunca informação implícita. Determinístico.
 */

import type { BootstrapResult, BootstrapStep } from "./bootstrapStage";
import type { BootstrapPipeline } from "./bootstrapPipeline";
import { directDependencies, directDependents } from "./bootstrapDependencyGraph";

export interface BootstrapExplanation {
  readonly component: string;
  readonly loaded: boolean;
  readonly reason: string;
  /** Dependências que este componente exigiu. */
  readonly dependencyRequired: readonly string[];
  /** Componentes que exigiram este (dependentes). */
  readonly requiredBy: readonly string[];
  readonly durationMs: number;
  readonly order: number;
  readonly result: string;
}

/** Explica uma etapa (step) dentro do pipeline. */
export function explainStep(pipeline: BootstrapPipeline, step: BootstrapStep): BootstrapExplanation {
  const dependencyRequired = directDependencies(pipeline.graph, step.stageId);
  const requiredBy = directDependents(pipeline.graph, step.stageId);
  const reason = dependencyRequired.length === 0
    ? `Carregado como etapa raiz (sem dependências), ordem ${step.order}.`
    : `Carregado porque suas dependências (${dependencyRequired.join(", ")}) foram resolvidas; ordem ${step.order}.`;
  return {
    component: step.stageId,
    loaded: step.status === "completed",
    reason,
    dependencyRequired,
    requiredBy,
    durationMs: step.duration,
    order: step.order,
    result: step.status,
  };
}

/** Explica toda a inicialização (uma explicação por etapa, na ordem determinística). */
export function explainBootstrap(pipeline: BootstrapPipeline, result: BootstrapResult): BootstrapExplanation[] {
  return [...result.steps]
    .sort((a, b) => a.order - b.order)
    .map(step => explainStep(pipeline, step));
}
