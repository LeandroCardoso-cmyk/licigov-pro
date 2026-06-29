import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { createApprovalRequest, recordDecision, escalateApproval, delegateApproval, getApprovalHistory, getPendingApprovals } from "../services/humanApprovalService";

export const approvalWorkflowRouter = router({
  listApprovals: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getPendingApprovals(ctx.organizationId)),

  createApproval: tenantProcedure
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

  approveExecution: tenantProcedure
    .input(z.object({ workflowId: z.string(), approver: z.string(), justification: z.string() }))
    .mutation(({ input }) => recordDecision(input.workflowId, { approver: input.approver, decision: "approve", justification: input.justification })),

  rejectExecution: tenantProcedure
    .input(z.object({ workflowId: z.string(), approver: z.string(), justification: z.string() }))
    .mutation(({ input }) => recordDecision(input.workflowId, { approver: input.approver, decision: "reject", justification: input.justification })),

  escalateExecution: tenantProcedure
    .input(z.object({ workflowId: z.string(), escalateTo: z.string(), reason: z.string() }))
    .mutation(({ input }) => escalateApproval(input.workflowId, input.escalateTo, input.reason)),

  inspectApproval: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getApprovalHistory(ctx.organizationId)),
});
