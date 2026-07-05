/**
 * Sprint 4.9 — Copilot Observability Service
 *
 * Emite traces/métricas estruturadas (console JSON) e persiste métricas na
 * tabela copilot_metrics (graceful sem DB). Cobre tempo de resposta, copiloto
 * utilizado, reasoning, lineage, replay e explainability.
 */

import type { CopilotType } from "../domain/institutionalCopilot";
import { recordCopilotMetric } from "../db/copilots";

export interface CopilotTrace {
  readonly correlationId: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly sessionId: string;
  readonly reasoningId: string;
  readonly durationMs: number;
  readonly evidenceCount: number;
  readonly groundingOnly: boolean;
  readonly replaySnapshot: string;
  readonly recordedAt: string;
}

export function recordCopilotTrace(trace: CopilotTrace): void {
  console.info(JSON.stringify({ event: "copilot_trace", ...trace }));
}

/** Persiste latência de resposta do copiloto (ms). */
export async function recordCopilotLatency(params: {
  organizationId: number;
  correlationId: string;
  copilotType: CopilotType;
  ms: number;
}): Promise<void> {
  console.info(JSON.stringify({ event: "copilot_latency", ...params }));
  await recordCopilotMetric({
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    copilotType: params.copilotType,
    metricName: "copilot.response.latency",
    metricValue: params.ms,
    metricUnit: "ms",
  });
}

/** Persiste uso de um copiloto (contador). */
export async function recordCopilotUsage(params: {
  organizationId: number;
  correlationId: string;
  copilotType: CopilotType;
}): Promise<void> {
  console.info(JSON.stringify({ event: "copilot_usage", ...params }));
  await recordCopilotMetric({
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    copilotType: params.copilotType,
    metricName: "copilot.usage",
    metricValue: 1,
    tags: { copilotType: params.copilotType },
  });
}

/** Persiste confiança da recomendação emitida. */
export async function recordRecommendationConfidence(params: {
  organizationId: number;
  correlationId: string;
  copilotType: CopilotType;
  confidence: number;
}): Promise<void> {
  console.info(JSON.stringify({ event: "copilot_confidence", ...params }));
  await recordCopilotMetric({
    organizationId: params.organizationId,
    correlationId: params.correlationId,
    copilotType: params.copilotType,
    metricName: "copilot.recommendation.confidence",
    metricValue: params.confidence,
    metricUnit: "ratio",
  });
}
