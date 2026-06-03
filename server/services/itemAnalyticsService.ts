/**
 * Sprint 3.0 — Item Analytics Service.
 *
 * KPIs operacionais para o ciclo de vida de ItemTR, matching e composição de TR.
 * Funções puras sobre arrays de entrada — sem acesso a DB, determinísticas.
 *
 * KPIs:
 *   1. candidateAcceptanceRate   — % de candidatos selecionados/aceitos
 *   2. overrideRate              — % de itens sobrescritos manualmente
 *   3. manualCorrectionRate      — % de itens com entrada/correção manual
 *   4. catalogAccuracy           — % de itens com vínculo CATMAT/CATSER correto
 *   5. clauseUsageRate           — % de cláusulas recomendadas efetivamente usadas
 *   6. semanticConfidenceDrift   — variação média de confiança entre janelas
 *   7. matchingStability         — % de matchings estáveis (replayKey consistente)
 *   8. reviewLatency             — latência média de revisão (ms)
 */

// ─── KPI ──────────────────────────────────────────────────────────────────────

export interface ItemKpi {
  key:        string;
  label:      string;
  value:      number;
  unit:       "percent" | "ms" | "ratio" | "count";
  computedAt: string; // ISO 8601
}

function kpi(key: string, label: string, value: number, unit: ItemKpi["unit"]): ItemKpi {
  return { key, label, value, unit, computedAt: new Date().toISOString() };
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

// ─── Input shapes ─────────────────────────────────────────────────────────────

export interface ItemLifecycleData {
  itemId:           string;
  organizationId:   number;
  reviewState:      string;   // ItemReviewState
  hadCandidates:    boolean;
  selectedCandidate: boolean;
  overridden:       boolean;
  manualEntry:      boolean;
  catalogLinked:    boolean;
  catalogCorrect:   boolean;  // confirmado por revisor
  confidenceScore:  number;
  reviewLatencyMs:  number | null;
}

export interface ClauseUsageData {
  recommendedCount: number;
  usedCount:        number;
}

export interface ConfidenceWindow {
  windowLabel:  string;
  avgConfidence: number;
}

export interface MatchingStabilityData {
  replayKey:    string;
  candidateSetSignature: string; // hash of candidate ids/scores
}

// ─── KPI computations ─────────────────────────────────────────────────────────

export function candidateAcceptanceRate(items: ItemLifecycleData[]): ItemKpi {
  const withCandidates = items.filter(i => i.hadCandidates);
  const accepted = withCandidates.filter(i => i.selectedCandidate).length;
  return kpi("candidateAcceptanceRate", "Taxa de Aceitação de Candidatos",
    pct(accepted, withCandidates.length), "percent");
}

export function overrideRate(items: ItemLifecycleData[]): ItemKpi {
  const overridden = items.filter(i => i.overridden).length;
  return kpi("overrideRate", "Taxa de Override", pct(overridden, items.length), "percent");
}

export function manualCorrectionRate(items: ItemLifecycleData[]): ItemKpi {
  const manual = items.filter(i => i.manualEntry || i.overridden).length;
  return kpi("manualCorrectionRate", "Taxa de Correção Manual", pct(manual, items.length), "percent");
}

export function catalogAccuracy(items: ItemLifecycleData[]): ItemKpi {
  const linked = items.filter(i => i.catalogLinked);
  const correct = linked.filter(i => i.catalogCorrect).length;
  return kpi("catalogAccuracy", "Acurácia do Catálogo", pct(correct, linked.length), "percent");
}

export function clauseUsageRate(usage: ClauseUsageData): ItemKpi {
  return kpi("clauseUsageRate", "Taxa de Uso de Cláusulas",
    pct(usage.usedCount, usage.recommendedCount), "percent");
}

/**
 * Variação média absoluta de confiança entre janelas consecutivas.
 */
export function semanticConfidenceDrift(windows: ConfidenceWindow[]): ItemKpi {
  if (windows.length < 2) return kpi("semanticConfidenceDrift", "Drift de Confiança Semântica", 0, "ratio");
  let totalDrift = 0;
  for (let i = 1; i < windows.length; i++) {
    totalDrift += Math.abs(windows[i].avgConfidence - windows[i - 1].avgConfidence);
  }
  const avg = totalDrift / (windows.length - 1);
  return kpi("semanticConfidenceDrift", "Drift de Confiança Semântica",
    Math.round(avg * 10000) / 10000, "ratio");
}

/**
 * Estabilidade de matching: % de pares (replayKey) cuja assinatura de candidate set
 * é consistente. Mesmo replayKey deve sempre ter a mesma assinatura.
 */
export function matchingStability(runs: MatchingStabilityData[]): ItemKpi {
  const byKey = new Map<string, Set<string>>();
  for (const r of runs) {
    if (!byKey.has(r.replayKey)) byKey.set(r.replayKey, new Set());
    byKey.get(r.replayKey)!.add(r.candidateSetSignature);
  }
  const totalKeys = byKey.size;
  if (totalKeys === 0) return kpi("matchingStability", "Estabilidade de Matching", 100, "percent");
  const stableKeys = Array.from(byKey.values()).filter(sigs => sigs.size === 1).length;
  return kpi("matchingStability", "Estabilidade de Matching", pct(stableKeys, totalKeys), "percent");
}

export function reviewLatency(items: ItemLifecycleData[]): ItemKpi {
  const withLatency = items.filter(i => i.reviewLatencyMs != null) as Array<ItemLifecycleData & { reviewLatencyMs: number }>;
  if (withLatency.length === 0) return kpi("reviewLatency", "Latência de Revisão", 0, "ms");
  const avg = withLatency.reduce((s, i) => s + i.reviewLatencyMs, 0) / withLatency.length;
  return kpi("reviewLatency", "Latência de Revisão", Math.round(avg), "ms");
}

// ─── Aggregate snapshot ───────────────────────────────────────────────────────

export interface ItemAnalyticsSnapshot {
  organizationId: number;
  itemCount:      number;
  kpis:           ItemKpi[];
  createdAt:      string;
}

export function computeItemAnalytics(
  organizationId: number,
  items:          ItemLifecycleData[],
  params: {
    clauseUsage?:      ClauseUsageData;
    confidenceWindows?: ConfidenceWindow[];
    matchingRuns?:     MatchingStabilityData[];
  } = {},
): ItemAnalyticsSnapshot {
  const kpis: ItemKpi[] = [
    candidateAcceptanceRate(items),
    overrideRate(items),
    manualCorrectionRate(items),
    catalogAccuracy(items),
    clauseUsageRate(params.clauseUsage ?? { recommendedCount: 0, usedCount: 0 }),
    semanticConfidenceDrift(params.confidenceWindows ?? []),
    matchingStability(params.matchingRuns ?? []),
    reviewLatency(items),
  ];
  return {
    organizationId,
    itemCount: items.length,
    kpis,
    createdAt: new Date().toISOString(),
  };
}
