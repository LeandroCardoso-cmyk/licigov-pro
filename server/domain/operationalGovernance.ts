import { createHash } from "crypto";

export type GovernancePolicyType =
  | "deployment"
  | "workflow"
  | "escalation"
  | "approval"
  | "data_access"
  | "support"
  | "incident"
  | "sla";

export type GovernanceAction =
  | "create_policy"
  | "enforce_policy"
  | "waive_policy"
  | "audit_policy"
  | "expire_policy"
  | "renew_policy";

export type GovernanceOutcome =
  | "compliant"
  | "non_compliant"
  | "waived"
  | "escalated";

export interface PolicyRules {
  conditions: string[];
  actions:    string[];
  thresholds: Record<string, number>;
}

export interface GovernancePolicy {
  id:            string;
  organizationId: number;
  policyType:    GovernancePolicyType;
  name:          string;
  description:   string;
  rules:         PolicyRules;
  isActive:      boolean;
  effectiveFrom: string;
  effectiveTo:   string | null;
  createdBy:     number;
  createdAt:     string;
}

export interface GovernanceEvent {
  readonly id:             string;
  readonly policyId:       string;
  readonly organizationId: number;
  readonly action:         GovernanceAction;
  readonly actor:          number;
  readonly context:        Record<string, unknown>;
  readonly outcome:        GovernanceOutcome;
  readonly justification:  string;
  readonly occurredAt:     string;
}

export interface GovernanceAuditTrail {
  policyId:        string;
  organizationId:  number;
  events:          readonly GovernanceEvent[];
  lastAuditAt:     string;
  complianceScore: number; // 0-100
}

// In-memory stores
const _policies = new Map<string, GovernancePolicy>();
const _trails   = new Map<string, GovernanceAuditTrail>();

function makePolicyId(organizationId: number, policyType: GovernancePolicyType, name: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ organizationId, policyType, name }))
    .digest("hex")
    .slice(0, 32);
}

function makeEventId(policyId: string, action: GovernanceAction, occurredAt: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ policyId, action, occurredAt }))
    .digest("hex")
    .slice(0, 24);
}

export function createPolicy(
  organizationId: number,
  policyType:     GovernancePolicyType,
  name:           string,
  description:    string,
  rules:          PolicyRules,
  createdBy:      number,
  effectiveTo:    string | null = null,
): GovernancePolicy {
  const createdAt = new Date().toISOString();
  const id = makePolicyId(organizationId, policyType, name);
  const policy: GovernancePolicy = {
    id,
    organizationId,
    policyType,
    name,
    description,
    rules,
    isActive:      true,
    effectiveFrom: createdAt,
    effectiveTo,
    createdBy,
    createdAt,
  };
  _policies.set(id, policy);
  // Init audit trail
  if (!_trails.has(id)) {
    _trails.set(id, { policyId: id, organizationId, events: [], lastAuditAt: createdAt, complianceScore: 100 });
  }
  return { ...policy };
}

export function enforcePolicy(
  policy:        GovernancePolicy,
  actor:         number,
  context:       Record<string, unknown>,
  justification: string = "",
): GovernanceEvent {
  const outcome   = isCompliant(policy, context) ? "compliant" : "non_compliant";
  const occurredAt = new Date().toISOString();
  const event: GovernanceEvent = {
    id:             makeEventId(policy.id, "enforce_policy", occurredAt),
    policyId:       policy.id,
    organizationId: policy.organizationId,
    action:         "enforce_policy",
    actor,
    context,
    outcome,
    justification,
    occurredAt,
  };
  _appendEvent(policy.id, policy.organizationId, event);
  return event;
}

export function waivePolicy(
  policy:        GovernancePolicy,
  actor:         number,
  justification: string,
  context:       Record<string, unknown> = {},
): GovernanceEvent {
  if (justification.length < 20) {
    throw new Error("Waiver justification must be at least 20 characters");
  }
  const occurredAt = new Date().toISOString();
  const event: GovernanceEvent = {
    id:             makeEventId(policy.id, "waive_policy", occurredAt),
    policyId:       policy.id,
    organizationId: policy.organizationId,
    action:         "waive_policy",
    actor,
    context,
    outcome:        "waived",
    justification,
    occurredAt,
  };
  _appendEvent(policy.id, policy.organizationId, event);
  return event;
}

export function auditPolicy(policy: GovernancePolicy): GovernanceAuditTrail {
  const trail  = _trails.get(policy.id) ?? { policyId: policy.id, organizationId: policy.organizationId, events: [], lastAuditAt: policy.createdAt, complianceScore: 100 };
  const score  = computeComplianceScore(trail);
  const now    = new Date().toISOString();

  const occurredAt = now;
  const event: GovernanceEvent = {
    id:             makeEventId(policy.id, "audit_policy", occurredAt),
    policyId:       policy.id,
    organizationId: policy.organizationId,
    action:         "audit_policy",
    actor:          0, // system
    context:        { complianceScore: score },
    outcome:        score >= 60 ? "compliant" : "non_compliant",
    justification:  "Periodic audit",
    occurredAt,
  };
  const updated: GovernanceAuditTrail = {
    ...trail,
    events:          [...trail.events, event],
    lastAuditAt:     now,
    complianceScore: score,
  };
  _trails.set(policy.id, updated);
  return { ...updated, events: [...updated.events] };
}

export function computeComplianceScore(trail: GovernanceAuditTrail): number {
  const events = trail.events.filter(e => e.action === "enforce_policy");
  if (events.length === 0) return 100;
  const compliant = events.filter(e => e.outcome === "compliant" || e.outcome === "waived").length;
  return Math.round((compliant / events.length) * 100);
}

export function getActivePolicies(organizationId: number): GovernancePolicy[] {
  return Array.from(_policies.values())
    .filter(p => p.organizationId === organizationId && p.isActive);
}

export function getPolicyLineage(policyId: string): GovernanceEvent[] {
  const trail = _trails.get(policyId);
  return trail ? [...trail.events] : [];
}

export function isCompliant(policy: GovernancePolicy, context: Record<string, unknown>): boolean {
  if (!policy.isActive) return false;
  // Check threshold conditions
  for (const [key, threshold] of Object.entries(policy.rules.thresholds)) {
    const val = context[key];
    if (typeof val === "number" && val > threshold) return false;
  }
  return true;
}

function _appendEvent(policyId: string, organizationId: number, event: GovernanceEvent): void {
  const trail = _trails.get(policyId) ?? { policyId, organizationId, events: [], lastAuditAt: event.occurredAt, complianceScore: 100 };
  _trails.set(policyId, { ...trail, events: [...trail.events, event] });
}
