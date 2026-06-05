import { createHash } from "crypto";

export type DeploymentPhase =
  | "planning"
  | "infrastructure_prep"
  | "data_migration"
  | "parallel_run"
  | "cutover"
  | "stabilization"
  | "full_operation";

export type DeploymentStatus =
  | "scheduled"
  | "in_progress"
  | "paused"
  | "completed"
  | "failed"
  | "rolled_back";

export type DeploymentEventType =
  | "started"
  | "completed"
  | "failed"
  | "paused"
  | "resumed"
  | "rolled_back"
  | "health_check";

// Transições válidas de fase (em ordem)
const PHASE_ORDER: DeploymentPhase[] = [
  "planning",
  "infrastructure_prep",
  "data_migration",
  "parallel_run",
  "cutover",
  "stabilization",
  "full_operation",
];

export interface DeploymentEvent {
  readonly id:           string;
  readonly deploymentId: string;
  readonly organizationId: number;
  readonly phase:        DeploymentPhase;
  readonly eventType:    DeploymentEventType;
  readonly actor:        string;
  readonly notes:        string;
  readonly occurredAt:   string;
}

export interface GovernanceCheck {
  name:   string;
  passed: boolean;
  notes:  string;
}

export interface DeploymentGovernance {
  deploymentId:           string;
  organizationId:         number;
  approvedBy:             number;
  approvalJustification:  string;
  constraints:            string[];
  governanceChecks:       GovernanceCheck[];
  governanceAt:           string;
}

export interface InstitutionalDeployment {
  id:                 string;
  organizationId:     number;
  municipio:          string;
  phase:              DeploymentPhase;
  status:             DeploymentStatus;
  targetVersion:      string;
  currentVersion:     string;
  rolloutPercentage:  number;   // 0-100
  healthScore:        number;   // 0-100
  events:             readonly DeploymentEvent[];
  validationResults:  Record<string, boolean>;
  rollbackPoint:      string | null;
  activatedAt:        string | null;
  completedAt:        string | null;
  createdAt:          string;
}

// In-memory store
const _deployments = new Map<string, InstitutionalDeployment>();

function makeId(organizationId: number, municipio: string, startedAt: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ organizationId, municipio, startedAt }))
    .digest("hex")
    .slice(0, 32);
}

function makeEventId(deploymentId: string, eventType: DeploymentEventType, occurredAt: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ deploymentId, eventType, occurredAt }))
    .digest("hex")
    .slice(0, 24);
}

export function createDeployment(
  organizationId: number,
  municipio:      string,
  targetVersion:  string,
  currentVersion: string,
): InstitutionalDeployment {
  const createdAt = new Date().toISOString();
  const id = makeId(organizationId, municipio, createdAt);
  const deployment: InstitutionalDeployment = {
    id,
    organizationId,
    municipio,
    phase:             "planning",
    status:            "scheduled",
    targetVersion,
    currentVersion,
    rolloutPercentage: 0,
    healthScore:       100,
    events:            [],
    validationResults: {},
    rollbackPoint:     null,
    activatedAt:       null,
    completedAt:       null,
    createdAt,
  };
  _deployments.set(id, deployment);
  return { ...deployment };
}

export function advancePhase(
  deployment: InstitutionalDeployment,
  actor:      string,
  notes:      string = "",
): InstitutionalDeployment {
  if (deployment.status === "completed" || deployment.status === "rolled_back" || deployment.status === "failed") {
    throw new Error(`Cannot advance phase: deployment is ${deployment.status}`);
  }
  if (deployment.status === "paused") {
    throw new Error("Cannot advance phase: deployment is paused");
  }
  const currentIdx = PHASE_ORDER.indexOf(deployment.phase);
  if (currentIdx === PHASE_ORDER.length - 1) {
    throw new Error("Deployment is already in final phase");
  }
  const nextPhase = PHASE_ORDER[currentIdx + 1];
  const now = new Date().toISOString();
  const event: DeploymentEvent = {
    id:             makeEventId(deployment.id, "started", now),
    deploymentId:   deployment.id,
    organizationId: deployment.organizationId,
    phase:          nextPhase,
    eventType:      "started",
    actor,
    notes,
    occurredAt:     now,
  };
  const isActivating = nextPhase === "cutover";
  const isCompleting = nextPhase === "full_operation";
  const updated: InstitutionalDeployment = {
    ...deployment,
    phase:      nextPhase,
    status:     "in_progress",
    events:     [...deployment.events, event],
    activatedAt: isActivating ? now : deployment.activatedAt,
    completedAt: isCompleting ? now : deployment.completedAt,
  };
  _deployments.set(deployment.id, updated);
  return { ...updated };
}

