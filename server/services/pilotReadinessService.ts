/**
 * Sprint 3.4 — Pilot Readiness Service.
 *
 * Avaliacao de prontidao para rollout de prefeitura piloto.
 * Verifica criterios tecnicos, operacionais e de adocao antes
 * de avancar entre fases do piloto.
 */

import type { PilotOrganization, PilotPhase } from "../domain/pilotOrganization";
import { evaluatePilotHealth, isPilotReadyForNextPhase, computePilotScore, PILOT_PHASE_ORDER } from "../domain/pilotOrganization";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadinessCategoryType =
  | "technical"
  | "operational"
  | "adoption"
  | "governance"
  | "security";

export type ReadinessStatus = "pass" | "warn" | "fail" | "skipped";

export interface ReadinessCheckResult {
  id:          string;
  category:    ReadinessCategoryType;
  name:        string;
  status:      ReadinessStatus;
  score:       number; // 0-100
  message:     string;
  remediation: string | null;
}

export interface ReadinessReport {
  organizationId:  number;
  pilotPhase:      PilotPhase;
  overallScore:    number; // 0-100
  overallStatus:   "ready" | "needs_attention" | "not_ready";
  checks:          ReadinessCheckResult[];
  blockers:        string[];
  recommendations: string[];
  generatedAt:     string;
}

