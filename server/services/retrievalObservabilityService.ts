import { createHash } from "crypto";

export interface RetrievalMetric {
  id: string;
  organizationId: number;
  metricName: string;
  value: number;
  unit: "ms" | "count" | "ratio" | "percent" | "score";
  tags: Record<string, string>;
  sessionId?: string;
  immutable: boolean;
  recordedAt: string;
}

export interface RetrievalHealthSnapshot {
  organizationId: number;
  period: { from: string; to: string };
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgRankingQuality: number;
  avgChunkEfficiency: number;
  semanticRecallRate: number;
  avgEvidenceQuality: number;
  queryComplexityDistribution: Record<"simple" | "medium" | "complex", number>;
  degradationAlerts: string[];
  snapshotAt: string;
}

export interface RetrievalObservabilityReport {
  organizationId: number;
  sessionId: string;
  metrics: RetrievalMetric[];
  health: RetrievalHealthSnapshot;
  forensicHash: string;
  reportedAt: string;
}

const _metrics = new Map<number, RetrievalMetric[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function createMetric(params: {
  organizationId: number;
  sessionId: string;
  metricName: string;
  value: number;
  unit: RetrievalMetric["unit"];
  tags?: Record<string, string>;
}): RetrievalMetric {
  const now = new Date().toISOString();
  const id = sha20(
    `${params.organizationId}${params.sessionId}${params.metricName}${params.value}${now}`
  );
  const metric: RetrievalMetric = {
    id,
    organizationId: params.organizationId,
    metricName: params.metricName,
    value: params.value,
    unit: params.unit,
    tags: params.tags ?? {},
    sessionId: params.sessionId,
    immutable: true,
    recordedAt: now,
  };
  const store = _metrics.get(params.organizationId) ?? [];
  store.push(metric);
  _metrics.set(params.organizationId, store);
  return metric;
}

export function recordLatency(
  organizationId: number,
  sessionId: string,
  durationMs: number
): RetrievalMetric {
  return createMetric({
    organizationId,
    sessionId,
    metricName: "retrieval_latency",
    value: durationMs,
    unit: "ms",
    tags: { session: sessionId },
  });
}

export function recordRankingQuality(
  organizationId: number,
  sessionId: string,
  quality: number
): RetrievalMetric {
  return createMetric({
    organizationId,
    sessionId,
    metricName: "ranking_quality",
    value: Math.min(1, Math.max(0, quality)),
    unit: "score",
    tags: { session: sessionId },
  });
}

export function recordChunkEfficiency(
  organizationId: number,
  sessionId: string,
  usedTokens: number,
  totalTokens: number
): RetrievalMetric {
  const ratio = totalTokens === 0 ? 0 : usedTokens / totalTokens;
  return createMetric({
    organizationId,
    sessionId,
    metricName: "chunk_efficiency",
    value: Math.min(1, Math.max(0, ratio)),
    unit: "ratio",
    tags: { session: sessionId, usedTokens: String(usedTokens), totalTokens: String(totalTokens) },
  });
}

export function recordSemanticRecall(
  organizationId: number,
  sessionId: string,
  score: number
): RetrievalMetric {
  return createMetric({
    organizationId,
    sessionId,
    metricName: "semantic_recall",
    value: Math.min(1, Math.max(0, score)),
    unit: "score",
    tags: { session: sessionId },
  });
}

export function recordEvidenceQuality(
  organizationId: number,
  sessionId: string,
  quality: number
): RetrievalMetric {
  return createMetric({
    organizationId,
    sessionId,
    metricName: "evidence_quality",
    value: Math.min(1, Math.max(0, quality)),
    unit: "score",
    tags: { session: sessionId },
  });
}

export function recordQueryComplexity(
  organizationId: number,
  sessionId: string,
  complexity: "simple" | "medium" | "complex"
): RetrievalMetric {
  const value = complexity === "simple" ? 1 : complexity === "medium" ? 2 : 3;
  return createMetric({
    organizationId,
    sessionId,
    metricName: "query_complexity",
    value,
    unit: "count",
    tags: { session: sessionId, complexity },
  });
}

function computeAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeP95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  if (sorted.length < 20) return sorted[sorted.length - 1];
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx];
}

export function computeHealthSnapshot(
  organizationId: number,
  metrics: RetrievalMetric[],
  period: { from: string; to: string }
): RetrievalHealthSnapshot {
  const now = new Date().toISOString();

  const latencies = metrics
    .filter((m) => m.metricName === "retrieval_latency")
    .map((m) => m.value)
    .sort((a, b) => a - b);

  const rankingQualities = metrics
    .filter((m) => m.metricName === "ranking_quality")
    .map((m) => m.value);

  const chunkEfficiencies = metrics
    .filter((m) => m.metricName === "chunk_efficiency")
    .map((m) => m.value);

  const semanticRecalls = metrics
    .filter((m) => m.metricName === "semantic_recall")
    .map((m) => m.value);

  const evidenceQualities = metrics
    .filter((m) => m.metricName === "evidence_quality")
    .map((m) => m.value);

  const complexityMetrics = metrics.filter((m) => m.metricName === "query_complexity");
  const complexityDistribution: Record<"simple" | "medium" | "complex", number> = {
    simple: 0,
    medium: 0,
    complex: 0,
  };
  for (const m of complexityMetrics) {
    const c = m.tags["complexity"] as "simple" | "medium" | "complex" | undefined;
    if (c && c in complexityDistribution) {
      complexityDistribution[c] += 1;
    }
  }

  const avgLatencyMs = computeAvg(latencies);
  const p95LatencyMs = computeP95(latencies);
  const avgRankingQuality = computeAvg(rankingQualities);
  const avgChunkEfficiency = computeAvg(chunkEfficiencies);
  const semanticRecallRate =
    semanticRecalls.length === 0
      ? 0
      : semanticRecalls.filter((s) => s > 0.7).length / semanticRecalls.length;
  const avgEvidenceQuality = computeAvg(evidenceQualities);

  const degradationAlerts: string[] = [];
  if (avgLatencyMs > 2000) degradationAlerts.push("High retrieval latency");
  if (semanticRecallRate < 0.5) degradationAlerts.push("Low semantic recall");

  return {
    organizationId,
    period,
    avgLatencyMs,
    p95LatencyMs,
    avgRankingQuality,
    avgChunkEfficiency,
    semanticRecallRate,
    avgEvidenceQuality,
    queryComplexityDistribution: complexityDistribution,
    degradationAlerts,
    snapshotAt: now,
  };
}

export function generateReport(
  organizationId: number,
  sessionId: string
): RetrievalObservabilityReport {
  const now = new Date().toISOString();
  const allMetrics = _metrics.get(organizationId) ?? [];
  const sessionMetrics = allMetrics.filter((m) => m.sessionId === sessionId);

  const period = {
    from:
      sessionMetrics.length > 0
        ? sessionMetrics.reduce((min, m) => (m.recordedAt < min ? m.recordedAt : min), sessionMetrics[0].recordedAt)
        : now,
    to: now,
  };

  const health = computeHealthSnapshot(organizationId, sessionMetrics, period);
  const forensicHash = sha20(
    sessionMetrics
      .map((m) => m.id)
      .sort()
      .join("")
  );

  return {
    organizationId,
    sessionId,
    metrics: sessionMetrics,
    health,
    forensicHash,
    reportedAt: now,
  };
}
