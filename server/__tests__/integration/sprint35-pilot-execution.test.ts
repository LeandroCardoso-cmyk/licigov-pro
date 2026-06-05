/**
 * Sprint 3.5 — Integration tests: Pilot Execution + Real Usage Refinement.
 *
 * Target: ~100 tests, 0 regressions.
 */

import { describe, it, expect } from "vitest";

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  createPilotExecution,
  transitionActivationState,
  updateAdoptionScore,
  assessOperationalHealth,
  computeOverallHealth,
  addRiskIndicator,
  resolveRiskIndicator,
  getActiveRisks,
  addRolloutStage,
  completeRolloutStage,
  isOnboardingComplete,
  computePilotExecutionScore,
  isValidActivationTransition,
  computeMaturityLevel,
  ACTIVATION_TRANSITIONS,
} from "../../domain/pilotExecution";

import {
  createIncident,
  updateIncidentStatus,
  assignIncident,
  escalateIncident,
  addIncidentComment,
  getOpenIncidents,
  getCriticalIncidents,
  computeIncidentMetrics,
  isValidIncidentTransition,
} from "../../domain/operationalIncident";

import {
  getGlobalTemplates,
  getTemplateByCategory,
} from "../../domain/operationalTemplates";

// ─── Service imports ──────────────────────────────────────────────────────────

import {
  recordFeedback,
  recordWorkflowFeedback,
  recordUXFeedback,
  reportFriction,
  reportBottleneck,
  computeFrictionReport,
  computeFeedbackTrends,
  getFeedbackByCategory,
  getAllFeedback,
} from "../../services/operationalFeedbackService";

import {
  computeReviewerWorkload,
  detectWorkloadAlerts,
  measureQueueHealth,
  buildWorkloadSnapshot,
  computeProductivityScore,
  getWorkloadAlerts,
  analyzeThroughputTrends,
} from "../../services/workloadIntelligenceService";

import {
  computeReadinessScore,
  getReadinessHistory,
  computeReadinessEvolution,
  verifyReadinessDeterminism,
} from "../../services/pilotReadinessScoreService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG = 9100;

function makeExecution() {
  return createPilotExecution({ organizationId: ORG, municipio: "Piloto Exec" });
}

function makeReadinessInput(overrides?: Partial<Parameters<typeof computeReadinessScore>[0]>) {
  return {
    organizationId:          ORG,
    onboardingCompletionPct: 70,
    workflowAdoptionPct:     60,
    userEngagementPct:       65,
    throughputPerDay:        20,
    reviewMaturityPct:       55,
    approvalEfficiencyPct:   70,
    featureAdoptionPct:      50,
    supportLoadIndex:        20,
    productivityHealthPct:   75,
    ...overrides,
  };
}

// ─── pilotExecution domain ────────────────────────────────────────────────────

