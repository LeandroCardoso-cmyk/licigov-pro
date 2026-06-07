import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextMetricName =
  | "context_tokens"
  | "retrieval_quality"
  | "grounding_quality"
  | "hallucination_risk"
  | "context_drift"
  | "compression_ratio"
  | "ranking_quality"
  | "assembly_latency";

export interface ContextMetric {
  id: string;
  organizationId: number;
  sessionId: string;
  metricName: ContextMetricName;
  value: number;
  unit: "tokens" | "score" | "ratio" | "ms" | "percent";
  tags: Record<string, string>;
  recordedAt: string;
}

export interface ContextHealthSnapshot {
  organizationId: number;
  sessionId: string;
  avgTokenUsage: number;
  avgGroundingQuality: number;
  avgHallucinationRisk: number;
  avgCompressionRatio: number;
  staleContextAlerts: number;
  rankingDegradationAlerts: number;
  contextDriftScore: number;
  period: { from: string; to: string };
  snapshotAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _metricsStore = new Map<number, ContextMetric[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

function createMetric(
  organizationId: number,
  sessionId: string,
  metricName: ContextMetricName,
  value: number,
  unit: ContextMetric["unit"],
  tags: Record<string, string> = {},
): ContextMetric {
  const recordedAt = new Date().toISOString();
  const id = genId(`${organizationId}${sessionId}${metricName}${value}${recordedAt}`);

  const metric: ContextMetric = {
    id,
    organizationId,
    sessionId,
    metricName,
    value,
    unit,
    tags,
    recordedAt,
  };

  const existing = _metricsStore.get(organizationId) ?? [];
  _metricsStore.set(organizationId, [...existing, metric]);

  return metric;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ─── Service functions ────────────────────────────────────────────────────────

export function recordTokenUsage(
  organizationId: number,
  sessionId: string,
  tokens: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "context_tokens", tokens, "tokens");
}

export function recordGroundingQuality(
  organizationId: number,
  sessionId: string,
  quality: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "grounding_quality", quality, "score");
}

export function recordHallucinationRisk(
  organizationId: number,
  sessionId: string,
  risk: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "hallucination_risk", risk, "score");
}

export function recordCompressionRatio(
  organizationId: number,
  sessionId: string,
  ratio: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "compression_ratio", ratio, "ratio");
}

export function recordContextDrift(
  organizationId: number,
  sessionId: string,
  drift: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "context_drift", drift, "score");
}

export function recordAssemblyLatency(
  organizationId: number,
  sessionId: string,
  ms: number,
): ContextMetric {
  return createMetric(organizationId, sessionId, "assembly_latency", ms, "ms");
}

export function computeContextHealth(
  organizationId: number,
  sessionId: string,
  metrics: ContextMetric[],
): ContextHealthSnapshot {
  const sessionMetrics = metrics.filter(
    m => m.organizationId === organizationId && m.sessionId === sessionId,
  );

  const tokenMetrics       = sessionMetrics.filter(m => m.metricName === "context_tokens");
  const groundingMetrics   = sessionMetrics.filter(m => m.metricName === "grounding_quality");
  const hallucinationMetrics = sessionMetrics.filter(m => m.metricName === "hallucination_risk");
  const compressionMetrics = sessionMetrics.filter(m => m.metricName === "compression_ratio");
  const driftMetrics       = sessionMetrics.filter(m => m.metricName === "context_drift");
  const rankingMetrics     = sessionMetrics.filter(m => m.metricName === "ranking_quality");

  const avgTokenUsage         = avg(tokenMetrics.map(m => m.value));
  const avgGroundingQuality   = avg(groundingMetrics.map(m => m.value));
  const avgHallucinationRisk  = avg(hallucinationMetrics.map(m => m.value));
  const avgCompressionRatio   = avg(compressionMetrics.map(m => m.value));

  // staleContextAlerts = count de context_drift > 0.7
  const staleContextAlerts = driftMetrics.filter(m => m.value > 0.7).length;

  // rankingDegradationAlerts = count de ranking_quality < 0.5
  const rankingDegradationAlerts = rankingMetrics.filter(m => m.value < 0.5).length;

  // contextDriftScore = média dos valores context_drift
  const contextDriftScore = avg(driftMetrics.map(m => m.value));

  // Determine period
  const allDates = sessionMetrics.map(m => m.recordedAt).sort();
  const from = allDates[0] ?? new Date().toISOString();
  const to   = allDates[allDates.length - 1] ?? new Date().toISOString();

  return {
    organizationId,
    sessionId,
    avgTokenUsage,
    avgGroundingQuality,
    avgHallucinationRisk,
    avgCompressionRatio,
    staleContextAlerts,
    rankingDegradationAlerts,
    contextDriftScore,
    period: { from, to },
    snapshotAt: new Date().toISOString(),
  };
}

export function getSessionMetrics(
  organizationId: number,
  sessionId: string,
): ContextMetric[] {
  const all = _metricsStore.get(organizationId) ?? [];
  return all.filter(m => m.sessionId === sessionId);
}