export function recordEvent(
  deployment: InstitutionalDeployment,
  eventType:  DeploymentEventType,
  actor:      string,
  notes:      string = "",
): InstitutionalDeployment {
  const now = new Date().toISOString();
  const event: DeploymentEvent = {
    id:             makeEventId(deployment.id, eventType, now),
    deploymentId:   deployment.id,
    organizationId: deployment.organizationId,
    phase:          deployment.phase,
    eventType,
    actor,
    notes,
    occurredAt:     now,
  };
  const updated: InstitutionalDeployment = {
    ...deployment,
    events: [...deployment.events, event],
  };
  _deployments.set(deployment.id, updated);
  return { ...updated };
}

export function pauseDeployment(
  deployment: InstitutionalDeployment,
  actor:      string,
  reason:     string,
): InstitutionalDeployment {
  if (deployment.status === "completed" || deployment.status === "rolled_back") {
    throw new Error(`Cannot pause: deployment is ${deployment.status}`);
  }
  const now = new Date().toISOString();
  const event: DeploymentEvent = {
    id:             makeEventId(deployment.id, "paused", now),
    deploymentId:   deployment.id,
    organizationId: deployment.organizationId,
    phase:          deployment.phase,
    eventType:      "paused",
    actor,
    notes:          reason,
    occurredAt:     now,
  };
  const updated: InstitutionalDeployment = {
    ...deployment,
    status: "paused",
    events: [...deployment.events, event],
  };
  _deployments.set(deployment.id, updated);
  return { ...updated };
}

export function resumeDeployment(
  deployment: InstitutionalDeployment,
  actor:      string,
): InstitutionalDeployment {
  if (deployment.status !== "paused") {
    throw new Error("Cannot resume: deployment is not paused");
  }
  const now = new Date().toISOString();
  const event: DeploymentEvent = {
    id:             makeEventId(deployment.id, "resumed", now),
    deploymentId:   deployment.id,
    organizationId: deployment.organizationId,
    phase:          deployment.phase,
    eventType:      "resumed",
    actor,
    notes:          "",
    occurredAt:     now,
  };
  const updated: InstitutionalDeployment = {
    ...deployment,
    status: "in_progress",
    events: [...deployment.events, event],
  };
  _deployments.set(deployment.id, updated);
  return { ...updated };
}

export function initiateRollback(
  deployment:  InstitutionalDeployment,
  actor:       string,
  reason:      string,
): InstitutionalDeployment {
  if (deployment.status === "completed") {
    throw new Error("Cannot rollback completed deployment");
  }
  const now = new Date().toISOString();
  const event: DeploymentEvent = {
    id:             makeEventId(deployment.id, "rolled_back", now),
    deploymentId:   deployment.id,
    organizationId: deployment.organizationId,
    phase:          deployment.phase,
    eventType:      "rolled_back",
    actor,
    notes:          reason,
    occurredAt:     now,
  };
  const updated: InstitutionalDeployment = {
    ...deployment,
    status: "rolled_back",
    events: [...deployment.events, event],
  };
  _deployments.set(deployment.id, updated);
  return { ...updated };
}

export function computeDeploymentHealth(deployment: InstitutionalDeployment): number {
  const phaseIdx    = PHASE_ORDER.indexOf(deployment.phase);
  const phaseScore  = Math.round((phaseIdx / (PHASE_ORDER.length - 1)) * 50); // 0-50
  const totalEvents = deployment.events.length;
  const failures    = deployment.events.filter(e => e.eventType === "failed").length;
  const errorRate   = totalEvents > 0 ? failures / totalEvents : 0;
  const errorPenalty = Math.round(errorRate * 40);
  const pausePenalty = deployment.status === "paused" ? 10 : 0;
  return Math.max(0, Math.min(100, 50 + phaseScore - errorPenalty - pausePenalty));
}

export function applyGovernance(
  deployment:            InstitutionalDeployment,
  approvedBy:            number,
  approvalJustification: string,
  constraints:           string[],
  checks:                GovernanceCheck[],
): DeploymentGovernance {
  return {
    deploymentId:          deployment.id,
    organizationId:        deployment.organizationId,
    approvedBy,
    approvalJustification,
    constraints,
    governanceChecks:      checks,
    governanceAt:          new Date().toISOString(),
  };
}

export function getActiveDeployments(organizationId: number): InstitutionalDeployment[] {
  return Array.from(_deployments.values())
    .filter(d => d.organizationId === organizationId && d.status !== "completed" && d.status !== "rolled_back");
}

export function getDeploymentLineage(deploymentId: string): DeploymentEvent[] {
  const d = _deployments.get(deploymentId);
  return d ? [...d.events] : [];
}
