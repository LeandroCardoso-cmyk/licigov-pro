import { createHash } from "crypto";
import {
  type SafetyCheck,
  type HallucinationRisk,
  type RollbackPlan,
  performSafetyCheck,
  assessHallucinationRisk,
  buildRollbackPlan,
  classifyAction,
  isActionBlocked,
  requiresHumanApproval,
} from "../domain/actionSafety";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentSafetyInput {
  organizationId: number;
  sessionId: string;
  actionType: string;
  executionId?: string;
  input: Record<string, unknown> | string;
  confidenceScore: number;
}

export interface AgentSafetyOutput {
  check: SafetyCheck;
  hallucinationRisk: HallucinationRisk;
  rollbackPlan: RollbackPlan | null;
  blocked: boolean;
  requiresApproval: boolean;
  processingMs: number;
  replayKey: string;
}

export interface SafetyReport {
  organizationId: number;
  sessionId: string;
  totalChecks: number;
  blockedCount: number;
  approvalRequiredCount: number;
  hallucinationRiskLevels: Record<string, number>;
  generatedAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, AgentSafetyOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function verifySafety(input: AgentSafetyInput): AgentSafetyOutput {
  const start = Date.now();
  const { organizationId, sessionId, actionType, confidenceScore } = input;
  const inputObj = typeof input.input === "string" ? { raw: input.input } : input.input;
  const executionId = input.executionId ?? null;

  const check = performSafetyCheck(organizationId, actionType, executionId, confidenceScore);
  const hallucinationRisk = assessHallucinationRisk(organizationId, inputObj);
  const classification = classifyAction(organizationId, actionType, inputObj);
  const blocked = isActionBlocked(classification);
  const needsApproval = requiresHumanApproval(classification, confidenceScore);

  const rollbackPlan = !blocked && classification.rollbackStrategy !== "none"
    ? buildRollbackPlan(organizationId, executionId ?? sessionId, [actionType])
    : null;

  const inputStr = JSON.stringify(inputObj);
  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, actionType,
    inputHash: sha256(inputStr),
    confidenceScore,
  }));

  const output: AgentSafetyOutput = {
    check,
    hallucinationRisk,
    rollbackPlan,
    blocked,
    requiresApproval: needsApproval,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function getSafetyHistory(organizationId: number): AgentSafetyOutput[] {
  return _store.get(organizationId) ?? [];
}

export function buildSafetyReport(organizationId: number, sessionId: string): SafetyReport {
  const all = _store.get(organizationId) ?? [];
  const hallucinationRiskLevels: Record<string, number> = {};
  let blockedCount = 0;
  let approvalRequiredCount = 0;

  for (const o of all) {
    if (o.blocked) blockedCount++;
    if (o.requiresApproval) approvalRequiredCount++;
    const level = o.hallucinationRisk.riskLevel;
    hallucinationRiskLevels[level] = (hallucinationRiskLevels[level] ?? 0) + 1;
  }

  return {
    organizationId,
    sessionId,
    totalChecks: all.length,
    blockedCount,
    approvalRequiredCount,
    hallucinationRiskLevels,
    generatedAt: new Date().toISOString(),
  };
}
