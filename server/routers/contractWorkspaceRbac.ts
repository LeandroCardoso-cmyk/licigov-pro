/**
 * NEW-006 — Matriz RBAC CONGELADA do `contractWorkspaceRouter` (Contratos, operacional).
 *
 * Antes: TODAS as procedures usavam `tenantProcedure` ⇒ um `viewer` criava contratos, aditivos e
 * apostilamentos, editava o contrato, mudava o status, gerava minutas (com IA), registrava
 * ocorrências e solicitava parecer jurídico.
 *
 * Regra do dono (NEW-006): READ → `tenantProcedure`; DRAFT_CREATE / DRAFT_EDIT / OCCURRENCE /
 * REQUEST / DOCUMENT_GENERATION (minuta, status "gerado") → `orgRoleProcedure("operator")`;
 * STATE_CHANGE / INSTRUMENT_CREATION que também muda o status institucional do contrato /
 * OFFICIAL_DECISION → `orgRoleProcedure("manager")`.
 *
 * IMPORTANTE — "manager" é APENAS um PISO TÉCNICO de RBAC. NÃO afirma que o papel `manager` seja a
 * autoridade legalmente competente para celebrar aditivo, apostilar, rescindir ou dar vigência a um
 * contrato. Regras de competência / ratificação / segregação de funções estão FORA do escopo desta
 * correção (PR-07 / PR-18 / PR-20).
 *
 * Esta constante é a fonte de verdade do teste de congelamento
 * (`server/__tests__/integration/new006-contract-workspace-rbac.test.ts`), que confere a matriz
 * contra o código-fonte do router e contra o comportamento real por papel. Qualquer procedure nova
 * ou mudança de piso quebra o CI até a matriz ser atualizada deliberadamente.
 */
import type { OrgRole } from "../../drizzle/schema";

export type ContractWorkspaceProcedureClass =
  | "READ"
  | "DRAFT_CREATE"
  | "DRAFT_EDIT"
  | "DOCUMENT_GENERATION"
  | "OCCURRENCE"
  | "REQUEST"
  | "STATE_CHANGE"
  | "INSTRUMENT_CREATION"
  | "OFFICIAL_DECISION";

export interface ContractWorkspaceRbacEntry {
  /** Classe(s) do efeito. A primeira define o piso; as demais documentam efeitos adicionais. */
  readonly classes: readonly ContractWorkspaceProcedureClass[];
  readonly oldBuilder: "tenantProcedure";
  /** Piso de papel na organização. `null` = qualquer membro ativo (tenantProcedure). */
  readonly minRole: Extract<OrgRole, "operator" | "manager"> | null;
  /**
   * Piso ADICIONAL checado dentro do handler, por condição de entrada (só `updateContract`:
   * `status` diferente do atual ⇒ manager). Checado ANTES de qualquer escrita.
   */
  readonly conditionalMinRole?: { readonly when: string; readonly minRole: Extract<OrgRole, "manager"> };
  readonly rationale: string;
  readonly sideEffects: readonly string[];
}

export const CONTRACT_WORKSPACE_RBAC_MATRIX = {
  createFromProcurement: {
    classes: ["DRAFT_CREATE"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Nasce MINUTA (status default do domínio). Não decide nada. Obs.: id determinístico + upsert pode sobrescrever contrato existente (SEM-006/007) — defeito tratado pela PR-06, não por RBAC.",
    sideEffects: ["contract_workspaces (upsert)", "process_timeline"],
  },
  createFromDirectProcurement: {
    classes: ["DRAFT_CREATE"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Idem createFromProcurement (origem: contratação direta). Nasce MINUTA.",
    sideEffects: ["contract_workspaces (upsert)", "process_timeline"],
  },
  createManual: {
    classes: ["DRAFT_CREATE"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Contrato avulso nasce MINUTA explícita; idempotência + unicidade por número já existentes.",
    sideEffects: ["idempotency_keys", "contract_workspaces", "process_timeline"],
  },
  importExternalContract: {
    classes: ["DRAFT_CREATE"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Reconstrução assistida determinística (sem IA) — nasce MINUTA pendente de revisão do servidor.",
    sideEffects: ["contract_workspaces (upsert)", "imported_contracts", "process_timeline"],
  },
  loadContract: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "Leitura escopada por organização.", sideEffects: [],
  },
  listContracts: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "Leitura escopada por organização.", sideEffects: [],
  },
  listImported: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "Leitura escopada por organização.", sideEffects: [],
  },
  updateContract: {
    classes: ["DRAFT_EDIT", "STATE_CHANGE"], oldBuilder: "tenantProcedure", minRole: "operator",
    conditionalMinRole: { when: "input.status presente e diferente do status atual", minRole: "manager" },
    rationale: "Mistura edição de campos (operator) e transição de status (vigente/encerrado/rescindido/arquivado — efeito institucional). Checagem DIVIDIDA no handler: operator edita campos; manager exigido só quando o status muda (o cliente — ContractEditor — nunca envia status). Checada sobre o MESMO snapshot usado na transição e antes de qualquer escrita.",
    sideEffects: ["contract_workspaces (upsert)"],
  },
  generateDocuments: {
    classes: ["DOCUMENT_GENERATION"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Gera MINUTA revisável: contract_ws_documents + official_documents com status 'gerado' (nunca 'emitido'); não muda status do contrato. Consome IA (AIExecutionEngine) — por isso viewer negado.",
    sideEffects: ["AI (orchestrateMultiCopilot → AIExecutionEngine)", "contract_ws_documents", "official_documents (status gerado)", "official_document_timeline", "process_timeline"],
  },
  createAddendum: {
    classes: ["INSTRUMENT_CREATION", "STATE_CHANGE", "OFFICIAL_DECISION"], oldBuilder: "tenantProcedure", minRole: "manager",
    rationale: "Além da minuta, MUDA o status institucional do contrato para 'aditado' (main: updateContractWorkspaceStatus direto; PR-08: via máquina de estados, ainda mudando o status) e finaliza automaticamente aditivo de prazo/qualitativo ('finalizado'). Piso manager até draft e decisão serem separados.",
    sideEffects: ["contract_addenda", "AI (minuta do aditivo)", "contract_ws_documents", "official_documents", "contract_workspaces.status → aditado", "process_timeline"],
  },
  createApostille: {
    classes: ["INSTRUMENT_CREATION", "STATE_CHANGE"], oldBuilder: "tenantProcedure", minRole: "manager",
    rationale: "Além da minuta, MUDA o status institucional do contrato para 'apostilado'. Piso manager até draft e decisão serem separados.",
    sideEffects: ["contract_ws_apostilles", "AI (minuta do apostilamento)", "contract_ws_documents", "official_documents", "contract_workspaces.status → apostilado", "process_timeline"],
  },
  registerOccurrence: {
    classes: ["OCCURRENCE"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Registro simples de ocorrência; não muda status nem decide.",
    sideEffects: ["contract_occurrences", "process_timeline"],
  },
  requestLegalOpinion: {
    classes: ["REQUEST"], oldBuilder: "tenantProcedure", minRole: "operator",
    rationale: "Abre solicitação ao domínio Parecer Jurídico (Institutional Request Engine); não decide nem muda o contrato.",
    sideEffects: ["institutional_requests", "request_timelines", "request_assignments", "document_references", "request_notifications", "process_timeline"],
  },
  getLegalOpinion: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "Leitura escopada por organização.", sideEffects: [],
  },
} as const satisfies Record<string, ContractWorkspaceRbacEntry>;

export type ContractWorkspaceProcedureName = keyof typeof CONTRACT_WORKSPACE_RBAC_MATRIX;
