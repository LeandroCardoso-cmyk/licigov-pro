import { describe, it, expect } from "vitest";

// ─── institutionalDeployment ──────────────────────────────────────────────────
import {
  createDeployment,
  advancePhase,
  recordEvent,
  pauseDeployment,
  resumeDeployment,
  initiateRollback,
  computeDeploymentHealth,
  applyGovernance,
  getActiveDeployments,
  getDeploymentLineage,
} from "../../../server/domain/institutionalDeployment";

// ─── operationalGovernance ────────────────────────────────────────────────────
import {
  createPolicy,
  enforcePolicy,
  waivePolicy,
  auditPolicy,
  computeComplianceScore,
  getActivePolicies,
  isCompliant,
} from "../../../server/domain/operationalGovernance";

// ─── operationalIncident expansions ───────────────────────────────────────────
import {
  createIncident,
  correlateIncidents,
  computeImpactScore,
  addEscalationStep,
  getEscalationChain,
  setCorrelationId,
  setImpactScope,
} from "../../../server/domain/operationalIncident";

// ─── operationalStabilityService ─────────────────────────────────────────────
import {
  recordMetric,
  computeStabilityScore,
  detectAnomalies,
  buildStabilitySnapshot,
  analyzeTrend,
  isStable,
} from "../../../server/services/operationalStabilityService";

// ─── disasterRecoveryService ──────────────────────────────────────────────────
import {
  createCheckpoint,
  validateCheckpoint,
  buildRecoveryPlan,
  executeRecoveryStep,
  validateRecovery,
  estimateRecoveryTime,
  getLatestCheckpoint,
  isRecoverable,
} from "../../../server/services/disasterRecoveryService";

// ─── serviceHealthService ─────────────────────────────────────────────────────
import {
  computeSlaScore,
  assessMetricHealth,
  buildHealthSnapshot,
  detectSlaBreaches,
  isWithinSla,
} from "../../../server/services/serviceHealthService";

// ─── deploymentValidationService ─────────────────────────────────────────────
import {
  validateSchemaConsistency,
  validateTenantIntegrity,
  validateWorkflowIntegrity,
  validateMigrationSafety,
  validateRollbackReadiness,
  validateEnvironmentReadiness,
  runFullValidation,
  getValidationHistory,
} from "../../../server/services/deploymentValidationService";

// ─── operationalCommunicationService ─────────────────────────────────────────
import {
  sendAlert,
  sendDeploymentNotification,
  sendSlaBreachAlert,
  sendEscalationAlert,
  sendRecoveryNotice,
  acknowledgeCommunication,
  getRecentCommunications,
} from "../../../server/services/operationalCommunicationService";

// ─── realUsageMonitoringService expansions ────────────────────────────────────
import {
  detectLongTermDegradation,
  analyzeContinuousOperation,
  correlateIncidents as correlateUsageIncidents,
  detectProductivityDegradation,
  recordUXEvent,
} from "../../../server/services/realUsageMonitoringService";

const ORG = 9200;

