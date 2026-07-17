/**
 * RC-X.1 — Institutional Experience Framework · Experience Kernel (Part 1).
 *
 * Kernel que COORDENA toda a experiência institucional: resolve capacidades, resolve workspaces,
 * monta navegação, compõe a Home e prepara o ponto de entrada do Copiloto — tudo a partir de um
 * InstitutionContext imutável. Nenhum módulo constrói menus/navegação diretamente. Declarativo,
 * determinístico, multi-tenant, observável. Sem UX definitiva, sem IA.
 */

import type { InstitutionContext } from "./institutionContext";
import { type CapabilityRegistry, type ResolvedCapability, resolveCapabilities } from "./capability";
import { type WorkspaceRegistry, type ResolvedWorkspace, resolveWorkspaces } from "./workspace";
import { buildNavigation, type NavigationModel } from "./navigationBuilder";
import { composeHome, type HomeModel } from "./homeComposer";
import { buildCopilotEntryPoint, type CopilotEntryPoint, type CopilotDefinition } from "./copilotEntrypoint";
import { recordExperienceEvent } from "../../services/experience/experienceObservabilityService";

export interface ExperienceKernel {
  readonly capabilityRegistry: CapabilityRegistry;
  readonly workspaceRegistry: WorkspaceRegistry;
  readonly copilotDefinition?: CopilotDefinition;
}

export function createExperienceKernel(
  capabilityRegistry: CapabilityRegistry,
  workspaceRegistry: WorkspaceRegistry,
  copilotDefinition?: CopilotDefinition,
): ExperienceKernel {
  return { capabilityRegistry, workspaceRegistry, copilotDefinition };
}

export interface ExperienceState {
  readonly context: InstitutionContext;
  readonly capabilities: readonly ResolvedCapability[];
  readonly workspaces: readonly ResolvedWorkspace[];
  readonly navigation: NavigationModel;
  readonly home: HomeModel;
  readonly copilot: CopilotEntryPoint;
}

/**
 * Monta o estado COMPLETO da experiência para um contexto. Determinístico. Emite observabilidade
 * quando um correlationId é fornecido. Um Tenant vê apenas o que suas capacidades/workspaces/
 * corpora permitem (Part 9).
 */
export function buildExperience(kernel: ExperienceKernel, context: InstitutionContext, correlationId?: string): ExperienceState {
  const capabilities = resolveCapabilities(kernel.capabilityRegistry, context);
  const workspaces = resolveWorkspaces(kernel.workspaceRegistry, kernel.capabilityRegistry, context);
  const navigation = buildNavigation(workspaces, context);
  const home = composeHome(context, workspaces, navigation.quickActions);
  const copilot = buildCopilotEntryPoint(context, capabilities, workspaces, kernel.copilotDefinition);

  if (correlationId) {
    const emit = (type: Parameters<typeof recordExperienceEvent>[0]["type"], subjectId: string, detail: string, count: number) =>
      recordExperienceEvent({ correlationId, tenantId: context.tenantId, type, subjectId, detail, count });
    emit("contextLoaded", context.institutionId, "contexto institucional carregado", 1);
    emit("capabilityResolved", context.institutionId, "capacidades resolvidas", capabilities.filter(c => c.enabled).length);
    for (const rw of workspaces.filter(w => w.enabled)) emit("workspaceActivated", rw.workspace.id, "workspace ativado", 1);
    emit("navigationGenerated", context.institutionId, "navegação gerada", navigation.sidebar.length);
    emit("homeGenerated", context.institutionId, "home gerada", home.cards.length);
    if (copilot.enabled) emit("copilotOpened", copilot.definition.id, "copiloto disponível", 1);
  }

  return { context, capabilities, workspaces, navigation, home, copilot };
}
