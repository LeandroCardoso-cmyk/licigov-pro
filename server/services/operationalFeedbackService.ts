/**
 * Sprint 3.5 — Operational Feedback Service.
 *
 * Coleta feedback operacional real de workflows, UX, produtividade e fricção.
 * Saída: structured log (console.info JSON) + in-memory store.
 * Feedback anonimizado: userId é hasheado antes de armazenar métricas.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FeedbackCategory =
  | "workflow"
  | "ux"
  | "productivity"
  | "friction"
  | "bottleneck"
  | "onboarding"
  | "approval"
  | "review"
  | "feature_satisfaction";

export type FeedbackSeverity = "low" | "medium" | "high" | "critical";

export interface FeedbackItem {
  id:             string;
  organizationId: number;
  userHash:       string; // anonymized
  category:       FeedbackCategory;
  severity:       FeedbackSeverity;
  feature:        string;
  message:        string;
  rating:         number | null; // 1-5
  metadata:       Record<string, unknown>;
  collectedAt:    string;
}

export interface FrictionReport {
  organizationId: number;
  period:         { start: string; end: string };
  topFrictions:   Array<{ feature: string; count: number; avgSeverity: string }>;
  onboardingPainPoints: string[];
  approvalFriction:     number; // avg seconds per approval step
  reviewComplexity:     number; // avg steps per review
  computedAt:           string;
}

export interface FeedbackTrend {
  category:    FeedbackCategory;
  period:      string;
  count:       number;
  avgRating:   number | null;
  severityCounts: Record<FeedbackSeverity, number>;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _feedbacks: FeedbackItem[] = [];
let   _counter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
}

function anonymize(userId: number): string {
  return createHash("sha256").update(String(userId)).digest("hex").slice(0, 12);
}

// ─── Record feedback ──────────────────────────────────────────────────────────

export function recordFeedback(params: {
  organizationId: number;
  userId:         number;
  category:       FeedbackCategory;
  feature:        string;
  message:        string;
  rating?:        number;
  severity?:      FeedbackSeverity;
  metadata?:      Record<string, unknown>;
}): FeedbackItem {
  const item: FeedbackItem = {
    id:             genId("fb"),
    organizationId: params.organizationId,
    userHash:       anonymize(params.userId),
    category:       params.category,
    severity:       params.severity ?? classifySeverity(params.rating),
    feature:        params.feature,
    message:        params.message,
    rating:         params.rating ?? null,
    metadata:       params.metadata ?? {},
    collectedAt:    new Date().toISOString(),
  };
  _feedbacks.push(item);
  console.info(JSON.stringify({ type: "operational_feedback", ...item }));
  return item;
}

function classifySeverity(rating: number | undefined): FeedbackSeverity {
  if (rating === undefined) return "low";
  if (rating <= 1) return "critical";
  if (rating <= 2) return "high";
  if (rating <= 3) return "medium";
  return "low";
}

// ─── Workflow feedback ────────────────────────────────────────────────────────

export function recordWorkflowFeedback(params: {
  organizationId: number;
  userId:         number;
  workflowStage:  string;
  rating:         number;
  issue?:         string;
}): FeedbackItem {
  return recordFeedback({
    organizationId: params.organizationId,
    userId:         params.userId,
    category:       "workflow",
    feature:        `workflow:${params.workflowStage}`,
    message:        params.issue ?? "Feedback de workflow",
    rating:         params.rating,
  });
}

// ─── UX feedback ─────────────────────────────────────────────────────────────

export function recordUXFeedback(params: {
  organizationId: number;
  userId:         number;
  screen:         string;
  rating:         number;
  frictionPoint?: string;
}): FeedbackItem {
  return recordFeedback({
    organizationId: params.organizationId,
    userId:         params.userId,
    category:       "ux",
    feature:        `screen:${params.screen}`,
    message:        params.frictionPoint ?? "Feedback de UX",
    rating:         params.rating,
  });
}

// ─── Friction reporting ───────────────────────────────────────────────────────

export function reportFriction(params: {
  organizationId: number;
  userId:         number;
  feature:        string;
  description:    string;
  severity:       FeedbackSeverity;
}): FeedbackItem {
  return recordFeedback({
    organizationId: params.organizationId,
    userId:         params.userId,
    category:       "friction",
    feature:        params.feature,
    message:        params.description,
    severity:       params.severity,
  });
}

// ─── Bottleneck reporting ─────────────────────────────────────────────────────

export function reportBottleneck(params: {
  organizationId: number;
  userId:         number;
  bottleneck:     string;
  estimatedImpact: "low" | "medium" | "high";
}): FeedbackItem {
  const severityMap: Record<string, FeedbackSeverity> = { low: "low", medium: "medium", high: "high" };
  return recordFeedback({
    organizationId: params.organizationId,
    userId:         params.userId,
    category:       "bottleneck",
    feature:        `bottleneck:${params.bottleneck}`,
    message:        `Gargalo reportado: ${params.bottleneck}`,
    severity:       severityMap[params.estimatedImpact] ?? "medium",
  });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export function computeFrictionReport(
  organizationId: number,
  periodStart:    string,
  periodEnd:      string,
): FrictionReport {
  const now = new Date().toISOString();
  const orgFeedbacks = _feedbacks.filter(
    f => f.organizationId === organizationId &&
         f.collectedAt >= periodStart &&
         f.collectedAt <= periodEnd &&
         (f.category === "friction" || f.category === "bottleneck"),
  );

  const featureMap: Record<string, { count: number; severities: FeedbackSeverity[] }> = {};
  for (const fb of orgFeedbacks) {
    if (!featureMap[fb.feature]) featureMap[fb.feature] = { count: 0, severities: [] };
    featureMap[fb.feature].count++;
    featureMap[fb.feature].severities.push(fb.severity);
  }

  const severityWeight: Record<FeedbackSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const topFrictions = Object.entries(featureMap)
    .map(([feature, data]) => ({
      feature,
      count:       data.count,
      avgSeverity: data.severities.length > 0
        ? (["low", "medium", "high", "critical"] as FeedbackSeverity[])[
            Math.min(3, Math.round(data.severities.reduce((s, sv) => s + severityWeight[sv], 0) / data.severities.length) - 1)
          ]
        : "low",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const onboardingFeedbacks = _feedbacks.filter(
    f => f.organizationId === organizationId && f.category === "onboarding",
  );
  const onboardingPainPoints = [...new Set(onboardingFeedbacks.map(f => f.feature))];

  return {
    organizationId,
    period:              { start: periodStart, end: periodEnd },
    topFrictions,
    onboardingPainPoints,
    approvalFriction:    0,
    reviewComplexity:    0,
    computedAt:          now,
  };
}

export function computeFeedbackTrends(
  organizationId: number,
  category?:      FeedbackCategory,
): FeedbackTrend[] {
  const orgFeedbacks = _feedbacks.filter(
    f => f.organizationId === organizationId && (!category || f.category === category),
  );

  const byCategory: Record<string, FeedbackItem[]> = {};
  for (const fb of orgFeedbacks) {
    if (!byCategory[fb.category]) byCategory[fb.category] = [];
    byCategory[fb.category].push(fb);
  }

  return Object.entries(byCategory).map(([cat, items]) => {
    const ratings = items.map(i => i.rating).filter(r => r !== null) as number[];
    const severityCounts: Record<FeedbackSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const item of items) severityCounts[item.severity]++;

    return {
      category:       cat as FeedbackCategory,
      period:         "all_time",
      count:          items.length,
      avgRating:      ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
      severityCounts,
    };
  });
}

export function getFeedbackByCategory(
  organizationId: number,
  category:       FeedbackCategory,
): FeedbackItem[] {
  return _feedbacks.filter(f => f.organizationId === organizationId && f.category === category);
}

export function getAllFeedback(organizationId: number): FeedbackItem[] {
  return _feedbacks.filter(f => f.organizationId === organizationId);
}