describe("pilotExecution domain", () => {
  it("creates execution with inactive state", () => {
    const e = makeExecution();
    expect(e.activationState).toBe("inactive");
    expect(e.maturityLevel).toBe("initial");
    expect(e.organizationId).toBe(ORG);
  });

  it("id is deterministic for same org+municipio", () => {
    const a = makeExecution();
    const b = makeExecution();
    expect(a.id).toBe(b.id);
  });

  it("id differs for different municipios", () => {
    const a = createPilotExecution({ organizationId: ORG, municipio: "A" });
    const b = createPilotExecution({ organizationId: ORG, municipio: "B" });
    expect(a.id).not.toBe(b.id);
  });

  it("valid transition inactive → onboarding_started", () => {
    const e = makeExecution();
    const t = transitionActivationState(e, "onboarding_started", 1, "iniciado");
    expect(t.activationState).toBe("onboarding_started");
    expect(t.executionHistory).toHaveLength(1);
  });

  it("invalid transition throws", () => {
    const e = makeExecution();
    expect(() => transitionActivationState(e, "full_rollout", 1, "salto")).toThrow();
  });

  it("full lifecycle transition chain works", () => {
    let e = makeExecution();
    e = transitionActivationState(e, "onboarding_started",   1, "s1");
    e = transitionActivationState(e, "onboarding_completed", 1, "s2");
    e = transitionActivationState(e, "shadow_active",        1, "s3");
    e = transitionActivationState(e, "live_active",          1, "s4");
    e = transitionActivationState(e, "evaluation_active",    1, "s5");
    e = transitionActivationState(e, "full_rollout",         1, "s6");
    expect(e.activationState).toBe("full_rollout");
    expect(e.executionHistory).toHaveLength(6);
  });

  it("terminal state terminated has no transitions", () => {
    expect(ACTIVATION_TRANSITIONS["terminated"]).toHaveLength(0);
  });

  it("updateAdoptionScore updates score and maturity", () => {
    const e  = makeExecution();
    const e2 = updateAdoptionScore(e, { workflowAdoption: 90, featureUsage: 80, userEngagement: 85, templateUsage: 75, reviewCompletion: 80 });
    expect(e2.adoptionScore.overall).toBeGreaterThan(0);
    expect(e2.maturityLevel).not.toBe("initial");
  });

  it("updateAdoptionScore returns new object", () => {
    const e = makeExecution();
    const e2 = updateAdoptionScore(e, { workflowAdoption: 50 });
    expect(e2).not.toBe(e);
  });

  it("computeMaturityLevel returns correct tier", () => {
    expect(computeMaturityLevel(0)).toBe("initial");
    expect(computeMaturityLevel(25)).toBe("developing");
    expect(computeMaturityLevel(50)).toBe("defined");
    expect(computeMaturityLevel(70)).toBe("managed");
    expect(computeMaturityLevel(90)).toBe("optimizing");
  });

  it("assessOperationalHealth updates indicators", () => {
    const e = makeExecution();
    const indicators = [
      { category: "workflow" as const, score: 80, status: "healthy" as const, issues: [], measuredAt: new Date().toISOString() },
      { category: "review"   as const, score: 55, status: "degraded" as const, issues: ["latency"], measuredAt: new Date().toISOString() },
    ];
    const e2 = assessOperationalHealth(e, indicators);
    expect(e2.healthIndicators).toHaveLength(2);
  });

  it("computeOverallHealth reflects worst status", () => {
    const e = assessOperationalHealth(makeExecution(), [
      { category: "workflow" as const, score: 90, status: "healthy" as const,  issues: [], measuredAt: "" },
      { category: "review"   as const, score: 30, status: "critical" as const, issues: ["critical"], measuredAt: "" },
    ]);
    const { status } = computeOverallHealth(e);
    expect(status).toBe("critical");
  });

  it("computeOverallHealth healthy when no indicators", () => {
    const { status } = computeOverallHealth(makeExecution());
    expect(status).toBe("healthy");
  });

  it("addRiskIndicator appends indicator", () => {
    const e  = makeExecution();
    const e2 = addRiskIndicator(e, { type: "adoption", level: "medium", description: "risco teste" });
    expect(e2.riskIndicators).toHaveLength(1);
    expect(e2.riskIndicators[0].resolvedAt).toBeNull();
  });

  it("resolveRiskIndicator sets resolvedAt", () => {
    let e = addRiskIndicator(makeExecution(), { type: "technical", level: "high", description: "r" });
    e = resolveRiskIndicator(e, e.riskIndicators[0].id);
    expect(e.riskIndicators[0].resolvedAt).not.toBeNull();
  });

  it("getActiveRisks excludes resolved", () => {
    let e = addRiskIndicator(makeExecution(), { type: "technical", level: "high", description: "r" });
    e = resolveRiskIndicator(e, e.riskIndicators[0].id);
    expect(getActiveRisks(e)).toHaveLength(0);
  });

  it("isOnboardingComplete returns true after onboarding_completed", () => {
    let e = makeExecution();
    e = transitionActivationState(e, "onboarding_started",   1, "");
    e = transitionActivationState(e, "onboarding_completed", 1, "");
    expect(isOnboardingComplete(e)).toBe(true);
  });

  it("isOnboardingComplete returns false for inactive", () => {
    expect(isOnboardingComplete(makeExecution())).toBe(false);
  });

  it("computePilotExecutionScore returns 0-100", () => {
    const result = computePilotExecutionScore(makeExecution());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("computePilotExecutionScore includes breakdown", () => {
    const result = computePilotExecutionScore(makeExecution());
    expect(result.breakdown).toBeDefined();
    expect(result.activeRisks).toBe(0);
  });

  it("critical risk reduces score", () => {
    let e = makeExecution();
    e = updateAdoptionScore(e, { workflowAdoption: 80, featureUsage: 80, userEngagement: 80, templateUsage: 80, reviewCompletion: 80 });
    const before = computePilotExecutionScore(e).score;
    e = addRiskIndicator(e, { type: "technical", level: "critical", description: "r" });
    e = addRiskIndicator(e, { type: "operational", level: "critical", description: "r2" });
    const after = computePilotExecutionScore(e).score;
    expect(after).toBeLessThan(before);
  });

  it("addRolloutStage appends stage", () => {
    const e = addRolloutStage(makeExecution(), {
      stage: "onboarding_started", targetCompletion: new Date().toISOString(), successCriteria: ["criterio 1"],
    });
    expect(e.rolloutStages).toHaveLength(1);
  });

  it("completeRolloutStage marks achieved", () => {
    let e = addRolloutStage(makeExecution(), {
      stage: "onboarding_started", targetCompletion: new Date().toISOString(), successCriteria: [],
    });
    e = completeRolloutStage(e, "onboarding_started", true);
    expect(e.rolloutStages[0].achieved).toBe(true);
    expect(e.rolloutStages[0].completedAt).not.toBeNull();
  });

  it("isValidActivationTransition respects table", () => {
    expect(isValidActivationTransition("inactive", "onboarding_started")).toBe(true);
    expect(isValidActivationTransition("inactive", "full_rollout")).toBe(false);
    expect(isValidActivationTransition("terminated", "live_active")).toBe(false);
  });
});

// ─── operationalIncident domain ───────────────────────────────────────────────

describe("operationalIncident domain", () => {
  it("creates incident with open status", () => {
    const inc = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "high", category: "workflow", reportedBy: 1 });
    expect(inc.status).toBe("open");
    expect(inc.history).toHaveLength(1);
    expect(inc.history[0].type).toBe("created");
  });

  it("updateIncidentStatus transitions correctly", () => {
    const inc  = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "medium", category: "support", reportedBy: 1 });
    const inc2 = updateIncidentStatus(inc, "investigating", 1, "em andamento");
    expect(inc2.status).toBe("investigating");
    expect(inc2.history).toHaveLength(2);
  });

  it("resolving sets resolvedAt and resolution", () => {
    let inc = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "low", category: "support", reportedBy: 1 });
    inc = updateIncidentStatus(inc, "resolved", 1, "corrigido", "solucao aplicada");
    expect(inc.resolvedAt).not.toBeNull();
    expect(inc.resolution).toBe("solucao aplicada");
  });

  it("closing sets closedAt", () => {
    let inc = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "low", category: "support", reportedBy: 1 });
    inc = updateIncidentStatus(inc, "resolved", 1, "ok", "resolvido");
    inc = updateIncidentStatus(inc, "closed",   1, "fechado");
    expect(inc.closedAt).not.toBeNull();
  });

  it("invalid transition throws", () => {
    const inc = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "low", category: "support", reportedBy: 1 });
    expect(() => updateIncidentStatus(inc, "closed", 1, "direto")).toThrow();
  });

  it("assignIncident updates assignedTo", () => {
    const inc  = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "high", category: "support", reportedBy: 1 });
    const inc2 = assignIncident(inc, 42, 1);
    expect(inc2.assignedTo).toBe(42);
    expect(inc2.history).toHaveLength(2);
  });

  it("escalateIncident appends escalation", () => {
    const inc  = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "critical", category: "security", reportedBy: 1 });
    const inc2 = escalateIncident(inc, 99, 1, "urgente");
    expect(inc2.escalations).toHaveLength(1);
    expect(inc2.escalations[0].escalatedTo).toBe(99);
  });

  it("escalateIncident closed throws", () => {
    let inc = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "low", category: "support", reportedBy: 1 });
    inc = updateIncidentStatus(inc, "resolved", 1, "ok", "res");
    inc = updateIncidentStatus(inc, "closed",   1, "fechado");
    expect(() => escalateIncident(inc, 99, 1, "motivo")).toThrow();
  });

  it("addIncidentComment appends comment event", () => {
    const inc  = createIncident({ organizationId: ORG, title: "T", description: "D", severity: "low", category: "support", reportedBy: 1 });
    const inc2 = addIncidentComment(inc, 1, "comentario adicional");
    expect(inc2.history).toHaveLength(2);
    expect(inc2.history[1].type).toBe("commented");
  });

  it("getOpenIncidents excludes closed/resolved", () => {
    const open   = createIncident({ organizationId: ORG, title: "O", description: "D", severity: "low", category: "support", reportedBy: 1 });
    let closed = createIncident({ organizationId: ORG, title: "C", description: "D", severity: "low", category: "support", reportedBy: 1 });
    closed = updateIncidentStatus(closed, "resolved", 1, "ok", "res");
    closed = updateIncidentStatus(closed, "closed",   1, "fechado");
    const result = getOpenIncidents([open, closed]);
    expect(result).toContain(open);
    expect(result).not.toContain(closed);
  });

  it("getCriticalIncidents filters correctly", () => {
    const critical = createIncident({ organizationId: ORG, title: "C", description: "D", severity: "critical", category: "security", reportedBy: 1 });
    const low      = createIncident({ organizationId: ORG, title: "L", description: "D", severity: "low",      category: "support",  reportedBy: 1 });
    const result   = getCriticalIncidents([critical, low]);
    expect(result).toContain(critical);
    expect(result).not.toContain(low);
  });

  it("computeIncidentMetrics calculates correctly", () => {
    const inc1 = createIncident({ organizationId: ORG, title: "A", description: "D", severity: "low", category: "support", reportedBy: 1 });
    let   inc2 = createIncident({ organizationId: ORG, title: "B", description: "D", severity: "low", category: "support", reportedBy: 1 });
    inc2 = updateIncidentStatus(inc2, "resolved", 1, "ok", "res");
    const m = computeIncidentMetrics([inc1, inc2]);
    expect(m.total).toBe(2);
    expect(m.resolved).toBe(1);
    expect(m.open).toBe(1);
  });

  it("isValidIncidentTransition rejects invalid", () => {
    expect(isValidIncidentTransition("open",   "closed")).toBe(false);
    expect(isValidIncidentTransition("closed", "open")).toBe(false);
    expect(isValidIncidentTransition("open",   "investigating")).toBe(true);
  });
});

