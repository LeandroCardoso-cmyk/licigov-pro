import { z }        from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  recordMetric,
  buildStabilitySnapshot,
  isStable,
  getActiveAnomalies,
} from "../services/operationalStabilityService";
import {
  buildHealthSnapshot,
  getHealthHistory,
} from "../services/serviceHealthService";
import {
  createCheckpoint,
  validateCheckpoint,
  buildRecoveryPlan,
  getLatestCheckpoint,
} from "../services/disasterRecoveryService";
import {
  createPolicy,
  getActivePolicies,
  auditPolicy,
} from "../domain/operationalGovernance";
import {
  getRecentCommunications,
  sendAlert,
} from "../services/operationalCommunicationService";

export const stabilityRouter = router({
  getStabilitySnapshot: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      metrics: z.array(z.object({
        id:             z.string(),
        organizationId: z.number(),
        metricType:     z.string(),
        value:          z.number(),
        unit:           z.enum(["ms", "count", "percent", "ratio"]),
        threshold:      z.number(),
        isAnomalous:    z.boolean(),
        recordedAt:     z.string(),
      })),
    }))
    .query(({ input }) =>
      buildStabilitySnapshot(input.organizationId, input.metrics as Parameters<typeof buildStabilitySnapshot>[1], [])
    ),

  recordMetric: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      metricType:     z.enum(["workflow_throughput","queue_depth","review_latency","approval_rate","error_rate","deployment_health","tenant_load"]),
      value:          z.number(),
      unit:           z.enum(["ms","count","percent","ratio"]),
    }))
    .mutation(({ input }) =>
      recordMetric(input.organizationId, input.metricType, input.value, input.unit)
    ),

  isStable: adminProcedure
    .input(z.object({
      snapshot: z.object({
        id: z.string(), organizationId: z.number(),
        overallScore: z.number(), degradationLevel: z.string(),
        metrics: z.array(z.any()), activeAnomalies: z.array(z.any()),
        trend: z.string(), snapshotAt: z.string(),
      }),
    }))
    .query(({ input }) =>
      isStable(input.snapshot as Parameters<typeof isStable>[0])
    ),

  getServiceHealth: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      metrics: z.record(z.string(), z.number()),
    }))
    .query(({ input }) =>
      buildHealthSnapshot(input.organizationId, input.metrics)
    ),

  getHealthHistory: adminProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => getHealthHistory(input.organizationId)),

  createCheckpoint: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      checkpointType: z.enum(["pre_deployment","post_migration","manual","scheduled","pre_rollback"]),
      snapshotData: z.object({
        tablesIncluded: z.array(z.string()),
        rowCounts:      z.record(z.string(), z.number()),
        schemaVersion:  z.string(),
        serviceStates:  z.record(z.string(), z.string()),
      }),
    }))
    .mutation(({ input }) =>
      createCheckpoint(input.organizationId, input.checkpointType, input.snapshotData)
    ),

  getRecoveryCheckpoints: adminProcedure
    .input(z.object({
      organizationId:  z.number(),
      checkpointType:  z.enum(["pre_deployment","post_migration","manual","scheduled","pre_rollback"]),
    }))
    .query(({ input }) =>
      getLatestCheckpoint(input.organizationId, input.checkpointType)
    ),

  getGovernancePolicies: adminProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => getActivePolicies(input.organizationId)),

  createGovernancePolicy: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      policyType:     z.enum(["deployment","workflow","escalation","approval","data_access","support","incident","sla"]),
      name:           z.string(),
      description:    z.string(),
      rules:          z.object({
        conditions:  z.array(z.string()),
        actions:     z.array(z.string()),
        thresholds:  z.record(z.string(), z.number()),
      }),
      effectiveTo:    z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) =>
      // RC-SEC-PR-A: autor derivado do contexto autenticado, nunca do input.
      createPolicy(
        input.organizationId, input.policyType, input.name,
        input.description, input.rules, ctx.user.id,
        input.effectiveTo ?? null,
      )
    ),

  getCommunications: adminProcedure
    .input(z.object({ organizationId: z.number(), limit: z.number().optional() }))
    .query(({ input }) =>
      getRecentCommunications(input.organizationId, input.limit)
    ),

  sendAlert: adminProcedure
    .input(z.object({
      organizationId: z.number(),
      type:           z.enum(["deployment_alert","workflow_alert","degradation_notice","escalation_alert","onboarding_reminder","support_notification","sla_breach","recovery_notice","governance_notice"]),
      priority:       z.enum(["low","medium","high","critical"]),
      subject:        z.string(),
      body:           z.string(),
      recipientRoles: z.array(z.string()),
    }))
    .mutation(({ input }) =>
      sendAlert(input.organizationId, input.type, input.priority, input.subject, input.body, input.recipientRoles)
    ),
});
