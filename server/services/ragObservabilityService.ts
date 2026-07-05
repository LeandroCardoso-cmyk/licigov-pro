export interface RAGTrace {
  readonly correlationId: string;
  readonly operation: string;
  readonly stages: Record<string, number>;
  readonly totalMs: number;
  readonly chunkCount: number;
  readonly evidenceCount: number;
  readonly confidenceScore: number;
  readonly hallucinationRisk: string;
  readonly organizationId: number;
  readonly recordedAt: string;
}

export interface RAGMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: "ms" | "count" | "percent" | "ratio";
  readonly tags: Record<string, string>;
  readonly organizationId: number;
  readonly recordedAt: string;
}

export function recordRAGTrace(trace: RAGTrace): void {
  console.info(JSON.stringify({ type: "rag_trace", ...trace }));
}

export function recordRAGMetric(metric: RAGMetric): void {
  console.info(JSON.stringify({ type: "rag_metric", ...metric }));
}

export function recordRetrievalLatency(
  correlationId: string,
  ms: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "retrieval_latency",
    value: ms,
    unit: "ms",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordGroundingLatency(
  correlationId: string,
  ms: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "grounding_latency",
    value: ms,
    unit: "ms",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordInferenceLatency(
  correlationId: string,
  ms: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "inference_latency",
    value: ms,
    unit: "ms",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordContextConsumption(
  correlationId: string,
  tokens: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "context_consumption",
    value: tokens,
    unit: "count",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordConfidenceScore(
  correlationId: string,
  score: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "confidence_score",
    value: score,
    unit: "ratio",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordHallucinationAlert(
  correlationId: string,
  risk: string,
  orgId: number,
): void {
  recordRAGMetric({
    name: "hallucination_alert",
    value: risk === "critical" ? 1 : risk === "high" ? 0.75 : risk === "medium" ? 0.5 : 0.25,
    unit: "ratio",
    tags: { correlationId, risk },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordCitationCount(
  correlationId: string,
  count: number,
  orgId: number,
): void {
  recordRAGMetric({
    name: "citation_count",
    value: count,
    unit: "count",
    tags: { correlationId },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}

export function recordValidationResult(
  correlationId: string,
  result: string,
  orgId: number,
): void {
  recordRAGMetric({
    name: "validation_result",
    value: result === "approved" ? 1 : result === "needs_review" ? 0.5 : 0,
    unit: "ratio",
    tags: { correlationId, result },
    organizationId: orgId,
    recordedAt: new Date().toISOString(),
  });
}