// ─── operationalTemplates — Sprint 3.5 templates ─────────────────────────────

describe("operationalTemplates — Sprint 3.5 additions", () => {
  it("total templates now 20", () => {
    expect(getGlobalTemplates()).toHaveLength(20);
  });

  it("finds transporte_escolar template", () => {
    const t = getTemplateByCategory("transporte_escolar");
    expect(t).not.toBeNull();
    expect(t!.legalBasis.some(lb => lb.includes("PNATE") || lb.includes("10.880"))).toBe(true);
  });

  it("finds pavimentacao template with high approvalLevels", () => {
    const t = getTemplateByCategory("pavimentacao");
    expect(t).not.toBeNull();
    expect(t!.approvalLevels).toBeGreaterThanOrEqual(3);
  });

  it("finds medicamentos_controlados with portaria", () => {
    const t = getTemplateByCategory("medicamentos_controlados");
    expect(t).not.toBeNull();
    expect(t!.legalBasis.some(lb => lb.toLowerCase().includes("344"))).toBe(true);
  });

  it("finds coleta_lixo with PNRS reference", () => {
    const t = getTemplateByCategory("coleta_lixo");
    expect(t).not.toBeNull();
    expect(t!.legalBasis.some(lb => lb.includes("12.305") || lb.includes("PNRS"))).toBe(true);
  });

  it("finds assistencia_social with LOAS reference", () => {
    const t = getTemplateByCategory("assistencia_social");
    expect(t!.legalBasis.some(lb => lb.includes("8.742") || lb.includes("LOAS"))).toBe(true);
  });

  it("all new templates have legalBasis", () => {
    const newCats = ["transporte_escolar", "manutencao_frota", "pavimentacao", "merenda_escolar", "exames_laboratoriais", "medicamentos_controlados", "vigilancia_saude", "coleta_lixo", "iluminacao_publica", "assistencia_social"] as const;
    for (const cat of newCats) {
      const t = getTemplateByCategory(cat);
      expect(t).not.toBeNull();
      expect(t!.legalBasis.length).toBeGreaterThan(0);
    }
  });

  it("all new templates have itemTRTemplates", () => {
    const templates = getGlobalTemplates().filter(t =>
      ["transporte_escolar", "manutencao_frota", "pavimentacao"].includes(t.category),
    );
    for (const t of templates) {
      expect(t.itemTRTemplates.length).toBeGreaterThan(0);
      expect(t.itemTRTemplates[0].canonicalUnit).toBeTruthy();
    }
  });
});