export interface PhaseTransitionApproval {
  id:              string;
  organizationId:  number;
  fromPhase:       PilotPhase;
  toPhase:         PilotPhase;
  approvedBy:      number;
  readinessScore:  number;
  notes:           string;
  approvedAt:      string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _approvals: PhaseTransitionApproval[] = [];
let   _counter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_counter}`;
}

// ─── Core checks ─────────────────────────────────────────────────────────────

function technicalChecks(pilot: PilotOrganization): ReadinessCheckResult[] {
  const { metrics, health } = pilot;
  const results: ReadinessCheckResult[] = [];

  // Error rate
  const errStatus: ReadinessStatus =
    metrics.errorRate > 0.3 ? "fail" : metrics.errorRate > 0.1 ? "warn" : "pass";
  results.push({
    id:          "tech_error_rate",
    category:    "technical",
    name:        "Taxa de Erro",
    status:      errStatus,
    score:       errStatus === "pass" ? 100 : errStatus === "warn" ? 50 : 0,
    message:     `Taxa atual: ${(metrics.errorRate * 100).toFixed(1)}%`,
    remediation: errStatus !== "pass" ? "Investigar e corrigir erros recorrentes no sistema." : null,
  });

  // Latency
  const latStatus: ReadinessStatus =
    metrics.avgReviewLatencyMs > 10000 ? "fail" : metrics.avgReviewLatencyMs > 5000 ? "warn" : "pass";
  results.push({
    id:          "tech_latency",
    category:    "technical",
    name:        "Latencia de Revisao",
    status:      latStatus,
    score:       latStatus === "pass" ? 100 : latStatus === "warn" ? 60 : 0,
    message:     `Latencia media: ${metrics.avgReviewLatencyMs}ms`,
    remediation: latStatus !== "pass" ? "Otimizar pipelines de processamento e consultas ao banco." : null,
  });

  // System health
  const healthScore = health.status === "healthy" ? 100 : health.status === "degraded" ? 50 : 0;
  results.push({
    id:          "tech_health",
    category:    "technical",
    name:        "Saude do Sistema",
    status:      health.status === "healthy" ? "pass" : health.status === "degraded" ? "warn" : "fail",
    score:       healthScore,
    message:     `Status: ${health.status}. ${health.issues.length > 0 ? health.issues.join("; ") : "Sem problemas."}`,
    remediation: health.issues.length > 0 ? "Resolver problemas listados em health.issues." : null,
  });

  return results;
}

function operationalChecks(pilot: PilotOrganization): ReadinessCheckResult[] {
  const { metrics } = pilot;
  const results: ReadinessCheckResult[] = [];

  // Active users
  const userStatus: ReadinessStatus = metrics.activeUsers >= 3 ? "pass" : metrics.activeUsers >= 1 ? "warn" : "fail";
  results.push({
    id:          "ops_active_users",
    category:    "operational",
    name:        "Usuarios Ativos",
    status:      userStatus,
    score:       Math.min(100, metrics.activeUsers * 20),
    message:     `${metrics.activeUsers} usuario(s) ativo(s)`,
    remediation: userStatus !== "pass" ? "Aumentar engajamento e treinamento de usuarios." : null,
  });

  // Processes created
  const procStatus: ReadinessStatus = metrics.processesCreated >= 10 ? "pass" : metrics.processesCreated >= 3 ? "warn" : "fail";
  results.push({
    id:          "ops_processes",
    category:    "operational",
    name:        "Processos Criados",
    status:      procStatus,
    score:       Math.min(100, metrics.processesCreated * 10),
    message:     `${metrics.processesCreated} processo(s) criado(s)`,
    remediation: procStatus !== "pass" ? "Incentivar criacao de processos pelos responsaveis." : null,
  });

  // Items reviewed
  const itemStatus: ReadinessStatus = metrics.itemsReviewed >= 20 ? "pass" : metrics.itemsReviewed >= 5 ? "warn" : "fail";
  results.push({
    id:          "ops_items_reviewed",
    category:    "operational",
    name:        "Itens Revisados",
    status:      itemStatus,
    score:       Math.min(100, metrics.itemsReviewed * 5),
    message:     `${metrics.itemsReviewed} item(s) revisado(s)`,
    remediation: itemStatus !== "pass" ? "Garantir que revisores estejam treinados e ativos." : null,
  });

  return results;
}

function adoptionChecks(pilot: PilotOrganization): ReadinessCheckResult[] {
  const { metrics } = pilot;
  const results: ReadinessCheckResult[] = [];

  // Onboarding completion
  const onbStatus: ReadinessStatus =
    metrics.onboardingCompletionRate >= 0.8 ? "pass" : metrics.onboardingCompletionRate >= 0.5 ? "warn" : "fail";
  results.push({
    id:          "adopt_onboarding",
    category:    "adoption",
    name:        "Conclusao de Onboarding",
    status:      onbStatus,
    score:       Math.round(metrics.onboardingCompletionRate * 100),
    message:     `${(metrics.onboardingCompletionRate * 100).toFixed(0)}% concluido`,
    remediation: onbStatus !== "pass" ? "Acompanhar usuarios que nao concluiram o onboarding." : null,
  });

  // Template adoption
  const tplStatus: ReadinessStatus =
    metrics.templateAdoptionRate >= 0.6 ? "pass" : metrics.templateAdoptionRate >= 0.3 ? "warn" : "fail";
  results.push({
    id:          "adopt_templates",
    category:    "adoption",
    name:        "Adocao de Templates",
    status:      tplStatus,
    score:       Math.round(metrics.templateAdoptionRate * 100),
    message:     `${(metrics.templateAdoptionRate * 100).toFixed(0)}% de adocao`,
    remediation: tplStatus !== "pass" ? "Treinamento adicional sobre uso de templates operacionais." : null,
  });

  return results;
}

// ─── Generate report ──────────────────────────────────────────────────────────

export function generateReadinessReport(pilot: PilotOrganization): ReadinessReport {
  const now    = new Date().toISOString();
  const checks = [
    ...technicalChecks(pilot),
    ...operationalChecks(pilot),
    ...adoptionChecks(pilot),
  ];

  const passCount  = checks.filter(c => c.status === "pass").length;
  const failCount  = checks.filter(c => c.status === "fail").length;
  const overallScore = checks.length > 0 ? Math.round(checks.reduce((s, c) => s + c.score, 0) / checks.length) : 0;

  const { blockers } = isPilotReadyForNextPhase(pilot);
  const overallStatus: ReadinessReport["overallStatus"] =
    failCount > 0 || blockers.length > 0 ? "not_ready" : passCount < checks.length ? "needs_attention" : "ready";

  const recommendations: string[] = checks
    .filter(c => c.remediation)
    .map(c => c.remediation as string);

  return {
    organizationId:  pilot.organizationId,
    pilotPhase:      pilot.pilotPhase,
    overallScore,
    overallStatus,
    checks,
    blockers,
    recommendations,
    generatedAt:     now,
  };
}

// ─── Scorecard ────────────────────────────────────────────────────────────────

export function generatePilotScorecard(pilot: PilotOrganization): {
  pilotScore:       number;
  readinessReport:  ReadinessReport;
  phaseProgress:    number; // 0-1 — how far through the pilot phases
  nextPhaseEta:     string | null;
} {
  const readinessReport = generateReadinessReport(pilot);
  const pilotScore      = computePilotScore(pilot);
  const phaseIdx        = PILOT_PHASE_ORDER.indexOf(pilot.pilotPhase);
  const phaseProgress   = phaseIdx >= 0 ? phaseIdx / (PILOT_PHASE_ORDER.length - 1) : 0;

  // Estimate next phase based on score
  let nextPhaseEta: string | null = null;
  if (readinessReport.overallStatus === "ready") {
    const eta = new Date();
    eta.setDate(eta.getDate() + 7);
    nextPhaseEta = eta.toISOString();
  }

  return { pilotScore, readinessReport, phaseProgress, nextPhaseEta };
}

// ─── Approve phase transition ──────────────────────────────────────────────────

export function approvePhaseTransition(params: {
  organizationId: number;
  pilot:          PilotOrganization;
  approvedBy:     number;
  notes:          string;
}): PhaseTransitionApproval {
  const report     = generateReadinessReport(params.pilot);
  const currentIdx = PILOT_PHASE_ORDER.indexOf(params.pilot.pilotPhase);
  const nextPhase  = PILOT_PHASE_ORDER[currentIdx + 1];

  if (!nextPhase) throw new Error("Piloto ja esta na fase final.");
  if (report.overallStatus === "not_ready") {
    throw new Error(`Piloto nao esta pronto para avancao. Blockers: ${report.blockers.join("; ")}`);
  }

  const approval: PhaseTransitionApproval = {
    id:             genId("approval"),
    organizationId: params.organizationId,
    fromPhase:      params.pilot.pilotPhase,
    toPhase:        nextPhase,
    approvedBy:     params.approvedBy,
    readinessScore: report.overallScore,
    notes:          params.notes,
    approvedAt:     new Date().toISOString(),
  };
  _approvals.push(approval);
  return approval;
}

export function getPhaseTransitionHistory(organizationId: number): PhaseTransitionApproval[] {
  return _approvals.filter(a => a.organizationId === organizationId);
}
