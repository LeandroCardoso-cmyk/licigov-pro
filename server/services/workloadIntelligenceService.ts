/**
 * Sprint 3.5 — Workload Intelligence Service.
 *
 * Monitora carga operacional real: revisores sobrecarregados, aprovações
 * paradas, congestionamento de workflow, throughput operacional e alertas
 * de degradação.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkloadAlertType =
  | "reviewer_overload"
  | "stalled_approval"
  | "workflow_congestion"
  | "review_backlog"
  | "bottleneck_department"
  | "idle_queue"
  | "approval_latency"
  | "throughput_drop";

export interface ReviewerWorkload {
  userId:          number;
  organizationId:  number;
  department:      string;
  pendingReviews:  number;
  pendingApprovals: number;
  avgLatencyMs:    number;
  oldestItemAge:   number; // hours
  isOverloaded:    boolean;
  score:           number; // 0-100 (lower = more overloaded)
}

export interface WorkloadAlert {
  id:             string;
  organizationId: number;
  type:           WorkloadAlertType;
  severity:       "info" | "warning" | "critical";
  description:    string;
  affectedUsers:  number[];
  department?:    string;
  detectedAt:     string;
}

export interface QueueHealthMetric {
  queueName:       string;
  organizationId:  number;
  depth:           number;
  oldestItemAgeMs: number;
  avgProcessingMs: number;
  status:          "healthy" | "degraded" | "stalled";
  measuredAt:      string;
}

export interface WorkloadSnapshot {
  organizationId:       number;
  period:               { start: string; end: string };
  reviewerWorkloads:    ReviewerWorkload[];
  alerts:               WorkloadAlert[];
  queueHealth:          QueueHealthMetric[];
  avgApprovalLatencyMs: number;
  totalPending:         number;
  throughputPerHour:    number;
  productivityScore:    number; // 0-100
  computedAt:           string;
}

export interface ThroughputTrend {
  period:      string;
  processed:   number;
  avgLatencyMs: number;
  backlog:     number;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _snapshots: WorkloadSnapshot[] = [];
const _alerts:    WorkloadAlert[]    = [];
let   _counter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
}

// ─── Workload scoring ─────────────────────────────────────────────────────────

const OVERLOAD_THRESHOLD_REVIEWS  = 20;
const OVERLOAD_THRESHOLD_AGE_HOURS = 48;

export function computeReviewerWorkload(params: {
  userId:           number;
  organizationId:   number;
  department:       string;
  pendingReviews:   number;
  pendingApprovals: number;
  avgLatencyMs:     number;
  oldestItemAgeHours: number;
}): ReviewerWorkload {
  const total = params.pendingReviews + params.pendingApprovals;
  const isOverloaded =
    total >= OVERLOAD_THRESHOLD_REVIEWS ||
    params.oldestItemAgeHours >= OVERLOAD_THRESHOLD_AGE_HOURS;

  // Score: 100 = no load, 0 = critical overload
  const loadFactor = Math.min(1, total / (OVERLOAD_THRESHOLD_REVIEWS * 2));
  const ageFactor  = Math.min(1, params.oldestItemAgeHours / (OVERLOAD_THRESHOLD_AGE_HOURS * 2));
  const score      = Math.round(100 * (1 - (loadFactor * 0.6 + ageFactor * 0.4)));

  return {
    userId:           params.userId,
    organizationId:   params.organizationId,
    department:       params.department,
    pendingReviews:   params.pendingReviews,
    pendingApprovals: params.pendingApprovals,
    avgLatencyMs:     params.avgLatencyMs,
    oldestItemAge:    params.oldestItemAgeHours,
    isOverloaded,
    score,
  };
}

// ─── Alert detection ──────────────────────────────────────────────────────────

export function detectWorkloadAlerts(
  organizationId: number,
  workloads:      ReviewerWorkload[],
): WorkloadAlert[] {
  const now    = new Date().toISOString();
  const alerts: WorkloadAlert[] = [];

  const overloaded = workloads.filter(w => w.isOverloaded);
  if (overloaded.length > 0) {
    const alert: WorkloadAlert = {
      id:             genId("walt"),
      organizationId,
      type:           "reviewer_overload",
      severity:       overloaded.length >= 3 ? "critical" : "warning",
      description:    `${overloaded.length} revisor(es) sobrecarregado(s).`,
      affectedUsers:  overloaded.map(w => w.userId),
      detectedAt:     now,
    };
    alerts.push(alert);
    _alerts.push(alert);
  }

  const stalled = workloads.filter(w => w.oldestItemAge >= OVERLOAD_THRESHOLD_AGE_HOURS * 2);
  if (stalled.length > 0) {
    const alert: WorkloadAlert = {
      id:             genId("walt"),
      organizationId,
      type:           "stalled_approval",
      severity:       "critical",
      description:    `${stalled.length} aprovação(ões) parada(s) há mais de ${OVERLOAD_THRESHOLD_AGE_HOURS * 2}h.`,
      affectedUsers:  stalled.map(w => w.userId),
      detectedAt:     now,
    };
    alerts.push(alert);
    _alerts.push(alert);
  }

  // Department bottleneck
  const deptGroups: Record<string, ReviewerWorkload[]> = {};
  for (const w of workloads) {
    if (!deptGroups[w.department]) deptGroups[w.department] = [];
    deptGroups[w.department].push(w);
  }
  for (const [dept, deptWorkloads] of Object.entries(deptGroups)) {
    const total = deptWorkloads.reduce((s, w) => s + w.pendingReviews + w.pendingApprovals, 0);
    if (total >= OVERLOAD_THRESHOLD_REVIEWS * deptWorkloads.length) {
      const alert: WorkloadAlert = {
        id:             genId("walt"),
        organizationId,
        type:           "bottleneck_department",
        severity:       "warning",
        description:    `Departamento "${dept}" com congestionamento (${total} itens pendentes).`,
        affectedUsers:  deptWorkloads.map(w => w.userId),
        department:     dept,
        detectedAt:     now,
      };
      alerts.push(alert);
      _alerts.push(alert);
    }
  }

  return alerts;
}

// ─── Queue health ─────────────────────────────────────────────────────────────

export function measureQueueHealth(params: {
  queueName:         string;
  organizationId:    number;
  depth:             number;
  oldestItemAgeMs:   number;
  avgProcessingMs:   number;
}): QueueHealthMetric {
  const now = new Date().toISOString();
  const stalledThresholdMs = 86_400_000; // 24h

  let status: QueueHealthMetric["status"] = "healthy";
  if (params.depth > 100 || params.oldestItemAgeMs > stalledThresholdMs * 2) status = "stalled";
  else if (params.depth > 50 || params.oldestItemAgeMs > stalledThresholdMs) status = "degraded";

  return {
    queueName:       params.queueName,
    organizationId:  params.organizationId,
    depth:           params.depth,
    oldestItemAgeMs: params.oldestItemAgeMs,
    avgProcessingMs: params.avgProcessingMs,
    status,
    measuredAt:      now,
  };
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function buildWorkloadSnapshot(params: {
  organizationId: number;
  periodStart:    string;
  periodEnd:      string;
  workloads:      ReviewerWorkload[];
  queueHealth:    QueueHealthMetric[];
  processed:      number;
  periodHours:    number;
}): WorkloadSnapshot {
  const now    = new Date().toISOString();
  const alerts = detectWorkloadAlerts(params.organizationId, params.workloads);

  const totalPending        = params.workloads.reduce((s, w) => s + w.pendingReviews + w.pendingApprovals, 0);
  const avgLatency          = params.workloads.length > 0
    ? params.workloads.reduce((s, w) => s + w.avgLatencyMs, 0) / params.workloads.length
    : 0;
  const throughputPerHour   = params.periodHours > 0 ? params.processed / params.periodHours : 0;
  const overloadedCount     = params.workloads.filter(w => w.isOverloaded).length;
  const productivityScore   = Math.max(0, Math.round(
    100 - (overloadedCount * 10) - (totalPending > 100 ? 20 : totalPending > 50 ? 10 : 0),
  ));

  const snapshot: WorkloadSnapshot = {
    organizationId:       params.organizationId,
    period:               { start: params.periodStart, end: params.periodEnd },
    reviewerWorkloads:    params.workloads,
    alerts,
    queueHealth:          params.queueHealth,
    avgApprovalLatencyMs: Math.round(avgLatency),
    totalPending,
    throughputPerHour,
    productivityScore,
    computedAt:           now,
  };
  _snapshots.push(snapshot);
  return snapshot;
}

// ─── Productivity scoring ─────────────────────────────────────────────────────

export function computeProductivityScore(workloads: ReviewerWorkload[]): number {
  if (workloads.length === 0) return 100;
  const avg = workloads.reduce((s, w) => s + w.score, 0) / workloads.length;
  return Math.round(avg);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getWorkloadAlerts(organizationId: number): WorkloadAlert[] {
  return _alerts.filter(a => a.organizationId === organizationId);
}

export function getWorkloadSnapshots(organizationId: number): WorkloadSnapshot[] {
  return _snapshots.filter(s => s.organizationId === organizationId);
}

export function analyzeThroughputTrends(snapshots: WorkloadSnapshot[]): ThroughputTrend[] {
  return snapshots.map(s => ({
    period:       s.period.start,
    processed:    Math.round(s.throughputPerHour),
    avgLatencyMs: s.avgApprovalLatencyMs,
    backlog:      s.totalPending,
  }));
}
