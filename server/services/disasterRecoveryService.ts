import { createHash } from "crypto";

export type CheckpointType  = "pre_deployment" | "post_migration" | "manual" | "scheduled" | "pre_rollback";
export type PlanType        = "rollback" | "restore" | "partial_restore" | "tenant_restore";
export type RiskLevel       = "low" | "medium" | "high" | "critical";
export type StepOutcome     = "success" | "failed" | "skipped";

export interface RecoveryCheckpoint {
  id:             string;
  organizationId: number;
  checkpointType: CheckpointType;
  snapshotData:   {
    tablesIncluded: string[];
    rowCounts:      Record<string, number>;
    schemaVersion:  string;
    serviceStates:  Record<string, string>;
  };
  integrityHash:  string;
  isValid:        boolean;
  createdAt:      string;
}

export interface RecoveryStep {
  order:           number;
  action:          string;
  target:          string;
  expectedOutcome: string;
  rollbackAction:  string;
  timeoutMs:       number;
}

export interface RecoveryPlan {
  id:                  string;
  organizationId:      number;
  checkpointId:        string;
  planType:            PlanType;
  steps:               RecoveryStep[];
  estimatedDurationMs: number;
  riskLevel:           RiskLevel;
  validatedAt:         string | null;
}

export interface RecoveryLog {
  readonly id:             string;
  readonly organizationId: number;
  readonly planId:         string;
  readonly step:           number;
  readonly outcome:        StepOutcome;
  readonly notes:          string;
  readonly executedAt:     string;
}

// In-memory stores
const _checkpoints: RecoveryCheckpoint[] = [];
const _plans:       RecoveryPlan[]       = [];
const _logs:        RecoveryLog[]        = [];
let _planCounter = 0;
let _logCounter  = 0;

function makeCheckpointId(organizationId: number, checkpointType: CheckpointType, createdAt: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ organizationId, checkpointType, createdAt }))
    .digest("hex")
    .slice(0, 32);
}

function computeIntegrityHash(data: RecoveryCheckpoint["snapshotData"]): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
}

export function createCheckpoint(
  organizationId: number,
  checkpointType: CheckpointType,
  snapshotData:   RecoveryCheckpoint["snapshotData"],
): RecoveryCheckpoint {
  const createdAt     = new Date().toISOString();
  const id            = makeCheckpointId(organizationId, checkpointType, createdAt);
  const integrityHash = computeIntegrityHash(snapshotData);
  const cp: RecoveryCheckpoint = {
    id,
    organizationId,
    checkpointType,
    snapshotData,
    integrityHash,
    isValid: true,
    createdAt,
  };
  _checkpoints.push(cp);
  return { ...cp };
}

export function validateCheckpoint(cp: RecoveryCheckpoint): boolean {
  const expectedHash = computeIntegrityHash(cp.snapshotData);
  return cp.integrityHash === expectedHash;
}

export function buildRecoveryPlan(
  organizationId: number,
  checkpoint:     RecoveryCheckpoint,
  planType:       PlanType,
): RecoveryPlan {
  const steps: RecoveryStep[] = [
    { order: 1, action: "verify_checkpoint",  target: checkpoint.id,        expectedOutcome: "checkpoint valid",          rollbackAction: "abort",                    timeoutMs: 5000 },
    { order: 2, action: "stop_services",      target: "all",                expectedOutcome: "services stopped",          rollbackAction: "restart_services",         timeoutMs: 30000 },
    { order: 3, action: "backup_current",     target: "database",           expectedOutcome: "current state backed up",   rollbackAction: "none",                     timeoutMs: 60000 },
    { order: 4, action: "restore_snapshot",   target: checkpoint.id,        expectedOutcome: "snapshot restored",         rollbackAction: "restore_previous_backup",  timeoutMs: 120000 },
    { order: 5, action: "validate_restore",   target: "schema",             expectedOutcome: "schema consistent",         rollbackAction: "restore_previous_backup",  timeoutMs: 30000 },
    { order: 6, action: "restart_services",   target: "all",                expectedOutcome: "services running",          rollbackAction: "escalate",                 timeoutMs: 60000 },
    { order: 7, action: "validate_operation", target: "health_check",       expectedOutcome: "system operational",        rollbackAction: "escalate",                 timeoutMs: 30000 },
  ];
  const plan: RecoveryPlan = {
    id:                  `rplan_${++_planCounter}`,
    organizationId,
    checkpointId:        checkpoint.id,
    planType,
    steps,
    estimatedDurationMs: steps.reduce((s, st) => s + st.timeoutMs, 0),
    riskLevel:           planType === "rollback" ? "high" : planType === "tenant_restore" ? "medium" : "low",
    validatedAt:         null,
  };
  _plans.push(plan);
  return { ...plan };
}

export function executeRecoveryStep(
  organizationId: number,
  plan:           RecoveryPlan,
  stepOrder:      number,
  outcome:        StepOutcome,
  notes:          string = "",
): RecoveryLog {
  const log: RecoveryLog = {
    id:             `rlog_${++_logCounter}`,
    organizationId,
    planId:         plan.id,
    step:           stepOrder,
    outcome,
    notes,
    executedAt:     new Date().toISOString(),
  };
  _logs.push(log);
  return { ...log };
}

export function validateRecovery(planId: string): { valid: boolean; issues: string[] } {
  const logs   = _logs.filter(l => l.planId === planId);
  const plan   = _plans.find(p => p.id === planId);
  const issues: string[] = [];
  if (!plan) { return { valid: false, issues: ["Plan not found"] }; }
  const failedSteps = logs.filter(l => l.outcome === "failed");
  for (const s of failedSteps) { issues.push(`Step ${s.step} failed: ${s.notes}`); }
  const executedOrders = new Set(logs.map(l => l.step));
  for (const step of plan.steps) {
    if (!executedOrders.has(step.order) && !logs.find(l => l.step === step.order && l.outcome === "skipped")) {
      issues.push(`Step ${step.order} (${step.action}) not executed`);
    }
  }
  return { valid: issues.length === 0, issues };
}

export function estimateRecoveryTime(plan: RecoveryPlan): number {
  return plan.steps.reduce((s, step) => s + step.timeoutMs, 0);
}

export function getLatestCheckpoint(organizationId: number, type: CheckpointType): RecoveryCheckpoint | null {
  const filtered = _checkpoints
    .filter(c => c.organizationId === organizationId && c.checkpointType === type)
    .sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  return filtered[0] ? { ...filtered[0] } : null;
}

export function isRecoverable(checkpoint: RecoveryCheckpoint): boolean {
  return checkpoint.isValid && validateCheckpoint(checkpoint);
}
