/**
 * Sprint 3.4 — Pilot Organization Domain.
 *
 * Configuracao e gestao de prefeitura piloto para o LiciGov Pro.
 * Ciclo: onboarding → training → shadow_mode → live_pilot → evaluation → full_rollout.
 *
 * PRINCIPIOS:
 *   - Imutabilidade: avanco de fase cria novo objeto.
 *   - Rastreabilidade: auditTrail append-only.
 *   - Multi-tenant: organizationId obrigatorio.
 *   - Health baseado em metricas reais.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PilotPhase =
  | "onboarding"
  | "training"
  | "shadow_mode"
  | "live_pilot"
  | "evaluation"
  | "full_rollout";

export interface PilotFeatureFlags {
  semanticReview:     boolean;
  catmatMatching:     boolean;
  trIntelligence:     boolean;
  collaboration:      boolean;
  exports:            boolean;
  webhooks:           boolean;
  advancedAnalytics:  boolean;
}

export interface PilotMetrics {
  onboardingCompletionRate: number; // 0-1
  activeUsers:              number;
  processesCreated:         number;
  itemsReviewed:            number;
  avgReviewLatencyMs:       number;
  templateAdoptionRate:     number; // 0-1
  errorRate:                number; // 0-1
}

export interface PilotHealth {
  status:        "healthy" | "degraded" | "critical";
  issues:        string[];
  lastCheckedAt: string;
}

export interface PilotAuditEntry {
  action:     string;
  actor:      number;
  details:    Record<string, unknown>;
  occurredAt: string;
}

export interface PilotOrganization {
  id:                string;
  organizationId:    number;
  municipio:         string;
  estado:            string;
  populacao:         number;
  pilotPhase:        PilotPhase;
  pilotStartedAt:    string;
  pilotGoLiveAt:     string | null;
  rolloutPercentage: number; // 0-100
  features:          PilotFeatureFlags;
  metrics:           PilotMetrics;
  health:            PilotHealth;
  auditTrail:        PilotAuditEntry[];
  createdAt:         string;
  updatedAt:         string;
}

// ─── Phase order ──────────────────────────────────────────────────────────────

export const PILOT_PHASE_ORDER: PilotPhase[] = [
  "onboarding",
  "training",
  "shadow_mode",
  "live_pilot",
  "evaluation",
  "full_rollout",
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_FEATURES: PilotFeatureFlags = {
  semanticReview:    false,
  catmatMatching:    false,
  trIntelligence:    false,
  collaboration:     false,
  exports:           false,
  webhooks:          false,
  advancedAnalytics: false,
};

const DEFAULT_METRICS: PilotMetrics = {
  onboardingCompletionRate: 0,
  activeUsers:              0,
  processesCreated:         0,
  itemsReviewed:            0,
  avgReviewLatencyMs:       0,
  templateAdoptionRate:     0,
  errorRate:                0,
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPilotOrganization(params: {
  organizationId: number;
  municipio:      string;
  estado:         string;
  populacao:      number;
  features?:      Partial<PilotFeatureFlags>;
}): PilotOrganization {
  const now = new Date().toISOString();
  const seed = JSON.stringify({ organizationId: params.organizationId, municipio: params.municipio });
  const id = `pilot_${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;

  return {
    id,
    organizationId:    params.organizationId,
    municipio:         params.municipio,
    estado:            params.estado,
    populacao:         params.populacao,
    pilotPhase:        "onboarding",
    pilotStartedAt:    now,
    pilotGoLiveAt:     null,
    rolloutPercentage: 0,
    features:          { ...DEFAULT_FEATURES, ...(params.features ?? {}) },
    metrics:           { ...DEFAULT_METRICS },
    health:            { status: "healthy", issues: [], lastCheckedAt: now },
    auditTrail: [
      {
        action:     "pilot_created",
        actor:      0,
        details:    { municipio: params.municipio, estado: params.estado },
        occurredAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Advance phase ────────────────────────────────────────────────────────────

export function advancePilotPhase(
  pilot: PilotOrganization,
  actor: number,
): PilotOrganization {
  const currentIdx = PILOT_PHASE_ORDER.indexOf(pilot.pilotPhase);
  if (currentIdx < 0 || currentIdx >= PILOT_PHASE_ORDER.length - 1) {
    throw new Error(`Fase "${pilot.pilotPhase}" ja e a final ou desconhecida.`);
  }
  const nextPhase = PILOT_PHASE_ORDER[currentIdx + 1];
  const now = new Date().toISOString();

  return {
    ...pilot,
    pilotPhase:    nextPhase,
    pilotGoLiveAt: nextPhase === "live_pilot" ? now : pilot.pilotGoLiveAt,
    auditTrail:    [
      ...pilot.auditTrail,
      { action: "phase_advanced", actor, details: { from: pilot.pilotPhase, to: nextPhase }, occurredAt: now },
    ],
    updatedAt: now,
  };
}

// ─── Update metrics ───────────────────────────────────────────────────────────

export function updatePilotMetrics(
  pilot:   PilotOrganization,
  metrics: Partial<PilotMetrics>,
): PilotOrganization {
  const updated = { ...pilot.metrics, ...metrics };
  const health  = evaluatePilotHealth({ ...pilot, metrics: updated });
  return { ...pilot, metrics: updated, health, updatedAt: new Date().toISOString() };
}

// ─── Evaluate health ──────────────────────────────────────────────────────────

export function evaluatePilotHealth(pilot: PilotOrganization): PilotHealth {
  const now    = new Date().toISOString();
  const issues: string[] = [];
  const { errorRate, avgReviewLatencyMs, activeUsers, onboardingCompletionRate } = pilot.metrics;

  if (errorRate > 0.3)   issues.push(`Taxa de erro critica: ${(errorRate * 100).toFixed(1)}%`);
  else if (errorRate > 0.1) issues.push(`Taxa de erro elevada: ${(errorRate * 100).toFixed(1)}%`);

  if (avgReviewLatencyMs > 10000) issues.push(`Latencia critica: ${avgReviewLatencyMs}ms`);
  else if (avgReviewLatencyMs > 5000) issues.push(`Latencia elevada: ${avgReviewLatencyMs}ms`);

  const livePhases: PilotPhase[] = ["live_pilot", "evaluation", "full_rollout"];
  if (livePhases.includes(pilot.pilotPhase) && activeUsers === 0) {
    issues.push("Nenhum usuario ativo detectado em fase operacional.");
  }

  if (onboardingCompletionRate < 0.3 && pilot.pilotPhase !== "onboarding") {
    issues.push(`Conclusao de onboarding baixa: ${(onboardingCompletionRate * 100).toFixed(0)}%`);
  }

  const status: PilotHealth["status"] = errorRate > 0.3 ? "critical" : issues.length > 0 ? "degraded" : "healthy";
  return { status, issues, lastCheckedAt: now };
}

// ─── Readiness check ──────────────────────────────────────────────────────────

export function isPilotReadyForNextPhase(pilot: PilotOrganization): {
  ready:    boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  const { metrics, pilotPhase } = pilot;

  switch (pilotPhase) {
    case "onboarding":
      if (metrics.onboardingCompletionRate < 0.5)
        blockers.push("Taxa de conclusao de onboarding deve ser >= 50%.");
      break;
    case "training":
      if (metrics.onboardingCompletionRate < 0.7)
        blockers.push("Taxa de conclusao deve ser >= 70% antes do piloto live.");
      if (metrics.activeUsers < 1)
        blockers.push("Ao menos 1 usuario ativo e necessario.");
      break;
    case "shadow_mode":
      if (metrics.templateAdoptionRate < 0.3)
        blockers.push("Taxa de adocao de templates deve ser >= 30%.");
      if (metrics.errorRate > 0.1)
        blockers.push("Taxa de erro deve ser < 10% antes do live.");
      break;
    case "live_pilot":
      if (metrics.processesCreated < 5)
        blockers.push("Ao menos 5 processos devem ser criados.");
      if (metrics.errorRate > 0.05)
        blockers.push("Taxa de erro deve ser < 5% para avaliacao.");
      break;
    case "evaluation":
      if (metrics.templateAdoptionRate < 0.5)
        blockers.push("Taxa de adocao de templates deve ser >= 50% para rollout.");
      if (metrics.activeUsers < 3)
        blockers.push("Ao menos 3 usuarios ativos para rollout completo.");
      if (pilot.health.status === "critical")
        blockers.push("Saude do sistema nao pode ser critica.");
      break;
    case "full_rollout":
      blockers.push("Ja esta em rollout completo.");
      break;
  }

  return { ready: blockers.length === 0, blockers };
}

// ─── Compute pilot score ──────────────────────────────────────────────────────

export function computePilotScore(pilot: PilotOrganization): number {
  const { metrics } = pilot;
  const onboardingScore = metrics.onboardingCompletionRate * 30;
  const templateScore   = metrics.templateAdoptionRate * 30;
  const latencyScore    = metrics.avgReviewLatencyMs > 0 && metrics.avgReviewLatencyMs <= 3000 ? 20 : 0;
  const userScore       = Math.min(metrics.activeUsers * 2, 20);
  return Math.max(0, Math.min(100, Math.round(onboardingScore + templateScore + latencyScore + userScore)));
}

// ─── Rollout plan ─────────────────────────────────────────────────────────────

export function getRolloutPlan(
  pilot: PilotOrganization,
): Array<{ phase: PilotPhase; targetDate: string; requirements: string[] }> {
  const base = new Date(pilot.pilotStartedAt);
  const durations: Record<PilotPhase, number> = {
    onboarding:   7,
    training:     14,
    shadow_mode:  14,
    live_pilot:   30,
    evaluation:   14,
    full_rollout:  0,
  };
  const requirements: Record<PilotPhase, string[]> = {
    onboarding:   ["Configurar usuarios", "Importar estrutura organizacional"],
    training:     ["Completar treinamento", "Validar entendimento do workflow"],
    shadow_mode:  ["Executar processos em modo sombra", "Comparar com sistema legado"],
    live_pilot:   ["Processos reais com supervisao", "Monitoramento intensivo"],
    evaluation:   ["Avaliar metricas de adocao", "Coletar feedback"],
    full_rollout: ["Migrar todos os processos", "Desativar sistema legado"],
  };

  let days = 0;
  return PILOT_PHASE_ORDER.map(phase => {
    const target = new Date(base);
    target.setDate(base.getDate() + days);
    days += durations[phase];
    return { phase, targetDate: target.toISOString(), requirements: requirements[phase] };
  });
}
