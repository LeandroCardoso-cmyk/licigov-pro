/**
 * Sprint 4.9 — Institutional Cognitive Copilots
 *
 * Representa um copiloto cognitivo institucional especializado. Copilotos NÃO
 * tomam decisões: orientam, estruturam, sugerem, explicam, fundamentam e
 * identificam riscos — sempre sob supervisão humana. Nenhum copiloto acessa o
 * provider de IA diretamente; toda inferência passa pelo pipeline oficial.
 *
 * Funções puras, determinísticas (IDs SHA-256), multi-tenant (organizationId).
 */

import { createHash } from "crypto";

export type CopilotType =
  | "agente_contratacao"
  | "pregoeiro"
  | "planejamento"
  | "tr_intelligence"
  | "juridico"
  | "pesquisa_precos"
  | "contratos"
  | "controle_interno";

export interface CopilotDefinition {
  readonly copilotType: CopilotType;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  /** Ações que este copiloto JAMAIS pode executar (governança). */
  readonly forbiddenActions: readonly string[];
}

export interface InstitutionalCopilot {
  readonly id: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly active: boolean;
  readonly version: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

// ─── Registry: primeira geração (8 copilotos) ─────────────────────────────────

const COMMON_FORBIDDEN = [
  "tomar_decisao_final",
  "assinar_documento",
  "homologar_processo",
] as const;

export const COPILOT_DEFINITIONS: Record<CopilotType, CopilotDefinition> = {
  agente_contratacao: {
    copilotType: "agente_contratacao",
    name: "Agente de Contratação Copilot",
    description: "Especialista em Lei 14.133/2021, fluxo licitatório, planejamento, documentos e governança.",
    domain: "contratacao",
    capabilities: ["orientar_procedimentos", "revisar_documentos", "verificar_conformidade", "sugerir_melhorias", "explicar_fundamentos"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
  pregoeiro: {
    copilotType: "pregoeiro",
    name: "Pregoeiro Copilot",
    description: "Especialista em pregão eletrônico, fases da disputa, habilitação, julgamento, recursos e condução operacional.",
    domain: "pregao",
    capabilities: ["orientar_disputa", "apoiar_habilitacao", "apoiar_julgamento", "orientar_recursos", "conduzir_operacional"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN, "julgar_licitacao"],
  },
  planejamento: {
    copilotType: "planejamento",
    name: "Planejamento Copilot",
    description: "Especialista em DFD, ETP, planejamento anual, PCA, justificativas e matriz de riscos.",
    domain: "planejamento",
    capabilities: ["estruturar_dfd", "estruturar_etp", "apoiar_pca", "elaborar_justificativas", "montar_matriz_riscos"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
  tr_intelligence: {
    copilotType: "tr_intelligence",
    name: "TR Intelligence Copilot",
    description: "Especialista em elaboração de TR, requisitos, especificações, cláusulas, CATMAT/CATSER e padronização.",
    domain: "termo_referencia",
    capabilities: ["elaborar_tr", "definir_requisitos", "estruturar_especificacoes", "sugerir_clausulas", "mapear_catmat_catser", "padronizar"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
  juridico: {
    copilotType: "juridico",
    name: "Jurídico Copilot",
    description: "Especialista em fundamentação legal, jurisprudência, acórdãos, pareceres e revisão jurídica.",
    domain: "juridico",
    capabilities: ["fundamentar_legalmente", "consultar_jurisprudencia", "consultar_acordaos", "apoiar_pareceres", "revisar_juridicamente"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    // Jurídico jamais emite parecer definitivo
    forbiddenActions: [...COMMON_FORBIDDEN, "emitir_parecer_definitivo", "decidir_questao_juridica"],
  },
  pesquisa_precos: {
    copilotType: "pesquisa_precos",
    name: "Pesquisa de Preços Copilot",
    description: "Especialista em metodologia, fontes, pesquisa, estimativa e validação de preços.",
    domain: "pesquisa_precos",
    capabilities: ["orientar_metodologia", "indicar_fontes", "apoiar_pesquisa", "apoiar_estimativa", "validar_precos"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
  contratos: {
    copilotType: "contratos",
    name: "Contratos Copilot",
    description: "Especialista em gestão contratual, aditivos, prorrogações, fiscalização e execução.",
    domain: "contratos",
    capabilities: ["apoiar_gestao_contratual", "apoiar_aditivos", "apoiar_prorrogacoes", "orientar_fiscalizacao", "acompanhar_execucao"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
  controle_interno: {
    copilotType: "controle_interno",
    name: "Controle Interno Copilot",
    description: "Especialista em compliance, auditoria, riscos, controles e conformidade.",
    domain: "controle_interno",
    capabilities: ["apoiar_compliance", "apoiar_auditoria", "avaliar_riscos", "verificar_controles", "verificar_conformidade"],
    permissions: ["read_rag", "read_knowledge_graph", "emit_recommendation"],
    forbiddenActions: [...COMMON_FORBIDDEN],
  },
};

export const ALL_COPILOT_TYPES: CopilotType[] = Object.keys(COPILOT_DEFINITIONS) as CopilotType[];

export function getCopilotDefinition(copilotType: CopilotType): CopilotDefinition {
  return COPILOT_DEFINITIONS[copilotType];
}

export function createInstitutionalCopilot(params: {
  organizationId: number;
  copilotType: CopilotType;
  correlationId?: string;
  createdAt?: string;
}): InstitutionalCopilot {
  const def = getCopilotDefinition(params.copilotType);
  const id = createHash("sha256")
    .update(`cop:${params.organizationId}:${params.copilotType}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    copilotType: params.copilotType,
    name: def.name,
    description: def.description,
    domain: def.domain,
    capabilities: def.capabilities,
    permissions: def.permissions,
    forbiddenActions: def.forbiddenActions,
    active: true,
    version: 1,
    correlationId: params.correlationId ?? "",
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Instancia todos os copilotos da primeira geração para uma organização. */
export function instantiateFirstGeneration(
  organizationId: number,
  correlationId?: string,
): InstitutionalCopilot[] {
  return ALL_COPILOT_TYPES.map(copilotType =>
    createInstitutionalCopilot({ organizationId, copilotType, correlationId }),
  );
}

export function isCapableOf(copilot: InstitutionalCopilot, capability: string): boolean {
  return copilot.capabilities.includes(capability);
}

export function isForbidden(copilot: InstitutionalCopilot, action: string): boolean {
  return copilot.forbiddenActions.includes(action);
}
