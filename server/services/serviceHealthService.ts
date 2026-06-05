export type SlaStatus       = "meeting" | "warning" | "breaching";
export type TrendDirection  = "up" | "down" | "stable";

export interface SLATarget {
  metricName:      string;
  targetValue:     number;
  unit:            string;
  breachThreshold: number; // percentage above/below target (e.g. 1.5 = 150%)
  severity:        "warning" | "critical";
}

export const SLA_TARGETS: Record<string, SLATarget> = {
  response_latency_ms:           { metricName: "response_latency_ms",          targetValue: 2000,  unit: "ms",    breachThreshold: 1.5,  severity: "critical" },
  workflow_throughput_per_hour:  { metricName: "workflow_throughput_per_hour",  targetValue: 50,    unit: "count", breachThreshold: 0.5,  severity: "warning"  },
  review_completion_hours:       { metricName: "review_completion_hours",       targetValue: 24,    unit: "hours", breachThreshold: 2.0,  severity: "critical" },
  approval_throughput_per_day:   { metricName: "approval_throughput_per_day",   targetValue: 20,    unit: "count", breachThreshold: 0.5,  severity: "warning"  },
  export_latency_ms:             { metricName: "export_latency_ms",             targetValue: 5000,  unit: "ms",    breachThreshold: 2.0,  severity: "warning"  },
  queue_depth:                   { metricName: "queue_depth",                   targetValue: 100,   unit: "count", breachThreshold: 2.0,  severity: "critical" },
};

export interface HealthMetric {
  name:            string;
  currentValue:    number;
  targetValue:     number;
  unit:            string;
  slaStatus:       SlaStatus;
  trendDirection:  TrendDirection;
  lastRecordedAt:  string;
}

export interface ServiceHealthSnapshot {
  id:               string;
  organizationId:   number;
  overallSlaScore:  number;   // 0-100
  healthMetrics:    HealthMetric[];
  breachingMetrics: string[];
  warningMetrics:   string[];
  snapshotAt:       string;
}

const _history: ServiceHealthSnapshot[] = [];
let _snapshotCounter = 0;

function isMaxMetric(metricName: string): boolean {
  // Metrics where lower is better (max thresholds)
  return ["response_latency_ms", "review_completion_hours", "export_latency_ms", "queue_depth"].includes(metricName);
}

export function assessMetricHealth(name: string, value: number): HealthMetric {
  const target = SLA_TARGETS[name];
  if (!target) {
    return {
      name, currentValue: value, targetValue: 0,
      unit: "unknown", slaStatus: "meeting", trendDirection: "stable",
      lastRecordedAt: new Date().toISOString(),
    };
  }
  const maxMetric = isMaxMetric(name);
  let slaStatus: SlaStatus;
  if (maxMetric) {
    const breachValue = target.targetValue * target.breachThreshold;
    if (value > breachValue)                            slaStatus = "breaching";
    else if (value > target.targetValue * 1.2)          slaStatus = "warning";
    else                                                 slaStatus = "meeting";
  } else {
    // min metric: lower value is worse
    const breachValue = target.targetValue * target.breachThreshold;
    if (value < breachValue)                            slaStatus = "breaching";
    else if (value < target.targetValue * 0.8)          slaStatus = "warning";
    else                                                 slaStatus = "meeting";
  }
  return {
    name,
    currentValue:   value,
    targetValue:    target.targetValue,
    unit:           target.unit,
    slaStatus,
    trendDirection: "stable",
    lastRecordedAt: new Date().toISOString(),
  };
}

export function computeSlaScore(metrics: HealthMetric[]): number {
  if (metrics.length === 0) return 100;
  const breachingCount = metrics.filter(m => m.slaStatus === "breaching").length;
  const warningCount   = metrics.filter(m => m.slaStatus === "warning").length;
  const penalty = (breachingCount * 20) + (warningCount * 8);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function buildHealthSnapshot(
  organizationId: number,
  metricsInput:   Record<string, number>,
): ServiceHealthSnapshot {
  const healthMetrics = Object.entries(metricsInput).map(([name, value]) => assessMetricHealth(name, value));
  const overallSlaScore  = computeSlaScore(healthMetrics);
  const breachingMetrics = healthMetrics.filter(m => m.slaStatus === "breaching").map(m => m.name);
  const warningMetrics   = healthMetrics.filter(m => m.slaStatus === "warning").map(m => m.name);
  const snapshot: ServiceHealthSnapshot = {
    id:               `shs_${++_snapshotCounter}`,
    organizationId,
    overallSlaScore,
    healthMetrics,
    breachingMetrics,
    warningMetrics,
    snapshotAt:       new Date().toISOString(),
  };
  _history.push(snapshot);
  return { ...snapshot };
}

export function detectSlaBreaches(snapshot: ServiceHealthSnapshot): HealthMetric[] {
  return snapshot.healthMetrics.filter(m => m.slaStatus === "breaching");
}

export function analyzeSlatrend(snapshots: ServiceHealthSnapshot[]): { trend: TrendDirection; avgScore: number } {
  if (snapshots.length === 0) return { trend: "stable", avgScore: 100 };
  const scores  = snapshots.map(s => s.overallSlaScore);
  const avgScore = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const last  = scores[scores.length - 1];
  const prev  = scores.length > 1 ? scores[scores.length - 2] : last;
  const trend: TrendDirection = last > prev + 3 ? "up" : last < prev - 3 ? "down" : "stable";
  return { trend, avgScore };
}

export function isWithinSla(metricName: string, value: number): boolean {
  const h = assessMetricHealth(metricName, value);
  return h.slaStatus === "meeting";
}

export function getHealthHistory(organizationId: number): ServiceHealthSnapshot[] {
  return _history.filter(s => s.organizationId === organizationId);
}
