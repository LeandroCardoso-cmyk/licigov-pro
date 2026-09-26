import { tenantProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";
import { serviceLogger } from "../services/observabilityService";

const authzLog = serviceLogger("collaborationRouter");

/*
 * R1 / PR-01 — SEM-001 (P0): isolamento multi-tenant da colaboração (FAIL-CLOSED).
 *
 * Contrato (servidor — esconder botão não é controle):
 *  1. TENANT: a fonte da verdade é `ctx.organizationId` (resolvido por `tenantProcedure`, nunca do input).
 *  2. PROCESSO: resolvido por (processId, ctx.organizationId). Outro tenant, inexistente ou sem vínculo do
 *     chamador ⇒ o MESMO `NOT_FOUND "Processo não encontrado."` (anti-enumeração). Só DEPOIS de o processo
 *     pertencer ao tenant a permissão no processo (owner/approver/membro) é avaliada.
 *  3. USUÁRIO-ALVO de adição/atribuição/alteração: precisa ter membership ATIVA no mesmo órgão
 *     (`organization_members`, N:N). Inexistente, de outro órgão ou inativo ⇒ o MESMO
 *     `NOT_FOUND "Usuário não encontrado nesta organização."` — nunca revela que existe em outro órgão.
 *  4. Escrita, notificação e activity log SÓ depois de todos os gates. Negação ⇒ zero efeito colateral,
 *     apenas o evento técnico `tenant_authorization_denied` (sem e-mail/nome do alvo).
 *  5. Leituras nunca expõem identidade de associação histórica com usuário de outro órgão (omitida + aviso de
 *     integridade sem PII). Remoção dessas associações continua possível (saneamento), sem expor o nome.
 */

type TenantCtx = Pick<TrpcContext, "organizationId" | "user" | "correlationId">;
type DenialReason =
  | "process_not_in_organization"
  | "caller_not_linked_to_process"
  | "target_user_not_in_organization"
  | "target_not_process_member";

const PROCESS_NOT_FOUND = "Processo não encontrado.";
const USER_NOT_FOUND = "Usuário não encontrado nesta organização.";
const MEMBER_NOT_FOUND = "Membro não encontrado neste processo.";

function deny(ctx: TenantCtx, procedure: string, processId: number, reason: DenialReason): void {
  authzLog.warn("tenant_authorization_denied", {
    procedure,
    organizationId: ctx.organizationId,
    actorUserId: ctx.user!.id,
    processId,
    correlationId: ctx.correlationId,
    reason,
  });
}

/** Processo do tenant do contexto — ou o MESMO NOT_FOUND para outro tenant/inexistente. */
async function resolveProcessInTenant(ctx: TenantCtx, procedure: string, processId: number) {
  const process = await db.getProcessByIdForOrganization(processId, ctx.organizationId!);
  if (!process) {
    deny(ctx, procedure, processId, "process_not_in_organization");
    throw new TRPCError({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
  }
  return process;
}

/**
 * Permissão de GESTÃO do processo (já resolvido no tenant): owner sempre; approver quando a operação admite.
 * Mesmo órgão SEM vínculo com o processo ⇒ o mesmo NOT_FOUND (não revela o processo); membro sem a permissão
 * necessária (já enxerga o processo) ⇒ FORBIDDEN.
 */
async function requireProcessManager(
  ctx: TenantCtx, procedure: string, process: { id: number; ownerId: number }, opts: { allowApprover: boolean; forbiddenMessage: string },
) {
  if (process.ownerId === ctx.user!.id) return;
  const caller = await db.getProcessMember(process.id, ctx.user!.id);
  if (!caller) {
    deny(ctx, procedure, process.id, "caller_not_linked_to_process");
    throw new TRPCError({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
  }
  if (!(opts.allowApprover && caller.permission === "approver")) {
    throw new TRPCError({ code: "FORBIDDEN", message: opts.forbiddenMessage });
  }
}

/** Usuário-alvo com membership ATIVA no tenant — ou o MESMO NOT_FOUND (anti-enumeração). */
async function resolveTargetUserById(ctx: TenantCtx, procedure: string, processId: number, userId: number) {
  const user = await db.getActiveOrganizationUserById(userId, ctx.organizationId!);
  if (!user) {
    deny(ctx, procedure, processId, "target_user_not_in_organization");
    throw new TRPCError({ code: "NOT_FOUND", message: USER_NOT_FOUND });
  }
  return user;
}

/** Associação do alvo ao processo — obrigatória para alterar/remover membro. */
async function requireProcessMembership(ctx: TenantCtx, procedure: string, processId: number, userId: number) {
  const member = await db.getProcessMember(processId, userId);
  if (!member) {
    deny(ctx, procedure, processId, "target_not_process_member");
    throw new TRPCError({ code: "NOT_FOUND", message: MEMBER_NOT_FOUND });
  }
  return member;
}

/** Activity log do processo com organização e correlação do contexto (só após sucesso). */
async function logActivity(ctx: TenantCtx, processId: number, action: string, details?: string) {
  await db.createActivityLogForOrganization({
    processId, userId: ctx.user!.id, action,
    // `activity_logs.correlationId` é varchar(36); o header do cliente pode ser maior — nunca falhar após a escrita.
    correlationId: ctx.correlationId ? ctx.correlationId.slice(0, 36) : null,
    ...(details ? { details } : {}),
  }, ctx.organizationId!);
}

// PR 0 (Security Emergency Closure): boundary tenant-scoped compartilhado por
// `listMembers` e `getStageAssignments` — resolve o processo dentro da organização do
// chamador e autoriza owner/membro do processo/admin de plataforma (o tenant do admin
// já foi validado deliberadamente por `resolveTenant`). Cross-tenant, processo
// inexistente ou sem autorização retornam o MESMO NOT_FOUND (anti-enumeração).
async function authorizeProcessAccess(ctx: TenantCtx, processId: number, procedure: string) {
  const process = await db.getProcessByIdForOrganization(processId, ctx.organizationId!);
  if (!process) {
    deny(ctx, procedure, processId, "process_not_in_organization");
    throw new TRPCError({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
  }

  const isPlatformAdmin = ctx.user!.role === "admin";
  const isOwner = process.ownerId === ctx.user!.id;
  const currentMember = isOwner || isPlatformAdmin ? undefined : await db.getProcessMember(processId, ctx.user!.id);
  if (!isOwner && !isPlatformAdmin && !currentMember) {
    deny(ctx, procedure, processId, "caller_not_linked_to_process");
    throw new TRPCError({ code: "NOT_FOUND", message: PROCESS_NOT_FOUND });
  }

  return process;
}

/** Associações históricas com usuário de outro órgão: aviso de integridade só com contagem (sem PII). */
function reportHiddenRows(ctx: TenantCtx, procedure: string, processId: number, hiddenCount: number) {
  if (hiddenCount === 0) return;
  authzLog.warn("collaboration_cross_tenant_rows_hidden", {
    procedure, organizationId: ctx.organizationId, actorUserId: ctx.user!.id, processId,
    correlationId: ctx.correlationId, hiddenCount,
  });
}

export const collaborationRouter = router({
  addMember: tenantProcedure
    .input(z.object({
      processId: z.number(),
      userEmail: z.string().email(),
      permission: z.enum(["viewer", "editor", "approver"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.addMember";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: true, forbiddenMessage: "Sem permissão para adicionar membros." });

      const targetUser = await db.getActiveOrganizationUserByEmail(input.userEmail, ctx.organizationId);
      if (!targetUser) {
        deny(ctx, op, process.id, "target_user_not_in_organization");
        throw new TRPCError({ code: "NOT_FOUND", message: USER_NOT_FOUND });
      }

      const existingMember = await db.getProcessMember(process.id, targetUser.id);
      if (existingMember) {
        throw new TRPCError({ code: "CONFLICT", message: "Usuário já é membro deste processo." });
      }

      await db.addProcessMember({
        processId: process.id,
        userId: targetUser.id,
        permission: input.permission,
        invitedBy: ctx.user.id,
      });

      await db.createNotification({
        userId: targetUser.id,
        title: "Você foi adicionado a um processo",
        message: `${ctx.user.name} adicionou você ao processo "${process.name}" como ${input.permission}`,
        type: "member_added",
        processId: process.id,
        isRead: false,
      });

      await logActivity(ctx, process.id, `adicionou ${targetUser.name} como ${input.permission}`);

      return { success: true };
    }),

  removeMember: tenantProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.removeMember";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: true, forbiddenMessage: "Sem permissão para remover membros." });

      if (input.userId === process.ownerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Não é possível remover o proprietário do processo." });
      }

      // Saneamento permitido: a associação precisa existir NESTE processo (do tenant), mas o usuário removido
      // NÃO precisa pertencer ao órgão — uma associação histórica cross-tenant pode (e deve) poder ser retirada.
      await requireProcessMembership(ctx, op, process.id, input.userId);
      await db.removeProcessMember(process.id, input.userId);

      // Nome só se o usuário pertence ao órgão; associação estrangeira nunca tem o nome gravado.
      const removedUser = await db.getActiveOrganizationUserById(input.userId, ctx.organizationId);
      await logActivity(ctx, process.id, `removeu ${removedUser?.name || "um membro"} do processo`);

      return { success: true };
    }),

  updatePermission: tenantProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
      permission: z.enum(["viewer", "editor", "approver"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.updatePermission";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: false, forbiddenMessage: "Apenas o proprietário pode alterar permissões." });

      // Associação histórica com usuário de outro órgão NÃO pode ser elevada: exige membro do processo E do órgão.
      await requireProcessMembership(ctx, op, process.id, input.userId);
      const targetUser = await resolveTargetUserById(ctx, op, process.id, input.userId);

      await db.updateProcessMemberPermission(process.id, input.userId, input.permission);
      await logActivity(ctx, process.id, `alterou a permissão de ${targetUser.name || "um membro"} para ${input.permission}`);

      return { success: true };
    }),

  // PR 0 (Security Emergency Closure): `listMembers` era `protectedProcedure` sem
  // checagem de tenant/autorização — qualquer usuário autenticado podia enumerar
  // `processId` e obter nome + e-mail de membros de processos de QUALQUER organização.
  // Corrigido: processo resolvido dentro do tenant do chamador (`getProcessByIdForOrganization`,
  // já usado como padrão tenant-scoped em `server/db/processes.ts`), e o chamador precisa ter
  // autorização legítima naquele processo (owner ou membro). Cross-tenant / sem processo /
  // sem autorização retornam o MESMO `NOT_FOUND` (anti-enumeração, padrão já adotado no projeto).
  // R1 / SEM-001: membros sem vínculo com o órgão (associação histórica cross-tenant) não são expostos.
  listMembers: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      const op = "collaboration.listMembers";
      await authorizeProcessAccess(ctx, input.processId, op);
      const { members, hiddenCount } = await db.getProcessMembersForOrganization(input.processId, ctx.organizationId);
      reportHiddenRows(ctx, op, input.processId, hiddenCount);
      return members;
    }),

  checkPermission: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      const process = await db.getProcessByIdForOrganization(input.processId, ctx.organizationId);
      if (!process) {
        return { permission: null, isOwner: false };
      }

      if (process.ownerId === ctx.user.id) {
        return { permission: "owner" as const, isOwner: true };
      }

      const member = await db.getProcessMember(input.processId, ctx.user.id);
      return {
        permission: member?.permission || null,
        isOwner: false,
      };
    }),

  updateFunctionalRole: tenantProcedure
    .input(z.object({
      processId: z.number(),
      userId: z.number(),
      functionalRole: z.enum(["solicitante", "compras", "juridico", "controle_interno", "gestor", "fiscal", "administrador"]).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.updateFunctionalRole";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: false, forbiddenMessage: "Apenas o proprietário pode definir perfis funcionais." });

      await requireProcessMembership(ctx, op, process.id, input.userId);
      const targetUser = await resolveTargetUserById(ctx, op, process.id, input.userId);

      await db.updateProcessMemberFunctionalRole(process.id, input.userId, input.functionalRole);
      await logActivity(ctx, process.id, `definiu perfil de ${targetUser.name || "membro"} como ${input.functionalRole || "nenhum"}`);
      return { success: true };
    }),

  assignStage: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
      assignedUserId: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.assignStage";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: false, forbiddenMessage: "Apenas o proprietário pode atribuir responsáveis por etapa." });
      const assignedUser = await resolveTargetUserById(ctx, op, process.id, input.assignedUserId);

      await db.upsertStageAssignment({
        processId: process.id,
        docType: input.docType,
        assignedUserId: assignedUser.id,
        assignedBy: ctx.user.id,
        note: input.note || null,
      });

      await db.createNotification({
        userId: assignedUser.id,
        title: "Você foi designado como responsável por uma etapa",
        message: `${ctx.user.name} designou você como responsável pela etapa ${input.docType.toUpperCase()} no processo "${process.name}"${input.note ? `. Nota: ${input.note}` : ""}`,
        type: "stage_assigned",
        processId: process.id,
        isRead: false,
      });

      await logActivity(
        ctx, process.id,
        `designou ${assignedUser.name} como responsável pela etapa ${input.docType.toUpperCase()}`,
        JSON.stringify({ docType: input.docType, assignedUserId: assignedUser.id }),
      );

      return { success: true };
    }),

  unassignStage: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const op = "collaboration.unassignStage";
      const process = await resolveProcessInTenant(ctx, op, input.processId);
      await requireProcessManager(ctx, op, process, { allowApprover: false, forbiddenMessage: "Apenas o proprietário pode remover responsáveis." });
      // Saneamento permitido: remove a atribuição da etapa NESTE processo sem resolver/expor o usuário atribuído.
      await db.removeStageAssignment(process.id, input.docType);
      await logActivity(ctx, process.id, `removeu responsável da etapa ${input.docType.toUpperCase()}`);
      return { success: true };
    }),

  getStageAssignments: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      const op = "collaboration.getStageAssignments";
      await authorizeProcessAccess(ctx, input.processId, op);
      const { assignments, hiddenCount } = await db.getStageAssignmentsForOrganization(input.processId, ctx.organizationId);
      reportHiddenRows(ctx, op, input.processId, hiddenCount);
      return assignments;
    }),
});