// ─── operationalFeedbackService ───────────────────────────────────────────────

describe("operationalFeedbackService", () => {
  it("recordFeedback stores item", () => {
    const fb = recordFeedback({ organizationId: ORG, userId: 1, category: "workflow", feature: "tr_editor", message: "ok" });
    expect(fb.category).toBe("workflow");
    expect(fb.userHash).not.toBe(String(1)); // anonymized
  });

  it("userHash is anonymized (not plain userId)", () => {
    const fb = recordFeedback({ organizationId: ORG, userId: 123, category: "ux", feature: "x", message: "y" });
    expect(fb.userHash).not.toBe("123");
    expect(fb.userHash.length).toBeGreaterThan(0);
  });

  it("same userId → same userHash (deterministic)", () => {
    const a = recordFeedback({ organizationId: ORG, userId: 7, category: "ux",        feature: "a", message: "x" });
    const b = recordFeedback({ organizationId: ORG, userId: 7, category: "workflow",   feature: "b", message: "y" });
    expect(a.userHash).toBe(b.userHash);
  });

  it("classifies severity from rating", () => {
    const fb1 = recordFeedback({ organizationId: ORG, userId: 1, category: "ux", feature: "x", message: "y", rating: 1 });
    const fb2 = recordFeedback({ organizationId: ORG, userId: 1, category: "ux", feature: "x", message: "y", rating: 5 });
    expect(fb1.severity).toBe("critical");
    expect(fb2.severity).toBe("low");
  });

  it("recordWorkflowFeedback records workflow category", () => {
    const fb = recordWorkflowFeedback({ organizationId: ORG, userId: 1, workflowStage: "technical_review", rating: 3 });
    expect(fb.category).toBe("workflow");
  });

  it("recordUXFeedback records ux category", () => {
    const fb = recordUXFeedback({ organizationId: ORG, userId: 1, screen: "dashboard", rating: 4 });
    expect(fb.category).toBe("ux");
  });

  it("reportFriction records friction category", () => {
    const fb = reportFriction({ organizationId: ORG, userId: 1, feature: "approval_flow", description: "muito cliques", severity: "high" });
    expect(fb.category).toBe("friction");
    expect(fb.severity).toBe("high");
  });

  it("reportBottleneck records bottleneck category", () => {
    const fb = reportBottleneck({ organizationId: ORG, userId: 1, bottleneck: "legal_review", estimatedImpact: "high" });
    expect(fb.category).toBe("bottleneck");
  });

  it("computeFrictionReport returns report", () => {
    const start = new Date(Date.now() - 86400000).toISOString();
    const end   = new Date().toISOString();
    const report = computeFrictionReport(ORG, start, end);
    expect(report.organizationId).toBe(ORG);
    expect(Array.isArray(report.topFrictions)).toBe(true);
  });

  it("computeFeedbackTrends returns trend per category", () => {
    const trends = computeFeedbackTrends(ORG);
    expect(Array.isArray(trends)).toBe(true);
    expect(trends.every(t => typeof t.count === "number")).toBe(true);
  });

  it("getFeedbackByCategory filters correctly", () => {
    const uxFeedback = getFeedbackByCategory(ORG, "ux");
    expect(uxFeedback.every(f => f.category === "ux")).toBe(true);
  });

  it("getAllFeedback returns org-scoped results", () => {
    const all = getAllFeedback(ORG);
    expect(all.every(f => f.organizationId === ORG)).toBe(true);
  });
});

