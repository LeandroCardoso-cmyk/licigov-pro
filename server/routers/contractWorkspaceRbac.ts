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
  /** Builder anterior à NEW-006; `null` = procedure criada depois da NEW-006 (já nasceu com piso). */
  readonly oldBuilder: "tenantProcedure" | null;
  /** Piso de papel na organização. `null` = qualquer membro ativo (tenantProcedure). */
  readonly minRole: Extract<OrgRole, "operator" | "manager"> | null;
  /**
   * Piso ADICIONAL checado dentro do handler, por condição de entrada (só `updateContract`:
   * `status` diferente do atual ⇒ manager). Checado ANTES de qualquer escrita.
   */
  readonly conditionalMinRole?: { readonly when: string; readonly minRole: Extract<OrgRole, "manager"> };
  /**
   * SECURITY-02 — ato institucional: além do piso, exige membership REAL, ativa e persistida (`institutionalProcedure`;
   * em `updateContract`, só quando o status muda). A projeção sintética do admin de plataforma não satisfaz.
   */
  readonly requiresRealMembership?: true;
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
  registerInForceContract: {
    classes: ["STATE_CHANGE", "DRAFT_CREATE"], oldBuilder: null, minRole: "manager", requiresRealMembership: true,
    rationale: "LICIGOV-FAST — contrato JÁ FORMALIZADO fora do sistema (processo anterior) registrado por declaração: nasce VIGENTE (informação declarada, não verificada). PISO TÉCNICO manager por nascer vigente; não transiciona minuta.",
    sideEffects: ["contract_workspaces (insert-only)", "process_timeline", "operational_events (se término informado)", "operational_timeline (se término informado)", "idempotency_keys"],
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
  proposeInheritance: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "SEM-062: leitura escopada por organização (proposta de contratado/valor com procedência; nunca grava nem decide).", sideEffects: [],
  },
  updateContract: {
    classes: ["DRAFT_EDIT", "STATE_CHANGE"], oldBuilder: "tenantProcedure", minRole: "operator", requiresRealMembership: true,
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
    classes: ["INSTRUMENT_CREATION"], oldBuilder: "tenantProcedure", minRole: "manager", requiresRealMembership: true,
    rationale: "PROMPT 08 / D-2 — PREPARATÓRIO: registra o aditivo em minuta (ou aguardando parecer) e gera o termo; NÃO muda status, vigência, valores nem alertas do contrato (efeitos só em formalizeAddendum). Piso manager mantido (sem afrouxar o piso vigente).",
    sideEffects: ["contract_addenda (minuta/aguardando_parecer)", "AI (minuta do aditivo)", "contract_ws_documents", "official_documents", "process_timeline", "idempotency_keys"],
  },
  formalizeAddendum: {
    classes: ["STATE_CHANGE", "OFFICIAL_DECISION"], oldBuilder: null, minRole: "manager", requiresRealMembership: true,
    rationale: "PROMPT 08 / D-2 — REGISTRO da formalização (termo assinado fora do sistema: data + referência; parecer governado quando exigido; termo gerado). Único ponto que aplica efeitos: contrato → 'aditado' (máquina de estados) e, no prazo, vencimento/alertas. CAS do aditivo e do status, idempotente, auditado.",
    sideEffects: ["contract_addenda (→ finalizado, documentReference, legalOpinionRequestId)", "contract_workspaces.status → aditado", "process_timeline", "operational_events/operational_timeline (aditivo de prazo)", "idempotency_keys"],
  },
  createApostille: {
    classes: ["INSTRUMENT_CREATION", "STATE_CHANGE"], oldBuilder: "tenantProcedure", minRole: "manager", requiresRealMembership: true,
    rationale: "Além da minuta, MUDA o status institucional do contrato para 'apostilado' e, nos apostilamentos de gestor/fiscal (SEM-062), APLICA a designação em manager/inspector. Piso manager até draft e decisão serem separados.",
    sideEffects: ["contract_ws_apostilles", "AI (minuta do apostilamento)", "contract_ws_documents", "official_documents", "contract_workspaces.status → apostilado", "contract_workspaces.manager/inspector (apostilamento gestor/fiscal)", "process_timeline"],
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
  listAddendumLegalOpinions: {
    classes: ["READ"], oldBuilder: "tenantProcedure", minRole: null,
    rationale: "PROMPT 09 — leitura dos pareceres solicitados para um aditivo (seleção na formalização); escopo do tenant e do contrato.", sideEffects: [],
  },
} as const satisfies Record<string, ContractWorkspaceRbacEntry>;

export type ContractWorkspaceProcedureName = keyof typeof CONTRACT_WORKSPACE_RBAC_MATRIX;
