/**
 * RC-4.3 — Institutional Operating Model · Papéis institucionais (declarativo).
 *
 * Modela os PAPÉIS do Departamento de Licitações. Cada papel declara responsabilidades,
 * permissões, participação, documentos envolvidos e dependências. SEM regras jurídicas —
 * apenas responsabilidades institucionais. Puro e determinístico.
 */

import type { InstitutionalObjectId } from "./objects";

export type InstitutionalRoleId =
  | "agente_contratacao" | "equipe_apoio" | "autoridade_competente" | "secretario"
  | "prefeito" | "controle_interno" | "assessoria_juridica" | "fiscal_contrato"
  | "gestor_contrato" | "fornecedor" | "solicitante" | "departamento_licitacoes" | "comissao";

export interface InstitutionalRole {
  readonly id: InstitutionalRoleId;
  readonly name: string;
  readonly responsibilities: readonly string[];
  readonly permissions: readonly string[];
  /** Etapas/atos em que o papel participa (declarativo). */
  readonly participation: readonly string[];
  readonly documents: readonly InstitutionalObjectId[];
  readonly dependencies: readonly InstitutionalRoleId[];
}

export const INSTITUTIONAL_ROLES: Record<InstitutionalRoleId, InstitutionalRole> = {
  departamento_licitacoes: {
    id: "departamento_licitacoes", name: "Departamento de Licitações",
    responsibilities: ["conduzir o processo", "organizar artefatos", "garantir rastreabilidade"],
    permissions: ["criar_processo", "organizar_documentos"], participation: ["planejamento", "instrução", "execução"],
    documents: ["processo", "dfd", "etp", "tr", "edital"], dependencies: ["solicitante", "agente_contratacao"],
  },
  solicitante: {
    id: "solicitante", name: "Solicitante",
    responsibilities: ["formalizar a demanda", "justificar a necessidade"],
    permissions: ["criar_dfd"], participation: ["planejamento"], documents: ["dfd"], dependencies: [],
  },
  agente_contratacao: {
    id: "agente_contratacao", name: "Agente de Contratação",
    responsibilities: ["conduzir o certame", "instruir o processo", "elaborar instrumentos"],
    permissions: ["elaborar_tr", "conduzir_sessao"], participation: ["instrução", "sessão"],
    documents: ["tr", "edital", "sessao"], dependencies: ["equipe_apoio", "departamento_licitacoes"],
  },
  equipe_apoio: {
    id: "equipe_apoio", name: "Equipe de Apoio",
    responsibilities: ["apoiar o agente de contratação", "auxiliar na instrução"],
    permissions: ["apoiar_instrucao"], participation: ["instrução", "sessão"], documents: ["tr", "edital"], dependencies: ["agente_contratacao"],
  },
  comissao: {
    id: "comissao", name: "Comissão",
    responsibilities: ["conduzir procedimentos colegiados", "julgar quando aplicável"],
    permissions: ["conduzir_sessao"], participation: ["sessão"], documents: ["sessao", "ata"], dependencies: ["departamento_licitacoes"],
  },
  autoridade_competente: {
    id: "autoridade_competente", name: "Autoridade Competente",
    responsibilities: ["autorizar", "homologar", "adjudicar"],
    permissions: ["aprovar_processo", "homologar"], participation: ["aprovação"], documents: ["processo", "edital"], dependencies: ["departamento_licitacoes"],
  },
  secretario: {
    id: "secretario", name: "Secretário",
    responsibilities: ["autorizar demandas da pasta", "ordenar despesas quando aplicável"],
    permissions: ["autorizar_demanda"], participation: ["aprovação"], documents: ["dfd", "processo"], dependencies: [],
  },
  prefeito: {
    id: "prefeito", name: "Prefeito",
    responsibilities: ["autoridade máxima", "ratificar contratações diretas quando aplicável"],
    permissions: ["ratificar"], participation: ["aprovação"], documents: ["contratacao_direta"], dependencies: [],
  },
  assessoria_juridica: {
    id: "assessoria_juridica", name: "Assessoria Jurídica",
    responsibilities: ["apoiar juridicamente", "emitir parecer quando solicitado"],
    permissions: ["emitir_parecer"], participation: ["análise jurídica"], documents: ["parecer"], dependencies: ["departamento_licitacoes"],
  },
  controle_interno: {
    id: "controle_interno", name: "Controle Interno",
    responsibilities: ["verificar conformidade", "acompanhar controles"],
    permissions: ["verificar_conformidade"], participation: ["controle"], documents: ["checklist", "processo"], dependencies: [],
  },
  gestor_contrato: {
    id: "gestor_contrato", name: "Gestor do Contrato",
    responsibilities: ["gerir o contrato", "acompanhar aditivos e prorrogações"],
    permissions: ["gerir_contrato"], participation: ["execução"], documents: ["contrato", "aditivo", "apostilamento"], dependencies: ["departamento_licitacoes"],
  },
  fiscal_contrato: {
    id: "fiscal_contrato", name: "Fiscal do Contrato",
    responsibilities: ["fiscalizar a execução", "registrar ocorrências"],
    permissions: ["fiscalizar"], participation: ["execução"], documents: ["contrato", "evento"], dependencies: ["gestor_contrato"],
  },
  fornecedor: {
    id: "fornecedor", name: "Fornecedor",
    responsibilities: ["executar o objeto contratado", "cumprir obrigações"],
    permissions: ["participar_certame", "executar_contrato"], participation: ["sessão", "execução"], documents: ["contrato"], dependencies: [],
  },
};

export const ALL_ROLE_IDS: InstitutionalRoleId[] = Object.keys(INSTITUTIONAL_ROLES) as InstitutionalRoleId[];

export function isInstitutionalRole(id: string): id is InstitutionalRoleId {
  return id in INSTITUTIONAL_ROLES;
}

export function getInstitutionalRole(id: InstitutionalRoleId): InstitutionalRole {
  return INSTITUTIONAL_ROLES[id];
}
