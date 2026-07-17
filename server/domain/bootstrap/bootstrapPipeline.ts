/**
 * RC-X.2 — Institutional Bootstrap Framework · Bootstrap Pipeline (Part 2).
 *
 * O pipeline declarativo de inicialização institucional. As etapas (Authentication → Institution
 * Context → Corpus/Package/Capability/Workspace/Navigation/Home/Copilot/Business Resolution →
 * Ready) são derivadas do registro e ordenadas DETERMINISTICAMENTE pelo grafo de dependências.
 * Puro. Sem regra de negócio, sem IA.
 */

import { createStage, type BootstrapStage } from "./bootstrapStage";
import type { BootstrapRegistry } from "./bootstrapRegistry";
import { buildDependencyGraph, topologicalOrder, type BootstrapDependencyGraph } from "./bootstrapDependencyGraph";

export interface BootstrapPipeline {
  readonly stages: readonly BootstrapStage[];
  readonly order: readonly string[];
  readonly graph: BootstrapDependencyGraph;
}

/** Constrói o pipeline a partir do registro. Ordem determinística; lança se houver ciclo. */
export function buildPipeline(registry: BootstrapRegistry): BootstrapPipeline {
  const stages: BootstrapStage[] = registry.subsystems.map(s => createStage({
    id: s.id, name: s.name, description: s.description, dependencies: [...s.dependencies], metadata: s.metadata,
  }));
  const graph = buildDependencyGraph(stages.map(s => ({ id: s.id, dependencies: s.dependencies })));
  const order = topologicalOrder(graph);
  const byId = new Map(stages.map(s => [s.id, s]));
  const ordered = order.map(id => byId.get(id)!);
  return { stages: ordered, order, graph };
}

export function getStage(pipeline: BootstrapPipeline, id: string): BootstrapStage | null {
  return pipeline.stages.find(s => s.id === id) ?? null;
}
