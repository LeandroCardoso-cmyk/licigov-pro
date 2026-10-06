import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalTenantProcedure } from "../services/experimentalApiGate";
import {
  createApprovalRequest, recordDecision, escalateApproval, getApprovalHistory, getPendingApprovals,
  APPROVER_NOT_DESIGNATED,
} from "../services/humanApprovalService";
import { APPROVAL_WORKFLOW_ALREADY_RESOLVED, APPROVER_ALREADY_DECIDED } from "../domain/humanApproval";

/*
 * SEM-077 — DECISÃO (superfície segue EM MEMÓRIA e DEV-ONLY atrás do gate LEG-028; nenhum estado institucional é
 * persistido nem fingido). Parte técnica fechada aqui:
 *  - tenant: TODA escrita (`approve`/`reject`/`escalate`) resolve o workflow pela organização do CONTEXTO; workflow
 *    inexistente ou de outra organização ⇒ NOT_FOUND (mesmo erro);
 *  - aprovador: a identidade registrada é SEMPRE o usuário autenticado (`user:<id>`); o campo `approver` do input é
 *    mantido no schema só por compatibilidade e IGNORADO (nunca vira autoridade);
 *  - cada aprovador conta uma única vez (domínio `humanApproval`); decisão repetida é idempotente e a contrária é
 *    recusada; workflow resolvido não aceita novas decisões;
 *  - agentes (`agentExecutionEngine`): saída simulada nunca é marcada `completed`/aprovada (ver domínio `agentExecution`).
 */

/** Referência canônica do aprovador AUTENTICADO + aliases do mesmo usuário (só para conferir a designação). */
function authenticatedApprover(user: { id: number; email?: string | null }) {
  return {
    ref: `user:${user.id}`,
    aliases: [String(user.id), ...(user.email ? [user.email] : [])],
  };
}

const NOT_FOUND = new TRPCError({ code: "NOT_FOUND", message: "Workflow de aprovação não encontrado." });

/** Traduz os tokens estáveis do domínio/serviço em erros tRPC determinísticos. */
function toTrpcError(err: unknown): never {
  if (err instanceof TRPCError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith(APPROVER_NOT_DESIGNATED)) throw new TRPCError({ code: "FORBIDDEN", message: `Aprovador não designado para este workflow (${APPROVER_NOT_DESIGNATED}).` });
  if (message.startsWith(APPROVAL_WORKFLOW_ALREADY_RESOLVED)) throw new TRPCError({ code: "CONFLICT", message: `Workflow de aprovação já resolvido (${APPROVAL_WORKFLOW_ALREADY_RESOLVED}).` });
  if (message.startsWith(APPROVER_ALREADY_DECIDED)) throw new TRPCError({ code: "CONFLICT", message: `Este aprovador já registrou uma decisão diferente (${APPROVER_ALREADY_DECIDED}).` });
  throw err;
}

export const approvalWorkflowRouter = router({
  listApprovals: experimentalTenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getPendingApprovals(ctx.organizationId)),

  createApproval: experimentalTenantProcedure
    .input(z.object({
      sessionId: z.string(),
      approvalType: z.string(),
      requiredApprovers: z.array(z.string()),
      executionId: z.string().optional(),
      planId: z.string().optional(),
      priority: z.enum(["urgent","high","normal","low"]).optional(),
      deadline: z.string().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(({ input, ctx }) => createApprovalRequest({ ...input, organizationId: ctx.organizationId })),

  approveExecution: experimentalTenantProcedure
    // `approver` do cliente é IGNORADO (SEM-077): a identidade é o usuário autenticado.
    .input(z.object({ workflowId: z.string(), approver: z.string().optional(), justification: z.string() }))
    .mutation(({ input, ctx }) => {
      try {
        const updated = recordDecision(
          input.workflowId,
          { approver: authenticatedApprover(ctx.user), decision: "approve", justification: input.justification },
          ctx.organizationId,
        );
        if (!updated) throw NOT_FOUND;
        return updated;
      } catch (err) { return toTrpcError(err); }
    }),

  rejectExecution: experimentalTenantProcedure
    .input(z.object({ workflowId: z.string(), approver: z.string().optional(), justification: z.string() }))
    .mutation(({ input, ctx }) => {
      try {
        const updated = recordDecision(
          input.workflowId,
          { approver: authenticatedApprover(ctx.user), decision: "reject", justification: input.justification },
          ctx.organizationId,
        );
        if (!updated) throw NOT_FOUND;
        return updated;
      } catch (err) { return toTrpcError(err); }
    }),

  escalateExecution: experimentalTenantProcedure
    .input(z.object({ workflowId: z.string(), escalateTo: z.string(), reason: z.string() }))
    .mutation(({ input, ctx }) => {
      try {
        const updated = escalateApproval(input.workflowId, input.escalateTo, input.reason, ctx.organizationId, authenticatedApprover(ctx.user).ref);
        if (!updated) throw NOT_FOUND;
        return updated;
      } catch (err) { return toTrpcError(err); }
    }),

  inspectApproval: experimentalTenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getApprovalHistory(ctx.organizationId)),
});
