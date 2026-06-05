export type StabilityMetricType =
  | "workflow_throughput"
  | "queue_depth"
  | "review_latency"
  | "approval_rate"
  | "error_rate"
  | "deployment_health"
  | "tenant_load";

export type DegradationLevel = "none" | "mild" | "moderate" | "severe" | "critical";
export type StabilityTrend   = "improving" | "stable" | "degrading";
export type AnomalySeverity  = "info" | "warning" | "critical";

export interface StabilityMetric {
  id:             string;
  organizationId: number;
  metricType:     StabilityMetricType;
  value:          number;
  unit:           "ms" | "count" | "percent" | "ratio";
  threshold:      number;
  isAnomalous:    boolean;
  recordedAt:     string;
}

export interface StabilityAnomaly {
  id:             string;
  organizationId: number;
  metricType:     StabilityMetricType;
  description:    string;
  severity:       AnomalySeverity;
  detectedAt:     string;
  resolvedAt:     string | null;
}

export interface StabilitySnapshot {
  id:               string;
  organizationId:   number;
  overallScore:     number;   // 0-100
  degradationLevel: DegradationLevel;
  metrics:          StabilityMetric[];
  activeAnomalies:  StabilityAnomaly[];
  trend:            StabilityTrend;
  snapshotAt:       string;
}

// Thresholds por tipo
const THRESHOLDS: Record<StabilityMetricType, number> = {
  workflow_throughput: 50,   // min items/hour
  queue_depth:        100,   // max items
  review_latency:    3600000, // max ms (1h)
  approval_rate:      0.80,  // min ratio
  error_rate:         0.05,  // max ratio
  deployment_health:  70,    // min score
  tenant_load:        80,    // max percent
};

// Weights para score (penalty)
const PENALTY_WEIGHTS: Partial<Record<StabilityMetricType, number>> = {
  error_rate:         30,
  queue_depth:        20,
  review_latency:     20,
  approval_rate:      15,
  deployment_health:  15,
};

let _metricCounter = 0;
let _anomalyCounter = 0;
let _snapshotCounter = 0;
const _metrics:   StabilityMetric[]   = [];
const _anomalies: StabilityAnomaly[]  = [];
const _snapshots: StabilitySnapshot[] = [];

export function recordMetric(
  organizationId: number,
  metricType:     StabilityMetricType,
  value:          number,
  unit:           StabilityMetric["unit"],
): StabilityMetric {
  const threshold   = THRESHOLDS[metricType];
  const isAnomalous = isMetricAnomalous(metricType, value, threshold);
  const metric: StabilityMetric = {
    id:             `stab_m_${++_metricCounter}`,
    organizationId,
    metricType,
    value,
    unit,
    threshold,
    isAnomalous,
    recordedAt:     new Date().toISOString(),
  };
  _metrics.push(metric);
  return { ...metric };
}

function isMetricAnomalous(type: StabilityMetricType, value: number, threshold: number): boolean {
  // For min-thresholds (throughput, approval_rate, deployment_health), anomalous if BELOW
  if (type === "workflow_throughput" || type === "approval_rate" || type === "deployment_health") {
    return value < threshold;
  }
  // For max-thresholds, anomalous if ABOVE
  return value > threshold;
}

export function computeStabilityScore(metrics: StabilityMetric[]): number {
  if (metrics.length === 0) return 100;
  let penalty = 0;
  for (const [type, weight] of Object.entries(PENALTY_WEIGHTS)) {
    const typeMetrics = metrics.filter(m => m.metricType === (type as StabilityMetricType));
    if (typeMetrics.length === 0) continue;
    const latest = typeMetrics[typeMetrics.length - 1];
    if (latest.isAnomalous) {
      const threshold = THRESHOLDS[latest.metricType];
      const deviation = threshold > 0 ? Math.abs(latest.value - threshold) / threshold : 0;
      penalty += Math.min(weight, weight * Math.min(deviation, 1));
    }
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function detectAnomalies(
  metrics:  StabilityMetric[],
  baseline: StabilityMetric[],
): StabilityAnomaly[] {
  const anomalies: StabilityAnomaly[] = [];
  const now = new Date().toISOString();

  for (const metric of metrics) {
    if (!metric.isAnomalous) continue;
    const baselineEntry = baseline.find(b => b.metricType === metric.metricType);
    const severity: AnomalySeverity =
      baselineEntry && Math.abs(metric.value - baselineEntry.value) / (baselineEntry.value || 1) > 0.5
        ? "critical"
        : "warning";
    anomalies.push({
      id:             `stab_a_${++_anomalyCounter}`,
      organizationId: metric.organizationId,
      metricType:     metric.metricType,
      description:    `${metric.metricType} value ${metric.value} exceeds threshold ${metric.threshold}`,
      severity,
      detectedAt:     now,
      resolvedAt:     null,
    });
  }
  return anomalies;
}

function scoreToDegradation(score: number): DegradationLevel {
  if (score >= 85) return "none";
  if (score >= 70) return "mild";
  if (score >= 50) return "moderate";
  if (score >= 30) return "severe";
  return "critical";
}

export function buildStabilitySnapshot(
  organizationId: number,
  metrics:        StabilityMetric[],
  baseline:       StabilityMetric[],
  previousSnapshots: StabilitySnapshot[] = [],
): StabilitySnapshot {
  const score     = computeStabilityScore(metrics);
  const anomalies = detectAnomalies(metrics, baseline);
  const trend     = analyzeTrend([...previousSnapshots, { overallScore: score } as StabilitySnapshot]);
  const snapshot: StabilitySnapshot = {
    id:               `stab_s_${++_snapshotCounter}`,
    organizationId,
    overallScore:     score,
    degradationLevel: scoreToDegradation(score),
    metrics:          [...metrics],
    activeAnomalies:  anomalies,
    trend,
    snapshotAt:       new Date().toISOString(),
  };
  _snapshots.push(snapshot);
  return { ...snapshot };
}

export function analyzeTrend(snapshots: Pick<StabilitySnapshot, "overallScore">[]): StabilityTrend {
  if (snapshots.length < 2) return "stable";
  const last  = snapshots[snapshots.length - 1].overallScore;
  const prev  = snapshots[snapshots.length - 2].overallScore;
  const delta = last - prev;
  if (delta > 5)  return "improving";
  if (delta < -5) return "degrading";
  return "stable";
}

export function isStable(snapshot: StabilitySnapshot): boolean {
  return snapshot.overallScore >= 70 &&
    snapshot.degradationLevel !== "critical" &&
    snapshot.degradationLevel !== "severe";
}

export function getActiveAnomalies(organizationId: number): StabilityAnomaly[] {
  return _anomalies.filter(a => a.organizationId === organizationId && a.resolvedAt === null);
}
