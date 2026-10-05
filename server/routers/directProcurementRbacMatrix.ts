/**
 * NEW-005 — Matriz RBAC CONGELADA do `directProcurementRouter` (Contratação Direta).
 *
 * Antes: TODAS as procedures usavam `tenantProcedure` (qualquer membro ativo do órgão, inclusive `viewer`,
 * alcançava mutações institucionais como `ratify` e `publish`). Agora cada procedure tem uma classe e um
 * builder mínimo, conforme a regra aprovada pelo owner (28/09/2026):
 *
 *   READ                    → tenantProcedure
 *   DRAFT_WRITE             → orgRoleProcedure("operator")   (mínimo)
 *   EVIDENCE_WRITE          → orgRoleProcedure("operator")   (mínimo)
 *   WORKFLOW_CONFIGURATION  → orgRoleProcedure("manager")    (mínimo)
 *   INSTITUTIONAL_DECISION  → orgRoleProcedure("manager")    (mínimo)
 *   PUBLICATION             → orgRoleProcedure("manager")    (mínimo)
 *   LEGACY_TO_DISABLE       → fora da matriz definitiva (desligamento governado em PR-02)
 *
 * `orgRoleProcedure(min)` (server/_core/trpc.ts) ordena viewer(1) < operator(2) < manager(3) < admin(4) <
 * owner(5) e deixa passar quem tem papel >= mínimo; admin de plataforma entra como `owner` do órgão
 * informado em X-Organization-Id (com auditoria fail-closed). Nenhum sistema RBAC novo é criado.
 *
 * IMPORTANTE — `manager` é APENAS um PISO TÉCNICO de RBAC. Esta matriz NÃO afirma nem codifica que o papel
 * `manager` seja a autoridade legalmente competente para ratificar/publicar a contratação direta. Autoridade
 * competente, distinção decidedBy × recordedBy e segregação de funções (SoD) pertencem ao PR-07; a semântica
 * da ratificação NÃO é alterada aqui.
 *
 * Este módulo é a fonte do teste de congelamento (`direct-procurement-rbac-contract.test.ts`): toda procedure
 * registrada no router precisa estar classificada aqui, e o gate efetivo precisa bater com `minRole`.
 */

export type DirectProcurementRbacClass =
  | "READ"
  | "DRAFT_WRITE"
  | "EVIDENCE_WRITE"
  | "WORKFLOW_CONFIGURATION"
  | "INSTITUTIONAL_DECISION"
  | "PUBLICATION"
  | "LEGACY_TO_DISABLE";

export interface DirectProcurementRbacEntry {
  readonly rbacClass: DirectProcurementRbacClass;
  /** Builder anterior (main 5cd9d50). */
  readonly oldBuilder: "tenantProcedure";
  /**
   * Papel mínimo efetivo. `null` = qualquer membro ativo (tenantProcedure). Para LEGACY_TO_DISABLE, o gate
   * definitivo é o desligamento governado (PR-02), não um papel.
   */
  readonly minRole: "operator" | "manager" | null;
  readonly newBuilder: string;
  readonly rationale: string;
  /** Efeitos colaterais do handler quando autorizado (tabelas, timeline, notificações, IA). */
  readonly sideEffects: string;
}

