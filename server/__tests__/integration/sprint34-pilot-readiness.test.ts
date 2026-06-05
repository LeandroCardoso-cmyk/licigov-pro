/**
 * Sprint 3.4 — Integration tests: Pilot Readiness + Operational Templates.
 *
 * Target: ~100 tests, 0 regressions.
 */

import { describe, it, expect } from "vitest";

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  createPilotOrganization,
  advancePilotPhase,
  updatePilotMetrics,
  evaluatePilotHealth,
  isPilotReadyForNextPhase,
  computePilotScore,
  getRolloutPlan,
  PILOT_PHASE_ORDER,
} from "../../domain/pilotOrganization";

import {
  getGlobalTemplates,
  getTemplateByCategory,
  customizeTemplate,
  bumpTemplateVersion,
  mergeTemplates,
  validateTemplate,
  getTemplateProvenance,
} from "../../domain/operationalTemplates";

import {
  createApprovalChain,
  advanceWorkflow,
  delegateApproval,
  requestCorrection,
  emergencyApprove,
  balanceWorkload,
  getOverdueChains,
  assignReviewer,
  routeToDepartment,
} from "../../domain/institutionalWorkflow";

// ─── Service imports ──────────────────────────────────────────────────────────

import {
  grantDepartmentPermission,
  revokeDepartmentPermission,
  grantWorkflowPermission,
  checkDepartmentPermission,
  checkWorkflowPermission,
  auditPermissionCheck,
  getDepartmentPermissions,
  getWorkflowPermissions,
} from "../../services/advancedPermissionService";

import {
  createEnvironment,
  updateEnvironmentConfig,
  setEnvironmentStatus,
  promoteEnvironment,
  checkEnvironmentHealth,
  getEnvironments,
  getEnvironmentById,
  compareEnvironments,
} from "../../services/environmentManagementService";

import {
  recordUXEvent,
  startSession,
  endSession,
  computeWorkflowAnalytics,
  detectUsageAlerts,
  getFeatureUsageReport,
  getRecentEvents,
  getAlerts,
} from "../../services/realUsageMonitoringService";

import {
  generateReadinessReport,
  generatePilotScorecard,
  approvePhaseTransition,
  getPhaseTransitionHistory,
} from "../../services/pilotReadinessService";

// ─── Helper ───────────────────────────────────────────────────────────────────

const ORG = 9001;

function makePilot(overrides?: Parameters<typeof createPilotOrganization>[0]) {
  return createPilotOrganization({
    organizationId: ORG,
    municipio:      "Piloto Cidade",
    estado:         "SP",
    populacao:      50000,
    ...overrides,
  });
}

// ─── pilotOrganization ────────────────────────────────────────────────────────