// ─── workloadIntelligenceService ─────────────────────────────────────────────

describe("workloadIntelligenceService", () => {
  it("computeReviewerWorkload marks overloaded correctly", () => {
    const w = computeReviewerWorkload({ userId: 1, organizationId: ORG, department: "licitacoes", pendingReviews: 25, pendingApprovals: 5, avgLatencyMs: 3000, oldestItemAgeHours: 10 });
    expect(w.isOverloaded).toBe(true);
  });

  it("computeReviewerWorkload not overloaded for low load", () => {
    const w = computeReviewerWorkload({ userId: 2, organizationId: ORG, department: "compras", pendingReviews: 2, pendingApprovals: 1, avgLatencyMs: 1000, oldestItemAgeHours: 5 });
    expect(w.isOverloaded).toBe(false);
    expect(w.score).toBeGreaterThan(50);
  });

  it("score 100 for zero load", () => {
    const w = computeReviewerWorkload({ userId: 3, organizationId: ORG, department: "financas", pendingReviews: 0, pendingApprovals: 0, avgLatencyMs: 0, oldestItemAgeHours: 0 });
    expect(w.score).toBe(100);
  });

  it("detectWorkloadAlerts detects overloaded users", () => {
    const overloaded = computeReviewerWorkload({ userId: 10, organizationId: ORG + 50, department: "dept", pendingReviews: 30, pendingApprovals: 10, avgLatencyMs: 5000, oldestItemAgeHours: 100 });
    const alerts = detectWorkloadAlerts(ORG + 50, [overloaded]);
    expect(alerts.some(a => a.type === "reviewer_overload" || a.type === "stalled_approval")).toBe(true);
  });

  it("detectWorkloadAlerts empty for healthy workloads", () => {
    const healthy = computeReviewerWorkload({ userId: 11, organizationId: ORG + 51, department: "x", pendingReviews: 1, pendingApprovals: 1, avgLatencyMs: 500, oldestItemAgeHours: 2 });
    const alerts = detectWorkloadAlerts(ORG + 51, [healthy]);
    expect(alerts.filter(a => a.type === "reviewer_overload")).toHaveLength(0);
  });

  it("measureQueueHealth returns healthy for low depth", () => {
    const q = measureQueueHealth({ queueName: "review", organizationId: ORG, depth: 5, oldestItemAgeMs: 3600000, avgProcessingMs: 1000 });
    expect(q.status).toBe("healthy");
  });

  it("measureQueueHealth returns stalled for very old items", () => {
    const q = measureQueueHealth({ queueName: "approval", organizationId: ORG, depth: 200, oldestItemAgeMs: 86400000 * 3, avgProcessingMs: 5000 });
    expect(q.status).toBe("stalled");
  });

  it("buildWorkloadSnapshot returns valid snapshot", () => {
    const w = computeReviewerWorkload({ userId: 20, organizationId: ORG + 60, department: "d", pendingReviews: 5, pendingApprovals: 2, avgLatencyMs: 1000, oldestItemAgeHours: 10 });
    const snap = buildWorkloadSnapshot({
      organizationId: ORG + 60,
      periodStart:    new Date(Date.now() - 3600000).toISOString(),
      periodEnd:      new Date().toISOString(),
      workloads:      [w],
      queueHealth:    [],
      processed:      50,
      periodHours:    1,
    });
    expect(snap.productivityScore).toBeGreaterThanOrEqual(0);
    expect(snap.throughputPerHour).toBe(50);
  });

  it("computeProductivityScore 100 for no workloads", () => {
    expect(computeProductivityScore([])).toBe(100);
  });

  it("computeProductivityScore decreases with overload", () => {
    const good = computeReviewerWorkload({ userId: 30, organizationId: ORG, department: "d", pendingReviews: 1, pendingApprovals: 0, avgLatencyMs: 100, oldestItemAgeHours: 1 });
    const bad  = computeReviewerWorkload({ userId: 31, organizationId: ORG, department: "d", pendingReviews: 40, pendingApprovals: 10, avgLatencyMs: 10000, oldestItemAgeHours: 100 });
    expect(computeProductivityScore([good])).toBeGreaterThan(computeProductivityScore([bad]));
  });

  it("analyzeThroughputTrends returns trends array", () => {
    const w = computeReviewerWorkload({ userId: 40, organizationId: ORG + 70, department: "d", pendingReviews: 3, pendingApprovals: 2, avgLatencyMs: 1000, oldestItemAgeHours: 5 });
    const snap = buildWorkloadSnapshot({ organizationId: ORG + 70, periodStart: new Date().toISOString(), periodEnd: new Date().toISOString(), workloads: [w], queueHealth: [], processed: 10, periodHours: 2 });
    const trends = analyzeThroughputTrends([snap]);
    expect(trends).toHaveLength(1);
    expect(trends[0].processed).toBe(5); // 10/2
  });
});

