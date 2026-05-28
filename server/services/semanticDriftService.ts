/**
 * Sprint 2.95 — Semantic Drift Service.
 *
 * Detecta degradação ao longo do tempo no motor de matching semântico.
 * Compara snapshots de métricas entre períodos para identificar tendências.
 *
 * Métricas acompanhadas:
 *   - avgConfidence: confiança média dos itens
 *   - avgSemanticMatchRate: % de itens com score >= 0.85
 *   - avgUnitNormRate: % de itens com unidade canônica normalizada
 *   - parserAccuracyByType: confiança média por tipo de parser
 *   - candidateInstabilityRate: % itens com confiança < 0.60
 *   - rankingInconsistencies: contagem de itens com score < 0.50
 *   - normalizationAnomalies: contagem de itens sem unidade canônica
 *   - semanticVolatility: desvio padrão das confianças
 */

import { nanoid } from "nanoid";
import type { StagingItemAnalyticsData, SessionAnalyticsData } from "./importAnalyticsService";

// ─── Snapshot types ───────────────────────────────────────────────────────────

export interface SemanticDriftMetrics {
  avgConfidence:             number;
  avgSemanticMatchRate:      number;
  avgUnitNormRate:           number;
  parserAccuracyByType:      Record<string, number>;
  candidateInstabilityRate:  number;
  rankingInconsistencies:    number;
  normalizationAnomalies:    number;
  semanticVolatility:        number;
}

export interface SemanticDriftSnapshot {
  id:             string;
  organizationId: number;
  period: {
    start: string;
    end:   string;
  };
  metrics:   SemanticDriftMetrics;
  createdAt: string;
}

// ─── Alert types ──────────────────────────────────────────────────────────────

export type DriftAlertType =
  | "confidence_degradation"
  | "parser_degradation"
  | "ranking_inconsistency"
  | "candidate_instability"
  | "normalization_anomaly"
  | "semantic_volatility";

export type DriftSeverity = "info" | "warning" | "critical";

export interface DriftAlert {
  type:          DriftAlertType;
  severity:      DriftSeverity;
  description:   string;
  affectedItems: number;
  detectedAt:    string;
}

// ─── Trend type ───────────────────────────────────────────────────────────────

