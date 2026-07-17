/**
 * RC-X.1 — Institutional Experience Framework · Copilot EntryPoint (Part 7).
 *
 * Conceito de Institutional Copilot como PONTO DE ENTRADA da plataforma. NESTA RC **não** há IA:
 * apenas CopilotDefinition, CopilotContext e CopilotEntryPoint (estrutura). Determinístico.
 * Não conecta LLM/RAG/Providers.
 */

import type { InstitutionContext } from "./institutionContext";
import type { ResolvedCapability } from "./capability";
import type { ResolvedWorkspace } from "./workspace";

export interface CopilotDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly entryLabel: string;
  /** Capacidade que habilita o copiloto. */
  readonly capability: string;
}

export interface CopilotContext {
  readonly tenantId: number;
  readonly institutionId: string;
  /** Workspaces disponíveis pelos quais o copiloto pode orientar. */
  readonly availableWorkspaces: readonly string[];
  /** Capacidades disponíveis. */
  readonly availableCapabilities: readonly string[];
}

export interface CopilotEntryPoint {
  readonly definition: CopilotDefinition;
  readonly enabled: boolean;
  readonly context: CopilotContext;
  readonly reason: string;
}

export const DEFAULT_COPILOT_DEFINITION: CopilotDefinition = {
  id: "institutional-copilot",
  name: "Copiloto Institucional",
  description: "Ponto de entrada institucional da plataforma (sem IA nesta fase).",
  entryLabel: "Iniciar pelo Copiloto",
  capability: "copilot",
};

/**
 * Monta o ponto de entrada do copiloto a partir do contexto e das resoluções. Habilitado apenas
 * se a capacidade "copilot" estiver habilitada. Determinístico. Sem execução de IA.
 */
export function buildCopilotEntryPoint(
  context: InstitutionContext,
  resolvedCapabilities: readonly ResolvedCapability[],
  resolvedWorkspaces: readonly ResolvedWorkspace[],
  definition: CopilotDefinition = DEFAULT_COPILOT_DEFINITION,
): CopilotEntryPoint {
  const enabledCaps = resolvedCapabilities.filter(r => r.enabled).map(r => r.capability.id).sort((a, b) => a.localeCompare(b));
  const enabledWs = resolvedWorkspaces.filter(r => r.enabled).map(r => r.workspace.id).sort((a, b) => a.localeCompare(b));
  const enabled = enabledCaps.includes(definition.capability);
  return {
    definition,
    enabled,
    context: {
      tenantId: context.tenantId,
      institutionId: context.institutionId,
      availableWorkspaces: enabledWs,
      availableCapabilities: enabledCaps,
    },
    reason: enabled
      ? `Copiloto disponível: capacidade "${definition.capability}" habilitada.`
      : `Copiloto indisponível: capacidade "${definition.capability}" não habilitada.`,
  };
}
