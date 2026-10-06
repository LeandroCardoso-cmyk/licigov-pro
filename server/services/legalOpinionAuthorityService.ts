/**
 * NEW-007 — Autoridade CONTEXTUAL do Parecer Jurídico (Legal Opinion Workspace).
 *
 * Regra funcional aprovada pelo owner: o parecer NÃO é autorizado por ranking genérico de papel.
 *  1. Leituras seguem tenant-scoped (`tenantProcedure`).
 *  2. Toda mutação exige, no mínimo, `orgRoleProcedure("operator")` (no router).
 *  3. Além do papel, as ações PRÓPRIAS DO PROCURADOR (elaborar, editar, assinar, devolver, arquivar) exigem
 *     ATRIBUIÇÃO VÁLIDA do ator ao workspace — o modelo que já existe: `legal_opinion_workspaces.assigned_lawyer`
 *     (atribuição corrente) E o registro auditável em `lawyer_assignments` para o MESMO ator/workspace/tenant.
 *  4. owner/admin/manager NÃO viram procurador automaticamente; admin de plataforma (users.role='admin', que o
 *     `resolveTenant` projeta como owner SINTÉTICO) não tem autoridade jurídica sem atribuição — e, como a
 *     autoridade exige MEMBERSHIP REAL ativa (não a projeção sintética), ele também não pode se autoatribuir.
 *
 * Toda recusa acontece ANTES de qualquer escrita, evento, notificação, chave de idempotência ou chamada de IA,
 * e é registrada (sem PII/conteúdo) com correlationId. Tokens estáveis (não traduzir; usados por testes/cliente)
 * vão no fim da mensagem pt-BR.
 */

import { TRPCError } from "@trpc/server";
import type { OrgRole } from "../../drizzle/schema";
import type { LegalOpinionWorkspace } from "../domain/legalOpinionWorkspace";
import { getLawyerAssignmentForWorkspace } from "../db/legalOpinionAssignment";
import { getMembership } from "./tenantService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("legalOpinionAuthority");

/** Ator sem atribuição válida tentou uma ação própria do procurador. */
export const LEGAL_OPINION_ASSIGNMENT_REQUIRED = "LEGAL_OPINION_ASSIGNMENT_REQUIRED";
/** Recebimento exige membership REAL ativa (operator+) no tenant — nunca a projeção sintética do admin de plataforma. */
export const LEGAL_OPINION_MEMBERSHIP_REQUIRED = "LEGAL_OPINION_MEMBERSHIP_REQUIRED";
/** O workspace já tem OUTRO procurador designado; o recebimento não o toma (não há regra de reatribuição). */
export const LEGAL_OPINION_ALREADY_ASSIGNED = "LEGAL_OPINION_ALREADY_ASSIGNED";
/** A solicitação não está num estado que admita recebimento (validado antes de qualquer escrita). */
export const LEGAL_OPINION_REQUEST_NOT_RECEIVABLE = "LEGAL_OPINION_REQUEST_NOT_RECEIVABLE";
/** F1 — retomada de um recebimento parcial NÃO é segura (solicitação em estado/ator incompatível): falha fechada, observável. */
export const LEGAL_OPINION_RECEIVE_RESUME_UNSAFE = "LEGAL_OPINION_RECEIVE_RESUME_UNSAFE";

export const LEGAL_OPINION_ASSIGNMENT_REQUIRED_MESSAGE =
  `Somente o procurador designado para este parecer pode executar esta ação. Papel na organização não substitui a atribuição (${LEGAL_OPINION_ASSIGNMENT_REQUIRED}).`;
export const LEGAL_OPINION_MEMBERSHIP_REQUIRED_MESSAGE =
  `Receber uma solicitação de parecer exige vínculo ativo de operador (ou superior) nesta organização (${LEGAL_OPINION_MEMBERSHIP_REQUIRED}).`;
export const LEGAL_OPINION_ALREADY_ASSIGNED_MESSAGE =
  `Esta solicitação já foi recebida por outro procurador; a atribuição existente não foi alterada (${LEGAL_OPINION_ALREADY_ASSIGNED}).`;
export const LEGAL_OPINION_RECEIVE_RESUME_UNSAFE_MESSAGE =
  `O recebimento anterior desta solicitação ficou incompleto e não pode ser retomado com segurança; nada foi alterado (${LEGAL_OPINION_RECEIVE_RESUME_UNSAFE}).`;