export const DIRECT_PROCUREMENT_RBAC_MATRIX = {
  createProcess: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Abre o processo de contratação direta (instrução operacional); não decide nada.",
    sideEffects: "direct_procurement_workspaces (insert/upsert) + process_timeline(workspace_created). Sem IA/notificação.",
  },
  loadProcess: {
    rbacClass: "READ", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure",
    rationale: "Leitura escopada por (id, org do contexto); outro órgão ⇒ workspace null (neutro).",
    sideEffects: "Nenhum.",
  },
  listProcesses: {
    rbacClass: "READ", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure",
    rationale: "Listagem escopada pelo órgão do contexto.",
    sideEffects: "Nenhum.",
  },
  updateStage: {
    rbacClass: "LEGACY_TO_DISABLE", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure (inalterado; LEG-011 desligado por PR-02)",
    rationale: "LEG-011: salto genérico de etapa. Desligado de forma governada por PR-02 (merge ANTES deste branch) para TODOS os papéis; um gate de papel aqui divergiria do contrato de PR-02 (viewer recebe LEGACY_ENDPOINT_DISABLED).",
    sideEffects: "(pré-PR-02) direct_procurement_workspaces.current_stage/status + process_timeline(change).",
  },
  importDFD: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Importa o DFD de origem (instrução documental).",
    sideEffects: "NENHUM (SEM-042): recusa estável DIRECT_DFD_IMPORT_NOT_PERSISTED antes de qualquer escrita — não há repositório de DFD na contratação direta. Sem IA/notificação.",
  },
  selectLegalBasis: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Enquadramento proposto na instrução (revisado pelo parecer e pela ratificação). O evento de timeline se chama 'decision' por legado, mas não é o ato decisório.",
    sideEffects: "direct_procurement_workspaces.legal_basis (upsert) + process_timeline(decision). Sem IA/notificação.",
  },
  characterizeNeed: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Caracterização da necessidade (instrução).",
    sideEffects: "NENHUM (SEM-042): recusa estável DIRECT_NEED_NOT_PERSISTED antes de qualquer escrita — não há repositório da caracterização. Sem IA/notificação.",
  },
  importPriceResearch: {
    rbacClass: "EVIDENCE_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Evidência de preço (mesmo piso que PR-04A aplica com idempotência).",
    sideEffects: "price_research + price_research_items + process_timeline(change). Sem IA/notificação.",
  },
  configureProcedure: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Forma operacional de coleta (eletrônico/presencial, plataforma); não altera exigências legais do fluxo.",
    sideEffects: "direct_procurement_procedures + direct_procurement_workspaces.procedure_type + process_timeline(decision).",
  },
  registerProposal: {
    rbacClass: "EVIDENCE_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Registro de proposta recebida e seus documentos (evidência).",
    sideEffects: "proposal_collections + proposal_documents + process_timeline(change).",
  },
  generateJustification: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Rascunho revisável da justificativa da contratação.",
    sideEffects: "IA: orchestrateMultiCopilot → runCopilotReasoning → AIExecutionEngine.executeCognitiveTask; contract_justifications + official_documents (Document Engine) + process_timeline(recommendation).",
  },
  generatePriceJustification: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Justificativa de preço registrada pelo servidor (rascunho revisável).",
    sideEffects: "price_justifications + official_documents (Document Engine) + process_timeline(change). Sem IA.",
  },
  acceptJustification: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "R5 / PR-11 — aceite HUMANO da justificativa da contratação (a IA só sugere); persiste e gera o documento oficial com autor humano.",
    sideEffects: "contract_justifications (registro do aceite) + official_documents (justificativa_contratacao) + process_timeline(decision). Sem IA.",
  },
  getJustifications: {
    rbacClass: "READ", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure",
    rationale: "R5 / PR-11 — justificativas persistidas para hidratação dos formulários, escopadas pelo órgão do contexto.",
    sideEffects: "Nenhum.",
  },
  validateDocuments: {
    rbacClass: "EVIDENCE_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Checklist documental: semeia ou marca pendente/validado (conferência documental, não decisão). R7 / PR-16: validar exige anexo real; \"anexado\" só por upload.",
    sideEffects: "required_documents (insert/update) + timeline. Sem IA/notificação.",
  },
  attachRequiredDocument: {
    rbacClass: "EVIDENCE_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "R7 / PR-16 (SEM-020) — anexa a evidência REAL (upload S3 pelo servidor, SHA-256) a um item do checklist.",
    sideEffects: "S3 (objeto do anexo) + required_documents (update) + timeline. Sem IA/notificação.",
  },
  requestLegalOpinion: {
    rbacClass: "DRAFT_WRITE", oldBuilder: "tenantProcedure", minRole: "operator", newBuilder: 'orgRoleProcedure("operator")',
    rationale: "Encaminha o processo ao domínio Parecer Jurídico (não emite parecer).",
    sideEffects: "institutional_requests + assignments/document refs + request_notifications (notificação interna) + process_timeline + etapa LEGAL_OPINION.",
  },
  getLegalOpinion: {
    rbacClass: "READ", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure",
    rationale: "Leitura da resposta institucional escopada pelo órgão do contexto.",
    sideEffects: "Nenhum.",
  },
  ratify: {
    rbacClass: "INSTITUTIONAL_DECISION", oldBuilder: "tenantProcedure", minRole: "manager", newBuilder: 'orgRoleProcedure("manager")',
    rationale: "Registro da ratificação (ato institucional). manager+ é só o PISO técnico de quem REGISTRA; a autoridade que decidiu é declarada (decidedBy ≠ recordedBy) e sua competência não é validada pelo sistema (R4.2 pendente) — PR-07.",
    sideEffects: "institutional_decisions (INSERT append-only, revisão CAS, idempotência) + etapa RATIFICATION só se 'ratificado' + process_timeline(approval, id estável). Sem IA/notificação.",
  },
  getRatificationDecision: {
    rbacClass: "READ", oldBuilder: "tenantProcedure", minRole: null, newBuilder: "tenantProcedure",
    rationale: "R4 / PR-07 — leitura da decisão de ratificação corrente, do histórico de revisões e do registro legado, escopada pelo órgão do contexto.",
    sideEffects: "Nenhum.",
  },
  publish: {
    rbacClass: "PUBLICATION", oldBuilder: "tenantProcedure", minRole: "manager", newBuilder: 'orgRoleProcedure("manager")',
    rationale: "Materializa publicações oficiais (aviso, termo de ratificação; extrato só de contrato registrado); exige ratificação 'ratificado' (fail-closed no service).",
    sideEffects: "generated_publications + official_documents (Document Engine) + process_timeline(decision, evento singleton por conteúdo) + etapa/status PUBLICATION/publicado só após gravar. Extrato de contrato só com includeContractExtract e contrato registrado (SEM-064). Sem IA.",
  },
  configureFlags: {
    rbacClass: "WORKFLOW_CONFIGURATION", oldBuilder: "tenantProcedure", minRole: "manager", newBuilder: 'orgRoleProcedure("manager")',
    rationale: "Altera exigências do fluxo adaptativo (ex.: requiresLegalOpinion, requiresPriceResearch).",
    sideEffects: "direct_procurement_workspaces.flags (UPDATE só das flags) + process_timeline(change|decision, antes→depois, ator humano) na mesma transação; sem mudança ⇒ sem escrita (SEM-064). Sem IA/notificação.",
  },
} as const satisfies Record<string, DirectProcurementRbacEntry>;

export type DirectProcurementProcedureName = keyof typeof DIRECT_PROCUREMENT_RBAC_MATRIX;
