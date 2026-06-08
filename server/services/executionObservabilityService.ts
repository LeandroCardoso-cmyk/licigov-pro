// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExecutionObservabilityTrace {
  correlationId: string;
  executionId: string;
  organizationId: number;
  agentType: string;
  totalStages: number;
  completedStages: number;
  failedStages: number;
  approvalRequired: boolean;
  safetyBlocked: boolean;
  totalMs: number;
  recordedAt: string;
}

export interface ExecutionObservabilityMetric {
  name: string;
  value: number;
  unit: "ms" | "count" | "percent" | "ratio";
  tags: Record<string, string>;
  recordedAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _traces = new Map<number, ExecutionObservabilityTrace[]>();
const _metrics = new Map<number, ExecutionObservabilityMetric[]>();

// ─── Core functions ───────────────────────────────────────────────────────────

export function recordExecutionTrace(trace: ExecutionObservabilityTrace): void {
  console.info(JSON.stringify({ type: "execution_trace", ...trace }));
  const existing = _traces.get(trace.organizationId) ?? [];
  _traces.set(trace.organizationId, [...existing, trace]);
}

export function recordExecutionMetric(metric: ExecutionObservabilityMetric & { organizationId?: number }): void {
  console.info(JSON.stringify({ type: "execution_metric", ...metric }));
  const orgId = metric.organizationId ?? parseInt(metric.tags["orgId"] ?? "0");
  const existing = _metrics.get(orgId) ?? [];
  _metrics.set(orgId, [...existing, metric]);
}

// ─── Helper metric functions ──────────────────────────────────────────────────

export function executionLatency(correlationId: string, ms: number, orgId: number): void {
  recordExecutionMetric({ name: "execution_latency", value: ms, unit: "ms", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

export function approvalLatency(correlationId: string, ms: number, orgId: number): void {
  recordExecutionMetric({ name: "approval_latency", value: ms, unit: "ms", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

export function rollbackFrequency(correlationId: string, count: number, orgId: number): void {
  recordExecutionMetric({ name: "rollback_frequency", value: count, unit: "count", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

export function safetyBlockRate(correlationId: string, rate: number, orgId: number): void {
  recordExecutionMetric({ name: "safety_block_rate", value: rate, unit: "ratio", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

export function hallucinationRiskLevel(correlationId: string, level: number, orgId: number): void {
  recordExecutionMetric({ name: "hallucination_risk_level", value: level, unit: "ratio", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

export function orchestrationDepth(correlationId: string, depth: number, orgId: number): void {
  recordExecutionMetric({ name: "orchestration_depth", value: depth, unit: "count", tags: { correlationId, orgId: String(orgId) }, recordedAt: new Date().toISOString(), organizationId: orgId });
}

// ─── Query functions ──────────────────────────────────────────────────────────

export function getExecutionTraces(orgId: number): ExecutionObservabilityTrace[] {
  return _traces.get(orgId) ?? [];
}

export function getExecutionMetrics(orgId: number): ExecutionObservabilityMetric[] {
  return _metrics.get(orgId) ?? [];
}

export function computeExecutionHealth(orgId: number, _sessionId?: string): {
  healthScore: number;
  status: "healthy" | "degraded" | "critical";
  alerts: string[];
} {
  const traces = getExecutionTraces(orgId);
  const alerts: string[] = [];

  if (traces.length === 0) {
    return { healthScore: 1.0, status: "healthy", alerts: [] };
  }

  const blockedRate = traces.filter(t => t.safetyBlocked).length / traces.length;
  const approvalRate = traces.filter(t => t.approvalRequired).length / traces.length;
  const failRate = traces.filter(t => t.failedStages > 0).length / traces.length;
  const avgMs = traces.reduce((sum, t) => sum + t.totalMs, 0) / traces.length;

  if (blockedRate > 0.3) alerts.push(`Taxa de bloqueio elevada: ${(blockedRate * 100).toFixed(1)}%`);
  if (failRate > 0.2) alerts.push(`Taxa de falha elevada: ${(failRate * 100).toFixed(1)}%`);
  if (avgMs > 5000) alerts.push(`Latência média elevada: ${avgMs.toFixed(0)}ms`);
  if (approvalRate > 0.5) alerts.push(`Alta taxa de aprovação manual: ${(approvalRate * 100).toFixed(1)}%`);

  const healthScore = Math.max(0, 1 - blockedRate * 0.4 - failRate * 0.4 - (avgMs > 5000 ? 0.2 : 0));
  const status = healthScore >= 0.8 ? "healthy" : healthScore >= 0.5 ? "degraded" : "critical";

  return { healthScore: Math.min(1, Math.max(0, healthScore)), status, alerts };
}
