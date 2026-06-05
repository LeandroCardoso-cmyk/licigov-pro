/**
 * Sprint 3.5 — Operational Incident Domain.
 *
 * Rastreamento imutável de incidentes operacionais, de suporte, de workflow
 * e de implantação com escalonamento e resolução auditável.
 *
 * PRINCÍPIOS:
 *   - Histórico imutável: append-only.
 *   - Replay-safe: mesmo input → mesmo estado.
 *   - Multi-tenant: organizationId obrigatório.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IncidentSeverity  = "low" | "medium" | "high" | "critical";
export type IncidentCategory  = "workflow" | "deployment" | "support" | "onboarding" | "data" | "security" | "performance";
export type IncidentStatus    = "open" | "investigating" | "mitigated" | "resolved" | "closed";

export interface IncidentEvent {
  id:          string;
  type:        "created" | "updated" | "escalated" | "mitigated" | "resolved" | "closed" | "commented";
  actor:       number;
  description: string;
  metadata:    Record<string, unknown>;
  occurredAt:  string;
}

export interface EscalationEntry {
  escalatedTo:   number;
  escalatedBy:   number;
  reason:        string;
  escalatedAt:   string;
}

export interface OperationalIncident {
  id:                string;
  organizationId:    number;
  title:             string;
  description:       string;
  severity:          IncidentSeverity;
  category:          IncidentCategory;
  status:            IncidentStatus;
  reportedBy:        number;
  assignedTo:        number | null;
  escalations:       EscalationEntry[];
  history:           IncidentEvent[];
  relatedProcessIds: string[];
  resolution:        string | null;
  resolvedAt:        string | null;
  closedAt:          string | null;
  createdAt:         string;
  updatedAt:         string;
}

// ─── Status transitions ───────────────────────────────────────────────────────

export const INCIDENT_STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open:          ["investigating", "mitigated", "resolved"],
  investigating: ["mitigated", "resolved", "open"],
  mitigated:     ["resolved", "investigating"],
  resolved:      ["closed", "open"],
  closed:        [],
};

export function isValidIncidentTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _incidentCounter = 0;

function genId(prefix: string): string {
  const seed = `${prefix}_${Date.now()}_${++_incidentCounter}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 20);
}

export function createIncident(params: {
  organizationId:    number;
  title:             string;
  description:       string;
  severity:          IncidentSeverity;
  category:          IncidentCategory;
  reportedBy:        number;
  relatedProcessIds?: string[];
}): OperationalIncident {
  const now = new Date().toISOString();
  const id  = genId("inc");

  const event: IncidentEvent = {
    id:          genId("evt"),
    type:        "created",
    actor:       params.reportedBy,
    description: `Incidente criado: ${params.title}`,
    metadata:    { severity: params.severity, category: params.category },
    occurredAt:  now,
  };

  return {
    id,
    organizationId:    params.organizationId,
    title:             params.title,
    description:       params.description,
    severity:          params.severity,
    category:          params.category,
    status:            "open",
    reportedBy:        params.reportedBy,
    assignedTo:        null,
    escalations:       [],
    history:           [event],
    relatedProcessIds: params.relatedProcessIds ?? [],
    resolution:        null,
    resolvedAt:        null,
    closedAt:          null,
    createdAt:         now,
    updatedAt:         now,
  };
}

// ─── Transition ───────────────────────────────────────────────────────────────

export function updateIncidentStatus(
  incident:    OperationalIncident,
  to:          IncidentStatus,
  actor:       number,
  description: string,
  resolution?: string,
): OperationalIncident {
  if (!isValidIncidentTransition(incident.status, to)) {
    throw new Error(`Transição inválida: ${incident.status} → ${to}`);
  }
  const now = new Date().toISOString();
  const event: IncidentEvent = {
    id:          genId("evt"),
    type:        to === "resolved" ? "resolved" : to === "closed" ? "closed" : to === "mitigated" ? "mitigated" : "updated",
    actor,
    description,
    metadata:    { from: incident.status, to },
    occurredAt:  now,
  };

  return {
    ...incident,
    status:     to,
    resolution: to === "resolved" ? (resolution ?? incident.resolution) : incident.resolution,
    resolvedAt: to === "resolved" ? now : incident.resolvedAt,
    closedAt:   to === "closed"   ? now : incident.closedAt,
    history:    [...incident.history, event],
    updatedAt:  now,
  };
}

// ─── Assignment ───────────────────────────────────────────────────────────────

export function assignIncident(
  incident:  OperationalIncident,
  userId:    number,
  assignedBy: number,
): OperationalIncident {
  const now = new Date().toISOString();
  const event: IncidentEvent = {
    id:          genId("evt"),
    type:        "updated",
    actor:       assignedBy,
    description: `Incidente atribuído ao userId=${userId}`,
    metadata:    { assignedTo: userId },
    occurredAt:  now,
  };
  return { ...incident, assignedTo: userId, history: [...incident.history, event], updatedAt: now };
}

// ─── Escalation ───────────────────────────────────────────────────────────────

export function escalateIncident(
  incident:    OperationalIncident,
  escalateTo:  number,
  escalatedBy: number,
  reason:      string,
): OperationalIncident {
  if (incident.status === "closed") {
    throw new Error("Não é possível escalar incidente fechado.");
  }
  const now = new Date().toISOString();
  const entry: EscalationEntry = { escalatedTo: escalateTo, escalatedBy, reason, escalatedAt: now };
  const event: IncidentEvent   = {
    id:          genId("evt"),
    type:        "escalated",
    actor:       escalatedBy,
    description: `Escalado para userId=${escalateTo}: ${reason}`,
    metadata:    { escalatedTo: escalateTo },
    occurredAt:  now,
  };

  return {
    ...incident,
    escalations: [...incident.escalations, entry],
    history:     [...incident.history, event],
    updatedAt:   now,
  };
}

// ─── Comment ──────────────────────────────────────────────────────────────────

export function addIncidentComment(
  incident: OperationalIncident,
  actor:    number,
  comment:  string,
): OperationalIncident {
  const now   = new Date().toISOString();
  const event: IncidentEvent = {
    id:          genId("evt"),
    type:        "commented",
    actor,
    description: comment,
    metadata:    {},
    occurredAt:  now,
  };
  return { ...incident, history: [...incident.history, event], updatedAt: now };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getOpenIncidents(incidents: OperationalIncident[]): OperationalIncident[] {
  return incidents.filter(i => i.status !== "closed" && i.status !== "resolved");
}

export function getCriticalIncidents(incidents: OperationalIncident[]): OperationalIncident[] {
  return incidents.filter(i => i.severity === "critical" && i.status !== "closed");
}

export function computeIncidentMetrics(incidents: OperationalIncident[]): {
  total:         number;
  open:          number;
  critical:      number;
  resolved:      number;
  avgResolutionMs: number;
} {
  const resolved = incidents.filter(i => i.resolvedAt !== null);
  const totalMs  = resolved.reduce((s, i) => {
    const start = new Date(i.createdAt).getTime();
    const end   = new Date(i.resolvedAt!).getTime();
    return s + (end - start);
  }, 0);

  return {
    total:           incidents.length,
    open:            getOpenIncidents(incidents).length,
    critical:        getCriticalIncidents(incidents).length,
    resolved:        resolved.length,
    avgResolutionMs: resolved.length > 0 ? Math.round(totalMs / resolved.length) : 0,
  };
}

// ─── Sprint 3.6: Expansão — correlação, impacto, escalação ───────────────────

export interface EscalationStep {
  level:       number;
  escalatedTo: string;
  reason:      string;
  escalatedAt: string;
}

// Note: these fields are added to IncidentRecord conceptually for new functions;
// we track them in a separate side-store to avoid breaking existing records.
const _escalationChains = new Map<string, EscalationStep[]>();
const _correlationMap   = new Map<string, string>(); // incidentId → correlationId
const _impactScopes     = new Map<string, "single_user" | "department" | "organization" | "system_wide">();

const IMPACT_SCOPE_WEIGHTS: Record<string, number> = {
  single_user:  1,
  department:   3,
  organization: 7,
  system_wide:  10,
};

const SEVERITY_WEIGHTS: Record<string, number> = {
  low:      1,
  medium:   2,
  high:     4,
  critical: 8,
};

export function setCorrelationId(incidentId: string, correlationId: string): void {
  _correlationMap.set(incidentId, correlationId);
}

export function setImpactScope(
  incidentId:  string,
  impactScope: "single_user" | "department" | "organization" | "system_wide",
): void {
  _impactScopes.set(incidentId, impactScope);
}

export function addEscalationStep(
  incidentId:  string,
  escalateTo:  string,
  reason:      string,
): EscalationStep {
  const chain  = _escalationChains.get(incidentId) ?? [];
  const step: EscalationStep = {
    level:       chain.length + 1,
    escalatedTo: escalateTo,
    reason,
    escalatedAt: new Date().toISOString(),
  };
  _escalationChains.set(incidentId, [...chain, step]);
  return { ...step };
}

export function getEscalationChain(incidentId: string): EscalationStep[] {
  return [...(_escalationChains.get(incidentId) ?? [])];
}

export function correlateIncidents(
  incidents: OperationalIncident[],
): Record<string, OperationalIncident[]> {
  const groups: Record<string, OperationalIncident[]> = {};
  for (const inc of incidents) {
    const corrId = _correlationMap.get(inc.id) ?? inc.id;
    if (!groups[corrId]) groups[corrId] = [];
    groups[corrId].push(inc);
  }
  return groups;
}

export function computeImpactScore(
  incidentId: string,
  severity:   "low" | "medium" | "high" | "critical",
): number {
  const scope       = _impactScopes.get(incidentId) ?? "single_user";
  const scopeWeight = IMPACT_SCOPE_WEIGHTS[scope] ?? 1;
  const sevWeight   = SEVERITY_WEIGHTS[severity]  ?? 1;
  return scopeWeight * sevWeight;
}
