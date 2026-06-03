/**
 * Sprint 3.2 — Security Hardening Service.
 *
 * Security monitoring, anomaly detection, brute force detection.
 * Structured JSON logs only — no DB writes.
 * Multi-tenant, correlation-aware.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type SecurityEventType =
  | "brute_force"
  | "suspicious_access"
  | "permission_anomaly"
  | "session_anomaly"
  | "audit_anomaly"
  | "rate_limit_exceeded";

export type SecuritySeverity = "info" | "warning" | "critical";

export interface SecurityEvent {
  id:              string;
  organizationId:  number;
  eventType:       SecurityEventType;
  severity:        SecuritySeverity;
  actorId:         number | null;
  description:     string;
  metadata:        Record<string, unknown>;
  correlationId:   string;
  detectedAt:      string;
}

export interface SecuritySnapshot {
  organizationId:  number;
  period:          string;
  totalEvents:     number;
  bySeverity:      Record<string, number>;
  byType:          Record<string, number>;
  anomalyScore:    number; // 0-1
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let eventCounter = 0;

function createEventId(): string {
  eventCounter++;
  return `sec_${Date.now()}_${eventCounter}`;
}

// ─── Brute force detection ───────────────────────────────────────────────────

export function detectBruteForce(
  loginAttempts: Array<{ userId: number; success: boolean; ip: string; at: string }>,
  windowMs = 300000,
  maxFails = 5,
): SecurityEvent | null {
  if (loginAttempts.length === 0) return null;

  const now = Date.now();
  const recent = loginAttempts.filter(
    a => now - new Date(a.at).getTime() < windowMs,
  );

  const failedByIp = new Map<string, number>();
  for (const attempt of recent) {
    if (!attempt.success) {
      failedByIp.set(attempt.ip, (failedByIp.get(attempt.ip) ?? 0) + 1);
    }
  }

  for (const [ip, count] of failedByIp.entries()) {
    if (count >= maxFails) {
      return {
        id:             createEventId(),
        organizationId: 0,
        eventType:      "brute_force",
        severity:       "critical",
        actorId:        null,
        description:    `Brute force detected: ${count} failed login attempts from IP ${ip} in ${windowMs / 1000}s.`,
        metadata:       { ip, failedCount: count, windowMs },
        correlationId:  `bf_${ip}_${Date.now()}`,
        detectedAt:     new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── Suspicious access detection ─────────────────────────────────────────────

export function detectSuspiciousAccess(
  accesses: Array<{ userId: number; orgId: number; resource: string; at: string }>,
): SecurityEvent[] {
  const events: SecurityEvent[] = [];

  // Detect cross-org access: user accessing multiple orgs in a short window
  const orgsByUser = new Map<number, Set<number>>();
  for (const access of accesses) {
    if (!orgsByUser.has(access.userId)) {
      orgsByUser.set(access.userId, new Set());
    }
    orgsByUser.get(access.userId)!.add(access.orgId);
  }

  for (const [userId, orgs] of orgsByUser.entries()) {
    if (orgs.size > 3) {
      events.push({
        id:             createEventId(),
        organizationId: 0,
        eventType:      "suspicious_access",
        severity:       "warning",
        actorId:        userId,
        description:    `User ${userId} accessed ${orgs.size} different organizations.`,
        metadata:       { userId, orgCount: orgs.size, orgIds: Array.from(orgs) },
        correlationId:  `sa_${userId}_${Date.now()}`,
        detectedAt:     new Date().toISOString(),
      });
    }
  }

  return events;
}

// ─── Permission anomaly detection ────────────────────────────────────────────

export function detectPermissionAnomaly(
  actions: Array<{ userId: number; action: string; allowed: boolean }>,
): SecurityEvent[] {
  const events: SecurityEvent[] = [];

  // Detect users with high denied-action ratio
  const deniedByUser = new Map<number, number>();
  const totalByUser = new Map<number, number>();

  for (const action of actions) {
    totalByUser.set(action.userId, (totalByUser.get(action.userId) ?? 0) + 1);
    if (!action.allowed) {
      deniedByUser.set(action.userId, (deniedByUser.get(action.userId) ?? 0) + 1);
    }
  }

  for (const [userId, denied] of deniedByUser.entries()) {
    const total = totalByUser.get(userId) ?? 0;
    if (denied >= 5 && denied / total > 0.5) {
      events.push({
        id:             createEventId(),
        organizationId: 0,
        eventType:      "permission_anomaly",
        severity:       "warning",
        actorId:        userId,
        description:    `User ${userId} had ${denied}/${total} actions denied (${Math.round((denied / total) * 100)}%).`,
        metadata:       { userId, denied, total, ratio: denied / total },
        correlationId:  `pa_${userId}_${Date.now()}`,
        detectedAt:     new Date().toISOString(),
      });
    }
  }

  return events;
}

// ─── Security snapshot ───────────────────────────────────────────────────────

export function computeSecuritySnapshot(
  events: SecurityEvent[],
  period: string,
): SecuritySnapshot {
  const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
  const byType: Record<string, number> = {};

  for (const e of events) {
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
  }

  // Anomaly score: weighted severity
  const criticalWeight = 0.5;
  const warningWeight = 0.3;
  const infoWeight = 0.1;
  const maxScore = Math.max(events.length, 1);
  const rawScore =
    (bySeverity.critical * criticalWeight +
      bySeverity.warning * warningWeight +
      bySeverity.info * infoWeight) /
    maxScore;
  const anomalyScore = Math.min(1, Math.round(rawScore * 1000) / 1000);

  return {
    organizationId: events[0]?.organizationId ?? 0,
    period,
    totalEvents: events.length,
    bySeverity,
    byType,
    anomalyScore,
  };
}

// ─── Health check ────────────────────────────────────────────────────────────

export function isSecurityHealthy(snapshot: SecuritySnapshot): boolean {
  return (
    (snapshot.bySeverity.critical ?? 0) === 0 &&
    snapshot.anomalyScore < 0.5
  );
}

// ─── Record event ────────────────────────────────────────────────────────────

export function recordSecurityEvent(event: SecurityEvent): void {
  console.info(JSON.stringify({
    service: "security",
    event:   "security_event",
    ...event,
    timestamp: new Date().toISOString(),
  }));
}
