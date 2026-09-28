import { z } from "zod";
import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalTenantProcedure } from "../services/experimentalApiGate";
import { createApprovalRequest, recordDecision, escalateApproval, getApprovalHistory, getPendingApprovals } from "../services/humanApprovalService";

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
    .mutation(({ input, ctx }) => createApprovalRequest({ organizationId: ctx.organizationId, ...input })),

  approveExecution: experimentalTenantProcedure
    .input(z.object({ workflowId: z.string(), approver: z.string(), justification: z.string() }))
    .mutation(({ input }) => recordDecision(input.workflowId, { approver: input.approver, decision: "approve", justification: input.justification })),

  rejectExecution: experimentalTenantProcedure
    .input(z.object({ workflowId: z.string(), approver: z.string(), justification: z.string() }))
    .mutation(({ input }) => recordDecision(input.workflowId, { approver: input.approver, decision: "reject", justification: input.justification })),

  escalateExecution: experimentalTenantProcedure
    .input(z.object({ workflowId: z.string(), escalateTo: z.string(), reason: z.string() }))
    .mutation(({ input }) => escalateApproval(input.workflowId, input.escalateTo, input.reason)),

  inspectApproval: experimentalTenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getApprovalHistory(ctx.organizationId)),
});
