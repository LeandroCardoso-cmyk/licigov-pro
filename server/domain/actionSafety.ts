import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SafetyLevel = "safe" | "low_risk" | "medium_risk" | "high_risk" | "critical" | "blocked";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ActionClassification {
  readonly id: string;
  readonly organizationId: number;
  readonly actionType: string;
  readonly safetyLevel: SafetyLevel;
  readonly isReversible: boolean;
  readonly requiresApproval: boolean;
  readonly approvalLevel: string | null;
  readonly maxRetries: number;
  readonly rollbackStrategy: "none" | "checkpoint" | "full_rollback" | "manual";
  readonly confidenceThreshold: number;
  readonly description: string;
  readonly legalBasis: string | null;
}

export interface SafetyCheck {
  readonly id: string;
  readonly organizationId: number;
  readonly actionType: string;
  readonly executionId: string | null;
  readonly safetyLevel: SafetyLevel;
  readonly passed: boolean;
  readonly findings: string[];
  readonly confidenceScore: number;
  readonly recommendation: "proceed" | "pause" | "block" | "escalate";
  readonly checkedAt: string;
}

export interface HallucinationRisk {
  readonly id: string;
  readonly organizationId: number;
  readonly inputHash: string;
  readonly riskLevel: "none" | "low" | "medium" | "high" | "critical";
  readonly indicators: string[];
  readonly mitigations: string[];
  readonly assessedAt: string;
}

export interface RollbackStep {
  readonly id: string;
  readonly rollbackPlanId: string;
  readonly stepOrder: number;
  readonly description: string;
  readonly actionType: string;
  readonly parameters: Record<string, unknown>;
  readonly isReversible: boolean;
}

export interface RollbackPlan {
  readonly id: string;
  readonly organizationId: number;
  readonly executionId: string;
  readonly steps: RollbackStep[];
  readonly estimatedDurationMs: number;
  readonly canAutoRollback: boolean;
  readonly requiresHumanConfirmation: boolean;
  readonly createdAt: string;
}

// ─── Action type safety registry (deterministic) ─────────────────────────────

const BLOCKED_ACTIONS = new Set([
  "delete_all", "drop_table", "mass_update", "mass_delete",
  "truncate_table", "drop_database", "irreversible_publish",
  "external_api_write", "send_mass_notification",
]);

const HIGH_RISK_ACTIONS = new Set([
  "bulk_update", "delete_record", "revoke_access",
  "expire_token", "archive_document", "close_process",
]);

const MEDIUM_RISK_ACTIONS = new Set([
  "update_record", "send_notification", "generate_document",
  "submit_approval", "assign_user",
]);

const LOW_RISK_ACTIONS = new Set([
  "search", "read", "list", "export_report",
  "create_draft", "add_comment",
]);

function resolveClassification(actionType: string): {
  safetyLevel: SafetyLevel;
  isReversible: boolean;
  requiresApproval: boolean;
  approvalLevel: string | null;
  rollbackStrategy: "none" | "checkpoint" | "full_rollback" | "manual";
  maxRetries: number;
  confidenceThreshold: number;
} {
  if (BLOCKED_ACTIONS.has(actionType) || actionType.startsWith("irreversible_")) {
    return { safetyLevel: "blocked", isReversible: false, requiresApproval: true, approvalLevel: "admin", rollbackStrategy: "none", maxRetries: 0, confidenceThreshold: 1.0 };
  }
  if (HIGH_RISK_ACTIONS.has(actionType) || actionType.startsWith("delete_") || actionType.startsWith("revoke_")) {
    return { safetyLevel: "high_risk", isReversible: false, requiresApproval: true, approvalLevel: "manager", rollbackStrategy: "full_rollback", maxRetries: 1, confidenceThreshold: 0.9 };
  }
  if (MEDIUM_RISK_ACTIONS.has(actionType) || actionType.startsWith("update_") || actionType.startsWith("submit_")) {
    return { safetyLevel: "medium_risk", isReversible: true, requiresApproval: false, approvalLevel: null, rollbackStrategy: "checkpoint", maxRetries: 2, confidenceThreshold: 0.75 };
  }
  if (LOW_RISK_ACTIONS.has(actionType) || actionType.startsWith("read_") || actionType.startsWith("list_") || actionType.startsWith("search_")) {
    return { safetyLevel: "low_risk", isReversible: true, requiresApproval: false, approvalLevel: null, rollbackStrategy: "none", maxRetries: 3, confidenceThreshold: 0.5 };
  }
  return { safetyLevel: "safe", isReversible: true, requiresApproval: false, approvalLevel: null, rollbackStrategy: "none", maxRetries: 5, confidenceThreshold: 0.3 };
}

// ─── Functions ────────────────────────────────────────────────────────────────

export function classifyAction(
  organizationId: number,
  actionType: string,
  _parameters: Record<string, unknown> = {},
): ActionClassification {
  const resolved = resolveClassification(actionType);
  const id = sha256(`classification:${organizationId}:${actionType}`).slice(0, 20);
  return {
    id,
    organizationId,
    actionType,
    safetyLevel: resolved.safetyLevel,
    isReversible: resolved.isReversible,
    requiresApproval: resolved.requiresApproval,
    approvalLevel: resolved.approvalLevel,
    maxRetries: resolved.maxRetries,
    rollbackStrategy: resolved.rollbackStrategy,
    confidenceThreshold: resolved.confidenceThreshold,
    description: `Ação '${actionType}' classificada como ${resolved.safetyLevel}`,
    legalBasis: resolved.safetyLevel !== "safe" ? "Lei 14133/2021 art. 168 — Princípio da segurança jurídica" : null,
  };
}

