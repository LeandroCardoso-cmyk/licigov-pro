/**
 * RC-X.2 — Institutional Bootstrap Framework · Context Reload (Part 6).
 *
 * Arquitetura (sem implementação real) para recarregar o contexto da plataforma diante de trocas:
 * Tenant, Município, Licença, Capabilities, Workspaces, Corpora, Branding. Determina, de forma
 * determinística, quais etapas do pipeline precisam ser reexecutadas (e seus dependentes). Puro.
 */

import type { BootstrapPipeline } from "./bootstrapPipeline";
import { directDependents } from "./bootstrapDependencyGraph";
import type { PlatformState } from "./platformState";

export type ReloadTrigger =
  | "tenant_switch" | "municipality_change" | "license_change" | "capabilities_update"
  | "workspaces_update" | "corpora_update" | "branding_update";

/** Etapa "raiz" afetada por cada gatilho (os dependentes são incluídos automaticamente). */
export const RELOAD_TRIGGER_STAGE: Record<ReloadTrigger, string> = {
  tenant_switch: "authentication",
  municipality_change: "institution_context",
  license_change: "capability_resolution",
  capabilities_update: "capability_resolution",
  workspaces_update: "workspace_resolution",
  corpora_update: "corpus_resolution",
  branding_update: "home_resolution",
};

export interface ReloadRequest {
  readonly trigger: ReloadTrigger;
  readonly tenantId: number;
  readonly correlationId?: string;
}

export interface ReloadPlan {
  readonly trigger: ReloadTrigger;
  readonly tenantId: number;
  readonly rootStage: string;
  /** Etapas a reexecutar (raiz + dependentes transitivos), em ordem determinística de pipeline. */
  readonly affectedStages: readonly string[];
  readonly fromState: PlatformState;
  readonly toState: PlatformState;
  readonly reason: string;
}

/** Coleta a raiz + todos os dependentes transitivos (determinístico). */
function collectAffected(pipeline: BootstrapPipeline, root: string): string[] {
  const affected = new Set<string>();
  const visit = (id: string) => {
    if (affected.has(id)) return;
    affected.add(id);
    for (const dep of directDependents(pipeline.graph, id)) visit(dep);
  };
  visit(root);
  // Ordena pela ordem do pipeline (determinística).
  return pipeline.order.filter(id => affected.has(id));
}

/**
 * Planeja o reload a partir do gatilho. NÃO executa nada — apenas descreve o plano. Se a etapa
 * raiz não existir no pipeline, o plano fica vazio (nada a recarregar).
 */
export function planReload(pipeline: BootstrapPipeline, request: ReloadRequest): ReloadPlan {
  const rootStage = RELOAD_TRIGGER_STAGE[request.trigger];
  const exists = pipeline.order.includes(rootStage);
  const affectedStages = exists ? collectAffected(pipeline, rootStage) : [];
  return {
    trigger: request.trigger,
    tenantId: request.tenantId,
    rootStage,
    affectedStages,
    fromState: "READY",
    toState: "RELOADING",
    reason: exists
      ? `Gatilho "${request.trigger}" recarrega "${rootStage}" e ${affectedStages.length - 1} dependente(s).`
      : `Gatilho "${request.trigger}": etapa raiz "${rootStage}" ausente do pipeline — nada a recarregar.`,
  };
}
