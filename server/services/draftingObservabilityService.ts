import { createHash } from "crypto";

export interface DraftingTrace {
  correlationId: string;
  organizationId: number;
  sessionId: string;
  draftId: string;
  documentType: string;
  stageBreakdown: Record<string, number>;  // stage → ms
  totalMs: number;
  completenessScore: number;
  riskScore: number;
  complianceScore: number;
  variableCount: number;
  missingVariables: number;
  recordedAt: string;
}

export interface DraftingMetric {
  name: string;
  value: number;
  unit: "ms" | "count" | "percent" | "ratio";
  tags: Record<string, string>;
  recordedAt: string;
}

const _traces: DraftingTrace[] = [];
const _metrics: DraftingMetric[] = [];

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export function recordDraftingTrace(trace: DraftingTrace): void {
  _traces.push(trace);
  console.info(JSON.stringify({ event: "drafting_trace", ...trace }));
}

export function recordDraftingMetric(metric: DraftingMetric): void {
  _metrics.push(metric);
  console.info(JSON.stringify({ event: "drafting_metric", ...metric }));
}

export function draftLatency(correlationId: string, ms: number, orgId: number): void {
  recordDraftingMetric({ name: "draft_latency", value: ms, unit: "ms", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function draftCompleteness(correlationId: string, score: number, orgId: number): void {
  recordDraftingMetric({ name: "draft_completeness", value: score * 100, unit: "percent", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function validationPassRate(correlationId: string, rate: number, orgId: number): void {
  recordDraftingMetric({ name: "validation_pass_rate", value: rate * 100, unit: "percent", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function riskScoreRecorded(correlationId: string, score: number, orgId: number): void {
  recordDraftingMetric({ name: "risk_score", value: score, unit: "ratio", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function complianceScoreRecorded(correlationId: string, score: number, orgId: number): void {
  recordDraftingMetric({ name: "compliance_score", value: score, unit: "ratio", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function clauseConflictDetected(correlationId: string, count: number, orgId: number): void {
  recordDraftingMetric({ name: "clause_conflicts", value: count, unit: "count", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function jurisprudenceCorrelated(correlationId: string, count: number, orgId: number): void {
  recordDraftingMetric({ name: "jurisprudence_correlated", value: count, unit: "count", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString() });
}

export function getDraftingTraces(organizationId: number): DraftingTrace[] {
  return _traces.filter(t => t.organizationId === organizationId);
}

export function getDraftingMetrics(organizationId: number): DraftingMetric[] {
  return _metrics.filter(m => m.tags.orgId === String(organizationId));
}

export function computeDraftingHealth(organizationId: number, sessionId: string): {
  sessionId: string;
  traceCount: number;
  avgCompleteness: number;
  avgRiskScore: number;
  avgComplianceScore: number;
  healthScore: number;
  status: "healthy" | "degraded" | "critical";
} {
  const traces = _traces.filter(t => t.organizationId === organizationId && t.sessionId === sessionId);
  if (traces.length === 0) {
    return { sessionId, traceCount: 0, avgCompleteness: 1, avgRiskScore: 0, avgComplianceScore: 1, healthScore: 1, status: "healthy" };
  }
  const avgCompleteness = traces.reduce((s, t) => s + t.completenessScore, 0) / traces.length;
  const avgRiskScore = traces.reduce((s, t) => s + t.riskScore, 0) / traces.length;
  const avgComplianceScore = traces.reduce((s, t) => s + t.complianceScore, 0) / traces.length;
  const healthScore = (avgCompleteness * 0.4 + avgComplianceScore * 0.4 + (1 - avgRiskScore) * 0.2);
  const status = healthScore >= 0.7 ? "healthy" : healthScore >= 0.4 ? "degraded" : "critical";
  return { sessionId, traceCount: traces.length, avgCompleteness, avgRiskScore, avgComplianceScore, healthScore, status };
}
