/**
 * Sprint 4.9 — Copilot Governance Router (operational).
 *
 * Governança e supervisão humana dos copilotos: políticas, aprovação/rejeição de
 * recomendações, atribuição, monitoramento, trilha de auditoria e exportação.
 * tenantProcedure; toda recomendação exige aprovação humana antes de uso.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  createInstitutionalCopilot,
  ALL_COPILOT_TYPES,
  type CopilotType,
} from "../domain/institutionalCopilot";
import { createCopilotPolicy } from "../domain/copilotPolicy";
import {
  insertCopilot,
  insertCopilotPolicy,
  getCopilotPolicy,
  getCopilotSession,
  updateSessionStatus,
  listRecommendationsBySession,
  getDecisionTrace,
  listSessions,
} from "../db/copilots";

const COPILOT_TYPES = ALL_COPILOT_TYPES as [CopilotType, ...CopilotType[]];

export const copilotGovernanceRouter = router({
  createPolicy: tenantProcedure
    .input(z.object({
      copilotType: z.enum(COPILOT_TYPES),
      name: z.string().min(1),
      allowedActions: z.array(z.string()).default([]),
      forbiddenActions: z.array(z.string()).default([]),
      minConfidence: z.number().min(0).max(1).optional(),
      approvalRiskThreshold: z.enum(["baixo", "medio", "alto", "critico"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const policy = createCopilotPolicy({
        organizationId: orgId,
        copilotType: input.copilotType,
        name: input.name,
        allowedActions: input.allowedActions,
        forbiddenActions: input.forbiddenActions,
        minConfidence: input.minConfidence,
        approvalRiskThreshold: input.approvalRiskThreshold,
        correlationId: ctx.correlationId,
      });
      await insertCopilotPolicy(policy);
      return { success: true, policy };
    }),

  updatePolicy: tenantProcedure
    .input(z.object({
      copilotType: z.enum(COPILOT_TYPES),
      name: z.string().min(1),
      allowedActions: z.array(z.string()).default([]),
      forbiddenActions: z.array(z.string()).default([]),
      minConfidence: z.number().min(0).max(1).optional(),
      approvalRiskThreshold: z.enum(["baixo", "medio", "alto", "critico"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      // Política determinística por (org, tipo, nome) — re-persiste com upsert.
      const policy = createCopilotPolicy({
        organizationId: orgId,
        copilotType: input.copilotType,
        name: input.name,
        allowedActions: input.allowedActions,
        forbiddenActions: input.forbiddenActions,
        minConfidence: input.minConfidence,
        approvalRiskThreshold: input.approvalRiskThreshold,
        correlationId: ctx.correlationId,
      });
      await insertCopilotPolicy(policy);
      return { success: true, policy };
    }),

  approveRecommendation: tenantProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const session = await getCopilotSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      await updateSessionStatus(session.id, orgId, "approved", session.updatedAt);
      return { success: true, sessionId: session.id, status: "approved" as const, approvedBy: ctx.user.id };
    }),

  rejectRecommendation: tenantProcedure
    .input(z.object({ sessionId: z.string().min(1), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const session = await getCopilotSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      await updateSessionStatus(session.id, orgId, "rejected", session.updatedAt);
      return { success: true, sessionId: session.id, status: "rejected" as const, rejectedBy: ctx.user.id, reason: input.reason ?? "" };
    }),

  assignCopilot: tenantProcedure
    .input(z.object({ copilotType: z.enum(COPILOT_TYPES) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const copilot = createInstitutionalCopilot({ organizationId: orgId, copilotType: input.copilotType, correlationId: ctx.correlationId });
      await insertCopilot(copilot);
      return { success: true, copilot };
    }),

  monitorCopilot: tenantProcedure
    .input(z.object({ copilotType: z.enum(COPILOT_TYPES) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const policy = await getCopilotPolicy(input.copilotType, orgId);
      const sessions = await listSessions(orgId, 100);
      const copilotSessions = sessions.filter(s => s.copilotType === input.copilotType);
      return {
        copilotType: input.copilotType,
        hasPolicy: policy !== null,
        sessionCount: copilotSessions.length,
        recentSessions: copilotSessions.slice(0, 10),
      };
    }),

  getAuditTrail: tenantProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const session = await getCopilotSession(input.sessionId, orgId);
      const trace = await getDecisionTrace(input.sessionId, orgId);
      const recommendations = await listRecommendationsBySession(input.sessionId, orgId);
      return { session, trace, recommendations };
    }),

  exportSession: tenantProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const session = await getCopilotSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      const trace = await getDecisionTrace(input.sessionId, orgId);
      const recommendations = await listRecommendationsBySession(input.sessionId, orgId);
      return {
        format: "json" as const,
        export: { session, trace, recommendations, exportedBy: ctx.user.id },
      };
    }),
});