export interface DriftTrend {
  metric:    string;
  previous:  number;
  current:   number;
  delta:     number;
  direction: "up" | "down" | "stable";
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function computeStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(variance);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

// ─── computeDriftSnapshot ─────────────────────────────────────────────────────

export function computeDriftSnapshot(
  items:    StagingItemAnalyticsData[],
  sessions: SessionAnalyticsData[],
  period:   { start: string; end: string },
  organizationId: number,
): SemanticDriftSnapshot {
  const confidences = items.map(i => i.confidence);

  // avgConfidence: média das confianças
  const avgConfidence = avg(confidences);

  // avgSemanticMatchRate: % de itens com candidateScore >= 0.85
  const highScoreCount = items.filter(i => (i.candidateScore ?? 0) >= 0.85).length;
  const avgSemanticMatchRate = pct(highScoreCount, items.length);

  // avgUnitNormRate: % de itens com canonicalUnit != null
  const withUnitCount = items.filter(i => i.canonicalUnit != null).length;
  const avgUnitNormRate = pct(withUnitCount, items.length);

  // parserAccuracyByType: agrupa por parserType, calcula média de confiança
  const byParser: Record<string, number[]> = {};
  for (const item of items) {
    if (!byParser[item.parserType]) byParser[item.parserType] = [];
    byParser[item.parserType].push(item.confidence);
  }
  const parserAccuracyByType: Record<string, number> = {};
  for (const [parser, confs] of Object.entries(byParser)) {
    parserAccuracyByType[parser] = avg(confs);
  }

  // candidateInstabilityRate: % de itens com confidence < 0.60
  const unstableCount = items.filter(i => i.confidence < 0.60).length;
  const candidateInstabilityRate = pct(unstableCount, items.length);

  // rankingInconsistencies: contagem de itens com candidateScore < 0.50
  const rankingInconsistencies = items.filter(i => (i.candidateScore ?? 0) < 0.50).length;

  // normalizationAnomalies: contagem de itens sem unidade canônica
  const normalizationAnomalies = items.filter(i => i.canonicalUnit == null).length;

  // semanticVolatility: desvio padrão das confianças
  const semanticVolatility = computeStdDev(confidences);

  return {
    id:             nanoid(),
    organizationId,
    period,
    metrics: {
      avgConfidence,
      avgSemanticMatchRate,
      avgUnitNormRate,
      parserAccuracyByType,
      candidateInstabilityRate,
      rankingInconsistencies,
      normalizationAnomalies,
      semanticVolatility,
    },
    createdAt: new Date().toISOString(),
  };
}

// ─── detectAlerts ─────────────────────────────────────────────────────────────

export function detectAlerts(
  current:  SemanticDriftSnapshot,
  baseline: SemanticDriftSnapshot,
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const now = new Date().toISOString();

  // Confidence degradation
  const confidenceDrop = baseline.metrics.avgConfidence - current.metrics.avgConfidence;
  if (confidenceDrop > 0.20) {
    alerts.push({
      type:          "confidence_degradation",
      severity:      "critical",
      description:   `Confiança média caiu ${(confidenceDrop * 100).toFixed(1)}% em relação ao baseline (crítico > 20%).`,
      affectedItems: Math.round(current.metrics.candidateInstabilityRate * 100),
      detectedAt:    now,
    });
  } else if (confidenceDrop > 0.10) {
    alerts.push({
      type:          "confidence_degradation",
      severity:      "warning",
      description:   `Confiança média caiu ${(confidenceDrop * 100).toFixed(1)}% em relação ao baseline (warning > 10%).`,
      affectedItems: Math.round(current.metrics.candidateInstabilityRate * 100),
      detectedAt:    now,
    });
  }

  // Unit normalization rate drop
  const unitNormDrop = baseline.metrics.avgUnitNormRate - current.metrics.avgUnitNormRate;
  if (unitNormDrop > 0.15) {
    alerts.push({
      type:          "normalization_anomaly",
      severity:      "warning",
      description:   `Taxa de normalização de unidades caiu ${(unitNormDrop * 100).toFixed(1)}% (warning > 15%).`,
      affectedItems: current.metrics.normalizationAnomalies,
      detectedAt:    now,
    });
  }

  // Semantic volatility
  if (current.metrics.semanticVolatility > 0.35) {
    alerts.push({
      type:          "semantic_volatility",
      severity:      "critical",
      description:   `Volatilidade semântica ${current.metrics.semanticVolatility.toFixed(3)} excede threshold crítico (> 0.35).`,
      affectedItems: current.metrics.rankingInconsistencies,
      detectedAt:    now,
    });
  } else if (current.metrics.semanticVolatility > 0.20) {
    alerts.push({
      type:          "semantic_volatility",
      severity:      "warning",
      description:   `Volatilidade semântica ${current.metrics.semanticVolatility.toFixed(3)} excede threshold de warning (> 0.20).`,
      affectedItems: current.metrics.rankingInconsistencies,
      detectedAt:    now,
    });
  }

  // Ranking inconsistencies (> 10% do total baseado em snapshot atual)
  const totalItemsProxy = current.metrics.rankingInconsistencies + Math.round(current.metrics.avgSemanticMatchRate * 100);
  if (totalItemsProxy > 0) {
    const inconsistencyRate = current.metrics.rankingInconsistencies / totalItemsProxy;
    if (inconsistencyRate > 0.10) {
      alerts.push({
        type:          "ranking_inconsistency",
        severity:      "warning",
        description:   `Taxa de inconsistência de ranking ${(inconsistencyRate * 100).toFixed(1)}% excede 10%.`,
        affectedItems: current.metrics.rankingInconsistencies,
        detectedAt:    now,
      });
    }
  }

  return alerts;
}

// ─── compareDriftSnapshots ────────────────────────────────────────────────────

export function compareDriftSnapshots(
  a: SemanticDriftSnapshot,
  b: SemanticDriftSnapshot,
): DriftTrend[] {
  const metricsToCompare: Array<[string, number, number]> = [
    ["avgConfidence",            a.metrics.avgConfidence,            b.metrics.avgConfidence],
    ["avgSemanticMatchRate",     a.metrics.avgSemanticMatchRate,     b.metrics.avgSemanticMatchRate],
    ["avgUnitNormRate",          a.metrics.avgUnitNormRate,          b.metrics.avgUnitNormRate],
    ["candidateInstabilityRate", a.metrics.candidateInstabilityRate, b.metrics.candidateInstabilityRate],
    ["rankingInconsistencies",   a.metrics.rankingInconsistencies,   b.metrics.rankingInconsistencies],
    ["normalizationAnomalies",   a.metrics.normalizationAnomalies,   b.metrics.normalizationAnomalies],
    ["semanticVolatility",       a.metrics.semanticVolatility,       b.metrics.semanticVolatility],
  ];

  return metricsToCompare.map(([metric, previous, current]) => {
    const delta = current - previous;
    return {
      metric,
      previous,
      current,
      delta:     Math.round(delta * 10000) / 10000,
      direction: Math.abs(delta) < 0.0001 ? "stable" : delta > 0 ? "up" : "down",
    };
  });
}

// ─── isHealthy ────────────────────────────────────────────────────────────────

export function isHealthy(
  current:  SemanticDriftSnapshot,
  baseline: SemanticDriftSnapshot,
): boolean {
  const alerts = detectAlerts(current, baseline);
  return !alerts.some(a => a.severity === "critical");
}
