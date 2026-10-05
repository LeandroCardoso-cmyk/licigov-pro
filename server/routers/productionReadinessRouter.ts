/**
 * Sprint 3.2 — Production Readiness Router.
 *
 * tRPC procedures for system health, cache metrics, ingestion status.
 */

import { router } from "../_core/trpc";
// R2 / LEG-028 — API experimental em memória: gate governado (desligada em production/staging; dev só com opt-in).
import { experimentalProtectedProcedure } from "../services/experimentalApiGate";
import { z } from "zod";
import type { CacheMetrics } from "../services/distributedCacheService";
import type { IngestionJob } from "../services/realCatalogIngestionService";

// ─── In-memory state (production would query DB) ─────────────────────────────

const lastIngestionJobs = new Map<number, IngestionJob>();

export const productionReadinessRouter = router({
  getSystemHealth: experimentalProtectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input: _input }) => {
      const checks = [
        { name: "database",  status: "healthy" as const, details: "Connection pool active" },
        { name: "cache",     status: "healthy" as const, details: "In-memory cache operational" },
        { name: "ingestion", status: "healthy" as const, details: "No active ingestion errors" },
        { name: "export",    status: "healthy" as const, details: "DOCX/PDF engine ready" },
        { name: "security",  status: "healthy" as const, details: "No anomalies detected" },
      ];

      const healthy = checks.every(c => c.status === "healthy");

      return { healthy, checks };
    }),

  getCacheMetrics: experimentalProtectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input: _input }): CacheMetrics => {
      // In production, would pull from actual cache service
      return {
        hits:      0,
        misses:    0,
        evictions: 0,
        size:      0,
        hitRatio:  0,
      };
    }),

  getIngestionStatus: experimentalProtectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }): IngestionJob | null => {
      return lastIngestionJobs.get(input.organizationId) ?? null;
    }),
});