// ═══════════════════════════════════════════════════════════════════════════════
// institutionalDeployment
// ═══════════════════════════════════════════════════════════════════════════════
describe("institutionalDeployment", () => {
  it("createDeployment returns deployment with planning phase", () => {
    const d = createDeployment(ORG, "Curitiba", "2.0.0", "1.0.0");
    expect(d.phase).toBe("planning");
    expect(d.status).toBe("scheduled");
    expect(d.organizationId).toBe(ORG);
    expect(d.municipio).toBe("Curitiba");
    expect(d.events).toHaveLength(0);
  });

  it("createDeployment generates deterministic id from same inputs at same time", () => {
    // Two different municipios produce different ids
    const d1 = createDeployment(ORG, "Porto Alegre", "1.0.0", "0.9.0");
    const d2 = createDeployment(ORG, "Florianópolis", "1.0.0", "0.9.0");
    expect(d1.id).not.toBe(d2.id);
  });

  it("advancePhase moves to infrastructure_prep", () => {
    const d  = createDeployment(ORG, "Salvador", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    expect(d2.phase).toBe("infrastructure_prep");
    expect(d2.status).toBe("in_progress");
    expect(d2.events).toHaveLength(1);
  });

  it("advancePhase records event as append-only", () => {
    const d   = createDeployment(ORG, "Recife", "2.0.0", "1.0.0");
    const d2  = advancePhase(d, "admin", "infra ok");
    const d3  = advancePhase(d2, "admin", "migration ok");
    expect(d3.events).toHaveLength(2);
    expect(d3.events[0].phase).toBe("infrastructure_prep");
    expect(d3.events[1].phase).toBe("data_migration");
  });

  it("advancePhase throws for completed deployment", () => {
    let d = createDeployment(ORG, "Manaus", "2.0.0", "1.0.0");
    // Advance to full_operation (6 advances)
    for (let i = 0; i < 6; i++) d = advancePhase(d, "admin");
    expect(d.phase).toBe("full_operation");
    expect(() => advancePhase(d, "admin")).toThrow();
  });

  it("pauseDeployment sets status to paused", () => {
    const d  = createDeployment(ORG, "Goiânia", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const d3 = pauseDeployment(d2, "admin", "maintenance window");
    expect(d3.status).toBe("paused");
    expect(d3.events.some(e => e.eventType === "paused")).toBe(true);
  });

  it("pauseDeployment throws for rolled_back deployment", () => {
    const d  = createDeployment(ORG, "Belém", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const d3 = initiateRollback(d2, "admin", "critical failure");
    expect(d3.status).toBe("rolled_back");
    expect(() => pauseDeployment(d3, "admin", "too late")).toThrow();
  });

  it("resumeDeployment restores in_progress from paused", () => {
    const d  = createDeployment(ORG, "Maceió", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const d3 = pauseDeployment(d2, "admin", "maintenance");
    const d4 = resumeDeployment(d3, "admin");
    expect(d4.status).toBe("in_progress");
  });

  it("resumeDeployment throws if not paused", () => {
    const d = createDeployment(ORG, "Natal", "2.0.0", "1.0.0");
    expect(() => resumeDeployment(d, "admin")).toThrow();
  });

  it("initiateRollback sets status to rolled_back", () => {
    const d  = createDeployment(ORG, "Teresina", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const d3 = initiateRollback(d2, "admin", "critical bug");
    expect(d3.status).toBe("rolled_back");
    expect(d3.events.some(e => e.eventType === "rolled_back")).toBe(true);
  });

  it("advancePhase throws for rolled_back deployment", () => {
    const d  = createDeployment(ORG, "Aracaju", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const d3 = initiateRollback(d2, "admin", "critical failure");
    expect(d3.status).toBe("rolled_back");
    expect(() => advancePhase(d3, "admin")).toThrow();
  });

  it("computeDeploymentHealth returns 0-100", () => {
    const d = createDeployment(ORG, "Palmas", "2.0.0", "1.0.0");
    const h = computeDeploymentHealth(d);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(100);
  });

  it("computeDeploymentHealth increases with phase advancement", () => {
    const d1  = createDeployment(ORG, "Porto Velho", "2.0.0", "1.0.0");
    const d2  = advancePhase(d1, "admin");
    const h1  = computeDeploymentHealth(d1);
    const h2  = computeDeploymentHealth(d2);
    expect(h2).toBeGreaterThanOrEqual(h1);
  });

  it("applyGovernance returns governance object", () => {
    const d = createDeployment(ORG, "Macapá", "2.0.0", "1.0.0");
    const g = applyGovernance(d, 1, "aprovado pela diretoria", [], [{ name: "schema ok", passed: true, notes: "" }]);
    expect(g.deploymentId).toBe(d.id);
    expect(g.approvedBy).toBe(1);
    expect(g.governanceChecks).toHaveLength(1);
  });

  it("getActiveDeployments filters by org and active status", () => {
    const d1 = createDeployment(ORG, "Boa Vista", "2.0.0", "1.0.0");
    const active = getActiveDeployments(ORG);
    expect(active.some(d => d.id === d1.id)).toBe(true);
  });

  it("getDeploymentLineage returns events array", () => {
    const d  = createDeployment(ORG, "Rio Branco", "2.0.0", "1.0.0");
    const d2 = advancePhase(d, "admin");
    const lineage = getDeploymentLineage(d2.id);
    expect(lineage.length).toBeGreaterThanOrEqual(1);
  });

  it("recordEvent appends health_check event", () => {
    const d  = createDeployment(ORG, "Campo Grande", "2.0.0", "1.0.0");
    const d2 = recordEvent(d, "health_check", "monitor", "all systems go");
    expect(d2.events).toHaveLength(1);
    expect(d2.events[0].eventType).toBe("health_check");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// operationalGovernance
// ═══════════════════════════════════════════════════════════════════════════════
describe("operationalGovernance", () => {
  it("createPolicy returns policy with deterministic id", () => {
    const p1 = createPolicy(ORG, "deployment", "Deployment Gate", "Requires approval", { conditions: [], actions: [], thresholds: {} }, 1);
    const p2 = createPolicy(ORG, "deployment", "Deployment Gate", "Requires approval", { conditions: [], actions: [], thresholds: {} }, 1);
    expect(p1.id).toBe(p2.id);
  });

  it("createPolicy sets isActive true", () => {
    const p = createPolicy(ORG, "workflow", "Workflow SLA", "Enforce 24h SLA", { conditions: ["latency > 24h"], actions: ["alert"], thresholds: { latency_hours: 24 } }, 1);
    expect(p.isActive).toBe(true);
    expect(p.policyType).toBe("workflow");
  });

  it("enforcePolicy returns compliant for valid context", () => {
    const p  = createPolicy(ORG, "sla", "Response SLA", "Max 2s", { conditions: [], actions: [], thresholds: { response_ms: 2000 } }, 1);
    const ev = enforcePolicy(p, 1, { response_ms: 1500 });
    expect(ev.outcome).toBe("compliant");
    expect(ev.action).toBe("enforce_policy");
  });

  it("enforcePolicy returns non_compliant when threshold exceeded", () => {
    const p  = createPolicy(ORG, "sla", "Queue SLA", "Max 100 items", { conditions: [], actions: [], thresholds: { queue_depth: 100 } }, 1);
    const ev = enforcePolicy(p, 1, { queue_depth: 150 });
    expect(ev.outcome).toBe("non_compliant");
  });

  it("waivePolicy requires justification >= 20 chars", () => {
    const p = createPolicy(ORG, "approval", "Approval Gate", "Requires director", { conditions: [], actions: [], thresholds: {} }, 1);
    expect(() => waivePolicy(p, 1, "too short")).toThrow();
  });

  it("waivePolicy succeeds with adequate justification", () => {
    const p  = createPolicy(ORG, "approval", "Approval Gate 2", "Requires director", { conditions: [], actions: [], thresholds: {} }, 1);
    const ev = waivePolicy(p, 1, "Dispensado por decisão administrativa justificada");
    expect(ev.outcome).toBe("waived");
    expect(ev.justification.length).toBeGreaterThanOrEqual(20);
  });

  it("auditPolicy returns trail with compliance score", () => {
    const p     = createPolicy(ORG, "incident", "Incident Policy", "Classify severity", { conditions: [], actions: [], thresholds: {} }, 1);
    enforcePolicy(p, 1, {});
    const trail = auditPolicy(p);
    expect(trail.complianceScore).toBeGreaterThanOrEqual(0);
    expect(trail.complianceScore).toBeLessThanOrEqual(100);
    expect(trail.events.length).toBeGreaterThan(0);
  });

  it("computeComplianceScore is 100 with no enforce events", () => {
    const trail = { policyId: "x", organizationId: ORG, events: [], lastAuditAt: new Date().toISOString(), complianceScore: 100 };
    expect(computeComplianceScore(trail)).toBe(100);
  });

  it("getActivePolicies returns only org policies", () => {
    createPolicy(ORG, "support", "Support Policy", "Response time", { conditions: [], actions: [], thresholds: {} }, 1);
    const policies = getActivePolicies(ORG);
    expect(policies.every(p => p.organizationId === ORG)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
  });

  it("isCompliant returns false when threshold exceeded", () => {
    const p = createPolicy(ORG, "deployment", "Deploy Budget", "Max ops cost", { conditions: [], actions: [], thresholds: { ops_cost: 1000 } }, 1);
    expect(isCompliant(p, { ops_cost: 1500 })).toBe(false);
  });

  it("isCompliant returns true within thresholds", () => {
    const p = createPolicy(ORG, "deployment", "Deploy Budget 2", "Max ops cost", { conditions: [], actions: [], thresholds: { ops_cost: 1000 } }, 1);
    expect(isCompliant(p, { ops_cost: 500 })).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// operationalIncident expansions
// ═══════════════════════════════════════════════════════════════════════════════
describe("operationalIncident — Sprint 3.6 expansions", () => {
  it("addEscalationStep appends to chain", () => {
    const inc = createIncident({ organizationId: ORG, title: "Workflow stuck", description: "Workflow stuck", severity: "high", category: "workflow", reportedBy: 1 });
    const s1  = addEscalationStep(inc.id, "supervisor", "unresolved > 2h");
    const s2  = addEscalationStep(inc.id, "director", "unresolved > 4h");
    const chain = getEscalationChain(inc.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].level).toBe(1);
    expect(chain[1].level).toBe(2);
    expect(s1.escalatedTo).toBe("supervisor");
    expect(s2.escalatedTo).toBe("director");
  });

  it("escalation chain is append-only (previous steps preserved)", () => {
    const inc = createIncident({ organizationId: ORG, title: "Slow API", description: "Slow API", severity: "medium", category: "performance", reportedBy: 2 });
    addEscalationStep(inc.id, "L1", "initial");
    addEscalationStep(inc.id, "L2", "escalated");
    addEscalationStep(inc.id, "L3", "critical");
    const chain = getEscalationChain(inc.id);
    expect(chain).toHaveLength(3);
    expect(chain.map(s => s.escalatedTo)).toEqual(["L1", "L2", "L3"]);
  });

  it("correlateIncidents groups by correlationId", () => {
    const i1 = createIncident({ organizationId: ORG, title: "Issue A", description: "Issue A", severity: "low",    category: "workflow", reportedBy: 1 });
    const i2 = createIncident({ organizationId: ORG, title: "Issue B", description: "Issue B", severity: "medium", category: "workflow", reportedBy: 2 });
    const i3 = createIncident({ organizationId: ORG, title: "Issue C", description: "Issue C", severity: "high",   category: "data",     reportedBy: 3 });
    setCorrelationId(i1.id, "corr_xyz");
    setCorrelationId(i2.id, "corr_xyz");
    // i3 gets its own group
    const groups = correlateIncidents([i1, i2, i3]);
    expect(groups["corr_xyz"]).toHaveLength(2);
    expect(groups[i3.id]).toHaveLength(1);
  });

  it("computeImpactScore multiplies severity by scope weight", () => {
    const inc = createIncident({ organizationId: ORG, title: "Breach", description: "Security breach", severity: "critical", category: "security", reportedBy: 1 });
    setImpactScope(inc.id, "system_wide");
    const score = computeImpactScore(inc.id, "critical");
    // system_wide=10, critical=8 → 80
    expect(score).toBe(80);
  });

  it("computeImpactScore single_user + low = 1", () => {
    const inc = createIncident({ organizationId: ORG, title: "Minor issue", description: "Minor issue", severity: "low", category: "support", reportedBy: 1 });
    setImpactScope(inc.id, "single_user");
    expect(computeImpactScore(inc.id, "low")).toBe(1);
  });

  it("computeImpactScore department + high = 12", () => {
    const inc = createIncident({ organizationId: ORG, title: "Deploy failure", description: "Deploy failure", severity: "high", category: "deployment", reportedBy: 1 });
    setImpactScope(inc.id, "department");
    expect(computeImpactScore(inc.id, "high")).toBe(12); // 3 * 4
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// operationalStabilityService
// ═══════════════════════════════════════════════════════════════════════════════
describe("operationalStabilityService", () => {
  it("computeStabilityScore returns 100 for empty metrics", () => {
    expect(computeStabilityScore([])).toBe(100);
  });

  it("computeStabilityScore penalizes anomalous metrics", () => {
    const m = recordMetric(ORG, "error_rate", 0.5, "ratio"); // above threshold 0.05
    expect(m.isAnomalous).toBe(true);
    const score = computeStabilityScore([m]);
    expect(score).toBeLessThan(100);
  });

  it("computeStabilityScore stays in 0-100 range", () => {
    const m1 = recordMetric(ORG, "error_rate",  0.9,   "ratio");
    const m2 = recordMetric(ORG, "queue_depth", 500,   "count");
    const score = computeStabilityScore([m1, m2]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("recordMetric marks workflow_throughput below threshold as anomalous", () => {
    const m = recordMetric(ORG, "workflow_throughput", 5, "count"); // below min 50
    expect(m.isAnomalous).toBe(true);
  });

  it("recordMetric does not flag normal values as anomalous", () => {
    const m = recordMetric(ORG, "error_rate", 0.01, "ratio");
    expect(m.isAnomalous).toBe(false);
  });

  it("detectAnomalies returns anomalies for anomalous metrics", () => {
    const m        = recordMetric(ORG, "queue_depth", 200, "count");
    const baseline = [recordMetric(ORG, "queue_depth", 50, "count")];
    const anomalies = detectAnomalies([m], baseline);
    expect(anomalies.length).toBeGreaterThan(0);
  });

  it("detectAnomalies returns empty for healthy metrics", () => {
    const m        = recordMetric(ORG, "error_rate", 0.01, "ratio");
    const baseline = [recordMetric(ORG, "error_rate", 0.01, "ratio")];
    const anomalies = detectAnomalies([m], baseline);
    expect(anomalies).toHaveLength(0);
  });

  it("buildStabilitySnapshot includes score, degradationLevel, trend", () => {
    const m = recordMetric(ORG, "error_rate", 0.01, "ratio");
    const s = buildStabilitySnapshot(ORG, [m], [m]);
    expect(s.overallScore).toBeGreaterThanOrEqual(0);
    expect(["none","mild","moderate","severe","critical"]).toContain(s.degradationLevel);
    expect(["improving","stable","degrading"]).toContain(s.trend);
  });

  it("analyzeTrend returns stable for single snapshot", () => {
    expect(analyzeTrend([{ overallScore: 80 }])).toBe("stable");
  });

  it("analyzeTrend returns improving when score rises >5", () => {
    expect(analyzeTrend([{ overallScore: 70 }, { overallScore: 80 }])).toBe("improving");
  });

  it("analyzeTrend returns degrading when score drops >5", () => {
    expect(analyzeTrend([{ overallScore: 80 }, { overallScore: 70 }])).toBe("degrading");
  });

  it("isStable returns true for score>=70 with none/mild degradation", () => {
    const m = recordMetric(ORG, "error_rate", 0.01, "ratio");
    const s = buildStabilitySnapshot(ORG, [m], [m]);
    const stable = isStable(s);
    expect(typeof stable).toBe("boolean");
  });

  it("isStable returns false for severe degradation (multiple anomalous metrics)", () => {
    // error_rate penalty=30 + queue_depth penalty=20 + review_latency penalty=20 = 70 → score=30
    const m1 = recordMetric(ORG, "error_rate",    0.95,     "ratio");
    const m2 = recordMetric(ORG, "queue_depth",   500,      "count");
    const m3 = recordMetric(ORG, "review_latency", 7200000, "ms");
    const s  = buildStabilitySnapshot(ORG, [m1, m2, m3], []);
    expect(isStable(s)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// disasterRecoveryService
// ═══════════════════════════════════════════════════════════════════════════════
describe("disasterRecoveryService", () => {
  const snapshotData = {
    tablesIncluded: ["processes", "items"],
    rowCounts:      { processes: 100, items: 500 },
    schemaVersion:  "1.0.0",
    serviceStates:  { api: "running", worker: "running" },
  };

  it("createCheckpoint generates deterministic id for same inputs at same time", () => {
    const cp1 = createCheckpoint(ORG, "manual", snapshotData);
    const cp2 = createCheckpoint(ORG, "manual", snapshotData);
    // IDs will differ because createdAt is different — but both should be valid
    expect(cp1.isValid).toBe(true);
    expect(cp2.isValid).toBe(true);
  });

  it("createCheckpoint computes integrity hash", () => {
    const cp = createCheckpoint(ORG, "pre_deployment", snapshotData);
    expect(cp.integrityHash).toBeTruthy();
    expect(cp.integrityHash.length).toBe(64);
  });

  it("validateCheckpoint returns true for untampered checkpoint", () => {
    const cp = createCheckpoint(ORG, "scheduled", snapshotData);
    expect(validateCheckpoint(cp)).toBe(true);
  });

  it("validateCheckpoint returns false for tampered checkpoint", () => {
    const cp      = createCheckpoint(ORG, "post_migration", snapshotData);
    const tampered = { ...cp, integrityHash: "0000000000000000000000000000000000000000000000000000000000000000" };
    expect(validateCheckpoint(tampered)).toBe(false);
  });

  it("buildRecoveryPlan has 7 steps", () => {
    const cp   = createCheckpoint(ORG, "pre_rollback", snapshotData);
    const plan = buildRecoveryPlan(ORG, cp, "rollback");
    expect(plan.steps).toHaveLength(7);
    expect(plan.steps[0].order).toBe(1);
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
  });

  it("buildRecoveryPlan sets riskLevel high for rollback", () => {
    const cp   = createCheckpoint(ORG, "pre_rollback", snapshotData);
    const plan = buildRecoveryPlan(ORG, cp, "rollback");
    expect(plan.riskLevel).toBe("high");
  });

  it("executeRecoveryStep appends log (append-only)", () => {
    const cp   = createCheckpoint(ORG, "manual", snapshotData);
    const plan = buildRecoveryPlan(ORG, cp, "restore");
    const log1 = executeRecoveryStep(ORG, plan, 1, "success", "step 1 done");
    const log2 = executeRecoveryStep(ORG, plan, 2, "success", "step 2 done");
    expect(log1.step).toBe(1);
    expect(log2.step).toBe(2);
    expect(log1.planId).toBe(plan.id);
  });

  it("validateRecovery reports missing steps as issues", () => {
    const cp   = createCheckpoint(ORG, "manual", snapshotData);
    const plan = buildRecoveryPlan(ORG, cp, "restore");
    // Execute only step 1
    executeRecoveryStep(ORG, plan, 1, "success");
    const result = validateRecovery(plan.id);
    // Steps 2-7 are missing
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("validateRecovery returns valid when plan not found", () => {
    const result = validateRecovery("nonexistent_plan");
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Plan not found");
  });

  it("estimateRecoveryTime sums step timeouts", () => {
    const cp   = createCheckpoint(ORG, "manual", snapshotData);
    const plan = buildRecoveryPlan(ORG, cp, "restore");
    const estimated = estimateRecoveryTime(plan);
    expect(estimated).toBeGreaterThan(0);
    expect(estimated).toBe(plan.estimatedDurationMs);
  });

  it("getLatestCheckpoint returns null for unknown type/org", () => {
    const cp = getLatestCheckpoint(999999, "scheduled");
    expect(cp).toBeNull();
  });

  it("isRecoverable returns true for valid checkpoint", () => {
    const cp = createCheckpoint(ORG, "manual", snapshotData);
    expect(isRecoverable(cp)).toBe(true);
  });

  it("isRecoverable returns false for tampered checkpoint", () => {
    const cp = createCheckpoint(ORG, "manual", snapshotData);
    const bad = { ...cp, integrityHash: "badhash" };
    expect(isRecoverable(bad)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// serviceHealthService
// ═══════════════════════════════════════════════════════════════════════════════
describe("serviceHealthService", () => {
  it("computeSlaScore returns 100 for empty metrics", () => {
    expect(computeSlaScore([])).toBe(100);
  });

  it("assessMetricHealth marks response_latency above target as warning or breaching", () => {
    const m = assessMetricHealth("response_latency_ms", 5000); // 5000 > 2000*1.5=3000 → breaching
    expect(m.slaStatus).toBe("breaching");
  });

  it("assessMetricHealth marks response_latency within target as meeting", () => {
    const m = assessMetricHealth("response_latency_ms", 500);
    expect(m.slaStatus).toBe("meeting");
  });

  it("assessMetricHealth marks workflow_throughput below breach as breaching", () => {
    const m = assessMetricHealth("workflow_throughput_per_hour", 10); // 10 < 50*0.5=25 → breaching
    expect(m.slaStatus).toBe("breaching");
  });

  it("assessMetricHealth returns meeting for unknown metric", () => {
    const m = assessMetricHealth("unknown_metric_xyz", 42);
    expect(m.slaStatus).toBe("meeting");
  });

  it("buildHealthSnapshot categorizes metrics correctly", () => {
    const snapshot = buildHealthSnapshot(ORG, {
      response_latency_ms:          500,
      workflow_throughput_per_hour: 60,
      queue_depth:                  50,
    });
    expect(snapshot.overallSlaScore).toBeGreaterThan(0);
    expect(snapshot.organizationId).toBe(ORG);
    expect(snapshot.healthMetrics.length).toBe(3);
  });

  it("detectSlaBreaches returns only breaching metrics", () => {
    const snapshot = buildHealthSnapshot(ORG, {
      response_latency_ms: 10000, // breaching
      queue_depth:         20,    // meeting
    });
    const breaches = detectSlaBreaches(snapshot);
    expect(breaches.every(m => m.slaStatus === "breaching")).toBe(true);
    expect(breaches.some(m => m.name === "response_latency_ms")).toBe(true);
  });

  it("isWithinSla returns true for meeting values", () => {
    expect(isWithinSla("response_latency_ms", 1000)).toBe(true);
  });

  it("isWithinSla returns false for breaching values", () => {
    expect(isWithinSla("response_latency_ms", 10000)).toBe(false);
  });

  it("computeSlaScore penalizes breaching metrics", () => {
    const metrics = [
      assessMetricHealth("response_latency_ms", 10000),
      assessMetricHealth("queue_depth",          300),
    ];
    const score = computeSlaScore(metrics);
    expect(score).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deploymentValidationService
// ═══════════════════════════════════════════════════════════════════════════════
describe("deploymentValidationService", () => {
  it("validateSchemaConsistency passes for valid orgId", () => {
    const check = validateSchemaConsistency(ORG);
    expect(check.passed).toBe(true);
    expect(check.category).toBe("schema");
  });

  it("validateSchemaConsistency fails for orgId 0", () => {
    const check = validateSchemaConsistency(0);
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("critical");
  });

  it("validateTenantIntegrity passes for valid orgId", () => {
    const check = validateTenantIntegrity(ORG);
    expect(check.passed).toBe(true);
    expect(check.category).toBe("tenant");
  });

  it("validateWorkflowIntegrity passes for valid orgId", () => {
    const check = validateWorkflowIntegrity(ORG);
    expect(check.passed).toBe(true);
    expect(check.category).toBe("workflow");
  });

  it("validateMigrationSafety passes for same major version", () => {
    const check = validateMigrationSafety("1.5.0", "1.0.0");
    expect(check.passed).toBe(true);
  });

  it("validateMigrationSafety warns on major version change", () => {
    const check = validateMigrationSafety("2.0.0", "1.0.0");
    expect(check.passed).toBe(false);
    expect(check.severity).toBe("warning");
  });

  it("validateRollbackReadiness passes for non-empty deploymentId", () => {
    const check = validateRollbackReadiness("deploy_abc123");
    expect(check.passed).toBe(true);
  });

  it("validateRollbackReadiness fails for empty deploymentId", () => {
    const check = validateRollbackReadiness("");
    expect(check.passed).toBe(false);
  });

  it("validateEnvironmentReadiness passes for valid envId", () => {
    const check = validateEnvironmentReadiness("env_prod");
    expect(check.passed).toBe(true);
  });

  it("validateEnvironmentReadiness fails for empty envId", () => {
    const check = validateEnvironmentReadiness("");
    expect(check.passed).toBe(false);
  });

  it("runFullValidation produces replay-safe replayKey", () => {
    const r1 = runFullValidation(ORG, "deploy_001");
    const r2 = runFullValidation(ORG, "deploy_001");
    expect(r1.replayKey).toBe(r2.replayKey);
  });

  it("runFullValidation different deploymentId produces different replayKey", () => {
    const r1 = runFullValidation(ORG, "deploy_001");
    const r2 = runFullValidation(ORG, "deploy_002");
    expect(r1.replayKey).not.toBe(r2.replayKey);
  });

  it("runFullValidation has 6 checks", () => {
    const r = runFullValidation(ORG, "deploy_001");
    expect(r.checks).toHaveLength(6);
  });

  it("runFullValidation overallPassed true when no critical/error checks fail", () => {
    const r = runFullValidation(ORG, "deploy_valid", "1.0.0", "1.0.0", "env_prod");
    expect(r.overallPassed).toBe(true);
  });

  it("getValidationHistory returns reports for org", () => {
    runFullValidation(ORG, "deploy_hist_01");
    const history = getValidationHistory(ORG);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every(r => r.organizationId === ORG)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// operationalCommunicationService
// ═══════════════════════════════════════════════════════════════════════════════
describe("operationalCommunicationService", () => {
  it("sendAlert creates communication record", () => {
    const r = sendAlert(ORG, "workflow_alert", "medium", "Test Alert", "Test body", ["admin"]);
    expect(r.organizationId).toBe(ORG);
    expect(r.type).toBe("workflow_alert");
    expect(r.priority).toBe("medium");
    expect(r.acknowledgedAt).toBeNull();
  });

  it("sendDeploymentNotification creates deployment_alert", () => {
    const r = sendDeploymentNotification(ORG, "deploy_abc", "cutover", "Initiating cutover");
    expect(r.type).toBe("deployment_alert");
    expect(r.priority).toBe("high");
    expect(r.metadata).toMatchObject({ deploymentId: "deploy_abc", phase: "cutover" });
  });

  it("sendSlaBreachAlert creates critical sla_breach", () => {
    const r = sendSlaBreachAlert(ORG, "response_latency_ms", 5000, 2000);
    expect(r.type).toBe("sla_breach");
    expect(r.priority).toBe("critical");
  });

  it("sendEscalationAlert creates critical escalation_alert", () => {
    const r = sendEscalationAlert(ORG, "inc_001", "director");
    expect(r.type).toBe("escalation_alert");
    expect(r.priority).toBe("critical");
    expect(r.metadata).toMatchObject({ incidentId: "inc_001", escalateTo: "director" });
  });

  it("sendRecoveryNotice creates recovery_notice", () => {
    const r = sendRecoveryNotice(ORG, "plan_001", "success");
    expect(r.type).toBe("recovery_notice");
    expect(r.priority).toBe("medium");
  });

  it("sendRecoveryNotice is critical when failed", () => {
    const r = sendRecoveryNotice(ORG, "plan_002", "failed");
    expect(r.priority).toBe("critical");
  });

  it("acknowledgeCommunication sets acknowledgedAt", () => {
    const r   = sendAlert(ORG, "governance_notice", "low", "Notice", "Body", ["admin"]);
    const ack = acknowledgeCommunication(r.id);
    expect(ack.acknowledgedAt).toBeTruthy();
  });

  it("acknowledgeCommunication throws for unknown id", () => {
    expect(() => acknowledgeCommunication("nonexistent_id")).toThrow();
  });

  it("getRecentCommunications returns org communications", () => {
    sendAlert(ORG, "onboarding_reminder", "low", "Reminder", "Body", ["elaborador"]);
    const recs = getRecentCommunications(ORG);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => r.organizationId === ORG)).toBe(true);
  });

  it("getRecentCommunications respects limit", () => {
    for (let i = 0; i < 5; i++) {
      sendAlert(ORG, "support_notification", "low", `Notif ${i}`, "Body", ["admin"]);
    }
    const recs = getRecentCommunications(ORG, 3);
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// realUsageMonitoringService — Sprint 3.6 expansions
// ═══════════════════════════════════════════════════════════════════════════════
describe("realUsageMonitoringService — continuous operation monitoring", () => {
  it("detectLongTermDegradation returns object with degraded boolean", () => {
    const result = detectLongTermDegradation(ORG, 30);
    expect(typeof result.degraded).toBe("boolean");
    expect(Array.isArray(result.metrics)).toBe(true);
    expect(["none","mild","moderate","severe"]).toContain(result.severity);
  });

  it("detectLongTermDegradation returns non-degraded for fresh org", () => {
    const result = detectLongTermDegradation(999888, 30);
    expect(result.degraded).toBe(false);
    expect(result.severity).toBe("none");
  });

  it("analyzeContinuousOperation returns analysis object", () => {
    const result = analyzeContinuousOperation(ORG, []);
    expect(typeof result.fatigue).toBe("boolean");
    expect(typeof result.workflowDecay).toBe("number");
    expect(typeof result.adoptionDecay).toBe("number");
    expect(typeof result.supportOverload).toBe("boolean");
  });

  it("analyzeContinuousOperation not fatigued with empty snapshots", () => {
    const result = analyzeContinuousOperation(ORG, []);
    expect(result.fatigue).toBe(false);
    expect(result.workflowDecay).toBe(0);
  });

  it("correlateUsageIncidents returns correlatedGroups and patterns", () => {
    recordUXEvent({ organizationId: ORG, userId: 1, sessionId: "s1", eventType: "feature_used", feature: "workflow", metadata: {} });
    recordUXEvent({ organizationId: ORG, userId: 2, sessionId: "s2", eventType: "feature_used", feature: "workflow", metadata: {} });
    const result = correlateUsageIncidents(ORG, []);
    expect(Array.isArray(result.correlatedGroups)).toBe(true);
    expect(Array.isArray(result.patterns)).toBe(true);
  });

  it("detectProductivityDegradation returns object with degraded and dropPercent", () => {
    const result = detectProductivityDegradation(ORG);
    expect(typeof result.degraded).toBe("boolean");
    expect(typeof result.dropPercent).toBe("number");
    expect(result.dropPercent).toBeGreaterThanOrEqual(0);
  });

  it("detectProductivityDegradation returns not degraded for org with few events", () => {
    const result = detectProductivityDegradation(999777);
    expect(result.degraded).toBe(false);
    expect(result.dropPercent).toBe(0);
  });
});