// ─── pilotReadinessScoreService ───────────────────────────────────────────────

describe("pilotReadinessScoreService", () => {
  it("computeReadinessScore returns 0-100 score", () => {
    const result = computeReadinessScore(makeReadinessInput());
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it("perfect input scores near 100", () => {
    const result = computeReadinessScore(makeReadinessInput({
      onboardingCompletionPct: 100,
      workflowAdoptionPct:     100,
      userEngagementPct:       100,
      throughputPerDay:        50,
      reviewMaturityPct:       100,
      approvalEfficiencyPct:   100,
      featureAdoptionPct:      100,
      supportLoadIndex:        0,
      productivityHealthPct:   100,
    }));
    expect(result.totalScore).toBeGreaterThanOrEqual(90);
    expect(result.tier).toBe("platinum");
  });

  it("zero input scores 0 and not_ready tier", () => {
    const result = computeReadinessScore(makeReadinessInput({
      onboardingCompletionPct: 0, workflowAdoptionPct: 0,
      userEngagementPct: 0, throughputPerDay: 0,
      reviewMaturityPct: 0, approvalEfficiencyPct: 0,
      featureAdoptionPct: 0, supportLoadIndex: 100, productivityHealthPct: 0,
    }));
    expect(result.totalScore).toBe(0);
    expect(result.tier).toBe("not_ready");
  });

  it("replayKey is deterministic for same input", () => {
    const a = computeReadinessScore(makeReadinessInput({ organizationId: ORG + 200 }));
    const b = computeReadinessScore(makeReadinessInput({ organizationId: ORG + 200 }));
    expect(a.replayKey).toBe(b.replayKey);
    expect(a.totalScore).toBe(b.totalScore);
  });

  it("verifyReadinessDeterminism passes for same inputs", () => {
    const input = makeReadinessInput({ organizationId: ORG + 201 });
    expect(verifyReadinessDeterminism(input, { ...input })).toBe(true);
  });

  it("dimensions cover all 9 areas", () => {
    const result = computeReadinessScore(makeReadinessInput());
    expect(result.dimensions).toHaveLength(9);
  });

  it("recommendations generated for poor dimensions", () => {
    const result = computeReadinessScore(makeReadinessInput({ workflowAdoptionPct: 10, featureAdoptionPct: 5 }));
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("tier progression: bronze < silver < gold < platinum", () => {
    const tiers = (["not_ready", "bronze", "silver", "gold", "platinum"] as const);
    const scores = [20, 45, 65, 80, 95];
    const results = scores.map(s => computeReadinessScore(makeReadinessInput({
      organizationId: ORG + 300 + s,
      onboardingCompletionPct: s,
      workflowAdoptionPct: s,
      userEngagementPct: s,
      reviewMaturityPct: s,
      approvalEfficiencyPct: s,
      featureAdoptionPct: s,
      supportLoadIndex: 100 - s,
      productivityHealthPct: s,
    })));
    // Higher input → higher score
    expect(results[1].totalScore).toBeGreaterThan(results[0].totalScore);
    expect(results[2].totalScore).toBeGreaterThan(results[1].totalScore);
  });

  it("getReadinessHistory returns snapshots", () => {
    computeReadinessScore(makeReadinessInput({ organizationId: ORG + 400 }));
    computeReadinessScore(makeReadinessInput({ organizationId: ORG + 400, workflowAdoptionPct: 80 }));
    const history = getReadinessHistory(ORG + 400);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("computeReadinessEvolution detects improvement", () => {
    const snaps = [
      { score: 40, tier: "bronze",   computedAt: new Date().toISOString() },
      { score: 70, tier: "gold",     computedAt: new Date().toISOString() },
    ];
    const ev = computeReadinessEvolution(snaps);
    expect(ev.improving).toBe(true);
    expect(ev.trend).toBe("up");
    expect(ev.delta).toBe(30);
  });

  it("computeReadinessEvolution stable for single snapshot", () => {
    const ev = computeReadinessEvolution([{ score: 50, tier: "silver", computedAt: "" }]);
    expect(ev.trend).toBe("stable");
  });

  it("supportLoadIndex is inverted (lower load = better score)", () => {
    const lowLoad  = computeReadinessScore(makeReadinessInput({ organizationId: ORG + 500, supportLoadIndex: 10 }));
    const highLoad = computeReadinessScore(makeReadinessInput({ organizationId: ORG + 500, supportLoadIndex: 90 }));
    expect(lowLoad.totalScore).toBeGreaterThan(highLoad.totalScore);
  });
});
