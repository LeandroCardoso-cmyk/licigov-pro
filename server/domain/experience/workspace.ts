/**
 * RC-X.1 — Institutional Experience Framework · Workspace Registry (Part 4).
 *
 * Cada Workspace representa um AMBIENTE DE TRABALHO (Processos, Contratos, Pesquisa de Preços,
 * Governança, Relatórios, Copilot) — NÃO um módulo técnico. O WorkspaceResolver determina, para
 * um InstitutionContext, quais workspaces estão disponíveis (todas as capacidades exigidas
 * habilitadas). Regra (Part 8): nenhum Workspace existe sem Capability. Declarativo, determinístico.
 */

import type { InstitutionContext } from "./institutionContext";
import type { CapabilityRegistry } from "./capability";
import { enabledCapabilityIds } from "./capability";

export type WorkspaceCategory =
  | "operacional" | "contrato" | "pesquisa" | "governanca" | "relatorio" | "copilot";

export interface WorkspaceAction {
  readonly id: string;
  readonly label: string;
  /** Capacidade exigida para executar a ação. */
  readonly capability: string;
}

export interface WorkspaceDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly category: WorkspaceCategory;
  /** Capacidades exigidas — obrigatório ao menos uma (Part 8). */
  readonly requiredCapabilities: readonly string[];
  readonly routes: readonly string[];
  readonly actions: readonly WorkspaceAction[];
  /** Módulo que registrou o workspace (explainability — Part 12). */
  readonly module: string;
  readonly metadata: Record<string, unknown>;
}

export interface WorkspaceRegistry {
  readonly workspaces: readonly WorkspaceDefinition[];
}

export function createWorkspaceRegistry(workspaces: WorkspaceDefinition[] = []): WorkspaceRegistry {
  const sorted = [...workspaces].sort((a, b) => a.id.localeCompare(b.id));
  return { workspaces: sorted };
}

/** Registra um workspace (append-only; idempotente por id). Lança se não houver Capability. */
export function registerWorkspace(registry: WorkspaceRegistry, workspace: WorkspaceDefinition): WorkspaceRegistry {
  if (workspace.requiredCapabilities.length === 0) {
    throw new Error(`registerWorkspace: workspace "${workspace.id}" não pode existir sem Capability (Part 8)`);
  }
  if (registry.workspaces.some(w => w.id === workspace.id)) return registry;
  return createWorkspaceRegistry([...registry.workspaces, workspace]);
}

export function getWorkspace(registry: WorkspaceRegistry, id: string): WorkspaceDefinition | null {
  return registry.workspaces.find(w => w.id === id) ?? null;
}

export interface ResolvedWorkspace {
  readonly workspace: WorkspaceDefinition;
  readonly enabled: boolean;
  /** Capacidades que habilitaram (subconjunto de requiredCapabilities). */
  readonly enabledBy: readonly string[];
  /** Capacidades exigidas ausentes. */
  readonly missing: readonly string[];
  /** Ids das ações cuja capacidade está habilitada (pode exigir capacidades além das do workspace). */
  readonly enabledActions: readonly string[];
  readonly reason: string;
}

/**
 * Resolve os workspaces para um contexto. Um workspace está habilitado se TODAS as suas
 * `requiredCapabilities` estiverem habilitadas. Determinístico (ordenação estável por id).
 */
export function resolveWorkspaces(
  workspaceRegistry: WorkspaceRegistry,
  capabilityRegistry: CapabilityRegistry,
  context: InstitutionContext,
): ResolvedWorkspace[] {
  const enabledCaps = new Set(enabledCapabilityIds(capabilityRegistry, context));
  return workspaceRegistry.workspaces.map(workspace => {
    const req = [...workspace.requiredCapabilities];
    const enabledBy = req.filter(c => enabledCaps.has(c)).sort((a, b) => a.localeCompare(b));
    const missing = req.filter(c => !enabledCaps.has(c)).sort((a, b) => a.localeCompare(b));
    const enabled = missing.length === 0;
    const enabledActions = [...workspace.actions].filter(a => enabledCaps.has(a.capability)).map(a => a.id).sort((a, b) => a.localeCompare(b));
    const reason = enabled
      ? `Disponível: todas as capacidades exigidas (${enabledBy.join(", ")}) estão habilitadas.`
      : `Indisponível: capacidades ausentes (${missing.join(", ")}).`;
    return { workspace, enabled, enabledBy, missing, enabledActions, reason };
  }).sort((a, b) => a.workspace.id.localeCompare(b.workspace.id));
}

/** Workspaces habilitados (apenas os disponíveis) para o contexto. */
export function enabledWorkspaces(
  workspaceRegistry: WorkspaceRegistry,
  capabilityRegistry: CapabilityRegistry,
  context: InstitutionContext,
): ResolvedWorkspace[] {
  return resolveWorkspaces(workspaceRegistry, capabilityRegistry, context).filter(r => r.enabled);
}
