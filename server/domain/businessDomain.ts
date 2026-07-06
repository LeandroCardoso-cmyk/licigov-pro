/**
 * Sprint 5.0.1 — Business Domain
 *
 * Cada Business Domain é uma unidade funcional independente, comercialmente
 * licenciável, com Workspace próprio. Todos reutilizam o mesmo Kernel Cognitivo —
 * nenhum duplica infraestrutura. Novos domínios podem ser criados SEM alterar o Kernel.
 *
 * Esta sprint apenas registra a arquitetura; os fluxos vêm nas Sprints 5.1-5.5.
 */

import { createHash } from "crypto";
import type { KernelServiceId } from "./cognitiveKernel";

export type BusinessDomainCode =
  | "processo_licitatorio"
  | "contratacao_direta"
  | "contratos"
  | "parecer_juridico"
  | "gestao_departamento";

export type BusinessDomainCategory = "core" | "juridico" | "gestao";

export interface BusinessDomain {
  readonly id: string;
  readonly code: BusinessDomainCode;
  readonly name: string;
  readonly description: string;
  readonly category: BusinessDomainCategory;
  readonly active: boolean;
  readonly version: number;
  /** Outros domínios dos quais este depende. */
  readonly dependencies: readonly BusinessDomainCode[];
  /** Serviços do Kernel exigidos por este domínio. */
  readonly requiredKernelServices: readonly KernelServiceId[];
  readonly supportedWorkflows: readonly string[];
  readonly workspaceType: string;
  readonly createdAt: string;
}

const BASE_KERNEL: KernelServiceId[] = [
  "ai_orchestration", "workflow_engine", "institutional_rag",
  "procurement_knowledge_graph", "copilot_infrastructure", "document_engine",
  "timeline_engine", "approval_engine", "governance_engine",
  "observability", "explainability", "replay_engine", "adaptive_process_engine",
];

export const BUSINESS_DOMAIN_DEFINITIONS: Record<BusinessDomainCode, Omit<BusinessDomain, "id" | "createdAt">> = {
  processo_licitatorio: {
    code: "processo_licitatorio",
    name: "Processo Licitatório",
    description: "Fluxo completo DFD → ETP → Pesquisa de Preços → TR → Edital.",
    category: "core",
    active: true,
    version: 1,
    dependencies: [],
    requiredKernelServices: [...BASE_KERNEL, "catmat_catser_engine", "import_engine"],
    supportedWorkflows: ["dfd", "etp", "pesquisa_precos", "tr", "edital"],
    workspaceType: "licitacao",
  },
  contratacao_direta: {
    code: "contratacao_direta",
    name: "Contratação Direta",
    description: "Dispensa, inexigibilidade, justificativas, pesquisa de preços e ratificação.",
    category: "core",
    active: true,
    version: 1,
    dependencies: ["processo_licitatorio"],
    requiredKernelServices: [...BASE_KERNEL, "catmat_catser_engine"],
    supportedWorkflows: ["dispensa", "inexigibilidade", "ratificacao"],
    workspaceType: "contratacao_direta",
  },
  contratos: {
    code: "contratos",
    name: "Contratos e Aditivos",
    description: "Gestão contratual, aditivos, prorrogações, fiscalização e execução.",
    category: "core",
    active: true,
    version: 1,
    dependencies: ["processo_licitatorio"],
    requiredKernelServices: [...BASE_KERNEL, "version_engine", "audit_engine"],
    supportedWorkflows: ["contrato", "aditivo", "prorrogacao"],
    workspaceType: "contrato",
  },
  parecer_juridico: {
    code: "parecer_juridico",
    name: "Parecer Jurídico",
    description: "Parecer inicial, adjudicação, favorável/desfavorável e revisão jurídica.",
    category: "juridico",
    active: true,
    version: 1,
    dependencies: [],
    requiredKernelServices: [...BASE_KERNEL, "knowledge_retrieval", "audit_engine"],
    supportedWorkflows: ["parecer_inicial", "parecer_adjudicacao"],
    workspaceType: "parecer",
  },
  gestao_departamento: {
    code: "gestao_departamento",
    name: "Gestão do Departamento",
    description: "Calendário, protocolos, andamento, indicadores e produtividade.",
    category: "gestao",
    active: true,
    version: 1,
    dependencies: [],
    requiredKernelServices: ["workflow_engine", "timeline_engine", "observability", "governance_engine"],
    supportedWorkflows: ["gestao_tarefas", "indicadores"],
    workspaceType: "generico",
  },
};

export const ALL_BUSINESS_DOMAIN_CODES: BusinessDomainCode[] = Object.keys(BUSINESS_DOMAIN_DEFINITIONS) as BusinessDomainCode[];

export function getBusinessDomainDefinition(code: BusinessDomainCode): Omit<BusinessDomain, "id" | "createdAt"> {
  return BUSINESS_DOMAIN_DEFINITIONS[code];
}

export function createBusinessDomain(code: BusinessDomainCode, createdAt?: string): BusinessDomain {
  const def = getBusinessDomainDefinition(code);
  const id = createHash("sha256").update(`bd:${code}`).digest("hex").slice(0, 20);
  return { id, ...def, createdAt: createdAt ?? new Date().toISOString() };
}

export function listBusinessDomains(): BusinessDomain[] {
  return ALL_BUSINESS_DOMAIN_CODES.map(code => createBusinessDomain(code));
}
