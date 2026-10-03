/**
 * R9 / SEM-071 — Política do RESPONSÁVEL (assignedTo) de tarefas da Gestão do Departamento.
 *
 * Antes, `tasks.create/update` e `departmentTasks.create/update` gravavam o ID cru recebido do cliente:
 * qualquer número (inexistente, usuário de OUTRO órgão, membro desativado) virava responsável. Agora o
 * responsável precisa ter membership ATIVA (`organization_members.ativo = 1`) na organização do contexto,
 * validada no servidor ANTES de qualquer escrita. Inexistente, de outro órgão ou inativo ⇒ o MESMO
 * BAD_REQUEST (anti-enumeração: a resposta não revela se o usuário existe em outro tenant).
 */

import { TRPCError } from "@trpc/server";
import { getActiveOrganizationUserById } from "../db/organizations";
import { serviceLogger } from "./observabilityService";

const authzLog = serviceLogger("taskAssigneePolicy");

export const TASK_ASSIGNEE_NOT_MEMBER_MESSAGE = "Responsável inválido: o usuário não é membro ativo desta organização.";

export async function assertTaskAssigneeIsActiveMember(params: {
  assignedTo: number;
  organizationId: number;
  actorUserId: number;
  procedure: string;
}): Promise<void> {
  const member = Number.isInteger(params.assignedTo) && params.assignedTo > 0
    ? await getActiveOrganizationUserById(params.assignedTo, params.organizationId)
    : undefined;
  if (member) return;
  authzLog.warn("task_assignee_rejected", {
    procedure: params.procedure,
    organizationId: params.organizationId,
    userId: params.actorUserId,
    resourceId: params.assignedTo,
    reason: "assignee_not_active_member_of_organization",
  });
  throw new TRPCError({ code: "BAD_REQUEST", message: TASK_ASSIGNEE_NOT_MEMBER_MESSAGE });
}
