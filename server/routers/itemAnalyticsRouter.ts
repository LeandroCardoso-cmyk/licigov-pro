/**
 * Sprint 3.1 — Item Analytics Router.
 *
 * Procedimentos para KPIs e dashboard analítico de ItemTR.
 */

import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalTenantProcedure } from "../services/experimentalApiGate";
// SEM-073 — a organização vem do contexto autenticado; `organizationId` do input é só compatibilidade (divergente ⇒ recusa).
import { organizationFromContext } from "../services/experimentalApiGate";
import { z } from "zod";

import {
  computeItemAnalytics,
  type ItemLifecycleData,
  type ConfidenceWindow,
} from "../services/itemAnalyticsService";

// ─── Demo lifecycle data ──────────────────────────────────────────────────────

function getMockLifecycleData(organizationId: number): ItemLifecycleData[] {
  return [
    {
      itemId:            "item-001",
      organizationId,
      reviewState:       "approved",
      hadCandidates:     true,
      selectedCandidate: true,
      overridden:        false,
      manualEntry:       false,
      catalogLinked:     true,
      catalogCorrect:    true,
      confidenceScore:   0.92,
      reviewLatencyMs:   12000,
    },
    {
      itemId:            "item-002",
      organizationId,
      reviewState:       "approved",
      hadCandidates:     true,
      selectedCandidate: true,
      overridden:        false,
      manualEntry:       false,
      catalogLinked:     true,
      catalogCorrect:    true,
      confidenceScore:   0.88,
      reviewLatencyMs:   9500,
    },
    {
      itemId:            "item-003",
      organizationId,
      reviewState:       "overridden",
      hadCandidates:     true,
      selectedCandidate: false,
      overridden:        true,
      manualEntry:       false,
      catalogLinked:     true,
      catalogCorrect:    false,
      confidenceScore:   0.65,
      reviewLatencyMs:   30000,
    },
    {
      itemId:            "item-004",
      organizationId,
      reviewState:       "awaiting_review",
      hadCandidates:     true,
      selectedCandidate: false,
      overridden:        false,
      manualEntry:       false,
      catalogLinked:     true,
      catalogCorrect:    false,
      confidenceScore:   0.78,
      reviewLatencyMs:   null,
    },
    {
      itemId:            "item-005",
      organizationId,
      reviewState:       "pending_match",
      hadCandidates:     false,
      selectedCandidate: false,
      overridden:        false,
      manualEntry:       false,
      catalogLinked:     false,
      catalogCorrect:    false,
      confidenceScore:   0.55,
      reviewLatencyMs:   null,
    },
    {
      itemId:            "item-006",
      organizationId,
      reviewState:       "rejected",
      hadCandidates:     true,
      selectedCandidate: false,
      overridden:        false,
      manualEntry:       false,
      catalogLinked:     false,
      catalogCorrect:    false,
      confidenceScore:   0.40,
      reviewLatencyMs:   5000,
    },
  ];
}

function getMockConfidenceWindows(): ConfidenceWindow[] {
  return [
    { windowLabel: "Semana 1", avgConfidence: 0.72 },
    { windowLabel: "Semana 2", avgConfidence: 0.75 },
    { windowLabel: "Semana 3", avgConfidence: 0.81 },
    { windowLabel: "Semana 4", avgConfidence: 0.79 },
  ];
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const itemAnalyticsRouter = router({
  getDashboard: experimentalTenantProcedure
    .input(z.object({
      organizationId: z.number().optional(),
      processId:      z.number().optional(),
    }))
    .query(({ input, ctx }) => {
      const organizationId = organizationFromContext(ctx, input.organizationId, "itemAnalytics.getDashboard");
      const lifecycleData = getMockLifecycleData(organizationId);
      const confidenceWindows = getMockConfidenceWindows();

      const snapshot = computeItemAnalytics(organizationId, lifecycleData, {
        clauseUsage:       { recommendedCount: 8, usedCount: 6 },
        confidenceWindows,
        matchingRuns:      [
          { replayKey: "key-1", candidateSetSignature: "sig-abc" },
          { replayKey: "key-1", candidateSetSignature: "sig-abc" },
          { replayKey: "key-2", candidateSetSignature: "sig-def" },
        ],
      });

      // Trends: last 4 weeks
      const trends = confidenceWindows.map((w, idx) => ({
        week:            w.windowLabel,
        avgConfidence:   w.avgConfidence,
        itemsProcessed:  10 + idx * 3,
        approvalRate:    0.70 + idx * 0.05,
      }));

      return {
        kpis: {
          snapshot,
          byKey: Object.fromEntries(snapshot.kpis.map(k => [k.key, k])),
        },
        trends,
      };
    }),
});
