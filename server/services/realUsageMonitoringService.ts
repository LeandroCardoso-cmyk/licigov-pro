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
