/**
 * RC-X.1 — Institutional Experience Framework · Amostra estrutural.
 *
 * Registros de exemplo (capacidades + workspaces) e contextos por tipo de tenant, usados para
 * exercitar o framework. Demonstra a EXTENSIBILIDADE (Part 10): registrar apenas Workspace +
 * Capabilities + Actions + Routes, sem alterar NavigationBuilder/HomeComposer. Determinístico.
 * Nenhuma UX definitiva, nenhum conteúdo jurídico.
 */

import { createInstitutionContext, type InstitutionContext, type TenantType } from "./institutionContext";
import { createCapabilityRegistry, type Capability, type CapabilityRegistry } from "./capability";
import { createWorkspaceRegistry, registerWorkspace, type WorkspaceDefinition, type WorkspaceRegistry } from "./workspace";
import { createExperienceKernel, type ExperienceKernel } from "./experienceKernel";

/** Capacidades oficiais de exemplo (nunca menus). */
export const SAMPLE_CAPABILITIES: Capability[] = [
  { id: "processos", name: "Processos", category: "operacional", description: "Gestão de processos licitatórios.", requiredModule: "licitacoes" },
  { id: "tr", name: "Termo de Referência", category: "documento", description: "Elaboração de TR.", requiredModule: "licitacoes" },
  { id: "etp", name: "Estudo Técnico Preliminar", category: "documento", description: "Elaboração de ETP.", requiredModule: "licitacoes" },
  { id: "pesquisa_precos", name: "Pesquisa de Preços", category: "pesquisa", description: "Pesquisa de preços.", requiredModule: "pesquisa" },
  { id: "contratos", name: "Contratos", category: "contrato", description: "Gestão de contratos.", requiredModule: "contratos" },
  { id: "convenios", name: "Convênios", category: "convenio", description: "Gestão de convênios.", requiredModule: "convenios" },
  { id: "paineis", name: "Painéis", category: "painel", description: "Painéis institucionais.", requiredModule: "gestao" },
  { id: "analytics", name: "Analytics", category: "analytics", description: "Indicadores e analytics.", requiredModule: "gestao" },
  { id: "copilot", name: "Copiloto", category: "copilot", description: "Copiloto institucional.", requiredModule: "copilot" },
];

/** Workspaces oficiais de exemplo (ambientes de trabalho, nunca módulos técnicos). */
export const SAMPLE_WORKSPACES: WorkspaceDefinition[] = [
  { id: "processos", title: "Processos", description: "Ambiente de processos licitatórios.", icon: "folder", category: "operacional", requiredCapabilities: ["processos"], routes: ["/processos"], actions: [{ id: "novo_tr", label: "Novo TR", capability: "tr" }, { id: "novo_etp", label: "Novo ETP", capability: "etp" }], module: "licitacoes", metadata: {} },
  { id: "contratos", title: "Contratos", description: "Ambiente de contratos.", icon: "file-signature", category: "contrato", requiredCapabilities: ["contratos"], routes: ["/contratos"], actions: [{ id: "novo_contrato", label: "Novo Contrato", capability: "contratos" }], module: "contratos", metadata: {} },
  { id: "pesquisa_precos", title: "Pesquisa de Preços", description: "Ambiente de pesquisa de preços.", icon: "search-dollar", category: "pesquisa", requiredCapabilities: ["pesquisa_precos"], routes: ["/pesquisa-precos"], actions: [], module: "pesquisa", metadata: {} },
  { id: "governanca", title: "Governança", description: "Ambiente de governança e painéis.", icon: "shield", category: "governanca", requiredCapabilities: ["paineis"], routes: ["/governanca"], actions: [], module: "gestao", metadata: {} },
  { id: "relatorios", title: "Relatórios", description: "Ambiente de relatórios e analytics.", icon: "chart-bar", category: "relatorio", requiredCapabilities: ["analytics"], routes: ["/relatorios"], actions: [], module: "gestao", metadata: {} },
  { id: "copilot", title: "Copiloto", description: "Ambiente do copiloto institucional.", icon: "sparkles", category: "copilot", requiredCapabilities: ["copilot"], routes: ["/copilot"], actions: [], module: "copilot", metadata: {} },
];

export function sampleCapabilityRegistry(): CapabilityRegistry {
  return createCapabilityRegistry(SAMPLE_CAPABILITIES);
}

export function sampleWorkspaceRegistry(): WorkspaceRegistry {
  let reg = createWorkspaceRegistry();
  for (const ws of SAMPLE_WORKSPACES) reg = registerWorkspace(reg, ws);
  return reg;
}

export function sampleExperienceKernel(): ExperienceKernel {
  return createExperienceKernel(sampleCapabilityRegistry(), sampleWorkspaceRegistry());
}

/** Perfis de exemplo por tipo de tenant (Part 9) — módulos/capacidades contratadas distintos. */
export const TENANT_PROFILES: Record<TenantType, { modules: string[]; capabilities: string[] }> = {
  municipio_pequeno: { modules: ["licitacoes", "copilot"], capabilities: ["processos", "tr", "etp", "copilot"] },
  municipio_grande: { modules: ["licitacoes", "pesquisa", "contratos", "convenios", "gestao", "copilot"], capabilities: ["processos", "tr", "etp", "pesquisa_precos", "contratos", "convenios", "paineis", "analytics", "copilot"] },
  consorcio: { modules: ["licitacoes", "contratos", "gestao"], capabilities: ["processos", "contratos", "paineis"] },
  camara: { modules: ["licitacoes"], capabilities: ["processos", "tr"] },
  autarquia: { modules: ["licitacoes", "contratos", "copilot"], capabilities: ["processos", "contratos", "copilot"] },
};

/** Contexto institucional de exemplo para um tenant/tipo. Determinístico. */
export function sampleInstitutionContext(tenantId: number, tenantType: TenantType = "municipio_grande"): InstitutionContext {
  const profile = TENANT_PROFILES[tenantType];
  return createInstitutionContext({
    tenantId,
    institutionId: `inst-${tenantId}`,
    institutionName: `Instituição ${tenantId}`,
    municipality: "Município Exemplo",
    state: "PR",
    country: "BR",
    tenantType,
    activeCorpora: ["federal-procurement-corpus"],
    enabledModules: profile.modules,
    capabilities: profile.capabilities,
    permissions: ["read", "write"],
    workspaceIds: ["processos"],
    resolutionChain: [
      { stage: "auth", source: "session", detail: "usuário autenticado" },
      { stage: "tenant", source: "institution", detail: `tenant ${tenantId} resolvido` },
      { stage: "licensing", source: "modules", detail: `${profile.modules.length} módulos habilitados` },
    ],
    metadata: { recentRoutes: ["/processos"] },
  });
}