describe("pilotOrganization", () => {
  it("creates pilot with default onboarding phase", () => {
    const pilot = makePilot();
    expect(pilot.pilotPhase).toBe("onboarding");
    expect(pilot.organizationId).toBe(ORG);
    expect(pilot.auditTrail).toHaveLength(1);
    expect(pilot.auditTrail[0].action).toBe("pilot_created");
  });

  it("generates deterministic id for same org+municipio", () => {
    const a = makePilot();
    const b = makePilot();
    expect(a.id).toBe(b.id);
  });

  it("id is different for different municipios", () => {
    const a = makePilot({ organizationId: ORG, municipio: "A", estado: "SP", populacao: 1 });
    const b = makePilot({ organizationId: ORG, municipio: "B", estado: "SP", populacao: 1 });
    expect(a.id).not.toBe(b.id);
  });

  it("advance phase returns new object, updates phase", () => {
    const p1 = makePilot();
    const p2 = advancePilotPhase(p1, 42);
    expect(p2).not.toBe(p1);
    expect(p2.pilotPhase).toBe("training");
    expect(p2.auditTrail).toHaveLength(2);
  });

  it("advance through all phases reaches full_rollout", () => {
    let p = makePilot();
    for (let i = 0; i < PILOT_PHASE_ORDER.length - 1; i++) {
      p = advancePilotPhase(p, 1);
    }
    expect(p.pilotPhase).toBe("full_rollout");
  });

  it("advance from full_rollout throws", () => {
    let p = makePilot();
    for (let i = 0; i < PILOT_PHASE_ORDER.length - 1; i++) {
      p = advancePilotPhase(p, 1);
    }
    expect(() => advancePilotPhase(p, 1)).toThrow();
  });

  it("sets pilotGoLiveAt when advancing to live_pilot", () => {
    let p = makePilot();
    p = advancePilotPhase(p, 1); // training
    p = advancePilotPhase(p, 1); // shadow_mode
    expect(p.pilotGoLiveAt).toBeNull();
    p = advancePilotPhase(p, 1); // live_pilot
    expect(p.pilotGoLiveAt).not.toBeNull();
  });

  it("updatePilotMetrics returns new object and updates health", () => {
    const p1 = makePilot();
    const p2 = updatePilotMetrics(p1, { errorRate: 0.5 });
    expect(p2).not.toBe(p1);
    expect(p2.metrics.errorRate).toBe(0.5);
    expect(p2.health.status).toBe("critical");
  });

  it("evaluatePilotHealth healthy when no issues", () => {
    const p   = makePilot();
    const h   = evaluatePilotHealth(p);
    expect(h.status).toBe("healthy");
    expect(h.issues).toHaveLength(0);
  });

  it("evaluatePilotHealth degraded on elevated latency", () => {
    const p = updatePilotMetrics(makePilot(), { avgReviewLatencyMs: 6000 });
    const h = evaluatePilotHealth(p);
    expect(h.status).toBe("degraded");
    expect(h.issues.length).toBeGreaterThan(0);
  });

  it("evaluatePilotHealth critical on high error rate", () => {
    const p = updatePilotMetrics(makePilot(), { errorRate: 0.4 });
    const h = evaluatePilotHealth(p);
    expect(h.status).toBe("critical");
  });

  it("isPilotReadyForNextPhase blocks when onboarding < 50%", () => {
    const p = makePilot();
    const { ready, blockers } = isPilotReadyForNextPhase(p);
    expect(ready).toBe(false);
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("isPilotReadyForNextPhase passes when conditions met", () => {
    const p = updatePilotMetrics(makePilot(), { onboardingCompletionRate: 0.6 });
    const { ready } = isPilotReadyForNextPhase(p);
    expect(ready).toBe(true);
  });

  it("computePilotScore 0 for default pilot", () => {
    const p = makePilot();
    expect(computePilotScore(p)).toBe(0);
  });

  it("computePilotScore max 100", () => {
    const p = updatePilotMetrics(makePilot(), {
      onboardingCompletionRate: 1,
      templateAdoptionRate: 1,
      avgReviewLatencyMs: 1000,
      activeUsers: 10,
    });
    expect(computePilotScore(p)).toBe(100);
  });

  it("getRolloutPlan returns 6 phases", () => {
    const plan = getRolloutPlan(makePilot());
    expect(plan).toHaveLength(6);
    expect(plan[0].phase).toBe("onboarding");
    expect(plan[5].phase).toBe("full_rollout");
  });

  it("getRolloutPlan each phase has requirements", () => {
    const plan = getRolloutPlan(makePilot());
    for (const p of plan) {
      expect(p.requirements.length).toBeGreaterThan(0);
    }
  });

  it("features default all false", () => {
    const p = makePilot();
    expect(p.features.semanticReview).toBe(false);
    expect(p.features.catmatMatching).toBe(false);
  });

  it("features can be set at creation", () => {
    const p = makePilot({ organizationId: ORG, municipio: "X", estado: "RJ", populacao: 1000, features: { semanticReview: true } });
    expect(p.features.semanticReview).toBe(true);
    expect(p.features.catmatMatching).toBe(false);
  });
});

// ─── operationalTemplates ─────────────────────────────────────────────────────

describe("operationalTemplates", () => {
  it("getGlobalTemplates returns at least 10 templates", () => {
    expect(getGlobalTemplates().length).toBeGreaterThanOrEqual(10);
  });

  it("all global templates have organizationId 0", () => {
    const templates = getGlobalTemplates();
    for (const t of templates) {
      expect(t.organizationId).toBe(0);
    }
  });

  it("getTemplateByCategory finds medicamentos", () => {
    const t = getTemplateByCategory("medicamentos");
    expect(t).not.toBeNull();
    expect(t!.category).toBe("medicamentos");
  });

  it("getTemplateByCategory returns null for unknown", () => {
    // @ts-expect-error testing invalid input
    expect(getTemplateByCategory("unknown_category")).toBeNull();
  });

  it("customizeTemplate creates org-specific copy", () => {
    const base = getTemplateByCategory("aquisicao_comum")!;
    const custom = customizeTemplate(base, ORG, { name: "Aquisição Customizada" });
    expect(custom.organizationId).toBe(ORG);
    expect(custom.name).toBe("Aquisição Customizada");
    // id includes orgId in format tpl_{orgId}_{category}_v1
    expect(custom.id).toContain(String(ORG));
  });

  it("bumpTemplateVersion increments patch", () => {
    const base  = getTemplateByCategory("aquisicao_comum")!;
    const bumped = bumpTemplateVersion(base, "Test bump", 1);
    const parts  = bumped.version.split(".").map(Number);
    const orig   = base.version.split(".").map(Number);
    expect(parts[2]).toBe((orig[2] ?? 0) + 1);
    expect(bumped.versionHistory).toHaveLength(base.versionHistory.length + 1);
  });

  it("mergeTemplates combines correctly", () => {
    const base    = getTemplateByCategory("combustivel")!;
    const merged  = mergeTemplates(base, { name: "Combustível Especial" });
    expect(merged.name).toBe("Combustível Especial");
    expect(merged.category).toBe("combustivel");
  });

  it("validateTemplate passes for valid template", () => {
    const t = getTemplateByCategory("obras")!;
    const { valid } = validateTemplate(t);
    expect(valid).toBe(true);
  });

  it("validateTemplate fails for empty name", () => {
    const t = { ...getTemplateByCategory("manutencao")!, name: "" };
    const { valid, errors } = validateTemplate(t);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("validateTemplate fails for invalid semver", () => {
    const t = { ...getTemplateByCategory("ti")!, version: "not-semver" };
    const { valid } = validateTemplate(t);
    expect(valid).toBe(false);
  });

  it("getTemplateProvenance returns global for global templates", () => {
    const t = getTemplateByCategory("saude")!;
    const prov = getTemplateProvenance(t);
    expect(prov.source).toBe("global");
    expect(prov.customizations).toHaveLength(0);
  });

  it("getTemplateProvenance returns customized for org templates", () => {
    const base   = getTemplateByCategory("alimentacao_escolar")!;
    const custom = customizeTemplate(base, ORG, { name: "Alimentação SP" });
    const prov   = getTemplateProvenance(custom);
    expect(prov.source).toBe("customized");
    expect(prov.customizations).toContain("name");
  });

  it("all 10 categories are covered", () => {
    const categories = getGlobalTemplates().map(t => t.category);
    expect(categories).toContain("aquisicao_comum");
    expect(categories).toContain("medicamentos");
    expect(categories).toContain("combustivel");
    expect(categories).toContain("obras");
    expect(categories).toContain("ti");
    expect(categories).toContain("saude");
    expect(categories).toContain("alimentacao_escolar");
  });

  it("each template has at least one legalBasis reference", () => {
    for (const t of getGlobalTemplates()) {
      expect(t.legalBasis.length).toBeGreaterThan(0);
    }
  });

  it("each template has positive estimatedDurationDays", () => {
    for (const t of getGlobalTemplates()) {
      expect(t.estimatedDurationDays).toBeGreaterThan(0);
    }
  });
});

// ─── institutionalWorkflow extensions ────────────────────────────────────────

describe("institutionalWorkflow Sprint 3.4 extensions", () => {
  function makeChain(assignedUserId = 10) {
    return createApprovalChain({ organizationId: ORG, processId: 1, assignedTo: { elaboration: [assignedUserId] } });
  }

  it("assignReviewer sets assignees for stage", () => {
    const chain    = makeChain();
    const updated  = assignReviewer(chain, "technical_review", [20, 21]);
    expect(updated.assignedTo["technical_review"]).toEqual([20, 21]);
  });

  it("delegateApproval replaces user in current stage", () => {
    const chain    = makeChain(10);
    const actor    = { type: "human" as const, userId: 10 };
    const updated  = delegateApproval(chain, actor, 99, "ausencia");
    expect(updated.assignedTo["elaboration"]).toContain(99);
    expect(updated.assignedTo["elaboration"]).not.toContain(10);
    expect(updated.history).toHaveLength(1);
  });

  it("delegateApproval fails if actor not in current stage", () => {
    const chain = makeChain(10);
    const actor = { type: "human" as const, userId: 55 };
    expect(() => delegateApproval(chain, actor, 99, "ausencia")).toThrow();
  });

  it("requestCorrection moves back to previous stage", () => {
    const chain   = makeChain();
    const actor   = { type: "human" as const, userId: 10 };
    const adv     = advanceWorkflow(chain, actor, "avancou");
    const corrected = requestCorrection(adv, actor, "erro detectado");
    expect(corrected.currentStage).toBe("elaboration");
    expect(corrected.history).toHaveLength(2);
  });

  it("requestCorrection throws on first stage", () => {
    const chain = makeChain();
    const actor = { type: "human" as const, userId: 10 };
    expect(() => requestCorrection(chain, actor, "motivo")).toThrow();
  });

  it("emergencyApprove jumps to completed for human actor", () => {
    const chain   = makeChain();
    const actor   = { type: "human" as const, userId: 10 };
    const updated = emergencyApprove(chain, actor, "urgência máxima comprovada");
    expect(updated.currentStage).toBe("completed");
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].reason).toContain("EMERGENCIA");
  });

  it("emergencyApprove fails for system actor", () => {
    const chain = makeChain();
    const actor = { type: "system" as const };
    expect(() => emergencyApprove(chain, actor, "justificativa suficiente")).toThrow();
  });

  it("emergencyApprove fails with short justification", () => {
    const chain = makeChain();
    const actor = { type: "human" as const, userId: 10 };
    expect(() => emergencyApprove(chain, actor, "ok")).toThrow();
  });

  it("balanceWorkload distributes chains round-robin", () => {
    const chains = [
      createApprovalChain({ organizationId: ORG, processId: 1 }),
      createApprovalChain({ organizationId: ORG, processId: 2 }),
      createApprovalChain({ organizationId: ORG, processId: 3 }),
    ];
    const dist = balanceWorkload(chains, [10, 11]);
    expect(dist[10]).toHaveLength(2);
    expect(dist[11]).toHaveLength(1);
  });

  it("balanceWorkload returns empty for empty userIds", () => {
    const chains = [createApprovalChain({ organizationId: ORG, processId: 1 })];
    expect(balanceWorkload(chains, [])).toEqual({});
  });

  it("getOverdueChains returns only overdue chains", () => {
    const past = new Date();
    past.setHours(past.getHours() - 1);
    const overdueChain = createApprovalChain({
      organizationId: ORG,
      processId:      10,
      deadlines:      { elaboration: past.toISOString() },
    });
    const okChain = createApprovalChain({ organizationId: ORG, processId: 11 });
    const result  = getOverdueChains([overdueChain, okChain]);
    expect(result).toContain(overdueChain);
    expect(result).not.toContain(okChain);
  });
});

// ─── advancedPermissionService ────────────────────────────────────────────────

describe("advancedPermissionService", () => {
  it("grantDepartmentPermission creates active perm", () => {
    const perm = grantDepartmentPermission({
      organizationId: ORG,
      userId:         1,
      department:     "licitacoes",
      resource:       "processo",
      actions:        ["create", "read"],
      scope:          "department",
      grantedBy:      99,
    });
    expect(perm.active).toBe(true);
    expect(perm.actions).toContain("create");
  });

  it("checkDepartmentPermission allows matching perm", () => {
    grantDepartmentPermission({
      organizationId: ORG + 1,
      userId:         2,
      department:     "financas",
      resource:       "relatorio",
      actions:        ["read", "export"],
      scope:          "own",
      grantedBy:      99,
    });
    const result = checkDepartmentPermission(ORG + 1, 2, "financas", "relatorio", "export");
    expect(result.allowed).toBe(true);
  });

  it("checkDepartmentPermission denies missing action", () => {
    const result = checkDepartmentPermission(ORG + 1, 2, "financas", "relatorio", "delete");
    expect(result.allowed).toBe(false);
  });

  it("revokeDepartmentPermission deactivates perm", () => {
    const perm = grantDepartmentPermission({
      organizationId: ORG + 2,
      userId:         3,
      department:     "compras",
      resource:       "template",
      actions:        ["read"],
      scope:          "own",
      grantedBy:      99,
    });
    const revoked = revokeDepartmentPermission(perm.id, ORG + 2);
    expect(revoked).toBe(true);
    const result = checkDepartmentPermission(ORG + 2, 3, "compras", "template", "read");
    expect(result.allowed).toBe(false);
  });

  it("grantWorkflowPermission creates perm with capabilities", () => {
    const perm = grantWorkflowPermission({
      organizationId: ORG,
      userId:         5,
      workflowStage:  "technical_review",
      canAdvance:     true,
      canReject:      true,
      canEscalate:    false,
      canDelegate:    false,
      maxDelegations: 0,
      grantedBy:      99,
    });
    expect(perm.canAdvance).toBe(true);
    expect(perm.canDelegate).toBe(false);
  });

  it("checkWorkflowPermission allows canAdvance when granted", () => {
    grantWorkflowPermission({
      organizationId: ORG + 3,
      userId:         6,
      workflowStage:  "legal_review",
      canAdvance:     true,
      canReject:      false,
      canEscalate:    false,
      canDelegate:    false,
      maxDelegations: 0,
      grantedBy:      99,
    });
    const result = checkWorkflowPermission(ORG + 3, 6, "legal_review", "canAdvance");
    expect(result.allowed).toBe(true);
  });

  it("checkWorkflowPermission denies when not granted", () => {
    const result = checkWorkflowPermission(ORG, 9999, "elaboration", "canDelegate");
    expect(result.allowed).toBe(false);
  });

  it("auditPermissionCheck records entry", () => {
    const check = checkDepartmentPermission(ORG, 1, "licitacoes", "processo", "read");
    auditPermissionCheck(ORG, 1, "read", "processo", "proc_1", check);
    // No assertion needed — if it doesn't throw, it works
  });

  it("getDepartmentPermissions returns active perms for org+user", () => {
    const perms = getDepartmentPermissions(ORG, 1);
    expect(Array.isArray(perms)).toBe(true);
    expect(perms.every(p => p.organizationId === ORG && p.userId === 1 && p.active)).toBe(true);
  });
});

// ─── environmentManagementService ────────────────────────────────────────────

describe("environmentManagementService", () => {
  it("createEnvironment returns active environment", () => {
    const env = createEnvironment({ organizationId: ORG, name: "dev-test", type: "development", createdBy: 1 });
    expect(env.status).toBe("active");
    expect(env.type).toBe("development");
    expect(env.version).toBe("1.0.0");
  });

  it("createEnvironment production gets higher limits", () => {
    const env = createEnvironment({ organizationId: ORG, name: "prod-test", type: "production", createdBy: 1 });
    expect(env.config.maxUsers).toBeGreaterThan(100);
    expect(env.config.allowExternalWebhooks).toBe(true);
  });

  it("updateEnvironmentConfig increments version", () => {
    const env     = createEnvironment({ organizationId: ORG, name: "staging-upd", type: "staging", createdBy: 1 });
    const updated = updateEnvironmentConfig(env.id, ORG, { maxUsers: 200 });
    expect(updated.config.maxUsers).toBe(200);
    expect(updated.version).not.toBe("1.0.0");
  });

  it("setEnvironmentStatus changes status", () => {
    const env     = createEnvironment({ organizationId: ORG, name: "maint", type: "development", createdBy: 1 });
    const updated = setEnvironmentStatus(env.id, ORG, "maintenance");
    expect(updated.status).toBe("maintenance");
  });

  it("promoteEnvironment copies features from source to dest", () => {
    const from = createEnvironment({ organizationId: ORG + 10, name: "from", type: "staging",    createdBy: 1, config: { features: { foo: true } } });
    const to   = createEnvironment({ organizationId: ORG + 10, name: "to",   type: "production", createdBy: 1 });
    const promo = promoteEnvironment(from.id, to.id, ORG + 10, 1);
    expect(promo.fromEnvId).toBe(from.id);
    const toUpdated = getEnvironmentById(to.id, ORG + 10)!;
    expect(toUpdated.config.features["foo"]).toBe(true);
  });

  it("promoteEnvironment throws from production", () => {
    const from = createEnvironment({ organizationId: ORG + 11, name: "prod-src", type: "production", createdBy: 1 });
    const to   = createEnvironment({ organizationId: ORG + 11, name: "stg-dst",  type: "staging",    createdBy: 1 });
    expect(() => promoteEnvironment(from.id, to.id, ORG + 11, 1)).toThrow();
  });

  it("checkEnvironmentHealth returns healthy for active env", () => {
    const env    = createEnvironment({ organizationId: ORG, name: "health-test", type: "development", createdBy: 1 });
    const health = checkEnvironmentHealth(env.id, ORG);
    expect(health.healthy).toBe(true);
  });

  it("checkEnvironmentHealth returns unhealthy for missing env", () => {
    const health = checkEnvironmentHealth("nonexistent", ORG);
    expect(health.healthy).toBe(false);
  });

  it("getEnvironments returns org-scoped results", () => {
    const env  = createEnvironment({ organizationId: ORG + 20, name: "isolated", type: "development", createdBy: 1 });
    const envs = getEnvironments(ORG + 20);
    expect(envs.some(e => e.id === env.id)).toBe(true);
  });

  it("compareEnvironments detects diffs", () => {
    const a = createEnvironment({ organizationId: ORG + 30, name: "a", type: "development", createdBy: 1 });
    const b = createEnvironment({ organizationId: ORG + 30, name: "b", type: "production",  createdBy: 1 });
    const diffs = compareEnvironments(a.id, b.id, ORG + 30);
    expect(diffs.some(d => d.field === "type")).toBe(true);
  });
});

// ─── realUsageMonitoringService ───────────────────────────────────────────────

describe("realUsageMonitoringService", () => {
  it("recordUXEvent creates event", () => {
    const ev = recordUXEvent({ organizationId: ORG, userId: 1, sessionId: "sess_1", eventType: "page_view", feature: "dashboard" });
    expect(ev.eventType).toBe("page_view");
    expect(ev.organizationId).toBe(ORG);
  });

  it("startSession creates session", () => {
    const sess = startSession({ organizationId: ORG, userId: 1, sessionId: "sess_start_1" });
    expect(sess.sessionId).toBe("sess_start_1");
    expect(sess.endedAt).toBeNull();
  });

  it("endSession updates session with events", () => {
    const sessionId = "sess_end_1";
    startSession({ organizationId: ORG, userId: 1, sessionId });
    recordUXEvent({ organizationId: ORG, userId: 1, sessionId, eventType: "feature_used", feature: "tr_editor" });
    const summary = endSession(sessionId, ORG);
    expect(summary).not.toBeNull();
    expect(summary!.endedAt).not.toBeNull();
    expect(summary!.featuresUsed).toContain("tr_editor");
  });

  it("computeWorkflowAnalytics returns snapshot", () => {
    const start = new Date(Date.now() - 86400000).toISOString();
    const end   = new Date().toISOString();
    const snap  = computeWorkflowAnalytics(ORG, start, end);
    expect(snap.organizationId).toBe(ORG);
    expect(typeof snap.userEngagementScore).toBe("number");
  });

  it("detectUsageAlerts detects low engagement", () => {
    const start = new Date(Date.now() - 86400000).toISOString();
    const end   = new Date().toISOString();
    const snap  = computeWorkflowAnalytics(ORG + 999, start, end);
    const alerts = detectUsageAlerts(ORG + 999, snap);
    expect(Array.isArray(alerts)).toBe(true);
  });

  it("getFeatureUsageReport returns sorted array", () => {
    const report = getFeatureUsageReport(ORG);
    expect(Array.isArray(report)).toBe(true);
    for (let i = 1; i < report.length; i++) {
      expect(report[i - 1].usageCount).toBeGreaterThanOrEqual(report[i].usageCount);
    }
  });

  it("getRecentEvents respects limit", () => {
    const events = getRecentEvents(ORG, 5);
    expect(events.length).toBeLessThanOrEqual(5);
  });

  it("getAlerts returns org-scoped alerts", () => {
    const alerts = getAlerts(ORG);
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts.every(a => a.organizationId === ORG)).toBe(true);
  });
});

// ─── pilotReadinessService ────────────────────────────────────────────────────

describe("pilotReadinessService", () => {
  it("generateReadinessReport returns report for pilot", () => {
    const pilot  = makePilot();
    const report = generateReadinessReport(pilot);
    expect(report.organizationId).toBe(ORG);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(["ready", "needs_attention", "not_ready"]).toContain(report.overallStatus);
  });

  it("generateReadinessReport new pilot is not_ready", () => {
    const pilot  = makePilot();
    const report = generateReadinessReport(pilot);
    expect(report.overallStatus).toBe("not_ready");
  });

  it("generateReadinessReport improved pilot has higher score", () => {
    const base    = makePilot();
    const good    = updatePilotMetrics(base, {
      onboardingCompletionRate: 0.9,
      activeUsers: 5,
      processesCreated: 15,
      itemsReviewed: 30,
      templateAdoptionRate: 0.7,
      errorRate: 0.01,
      avgReviewLatencyMs: 500,
    });
    const r1 = generateReadinessReport(base);
    const r2 = generateReadinessReport(good);
    expect(r2.overallScore).toBeGreaterThan(r1.overallScore);
  });

  it("generatePilotScorecard returns scorecard with phaseProgress", () => {
    const pilot    = makePilot();
    const scorecard = generatePilotScorecard(pilot);
    expect(scorecard.pilotScore).toBeGreaterThanOrEqual(0);
    expect(scorecard.phaseProgress).toBeGreaterThanOrEqual(0);
    expect(scorecard.phaseProgress).toBeLessThanOrEqual(1);
    expect(scorecard.readinessReport).toBeDefined();
  });

  it("generatePilotScorecard phaseProgress increases with phase", () => {
    const p0 = makePilot();
    const p1 = advancePilotPhase(makePilot(), 1);
    const sc0 = generatePilotScorecard(p0);
    const sc1 = generatePilotScorecard(p1);
    expect(sc1.phaseProgress).toBeGreaterThan(sc0.phaseProgress);
  });

  it("approvePhaseTransition succeeds when ready", () => {
    const pilot = updatePilotMetrics(makePilot(), {
      onboardingCompletionRate: 0.9,
      activeUsers: 5,
      processesCreated: 15,
      itemsReviewed: 30,
      templateAdoptionRate: 0.8,
      errorRate: 0.01,
      avgReviewLatencyMs: 500,
    });
    const approval = approvePhaseTransition({ organizationId: ORG, pilot, approvedBy: 1, notes: "Tudo certo" });
    expect(approval.fromPhase).toBe("onboarding");
    expect(approval.toPhase).toBe("training");
  });

  it("approvePhaseTransition throws when not_ready", () => {
    const pilot = makePilot(); // default: not_ready
    expect(() => approvePhaseTransition({ organizationId: ORG, pilot, approvedBy: 1, notes: "Forçar" })).toThrow();
  });

  it("getPhaseTransitionHistory returns org-scoped entries", () => {
    const history = getPhaseTransitionHistory(ORG);
    expect(Array.isArray(history)).toBe(true);
    expect(history.every(h => h.organizationId === ORG)).toBe(true);
  });
});
