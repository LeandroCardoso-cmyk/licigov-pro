/**
 * Institutional Templates — INTEGRAÇÃO A + B + C: ports reais sobre a persistência da Lane A, ligados na inicialização.
 *
 * Um adapter por responsabilidade (sem repositórios paralelos, sem fallback em memória):
 *  repositório (A) · manifests M1/M2 (A) · rascunho canônico · fontes canônicas · revisão humana · composição pura (B) · catálogo.
 * A flag `FF_INSTITUTIONAL_TEMPLATES_V1` (mecanismo existente, tenant-scoped, default OFF) governa TODA mutação/geração/emissão.
 */
import { createCanonicalReferenceAdapter } from "./adapters/canonicalAdapter";
import { createTemplateDraftAdapter } from "./adapters/draftAdapter";
import { createTemplateGovernanceAdapter } from "./adapters/governanceAdapter";
import { createTemplateManifestAdapter } from "./adapters/manifestAdapter";
import { createPreviewCompositionPort } from "./adapters/previewAdapter";
import { createTemplateRepositoryAdapter } from "./adapters/repositoryAdapter";
import { createTemplateReviewAdapter } from "./adapters/reviewAdapter";
import { createVariableCatalogPort } from "./catalogRegistry";
import type { PromotionTemplateIssuanceHook } from "./templateCompositionService";
import { createTemplateIssuanceHook, createTemplateTransactionPort } from "./templateCompositionService";
import type { TemplatePorts, TemplateWorkflowPorts } from "./ports";
import {
  configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateCompositionPorts, platformTemplatesFlagPort, randomIds,
  systemClock, templateCompositionPortsConfigured,
} from "./portsRegistry";

export function createTemplateWorkflowPorts(): TemplateWorkflowPorts {
  return {
    repository: createTemplateRepositoryAdapter(),
    catalog: createVariableCatalogPort(),
    composition: createPreviewCompositionPort(),
    manifests: createTemplateManifestAdapter(),
    governance: createTemplateGovernanceAdapter(),
    flag: platformTemplatesFlagPort(),
    clock: systemClock,
    ids: randomIds,
  };
}

export function createTemplateCompositionPorts(): TemplatePorts {
  const repository = createTemplateRepositoryAdapter();
  return {
    enablement: platformTemplatesFlagPort(),
    repository: { getIdentity: repository.getIdentity, getRevision: repository.getRevision, listRevisions: repository.listRevisions, listBindings: repository.listBindings },
    catalog: createVariableCatalogPort(),
    canonical: createCanonicalReferenceAdapter(),
    drafts: createTemplateDraftAdapter(),
    manifests: createTemplateManifestAdapter(),
    review: createTemplateReviewAdapter(),
    clock: systemClock,
    transactions: createTemplateTransactionPort(),
  };
}

let wired = false;
/** Idempotente. Chamado na inicialização do servidor; não habilita nenhum tenant (a flag segue OFF por padrão). */
export function wireInstitutionalTemplates(): void {
  if (wired) return;
  configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
  configureTemplateCompositionPorts(createTemplateCompositionPorts());
  wired = true;
}
export function resetInstitutionalTemplatesWiring(): void { wired = false; }

/**
 * Hook de emissão para `promoteOfficialDocument`: `undefined` quando a integração não está ligada (comportamento idêntico ao
 * anterior). Ligada: rascunho SEM M1 segue o caminho existente; rascunho COM M1 passa pela revalidação canônica — e é
 * BLOQUEADO se o módulo estiver desabilitado para a organização (nunca emite um documento composto sem M2).
 */
export function templateIssuanceHook(): PromotionTemplateIssuanceHook | undefined {
  return templateCompositionPortsConfigured() ? createTemplateIssuanceHook(getTemplateCompositionPorts()) : undefined;
}
