/**
 * Sprint 2.95 — Semantic Observability Service.
 *
 * Telemetria estruturada para o motor de matching semântico.
 * Todos os eventos são escritos como JSON em console.info (structured logging).
 * Sem persistência em DB — compatível com qualquer backend de log (CloudWatch, etc).
 *
 * PRINCÍPIO: zero overhead em path crítico — logs são fire-and-forget.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemanticTrace {
  correlationId:    string;
  operation:        string;
  stageBreakdown:   Record<string, number>; // stage → durationMs
  totalMs:          number;
  candidateCount:   number;
  consensusScore:   number;
  requiresReview:   boolean;
  parserType:       string;
  organizationId:   number;
  recordedAt:       string;
}

export interface SemanticMetric {
  name:       string;
  value:      number;
  unit:       "ms" | "count" | "percent" | "ratio";
  tags:       Record<string, string>;
  recordedAt: string;
}

// ─── Structured log helper ────────────────────────────────────────────────────

function emit(event: string, payload: Record<string, unknown>): void {
  console.info(JSON.stringify({
    service:   "semantic_engine",
    event,
    ...payload,
    timestamp: new Date().toISOString(),
  }));
}

// ─── Core functions ───────────────────────────────────────────────────────────

export function recordTrace(trace: SemanticTrace): void {
  emit("semantic_trace", {
    correlationId:  trace.correlationId,
    operation:      trace.operation,
    stageBreakdown: trace.stageBreakdown,
    totalMs:        trace.totalMs,
    candidateCount: trace.candidateCount,
    consensusScore: trace.consensusScore,
    requiresReview: trace.requiresReview,
    parserType:     trace.parserType,
    organizationId: trace.organizationId,
    recordedAt:     trace.recordedAt,
  });
}

export function recordMetric(metric: SemanticMetric): void {
  emit("semantic_metric", {
    name:       metric.name,
    value:      metric.value,
    unit:       metric.unit,
    tags:       metric.tags,
    recordedAt: metric.recordedAt,
  });
}

// ─── Domain-specific event emitters ──────────────────────────────────────────

export function matchingLatency(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  totalMs:        number;
  stageBreakdown: Record<string, number>;
}): void {
  emit("matching_latency", params);
}

export function candidateDivergence(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  candidateCount: number;
  topScore:       number;
  secondScore:    number;
  divergence:     number;
}): void {
  emit("candidate_divergence", params);
}

export function consensusInstability(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  consensusScore: number;
  tiebreakApplied: boolean;
  candidateCount: number;
}): void {
  emit("consensus_instability", params);
}

export function reviewOverride(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  operation:      string;
  actor:          string;
  justification:  string;
}): void {
  emit("review_override", params);
}

export function confidenceDegradation(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  score:          number;
  level:          string;
  reason:         string;
}): void {
  emit("confidence_degradation", params);
}

export function driftAlert(params: {
  organizationId: number;
  alertType:      string;
  severity:       string;
  description:    string;
  affectedItems:  number;
  detectedAt:     string;
}): void {
  emit("drift_alert", params);
}

export function rankingAnomaly(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  expectedRank:   number;
  actualRank:     number;
  score:          number;
  reason:         string;
}): void {
  emit("ranking_anomaly", params);
}

// ─── Sprint 3.0 — ItemTR / Catalog / Clause observability ─────────────────────

export function matchingLatencyV2(params: {
  correlationId:  string;
  organizationId: number;
  stagingItemId:  string;
  totalMs:        number;
  stageBreakdown: Record<string, number>;
  candidateCount: number;
}): void {
  emit("matching_latency_v2", params);
}

export function catalogLatency(params: {
  correlationId:  string;
  organizationId: number;
  catalogType:    string;
  operation:      string;
  totalMs:        number;
  entryCount:     number;
}): void {
  emit("catalog_latency", params);
}

export function clauseGenerationLatency(params: {
  correlationId:    string;
  organizationId:   number;
  itemCount:        number;
  clauseCount:      number;
  totalMs:          number;
}): void {
  emit("clause_generation_latency", params);
}

export function candidateInstability(params: {
  correlationId:  string;
  organizationId: number;
  replayKey:      string;
  expectedSignature: string;
  actualSignature: string;
}): void {
  emit("candidate_instability", params);
}

export function overrideFrequency(params: {
  organizationId: number;
  windowLabel:    string;
  overrideCount:  number;
  totalItems:     number;
  rate:           number;
}): void {
  emit("override_frequency", params);
}

export function semanticAnomaly(params: {
  correlationId:  string;
  organizationId: number;
  itemId:         string;
  anomalyType:    string;
  description:    string;
}): void {
  emit("semantic_anomaly", params);
}

export function compositionAnomaly(params: {
  correlationId:  string;
  organizationId: number;
  replayKey:      string;
  anomalyType:    string;
  description:    string;
}): void {
  emit("composition_anomaly", params);
}

export function catalogSyncAnomaly(params: {
  organizationId: number;
  catalogType:    string;
  expectedChecksum: string;
  actualChecksum: string;
  description:    string;
}): void {
  emit("catalog_sync_anomaly", params);
}
