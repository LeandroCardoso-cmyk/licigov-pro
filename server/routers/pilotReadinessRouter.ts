/**
 * Sprint 3.4 — Pilot Readiness Router.
 *
 * tRPC procedures para avaliacao de prontidao de piloto municipal.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { createPilotOrganization, advancePilotPhase, updatePilotMetrics, evaluatePilotHealth, getRolloutPlan, computePilotScore } from "../domain/pilotOrganization";
import { generateReadinessReport, generatePilotScorecard, approvePhaseTransition, getPhaseTransitionHistory } from "../services/pilotReadinessService";

const PilotMetricsSchema = z.object({
  onboardingCompletionRate: z.number().min(0).max(1).optional(),
  activeUsers:              z.number().int().min(0).optional(),
  processesCreated:         z.number().int().min(0).optional(),
  itemsReviewed:            z.number().int().min(0).optional(),
  avgReviewLatencyMs:       z.number().min(0).optional(),
  templateAdoptionRate:     z.number().min(0).max(1).optional(),
  errorRate:                z.number().min(0).max(1).optional(),
});

export const pilotReadinessRouter = router({
  createPilot: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      municipio:      z.string().min(1),
      estado:         z.string().length(2),
      populacao:      z.number().int().positive(),
    }))
    .mutation(({ input }) => {
      return createPilotOrganization({
        organizationId: input.organizationId,
        municipio:      input.municipio,
        estado:         input.estado,
        populacao:      input.populacao,
      });
    }),

  getReadinessReport: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      municipio:      z.string().min(1),
      estado:         z.string().length(2),
      populacao:      z.number().int().positive(),
      metricsOverride: PilotMetricsSchema.optional(),
    }))
    .query(({ input }) => {
      const pilot  = createPilotOrganization({ organizationId: input.organizationId, municipio: input.municipio, estado: input.estado, populacao: input.populacao });
      const patched = input.metricsOverride ? updatePilotMetrics(pilot, input.metricsOverride) : pilot;
      return generateReadinessReport(patched);
    }),

  getPilotScorecard: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      municipio:      z.string().min(1),
      estado:         z.string().length(2),
      populacao:      z.number().int().positive(),
      metricsOverride: PilotMetricsSchema.optional(),
    }))
    .query(({ input }) => {
      const pilot   = createPilotOrganization({ organizationId: input.organizationId, municipio: input.municipio, estado: input.estado, populacao: input.populacao });
      const patched = input.metricsOverride ? updatePilotMetrics(pilot, input.metricsOverride) : pilot;
      return generatePilotScorecard(patched);
    }),

  getRolloutPlan: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      municipio:      z.string().min(1),
      estado:         z.string().length(2),
      populacao:      z.number().int().positive(),
    }))
    .query(({ input }) => {
      const pilot = createPilotOrganization(input);
      return getRolloutPlan(pilot);
    }),

  getTransitionHistory: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => {
      return getPhaseTransitionHistory(input.organizationId);
    }),
});