export function legalOpinionRequestNotReceivableMessage(status: string): string {
  return `A solicitação está em "${status}" e não pode ser recebida; nada foi gravado (${LEGAL_OPINION_REQUEST_NOT_RECEIVABLE}).`;
}

/** Ações próprias do procurador — todas exigem atribuição (ver classificação no relatório NEW-007). */
export type LegalOpinionLawyerAction = "create_draft" | "update_opinion" | "sign_opinion" | "return_opinion" | "archive_opinion";

/** Log estruturado (sem PII/conteúdo) da trilha de atribuição — recebimento, retry e conflito. */
export function logLegalOpinionAssignment(
  event: "legal_opinion_workspace_assigned" | "legal_opinion_receive_replayed" | "legal_opinion_receive_conflict"
    | "legal_opinion_receive_resumed" | "legal_opinion_receive_resume_blocked",
  data: { organizationId: number; workspaceId: string; requestId: string; actorUserId: number; correlationId: string; created?: boolean },
): void {
  if (event === "legal_opinion_receive_conflict" || event === "legal_opinion_receive_resume_blocked") log.warn(event, data);
  else log.info(event, data);
}

const ORG_ROLE_RANK: Record<OrgRole, number> = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 };
const MIN_LEGAL_ROLE: OrgRole = "operator";

/** Membership REAL ativa com papel ≥ operator (nunca a projeção sintética do contexto do admin de plataforma). */
async function hasRealOperatorMembership(userId: number, organizationId: number): Promise<boolean> {
  const membership = await getMembership(userId, organizationId).catch(() => null);
  return Boolean(membership && membership.ativo && ORG_ROLE_RANK[membership.role] >= ORG_ROLE_RANK[MIN_LEGAL_ROLE]);
}

/**
 * Exige que `actorUserId` possa RECEBER (e assim ser designado para) uma solicitação de parecer no tenant.
 * Recusa ⇒ FORBIDDEN `LEGAL_OPINION_MEMBERSHIP_REQUIRED`, sem escrita.
 */
export async function assertLegalOpinionReceiver(params: {
  organizationId: number; actorUserId: number; requestId: string; correlationId: string;
}): Promise<void> {
  if (await hasRealOperatorMembership(params.actorUserId, params.organizationId)) return;
  log.warn("legal_opinion_receive_denied", {
    organizationId: params.organizationId, actorUserId: params.actorUserId, requestId: params.requestId,
    correlationId: params.correlationId, reason: "membership_required",
  });
  throw new TRPCError({ code: "FORBIDDEN", message: LEGAL_OPINION_MEMBERSHIP_REQUIRED_MESSAGE });
}

/**
 * Exige ATRIBUIÇÃO VÁLIDA do ator ao workspace para uma ação própria do procurador:
 *  - `workspace.assignedLawyer === actor` (atribuição corrente);
 *  - registro em `lawyer_assignments` para (tenant, workspace, actor) (trilha auditável da distribuição);
 *  - membership REAL ativa ≥ operator no tenant (um procurador rebaixado/removido perde a autoridade).
 * Qualquer falha ⇒ FORBIDDEN `LEGAL_OPINION_ASSIGNMENT_REQUIRED` (mesma mensagem para todos os motivos; o motivo
 * vai só no log). O workspace chega aqui já resolvido NO TENANT do contexto (cross-tenant ⇒ NOT_FOUND antes).
 */
export async function assertLegalOpinionAssignee(params: {
  workspace: LegalOpinionWorkspace; actorUserId: number; action: LegalOpinionLawyerAction; correlationId: string;
}): Promise<void> {
  const { workspace: ws, actorUserId } = params;
  let reason: string | null = null;
  if (ws.assignedLawyer === null) reason = "workspace_unassigned";
  else if (ws.assignedLawyer !== actorUserId) reason = "not_assigned_to_actor";
  else {
    const [assignment, member] = await Promise.all([
      getLawyerAssignmentForWorkspace(ws.id, ws.organizationId, actorUserId),
      hasRealOperatorMembership(actorUserId, ws.organizationId),
    ]);
    if (!assignment) reason = "assignment_record_missing";
    else if (!member) reason = "membership_required";
  }
  if (reason === null) return;
  log.warn("legal_opinion_authority_denied", {
    organizationId: ws.organizationId, workspaceId: ws.id, actorUserId, action: params.action,
    correlationId: params.correlationId, reason,
  });
  throw new TRPCError({ code: "FORBIDDEN", message: LEGAL_OPINION_ASSIGNMENT_REQUIRED_MESSAGE });
}