export function performSafetyCheck(
  organizationId: number,
  actionType: string,
  executionId: string | null,
  confidenceScore: number,
): SafetyCheck {
  const now = new Date().toISOString();
  const classification = classifyAction(organizationId, actionType);
  const findings: string[] = [];
  let recommendation: SafetyCheck["recommendation"] = "proceed";

  if (classification.safetyLevel === "blocked") {
    findings.push(`Ação '${actionType}' é bloqueada por política de segurança`);
    recommendation = "block";
  } else if (confidenceScore < classification.confidenceThreshold) {
    findings.push(`Confiança ${confidenceScore.toFixed(2)} abaixo do threshold ${classification.confidenceThreshold}`);
    recommendation = classification.safetyLevel === "high_risk" ? "block" : "pause";
  } else if (classification.requiresApproval) {
    findings.push("Ação requer aprovação humana");
    recommendation = "escalate";
  } else if (classification.safetyLevel === "high_risk") {
    findings.push("Ação de alto risco — monitoramento ativo");
    recommendation = "pause";
  }

  const passed = recommendation === "proceed";
  const id = sha256(`safetycheck:${organizationId}:${actionType}:${now}`).slice(0, 20);

  return {
    id,
    organizationId,
    actionType,
    executionId,
    safetyLevel: classification.safetyLevel,
    passed,
    findings,
    confidenceScore,
    recommendation,
    checkedAt: now,
  };
}

export function assessHallucinationRisk(
  organizationId: number,
  input: Record<string, unknown> | string,
): HallucinationRisk {
  const now = new Date().toISOString();
  const inputStr = typeof input === "string" ? input : JSON.stringify(input);
  const inputHash = sha256(inputStr);
  const indicators: string[] = [];
  const mitigations: string[] = [];

  // Heuristic checks
  if (/R\$\s*[\d.,]{10,}/.test(inputStr)) {
    indicators.push("Valor monetário suspeito (muito alto)");
    mitigations.push("Verificar valor contra referências de mercado");
  }
  if (/\b(sempre|nunca|todos|nenhum|impossível|garantido)\b/i.test(inputStr)) {
    indicators.push("Linguagem absoluta detectada");
    mitigations.push("Revisar afirmações absolutas — adicionar qualificadores");
  }
  if (/\d{4}-\d{2}-\d{2}/.test(inputStr)) {
    const dateMatch = inputStr.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      const year = parseInt(dateMatch[0].slice(0, 4));
      if (year < 2000 || year > 2040) {
        indicators.push("Data fora do intervalo esperado");
        mitigations.push("Verificar datas contra o contexto atual");
      }
    }
  }
  if (/lei\s+\d+\/\d{2,4}/i.test(inputStr) && !/lei\s+14133/i.test(inputStr) && !/lei\s+8666/i.test(inputStr)) {
    indicators.push("Referência legal não reconhecida");
    mitigations.push("Validar base legal contra corpus jurisprudencial");
  }
  if (inputStr.length > 5000) {
    indicators.push("Input muito longo — risco de inconsistência interna");
    mitigations.push("Dividir em segmentos menores para processamento");
  }

  const riskLevel: HallucinationRisk["riskLevel"] =
    indicators.length === 0 ? "none"
    : indicators.length === 1 ? "low"
    : indicators.length === 2 ? "medium"
    : indicators.length <= 4 ? "high"
    : "critical";

  const id = sha256(`hallucination:${organizationId}:${inputHash}`).slice(0, 20);

  return {
    id,
    organizationId,
    inputHash,
    riskLevel,
    indicators,
    mitigations,
    assessedAt: now,
  };
}

export function buildRollbackPlan(
  organizationId: number,
  executionId: string,
  stages: string[],
): RollbackPlan {
  const now = new Date().toISOString();
  const planId = sha256(`rollback-plan:${organizationId}:${executionId}`).slice(0, 20);

  const steps: RollbackStep[] = stages.map((stageName, idx) => ({
    id: sha256(`rollback-step:${planId}:${stageName}:${idx}`).slice(0, 20),
    rollbackPlanId: planId,
    stepOrder: stages.length - idx,
    description: `Reverter stage '${stageName}'`,
    actionType: `rollback_${stageName}`,
    parameters: { stageName, executionId },
    isReversible: true,
  })).reverse();

  return {
    id: planId,
    organizationId,
    executionId,
    steps,
    estimatedDurationMs: stages.length * 500,
    canAutoRollback: stages.length <= 5,
    requiresHumanConfirmation: stages.length > 3,
    createdAt: now,
  };
}

export function isActionBlocked(classification: ActionClassification): boolean {
  return classification.safetyLevel === "blocked";
}

export function requiresHumanApproval(
  classification: ActionClassification,
  confidenceScore: number,
): boolean {
  if (classification.requiresApproval) return true;
  if (confidenceScore < classification.confidenceThreshold) return true;
  if (classification.safetyLevel === "high_risk") return true;
  return false;
}

export function validateRollbackPlan(plan: RollbackPlan): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (plan.steps.length === 0) issues.push("Plano de rollback sem etapas");
  if (!plan.canAutoRollback && !plan.requiresHumanConfirmation) {
    issues.push("Rollback manual sem confirmação humana requerida");
  }
  const orders = plan.steps.map(s => s.stepOrder);
  const uniqueOrders = new Set(orders);
  if (uniqueOrders.size !== orders.length) issues.push("Ordens de etapas duplicadas");
  return { valid: issues.length === 0, issues };
}
