/**
 * Sprint 3.5 — Pilot Readiness Score Service.
 *
 * Score determinístico de prontidão operacional real:
 * onboarding, adoção de workflow, engajamento, throughput,
 * maturidade de revisão, eficiência de aprovação, adoção de features,
 * carga de suporte e saúde de produtividade.
 *
 * Replay-safe: mesmo input → mesmo score.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadinessScoreInput {
  organizationId:          number;
  onboardingCompletionPct: number; // 0-100
  workflowAdoptionPct:     number; // 0-100
  userEngagementPct:       number; // 0-100
  throughputPerDay:        number;
  reviewMaturityPct:       number; // 0-100 (% reviews completos sem re-abertura)
  approvalEfficiencyPct:   number; // 0-100 (% aprovações sem escalação)
  featureAdoptionPct:      number; // 0-100
  supportLoadIndex:        number; // 0-100 (0=sem suporte, 100=suporte máximo)
  productivityHealthPct:   number; // 0-100
}

export interface ReadinessScoreDimension {
  name:        string;
  weight:      number;
  rawValue:    number;
  contribution: number;
  status:      "excellent" | "good" | "needs_improvement" | "critical";
}

export interface ReadinessScoreResult {
  organizationId:   number;
  totalScore:       number; // 0-100
  tier:             "platinum" | "gold" | "silver" | "bronze" | "not_ready";
  dimensions:       ReadinessScoreDimension[];
  replayKey:        string;
  recommendations:  string[];
  historicalEvolution: ReadinessScoreSnapshot[];
  computedAt:       string;
}

export interface ReadinessScoreSnapshot {
  score:       number;
  tier:        string;
  computedAt:  string;
}

// ─── In-memory history ────────────────────────────────────────────────────────

const _history: Map<number, ReadinessScoreSnapshot[]> = new Map();

// ─── Tier mapping ─────────────────────────────────────────────────────────────

function scoreTier(score: number): ReadinessScoreResult["tier"] {
  if (score >= 90) return "platinum";
  if (score >= 75) return "gold";
  if (score >= 60) return "silver";
  if (score >= 40) return "bronze";
  return "not_ready";
}

function dimensionStatus(value: number): ReadinessScoreDimension["status"] {
  if (value >= 80) return "excellent";
  if (value >= 60) return "good";
  if (value >= 40) return "needs_improvement";
  return "critical";
}

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS: Record<keyof Omit<ReadinessScoreInput, "organizationId">, number> = {
  onboardingCompletionPct: 0.15,
  workflowAdoptionPct:     0.20,
  userEngagementPct:       0.15,
  throughputPerDay:        0.10,
  reviewMaturityPct:       0.10,
  approvalEfficiencyPct:   0.10,
  featureAdoptionPct:      0.10,
  supportLoadIndex:        0.05, // inverted: lower load = better
  productivityHealthPct:   0.05,
};

const DIMENSION_LABELS: Record<keyof Omit<ReadinessScoreInput, "organizationId">, string> = {
  onboardingCompletionPct: "Conclusão de Onboarding",
  workflowAdoptionPct:     "Adoção de Workflow",
  userEngagementPct:       "Engajamento de Usuários",
  throughputPerDay:        "Throughput Diário",
  reviewMaturityPct:       "Maturidade de Revisão",
  approvalEfficiencyPct:   "Eficiência de Aprovação",
  featureAdoptionPct:      "Adoção de Funcionalidades",
  supportLoadIndex:        "Carga de Suporte",
  productivityHealthPct:   "Saúde de Produtividade",
};

// ─── Core scoring ─────────────────────────────────────────────────────────────

export function computeReadinessScore(input: ReadinessScoreInput): ReadinessScoreResult {
  const now = new Date().toISOString();

  // Normalize throughputPerDay to 0-100 (cap at 50/day = 100%)
  const normalizedThroughput = Math.min(100, (input.throughputPerDay / 50) * 100);

  // supportLoadIndex is inverted: 0=good, 100=bad → flip to 0-100 where high = good
  const invertedSupportLoad = 100 - input.supportLoadIndex;

  const normalized: Record<keyof Omit<ReadinessScoreInput, "organizationId">, number> = {
    onboardingCompletionPct: input.onboardingCompletionPct,
    workflowAdoptionPct:     input.workflowAdoptionPct,
    userEngagementPct:       input.userEngagementPct,
    throughputPerDay:        normalizedThroughput,
    reviewMaturityPct:       input.reviewMaturityPct,
    approvalEfficiencyPct:   input.approvalEfficiencyPct,
    featureAdoptionPct:      input.featureAdoptionPct,
    supportLoadIndex:        invertedSupportLoad,
    productivityHealthPct:   input.productivityHealthPct,
  };

  let totalScore = 0;
  const dimensions: ReadinessScoreDimension[] = [];

  for (const [key, weight] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const raw         = normalized[key];
    const contribution = raw * weight;
    totalScore        += contribution;

    dimensions.push({
      name:         DIMENSION_LABELS[key],
      weight,
      rawValue:     key === "throughputPerDay" ? input.throughputPerDay : (input[key] as number),
      contribution: Math.round(contribution * 100) / 100,
      status:       dimensionStatus(raw),
    });
  }

  const score = Math.min(100, Math.max(0, Math.round(totalScore)));
  const tier  = scoreTier(score);

  // Replay key: deterministic hash of sorted inputs
  const replayKey = createHash("sha256")
    .update(JSON.stringify({ ...input, organizationId: undefined }, Object.keys(input).sort() as (keyof typeof input)[]))
    .digest("hex").slice(0, 32);

  // Recommendations
  const recommendations: string[] = dimensions
    .filter(d => d.status === "critical" || d.status === "needs_improvement")
    .map(d => `Melhorar "${d.name}" (atual: ${Math.round(d.rawValue)}%).`);

  // Store history
  const snap: ReadinessScoreSnapshot = { score, tier, computedAt: now };
  const existing = _history.get(input.organizationId) ?? [];
  _history.set(input.organizationId, [...existing, snap]);

  return {
    organizationId:      input.organizationId,
    totalScore:          score,
    tier,
    dimensions,
    replayKey,
    recommendations,
    historicalEvolution: [...(existing.slice(-10))],
    computedAt:          now,
  };
}

// ─── Historical evolution ─────────────────────────────────────────────────────

export function getReadinessHistory(organizationId: number): ReadinessScoreSnapshot[] {
  return _history.get(organizationId) ?? [];
}

export function computeReadinessEvolution(
  snapshots: ReadinessScoreSnapshot[],
): { improving: boolean; delta: number; trend: "up" | "down" | "stable" } {
  if (snapshots.length < 2) return { improving: true, delta: 0, trend: "stable" };
  const first = snapshots[0].score;
  const last  = snapshots[snapshots.length - 1].score;
  const delta = last - first;
  return {
    improving: delta >= 0,
    delta,
    trend: delta > 2 ? "up" : delta < -2 ? "down" : "stable",
  };
}

// ─── Determinism check ────────────────────────────────────────────────────────

export function verifyReadinessDeterminism(
  inputA: ReadinessScoreInput,
  inputB: ReadinessScoreInput,
): boolean {
  const a = computeReadinessScore(inputA);
  const b = computeReadinessScore(inputB);
  return a.replayKey === b.replayKey && a.totalScore === b.totalScore;
}
