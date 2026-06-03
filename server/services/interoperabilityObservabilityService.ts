/**
 * Sprint 3.3 — Interoperability Observability Service.
 *
 * Structured logging for API usage, webhooks, collaboration events,
 * workflow transitions, and anomaly detection.
 *
 * PRINCIPLES:
 *   - Zero DB — console.info structured JSON only.
 *   - Multi-tenant: organizationId mandatory.
 *   - Fire-and-forget.
 */

import type { WebhookDelivery } from "./webhookService";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntegrationTrace {
  traceId: string;
  service: string;
  operation: string;
  organizationId: number;
  durationMs: number;
  success: boolean;
  recordedAt: string;
}

export interface WebhookMetric {
  eventType: string;
  status: string;
  durationMs: number;
  organizationId: number;
  recordedAt: string;
}

export interface CollaborationMetric {
  eventType: string;
  organizationId: number;
  entityType: string;
  recordedAt: string;
}

export interface ApiUsageMetric {
  endpoint: string;
  method: string;
  organizationId: number;
  durationMs: number;
  status: number;
  recordedAt: string;
}

export interface WorkflowBottleneckMetric {
  stage: string;
  durationMs: number;
  organizationId: number;
  recordedAt: string;
}

// ─── Structured log helper ────────────────────────────────────────────────────

function emit(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      service: "interop_observability",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Record functions ─────────────────────────────────────────────────────────

export function recordApiUsage(
  endpoint: string,
  method: string,
  orgId: number,
  durationMs: number,
  status: number,
): void {
  emit("api_usage", {
    endpoint,
    method,
    organizationId: orgId,
    durationMs,
    status,
  });
}

export function recordWebhookDelivery(
  eventType: string,
  status: string,
  durationMs: number,
  orgId: number,
): void {
  emit("webhook_delivery", {
    eventType,
    status,
    durationMs,
    organizationId: orgId,
  });
}

export function recordCollaborationEvent(
  eventType: string,
  orgId: number,
  entityType: string,
): void {
  emit("collaboration_event", {
    eventType,
    organizationId: orgId,
    entityType,
  });
}

export function recordWorkflowTransition(
  stage: string,
  durationMs: number,
  orgId: number,
): void {
  emit("workflow_transition", {
    stage,
    durationMs,
    organizationId: orgId,
  });
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

export function detectWebhookAnomalies(
  deliveries: WebhookDelivery[],
): { anomalyType: string; severity: string; details: string }[] {
  if (deliveries.length === 0) return [];

  const failed = deliveries.filter(
    (d) => d.status === "failed" || d.status === "dead_letter",
  ).length;
  const total = deliveries.length;
  const failureRate = failed / total;

  const anomalies: { anomalyType: string; severity: string; details: string }[] = [];

  if (failureRate > 0.5) {
    anomalies.push({
      anomalyType: "high_webhook_failure_rate",
      severity: failureRate > 0.8 ? "critical" : "warning",
      details: `${Math.round(failureRate * 100)}% dos webhooks falharam (${failed}/${total})`,
    });
    emit("webhook_anomaly_detected", {
      failureRate,
      failed,
      total,
    });
  }

  return anomalies;
}

export function detectCollaborationSpike(
  events: CollaborationMetric[],
): { anomalyType: string; severity: string; details: string } | null {
  if (events.length <= 100) return null;

  // Simple spike detection: > 100 events in the batch
  const spike = {
    anomalyType: "collaboration_event_spike",
    severity: "warning",
    details: `${events.length} eventos de colaboração detectados (acima de 100/min)`,
  };

  emit("collaboration_spike_detected", {
    eventCount: events.length,
  });

  return spike;
}

// ─── Metrics computation ──────────────────────────────────────────────────────

export function computeApiMetrics(usages: ApiUsageMetric[]): {
  avgDurationMs: number;
  p95: number;
  errorRate: number;
  topEndpoints: string[];
} {
  if (usages.length === 0) {
    return { avgDurationMs: 0, p95: 0, errorRate: 0, topEndpoints: [] };
  }

  const durations = usages.map((u) => u.durationMs).sort((a, b) => a - b);
  const avgDurationMs =
    durations.reduce((s, d) => s + d, 0) / durations.length;
  const p95Index = Math.ceil(durations.length * 0.95) - 1;
  const p95 = durations[Math.max(0, p95Index)];

  const errors = usages.filter((u) => u.status >= 500).length;
  const errorRate = errors / usages.length;

  // Top endpoints by frequency
  const endpointCounts = new Map<string, number>();
  for (const u of usages) {
    endpointCounts.set(u.endpoint, (endpointCounts.get(u.endpoint) ?? 0) + 1);
  }
  const topEndpoints = Array.from(endpointCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ep]) => ep);

  return { avgDurationMs, p95, errorRate, topEndpoints };
}
