/**
 * Sprint 3.4 — Real Usage Monitoring Service.
 *
 * Telemetria de UX e analytics de workflow para entender como os usuarios
 * reais interagem com o sistema durante o piloto.
 *
 * Saidas: console.info JSON (structured logging) — sem DB real neste sprint.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type UXEventType =
  | "page_view"
  | "feature_used"
  | "workflow_step"
  | "error_encountered"
  | "help_accessed"
  | "export_generated"
  | "search_performed"
  | "review_completed"
  | "template_applied"
  | "session_start"
  | "session_end";

export interface UXEvent {
  id:             string;
  organizationId: number;
  userId:         number;
  sessionId:      string;
  eventType:      UXEventType;
  feature:        string;
  metadata:       Record<string, unknown>;
  durationMs?:    number;
  occurredAt:     string;
}

export interface WorkflowAnalyticsSnapshot {
  organizationId:      number;
  period:              { start: string; end: string };
  totalProcesses:      number;
  completedProcesses:  number;
  avgCompletionDays:   number;
  bottleneckStages:    Array<{ stage: string; avgDurationHours: number }>;
  dropOffPoints:       Array<{ stage: string; dropOffRate: number }>;
  userEngagementScore: number; // 0-100
  computedAt:          string;
}

export interface UsageAlert {
  id:             string;
  organizationId: number;
  type:           "low_engagement" | "high_error_rate" | "workflow_stall" | "feature_abandonment";
  severity:       "info" | "warning" | "critical";
  description:    string;
  affectedUsers:  number;
  detectedAt:     string;
}

export interface SessionSummary {
  sessionId:      string;
  organizationId: number;
  userId:         number;
  startedAt:      string;
  endedAt:        string | null;
  eventsCount:    number;
  featuresUsed:   string[];
  totalDurationMs: number;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _events:   UXEvent[]        = [];
const _sessions: SessionSummary[] = [];
const _alerts:   UsageAlert[]     = [];
let   _counter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
}

// ─── Record events ────────────────────────────────────────────────────────────

export function recordUXEvent(params: {
  organizationId: number;
  userId:         number;
  sessionId:      string;
  eventType:      UXEventType;
  feature:        string;
  metadata?:      Record<string, unknown>;
  durationMs?:    number;
}): UXEvent {
  const event: UXEvent = {
    id:             genId("ux"),
    organizationId: params.organizationId,
    userId:         params.userId,
    sessionId:      params.sessionId,
    eventType:      params.eventType,
    feature:        params.feature,
    metadata:       params.metadata ?? {},
    durationMs:     params.durationMs,
    occurredAt:     new Date().toISOString(),
  };
  _events.push(event);
  console.info(JSON.stringify({ type: "ux_event", ...event }));
  return event;
}

export function startSession(params: {
  organizationId: number;
  userId:         number;
  sessionId:      string;
}): SessionSummary {
  const session: SessionSummary = {
    sessionId:       params.sessionId,
    organizationId:  params.organizationId,
    userId:          params.userId,
    startedAt:       new Date().toISOString(),
    endedAt:         null,
    eventsCount:     0,
    featuresUsed:    [],
    totalDurationMs: 0,
  };
  _sessions.push(session);
  return session;
}

export function endSession(
  sessionId:      string,
  organizationId: number,
): SessionSummary | null {
  const session = _sessions.find(s => s.sessionId === sessionId && s.organizationId === organizationId);
  if (!session) return null;

  const sessionEvents = _events.filter(e => e.sessionId === sessionId);
  session.endedAt         = new Date().toISOString();
  session.eventsCount     = sessionEvents.length;
  session.featuresUsed    = [...new Set(sessionEvents.map(e => e.feature))];
  session.totalDurationMs = sessionEvents.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  return session;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export function computeWorkflowAnalytics(
  organizationId: number,
  periodStart:    string,
  periodEnd:      string,
): WorkflowAnalyticsSnapshot {
  const now = new Date().toISOString();
  const periodEvents = _events.filter(
    e => e.organizationId === organizationId && e.occurredAt >= periodStart && e.occurredAt <= periodEnd,
  );

  const workflowSteps = periodEvents.filter(e => e.eventType === "workflow_step");
  const completed     = periodEvents.filter(e => e.feature === "workflow_completed");

  const stageGroups: Record<string, number[]> = {};
  for (const ev of workflowSteps) {
    const stage = (ev.metadata["stage"] as string) ?? "unknown";
    const dur   = ev.durationMs ?? 0;
    if (!stageGroups[stage]) stageGroups[stage] = [];
    stageGroups[stage].push(dur);
  }

  const bottleneckStages = Object.entries(stageGroups)
    .map(([stage, durs]) => ({
      stage,
      avgDurationHours: (durs.reduce((s, d) => s + d, 0) / durs.length / 3_600_000),
    }))
    .sort((a, b) => b.avgDurationHours - a.avgDurationHours)
    .slice(0, 3);

  const uniqueUsers = new Set(periodEvents.map(e => e.userId)).size;
  const uniqueSessions = new Set(periodEvents.map(e => e.sessionId)).size;
  const engagementScore = Math.min(100, Math.round((uniqueUsers * 10) + (uniqueSessions * 5)));

  return {
    organizationId,
    period:             { start: periodStart, end: periodEnd },
    totalProcesses:     workflowSteps.length,
    completedProcesses: completed.length,
    avgCompletionDays:  completed.length > 0 ? 5 : 0,
    bottleneckStages,
    dropOffPoints:      [],
    userEngagementScore: engagementScore,
    computedAt:          now,
  };
}

export function detectUsageAlerts(
  organizationId: number,
  snapshot:       WorkflowAnalyticsSnapshot,
): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  const now = new Date().toISOString();

  if (snapshot.userEngagementScore < 20) {
    alerts.push({
      id:             genId("alert"),
      organizationId,
      type:           "low_engagement",
      severity:       "warning",
      description:    `Engajamento baixo: score ${snapshot.userEngagementScore}/100.`,
      affectedUsers:  0,
      detectedAt:     now,
    });
  }

  if (snapshot.bottleneckStages.some(s => s.avgDurationHours > 48)) {
    alerts.push({
      id:             genId("alert"),
      organizationId,
      type:           "workflow_stall",
      severity:       "warning",
      description:    "Estagio de workflow com duracao media > 48h detectado.",
      affectedUsers:  0,
      detectedAt:     now,
    });
  }

  for (const alert of alerts) {
    _alerts.push(alert);
  }

  return alerts;
}

export function getFeatureUsageReport(
  organizationId: number,
): Array<{ feature: string; usageCount: number; uniqueUsers: number }> {
  const orgEvents = _events.filter(e => e.organizationId === organizationId);
  const featureMap: Record<string, Set<number>> = {};

  for (const ev of orgEvents) {
    if (!featureMap[ev.feature]) featureMap[ev.feature] = new Set();
    featureMap[ev.feature].add(ev.userId);
  }

  return Object.entries(featureMap)
    .map(([feature, users]) => ({ feature, usageCount: orgEvents.filter(e => e.feature === feature).length, uniqueUsers: users.size }))
    .sort((a, b) => b.usageCount - a.usageCount);
}

export function getRecentEvents(organizationId: number, limit: number = 50): UXEvent[] {
  return _events.filter(e => e.organizationId === organizationId).slice(-limit);
}

export function getAlerts(organizationId: number): UsageAlert[] {
  return _alerts.filter(a => a.organizationId === organizationId);
}

export function getSessionSummaries(organizationId: number): SessionSummary[] {
  return _sessions.filter(s => s.organizationId === organizationId);
}

// ─── Sprint 3.6: Continuous Operation Monitoring ─────────────────────────────

export interface DegradationAnalysis {
  degraded:  boolean;
  metrics:   string[];
  severity:  "none" | "mild" | "moderate" | "severe";
}

export interface ContinuousOperationAnalysis {
  fatigue:         boolean;
  workflowDecay:   number; // 0-100 (percentage of decay)
  adoptionDecay:   number; // 0-100
  supportOverload: boolean;
}

export interface IncidentCorrelationResult {
  correlatedGroups: Array<{ correlationKey: string; eventIds: string[]; pattern: string }>;
  patterns:         string[];
}

export function detectLongTermDegradation(
  organizationId: number,
  periodDays:     number,
): DegradationAnalysis {
  const cutoff = new Date(Date.now() - periodDays * 86400000).toISOString();
  const recent = _events.filter(e => e.organizationId === organizationId && e.timestamp >= cutoff);

  if (recent.length === 0) {
    return { degraded: false, metrics: [], severity: "none" };
  }

  const degradedMetrics: string[] = [];

  // Check session duration decay
  const sessions = _sessions.filter(s => s.organizationId === organizationId && s.startedAt >= cutoff && s.endedAt !== null);
  const avgDuration = sessions.length > 0
    ? sessions.reduce((sum, s) => {
        const dur = new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime();
        return sum + dur;
      }, 0) / sessions.length
    : 0;
  if (avgDuration > 0 && avgDuration < 60000) degradedMetrics.push("session_duration");

  // Check event frequency decay
  const eventRate = recent.length / Math.max(periodDays, 1);
  if (eventRate < 5) degradedMetrics.push("event_frequency");

  // Check alert accumulation
  const orgAlerts = _alerts.filter(a => a.organizationId === organizationId);
  if (orgAlerts.length > 10) degradedMetrics.push("alert_accumulation");

  const severity =
    degradedMetrics.length === 0 ? "none" :
    degradedMetrics.length === 1 ? "mild" :
    degradedMetrics.length === 2 ? "moderate" : "severe";

  return {
    degraded:  degradedMetrics.length > 0,
    metrics:   degradedMetrics,
    severity,
  };
}

export function analyzeContinuousOperation(
  organizationId: number,
  snapshots:      SessionSummary[],
): ContinuousOperationAnalysis {
  if (snapshots.length < 2) {
    return { fatigue: false, workflowDecay: 0, adoptionDecay: 0, supportOverload: false };
  }

  const orgSnapshots = snapshots.filter(s => s.organizationId === organizationId);
  if (orgSnapshots.length < 2) {
    return { fatigue: false, workflowDecay: 0, adoptionDecay: 0, supportOverload: false };
  }

  // Compare first half vs second half of snapshots
  const mid   = Math.floor(orgSnapshots.length / 2);
  const first = orgSnapshots.slice(0, mid);
  const last  = orgSnapshots.slice(mid);

  const firstAvgDuration = first.reduce((s, ss) => s + (ss.durationMs ?? 0), 0) / first.length;
  const lastAvgDuration  = last.reduce((s, ss) => s + (ss.durationMs ?? 0), 0)  / last.length;

  const workflowDecay = firstAvgDuration > 0
    ? Math.max(0, Math.round(((firstAvgDuration - lastAvgDuration) / firstAvgDuration) * 100))
    : 0;
  const adoptionDecay  = workflowDecay > 50 ? workflowDecay - 20 : 0;
  const fatigue        = workflowDecay > 30 || adoptionDecay > 20;

  const orgAlerts     = _alerts.filter(a => a.organizationId === organizationId);
  const supportOverload = orgAlerts.length > 15;

  return { fatigue, workflowDecay, adoptionDecay, supportOverload };
}

export function correlateIncidents(
  organizationId: number,
  events:         UXEvent[],
): IncidentCorrelationResult {
  const orgEvents = events.filter(e => e.organizationId === organizationId);

  // Group by feature + action pattern
  const groupMap = new Map<string, string[]>();
  for (const ev of orgEvents) {
    const key = `${ev.feature}:${ev.action}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(ev.userId.toString());
  }

  const correlatedGroups = Array.from(groupMap.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, eventIds]) => ({
      correlationKey: key,
      eventIds,
      pattern:        `Repeated ${key} by ${eventIds.length} users`,
    }));

  const patterns = correlatedGroups.map(g => g.pattern);
  return { correlatedGroups, patterns };
}

export function detectProductivityDegradation(
  organizationId: number,
): { degraded: boolean; dropPercent: number } {
  const orgEvents = _events.filter(e => e.organizationId === organizationId);
  if (orgEvents.length < 10) return { degraded: false, dropPercent: 0 };

  const mid   = Math.floor(orgEvents.length / 2);
  const first = orgEvents.slice(0, mid);
  const last  = orgEvents.slice(mid);

  // Proxy: count completed actions (non-error events)
  const firstCompleted = first.filter(e => !e.action.includes("error")).length;
  const lastCompleted  = last.filter(e => !e.action.includes("error")).length;

  const dropPercent = firstCompleted > 0
    ? Math.max(0, Math.round(((firstCompleted - lastCompleted) / firstCompleted) * 100))
    : 0;

  return { degraded: dropPercent > 20, dropPercent };
}
