/**
 * Sprint 3.2 — Operational Audit Service.
 *
 * Centralized operational audit: immutable events, timeline-ready,
 * forensic-ready. In-memory store per org + structured JSON logs.
 *
 * Multi-tenant, correlation-aware.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "export"
  | "approval"
  | "override"
  | "clause_change"
  | "item_change"
  | "semantic_override"
  | "workflow_transition"
  | "tenant_operation";

export interface AuditEvent {
  id:              string;
  organizationId:  number;
  category:        AuditCategory;
  action:          string;
  actorId:         number;
  actorRole:       string;
  targetType:      string;
  targetId:        string;
  before:          Record<string, unknown> | null;
  after:           Record<string, unknown> | null;
  justification:   string | null;
  correlationId:   string;
  occurredAt:      string;
}

export interface AuditQuery {
  organizationId:  number;
  category?:       AuditCategory;
  targetId?:       string;
  actorId?:        number;
  from?:           string;
  to?:             string;
  limit?:          number;
}

export interface AuditSummary {
  organizationId:  number;
  period:          string;
  totalEvents:     number;
  byCategory:      Record<string, number>;
  byActor:         Record<string, number>;
  recentEvents:    AuditEvent[];
}

// ─── In-memory store ─────────────────────────────────────────────────────────

const auditStore = new Map<number, AuditEvent[]>();

let eventCounter = 0;

function nextEventId(): string {
  eventCounter++;
  return `audit_${Date.now()}_${eventCounter}`;
}

// ─── Record event ────────────────────────────────────────────────────────────

export function recordAuditEvent(event: Omit<AuditEvent, "id"> & { id?: string }): void {
  const fullEvent: AuditEvent = {
    ...event,
    id: event.id ?? nextEventId(),
  };

  // Append to in-memory store
  const orgEvents = auditStore.get(fullEvent.organizationId) ?? [];
  orgEvents.push(fullEvent);
  auditStore.set(fullEvent.organizationId, orgEvents);

  // Structured log
  console.info(JSON.stringify({
    service: "operational_audit",
    event: "audit_event",
    ...fullEvent,
    timestamp: new Date().toISOString(),
  }));
}

// ─── Query events ────────────────────────────────────────────────────────────

export function queryAuditEvents(query: AuditQuery): AuditEvent[] {
  const orgEvents = auditStore.get(query.organizationId) ?? [];

  let filtered = orgEvents;

  if (query.category) {
    filtered = filtered.filter(e => e.category === query.category);
  }
  if (query.targetId) {
    filtered = filtered.filter(e => e.targetId === query.targetId);
  }
  if (query.actorId !== undefined) {
    filtered = filtered.filter(e => e.actorId === query.actorId);
  }
  if (query.from) {
    filtered = filtered.filter(e => e.occurredAt >= query.from!);
  }
  if (query.to) {
    filtered = filtered.filter(e => e.occurredAt <= query.to!);
  }

  // Sort chronologically
  filtered = filtered.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  if (query.limit) {
    filtered = filtered.slice(0, query.limit);
  }

  return filtered;
}

// ─── Audit summary ───────────────────────────────────────────────────────────

export function getAuditSummary(
  orgId:  number,
  period: string,
): AuditSummary {
  const events = auditStore.get(orgId) ?? [];

  const byCategory: Record<string, number> = {};
  const byActor: Record<string, number> = {};

  for (const e of events) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    const actorKey = String(e.actorId);
    byActor[actorKey] = (byActor[actorKey] ?? 0) + 1;
  }

  const recent = events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 10);

  return {
    organizationId: orgId,
    period,
    totalEvents: events.length,
    byCategory,
    byActor,
    recentEvents: recent,
  };
}

// ─── Audit timeline ──────────────────────────────────────────────────────────

export function getAuditTimeline(
  orgId:    number,
  targetId: string,
): AuditEvent[] {
  return queryAuditEvents({ organizationId: orgId, targetId });
}

// ─── Export audit trail ──────────────────────────────────────────────────────

export function exportAuditTrail(
  orgId: number,
  from:  string,
  to:    string,
): AuditEvent[] {
  return queryAuditEvents({ organizationId: orgId, from, to });
}

// ─── Clear (for testing) ─────────────────────────────────────────────────────

export function clearAuditStore(): void {
  auditStore.clear();
  eventCounter = 0;
}
