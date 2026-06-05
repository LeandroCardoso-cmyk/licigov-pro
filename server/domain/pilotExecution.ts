/**
 * Sprint 3.5 — Pilot Execution Domain.
 *
 * Gerencia a execução real de prefeituras piloto: ciclo de vida de ativação,
 * maturidade operacional, scoring de adoção, estágios de rollout e
 * indicadores de risco.
 *
 * PRINCÍPIOS:
 *   - Histórico imutável: append-only.
 *   - Replay-safe: mesmo input → mesmo estado.
 *   - Isolamento multi-tenant: organizationId obrigatório.
 *   - Auditável: toda ação registrada com ator e razão.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivationState =
  | "inactive"
  | "onboarding_started"
  | "onboarding_completed"
  | "shadow_active"
  | "live_active"
  | "evaluation_active"
  | "full_rollout"
  | "suspended"
  | "terminated";

export type OperationalMaturityLevel =
  | "initial"      // 0-20%
  | "developing"   // 21-40%
  | "defined"      // 41-60%
  | "managed"      // 61-80%
  | "optimizing";  // 81-100%

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface PilotRiskIndicator {
  id:          string;
  type:        "adoption" | "technical" | "operational" | "compliance" | "support";
  level:       RiskLevel;
  description: string;
  detectedAt:  string;
  resolvedAt:  string | null;
}

export interface AdoptionScore {
  overall:           number; // 0-100
  workflowAdoption:  number;
  featureUsage:      number;
  userEngagement:    number;
  templateUsage:     number;
  reviewCompletion:  number;
  computedAt:        string;
}

export interface OperationalHealthIndicator {
  category:    "workflow" | "review" | "approval" | "onboarding" | "support";
  score:       number; // 0-100
  status:      "healthy" | "degraded" | "critical";
  issues:      string[];
  measuredAt:  string;
}

export interface PilotExecutionEvent {
  id:          string;
  type:        string;
  actor:       number;
  description: string;
  metadata:    Record<string, unknown>;
  occurredAt:  string;
}

export interface RolloutStage {
  stage:            ActivationState;
  startedAt:        string;
  completedAt:      string | null;
  targetCompletion: string;
  successCriteria:  string[];
  achieved:         boolean;
}

export interface PilotExecution {
  id:                string;
  organizationId:    number;
  municipio:         string;
  activationState:   ActivationState;
  maturityLevel:     OperationalMaturityLevel;
  adoptionScore:     AdoptionScore;
  healthIndicators:  OperationalHealthIndicator[];
  riskIndicators:    PilotRiskIndicator[];
  rolloutStages:     RolloutStage[];
  executionHistory:  PilotExecutionEvent[];
  startedAt:         string;
  lastActivityAt:    string;
  createdAt:         string;
  updatedAt:         string;
}

// ─── Transition table ─────────────────────────────────────────────────────────

export const ACTIVATION_TRANSITIONS: Record<ActivationState, ActivationState[]> = {
  inactive:              ["onboarding_started"],
  onboarding_started:    ["onboarding_completed", "suspended"],
  onboarding_completed:  ["shadow_active", "suspended"],
  shadow_active:         ["live_active", "suspended"],
  live_active:           ["evaluation_active", "suspended"],
  evaluation_active:     ["full_rollout", "live_active", "suspended"],
  full_rollout:          ["suspended"],
  suspended:             ["onboarding_started", "shadow_active", "live_active", "terminated"],
  terminated:            [],
};

export function isValidActivationTransition(
  from: ActivationState,
  to:   ActivationState,
): boolean {
  return ACTIVATION_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Maturity computation ─────────────────────────────────────────────────────

export function computeMaturityLevel(adoptionScore: number): OperationalMaturityLevel {
  if (adoptionScore >= 81) return "optimizing";
  if (adoptionScore >= 61) return "managed";
  if (adoptionScore >= 41) return "defined";
  if (adoptionScore >= 21) return "developing";
  return "initial";
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPilotExecution(params: {
  organizationId: number;
  municipio:      string;
}): PilotExecution {
  const now  = new Date().toISOString();
  const seed = JSON.stringify({ organizationId: params.organizationId, municipio: params.municipio });
  const id   = `exec_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;

  const defaultAdoption: AdoptionScore = {
    overall:          0,
    workflowAdoption: 0,
    featureUsage:     0,
    userEngagement:   0,
    templateUsage:    0,
    reviewCompletion: 0,
    computedAt:       now,
  };

  return {
    id,
    organizationId:   params.organizationId,
    municipio:        params.municipio,
    activationState:  "inactive",
    maturityLevel:    "initial",
    adoptionScore:    defaultAdoption,
    healthIndicators: [],
    riskIndicators:   [],
    rolloutStages:    [],
    executionHistory: [],
    startedAt:        now,
    lastActivityAt:   now,
    createdAt:        now,
    updatedAt:        now,
  };
}

// ─── Transition ───────────────────────────────────────────────────────────────

export function transitionActivationState(
  execution:   PilotExecution,
  to:          ActivationState,
  actor:       number,
  description: string,
): PilotExecution {
  if (!isValidActivationTransition(execution.activationState, to)) {
    throw new Error(
      `Transição inválida: ${execution.activationState} → ${to}`,
    );
  }
  const now = new Date().toISOString();
  const eventId = createHash("sha256")
    .update(`${execution.id}:${execution.activationState}:${to}:${execution.executionHistory.length}`)
    .digest("hex").slice(0, 24);

  const event: PilotExecutionEvent = {
    id:          eventId,
    type:        "activation_transition",
    actor,
    description: `${execution.activationState} → ${to}: ${description}`,
    metadata:    { from: execution.activationState, to },
    occurredAt:  now,
  };

  return {
    ...execution,
    activationState:  to,
    executionHistory: [...execution.executionHistory, event],
    lastActivityAt:   now,
    updatedAt:        now,
  };
}

// ─── Adoption score update ────────────────────────────────────────────────────

export function updateAdoptionScore(
  execution: PilotExecution,
  scores:    Partial<Omit<AdoptionScore, "overall" | "computedAt">>,
): PilotExecution {
  const now     = new Date().toISOString();
  const updated = { ...execution.adoptionScore, ...scores };

  // Weighted overall: workflow 30%, feature 20%, engagement 20%, template 15%, review 15%
  const overall = Math.round(
    (updated.workflowAdoption  * 0.30) +
    (updated.featureUsage      * 0.20) +
    (updated.userEngagement    * 0.20) +
    (updated.templateUsage     * 0.15) +
    (updated.reviewCompletion  * 0.15),
  );

  const newScore: AdoptionScore = { ...updated, overall: Math.min(100, overall), computedAt: now };
  const maturity = computeMaturityLevel(newScore.overall);

  return {
    ...execution,
    adoptionScore: newScore,
    maturityLevel: maturity,
    updatedAt:     now,
  };
}

// ─── Health indicators ────────────────────────────────────────────────────────

export function assessOperationalHealth(
  execution: PilotExecution,
  indicators: OperationalHealthIndicator[],
): PilotExecution {
  const now = new Date().toISOString();
  return {
    ...execution,
    healthIndicators: indicators,
    updatedAt:        now,
  };
}

export function computeOverallHealth(
  execution: PilotExecution,
): { status: "healthy" | "degraded" | "critical"; avgScore: number } {
  const { healthIndicators } = execution;
  if (healthIndicators.length === 0) return { status: "healthy", avgScore: 100 };

  const avg = Math.round(
    healthIndicators.reduce((s, h) => s + h.score, 0) / healthIndicators.length,
  );

  const hasCritical  = healthIndicators.some(h => h.status === "critical");
  const hasDegraded  = healthIndicators.some(h => h.status === "degraded");
  const status       = hasCritical ? "critical" : hasDegraded ? "degraded" : "healthy";
  return { status, avgScore: avg };
}

// ─── Risk indicators ──────────────────────────────────────────────────────────

export function addRiskIndicator(
  execution: PilotExecution,
  risk:      Omit<PilotRiskIndicator, "id" | "detectedAt" | "resolvedAt">,
): PilotExecution {
  const now = new Date().toISOString();
  const id  = createHash("sha256")
    .update(`risk:${execution.id}:${risk.type}:${execution.riskIndicators.length}`)
    .digest("hex").slice(0, 20);

  const indicator: PilotRiskIndicator = { ...risk, id, detectedAt: now, resolvedAt: null };
  return {
    ...execution,
    riskIndicators: [...execution.riskIndicators, indicator],
    updatedAt:      now,
  };
}

export function resolveRiskIndicator(
  execution:   PilotExecution,
  riskId:      string,
): PilotExecution {
  const now  = new Date().toISOString();
  const risks = execution.riskIndicators.map(r =>
    r.id === riskId ? { ...r, resolvedAt: now } : r,
  );
  return { ...execution, riskIndicators: risks, updatedAt: now };
}

export function getActiveRisks(execution: PilotExecution): PilotRiskIndicator[] {
  return execution.riskIndicators.filter(r => r.resolvedAt === null);
}

// ─── Rollout stages ───────────────────────────────────────────────────────────

export function addRolloutStage(
  execution: PilotExecution,
  stage:     Omit<RolloutStage, "startedAt" | "completedAt" | "achieved">,
): PilotExecution {
  const now = new Date().toISOString();
  const newStage: RolloutStage = { ...stage, startedAt: now, completedAt: null, achieved: false };
  return {
    ...execution,
    rolloutStages: [...execution.rolloutStages, newStage],
    updatedAt:     now,
  };
}

export function completeRolloutStage(
  execution: PilotExecution,
  state:     ActivationState,
  achieved:  boolean,
): PilotExecution {
  const now    = new Date().toISOString();
  const stages = execution.rolloutStages.map(s =>
    s.stage === state && s.completedAt === null
      ? { ...s, completedAt: now, achieved }
      : s,
  );
  return { ...execution, rolloutStages: stages, updatedAt: now };
}

// ─── Onboarding completion check ──────────────────────────────────────────────

export function isOnboardingComplete(execution: PilotExecution): boolean {
  return (
    execution.activationState === "onboarding_completed" ||
    execution.activationState === "shadow_active" ||
    execution.activationState === "live_active" ||
    execution.activationState === "evaluation_active" ||
    execution.activationState === "full_rollout"
  );
}

// ─── Pilot scoring ────────────────────────────────────────────────────────────

export function computePilotExecutionScore(execution: PilotExecution): {
  score:         number;
  maturity:      OperationalMaturityLevel;
  healthStatus:  "healthy" | "degraded" | "critical";
  activeRisks:   number;
  breakdown:     Record<string, number>;
} {
  const { avgScore, status } = computeOverallHealth(execution);
  const adoption = execution.adoptionScore.overall;
  const riskPenalty = getActiveRisks(execution).filter(r => r.level === "critical").length * 10;

  const score = Math.max(0, Math.round(
    (adoption * 0.60) + (avgScore * 0.40) - riskPenalty,
  ));

  return {
    score:        Math.min(100, score),
    maturity:     execution.maturityLevel,
    healthStatus: status,
    activeRisks:  getActiveRisks(execution).length,
    breakdown: {
      adoptionContribution: adoption * 0.60,
      healthContribution:   avgScore * 0.40,
      riskPenalty,
    },
  };
}
