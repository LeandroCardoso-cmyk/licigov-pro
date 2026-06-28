import { z }        from "zod";
import { router, publicProcedure } from "../_core/trpc";
import {
  createDeployment,
  advancePhase,
  pauseDeployment,
  resumeDeployment,
  initiateRollback,
  getActiveDeployments,
  applyGovernance,
  computeDeploymentHealth,
} from "../domain/institutionalDeployment";
import {
  runFullValidation,
  getValidationHistory,
} from "../services/deploymentValidationService";

export const deploymentRouter = router({
  createDeployment: publicProcedure
    .input(z.object({
      organizationId: z.number(),
      municipio:      z.string(),
      targetVersion:  z.string(),
      currentVersion: z.string(),
    }))
    .mutation(({ input }) =>
      createDeployment(input.organizationId, input.municipio, input.targetVersion, input.currentVersion)
    ),

  advancePhase: publicProcedure
    .input(z.object({
      deployment: z.object({
        id: z.string(), organizationId: z.number(), municipio: z.string(),
        phase: z.string(), status: z.string(), targetVersion: z.string(),
        currentVersion: z.string(), rolloutPercentage: z.number(),
        healthScore: z.number(), events: z.array(z.any()),
        validationResults: z.record(z.string(), z.boolean()),
        rollbackPoint: z.string().nullable(),
        activatedAt: z.string().nullable(), completedAt: z.string().nullable(),
        createdAt: z.string(),
      }),
      actor: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(({ input }) =>
      advancePhase(input.deployment as Parameters<typeof advancePhase>[0], input.actor, input.notes)
    ),

  pauseDeployment: publicProcedure
    .input(z.object({
      deployment: z.object({ id: z.string(), organizationId: z.number(), municipio: z.string(), phase: z.string(), status: z.string(), targetVersion: z.string(), currentVersion: z.string(), rolloutPercentage: z.number(), healthScore: z.number(), events: z.array(z.any()), validationResults: z.record(z.string(), z.boolean()), rollbackPoint: z.string().nullable(), activatedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string() }),
      actor:  z.string(),
      reason: z.string(),
    }))
    .mutation(({ input }) =>
      pauseDeployment(input.deployment as Parameters<typeof pauseDeployment>[0], input.actor, input.reason)
    ),

  resumeDeployment: publicProcedure
    .input(z.object({
      deployment: z.object({ id: z.string(), organizationId: z.number(), municipio: z.string(), phase: z.string(), status: z.string(), targetVersion: z.string(), currentVersion: z.string(), rolloutPercentage: z.number(), healthScore: z.number(), events: z.array(z.any()), validationResults: z.record(z.string(), z.boolean()), rollbackPoint: z.string().nullable(), activatedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string() }),
      actor: z.string(),
    }))
    .mutation(({ input }) =>
      resumeDeployment(input.deployment as Parameters<typeof resumeDeployment>[0], input.actor)
    ),

  initiateRollback: publicProcedure
    .input(z.object({
      deployment: z.object({ id: z.string(), organizationId: z.number(), municipio: z.string(), phase: z.string(), status: z.string(), targetVersion: z.string(), currentVersion: z.string(), rolloutPercentage: z.number(), healthScore: z.number(), events: z.array(z.any()), validationResults: z.record(z.string(), z.boolean()), rollbackPoint: z.string().nullable(), activatedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string() }),
      actor:  z.string(),
      reason: z.string(),
    }))
    .mutation(({ input }) =>
      initiateRollback(input.deployment as Parameters<typeof initiateRollback>[0], input.actor, input.reason)
    ),

  getActiveDeployments: publicProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => getActiveDeployments(input.organizationId)),

  computeHealth: publicProcedure
    .input(z.object({
      deployment: z.object({ id: z.string(), organizationId: z.number(), municipio: z.string(), phase: z.string(), status: z.string(), targetVersion: z.string(), currentVersion: z.string(), rolloutPercentage: z.number(), healthScore: z.number(), events: z.array(z.any()), validationResults: z.record(z.string(), z.boolean()), rollbackPoint: z.string().nullable(), activatedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string() }),
    }))
    .query(({ input }) =>
      computeDeploymentHealth(input.deployment as Parameters<typeof computeDeploymentHealth>[0])
    ),

  runValidation: publicProcedure
    .input(z.object({
      organizationId: z.number(),
      deploymentId:   z.string(),
      targetVersion:  z.string().optional(),
      currentVersion: z.string().optional(),
      envId:          z.string().optional(),
    }))
    .mutation(({ input }) =>
      runFullValidation(input.organizationId, input.deploymentId, input.targetVersion, input.currentVersion, input.envId)
    ),

  getValidationHistory: publicProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => getValidationHistory(input.organizationId)),

  applyGovernance: publicProcedure
    .input(z.object({
      deployment:            z.object({ id: z.string(), organizationId: z.number(), municipio: z.string(), phase: z.string(), status: z.string(), targetVersion: z.string(), currentVersion: z.string(), rolloutPercentage: z.number(), healthScore: z.number(), events: z.array(z.any()), validationResults: z.record(z.string(), z.boolean()), rollbackPoint: z.string().nullable(), activatedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string() }),
      approvedBy:            z.number(),
      approvalJustification: z.string(),
      constraints:           z.array(z.string()),
      checks:                z.array(z.object({ name: z.string(), passed: z.boolean(), notes: z.string() })),
    }))
    .mutation(({ input }) =>
      applyGovernance(
        input.deployment as Parameters<typeof applyGovernance>[0],
        input.approvedBy,
        input.approvalJustification,
        input.constraints,
        input.checks,
      )
    ),
});
