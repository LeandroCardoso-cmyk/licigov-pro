/**
 * Sprint 2.9 — Import Analytics Service.
 *
 * 10 KPI métricas para monitorar qualidade do import engine.
 * Métricas calculadas sobre ImportSession e ImportStagingItem completados.
 *
 * KPIs:
 *   1.  correctionRate         — % de itens que requereram correção manual
 *   2.  approvalRate           — % de itens aprovados pelo revisor
 *   3.  rejectionRate          — % de itens rejeitados
 *   4.  parserAccuracy         — confiança média por tipo de parser
 *   5.  unitNormalizationRate  — % de unidades normalizadas com sucesso
 *   6.  semanticMatchRate      — % de itens com candidato semântico ≥ 0.85
 *   7.  reviewTurnaroundMs     — tempo médio de revisão (ms)
 *   8.  pipelineSuccessRate    — % de itens que completaram todos os 7 estágios
 *   9.  avgConfidence          — confiança média global dos itens processados
 *   10. retryRate              — % de sessões que precisaram de retry
 */

// ─── KPI definitions ──────────────────────────────────────────────────────────

export interface ImportKpi {
  key:            string;
  label:          string;
  description:    string;
  value:          number;        // valor calculado
  unit:           "percent" | "ms" | "count" | "ratio";
  threshold?:     { warn: number; critical: number };
  isHealthy:      boolean;
  computedAt:     string;        // ISO 8601
}

// ─── Analytics snapshot ───────────────────────────────────────────────────────

export interface ImportAnalyticsSnapshot {
  organizationId:  number;
  periodStart:     string;  // ISO 8601
  periodEnd:       string;  // ISO 8601
  sessionCount:    number;
  itemCount:       number;
  kpis:            ImportKpi[];
  createdAt:       string;
}

// ─── Raw data inputs (o que o serviço precisa receber) ────────────────────────

export interface SessionAnalyticsData {
  importSessionId:  number;
  organizationId:   number;
  parserType:       string;
  retryCount:       number;
  status:           string;
  createdAt:        string;
  completedAt?:     string;
}

export interface StagingItemAnalyticsData {
  stagingItemId:    string;
  importSessionId:  number;
  reviewStatus:     string;           // "pending"|"approved"|"rejected"|"skipped"|"corrected"
  confidence:       number;
  canonicalUnit:    string | null;
  candidateScore:   number | null;    // melhor candidato semântico
  pipelineSuccess:  boolean;
  reviewedAt?:      string;
  createdAt:        string;
  parserType:       string;
}

// ─── KPI computations ─────────────────────────────────────────────────────────

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function computeCorrectionRate(items: StagingItemAnalyticsData[]): number {
  const corrected = items.filter(i => i.reviewStatus === "corrected").length;
  return pct(corrected, items.length);
}

function computeApprovalRate(items: StagingItemAnalyticsData[]): number {
  const decided  = items.filter(i => ["approved", "rejected", "corrected"].includes(i.reviewStatus));
  const approved = decided.filter(i => i.reviewStatus === "approved" || i.reviewStatus === "corrected");
  return pct(approved.length, decided.length);
}

function computeRejectionRate(items: StagingItemAnalyticsData[]): number {
  const decided  = items.filter(i => ["approved", "rejected", "corrected"].includes(i.reviewStatus));
  const rejected = decided.filter(i => i.reviewStatus === "rejected");
  return pct(rejected.length, decided.length);
}

function computeParserAccuracy(items: StagingItemAnalyticsData[]): Record<string, number> {
  const byParser: Record<string, number[]> = {};
  for (const item of items) {
    if (!byParser[item.parserType]) byParser[item.parserType] = [];
    byParser[item.parserType].push(item.confidence);
  }
  const result: Record<string, number> = {};
  for (const [parser, confs] of Object.entries(byParser)) {
    result[parser] = Math.round(avg(confs) * 10000) / 100;
  }
  return result;
}

function computeUnitNormalizationRate(items: StagingItemAnalyticsData[]): number {
  const withUnit = items.filter(i => i.canonicalUnit !== null).length;
  return pct(withUnit, items.length);
}

function computeSemanticMatchRate(items: StagingItemAnalyticsData[]): number {
  const highConf = items.filter(i => i.candidateScore !== null && i.candidateScore >= 0.85).length;
  return pct(highConf, items.length);
}

function computeReviewTurnaroundMs(items: StagingItemAnalyticsData[]): number {
  const reviewed = items.filter(i => i.reviewedAt && i.createdAt);
  if (reviewed.length === 0) return 0;
  const durations = reviewed.map(i => {
    const created  = new Date(i.createdAt).getTime();
    const resolved = new Date(i.reviewedAt!).getTime();
    return resolved - created;
  });
  return Math.round(avg(durations));
}

function computePipelineSuccessRate(items: StagingItemAnalyticsData[]): number {
  const success = items.filter(i => i.pipelineSuccess).length;
  return pct(success, items.length);
}

function computeAvgConfidence(items: StagingItemAnalyticsData[]): number {
  return Math.round(avg(items.map(i => i.confidence)) * 10000) / 100;
}

function computeRetryRate(sessions: SessionAnalyticsData[]): number {
  const withRetry = sessions.filter(s => s.retryCount > 0).length;
  return pct(withRetry, sessions.length);
}

// ─── KPI builder ──────────────────────────────────────────────────────────────

function buildKpi(
  key:     string,
  label:   string,
  desc:    string,
  value:   number,
  unit:    ImportKpi["unit"],
  warnAt?: number,
  critAt?: number,
): ImportKpi {
  const now = new Date().toISOString();
  let isHealthy = true;
  if (critAt !== undefined && value <= critAt) isHealthy = false;
  else if (warnAt !== undefined && value <= warnAt) isHealthy = true; // still ok, just a warn

  return {
    key,
    label,
    description: desc,
    value,
    unit,
    threshold:   warnAt !== undefined ? { warn: warnAt, critical: critAt ?? 0 } : undefined,
    isHealthy,
    computedAt:  now,
  };
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeAnalytics(
  organizationId: number,
  sessions:       SessionAnalyticsData[],
  items:          StagingItemAnalyticsData[],
  periodStart:    string,
  periodEnd:      string,
): ImportAnalyticsSnapshot {
  const parserAccuracy = computeParserAccuracy(items);
  const avgParser      = Object.values(parserAccuracy).length > 0
    ? avg(Object.values(parserAccuracy))
    : 0;

  const kpis: ImportKpi[] = [
    buildKpi(
      "correction_rate",
      "Taxa de Correção",
      "% de itens que requereram correção manual pelo revisor",
      computeCorrectionRate(items),
      "percent",
      /* warn @ */ 30,
      /* crit @ */ 60,
    ),
    buildKpi(
      "approval_rate",
      "Taxa de Aprovação",
      "% de itens aprovados ou corrigidos entre os revisados",
      computeApprovalRate(items),
      "percent",
      /* warn @ */ 70,
      /* crit @ */ 50,
    ),
    buildKpi(
      "rejection_rate",
      "Taxa de Rejeição",
      "% de itens rejeitados entre os revisados",
      computeRejectionRate(items),
      "percent",
      /* warn @ */ 20,
      /* crit @ */ 40,
    ),
    buildKpi(
      "parser_accuracy",
      "Acurácia dos Parsers",
      "Confiança média global dos parsers (média entre todos os tipos)",
      avgParser,
      "percent",
      /* warn @ */ 65,
      /* crit @ */ 50,
    ),
    buildKpi(
      "unit_normalization_rate",
      "Taxa de Normalização de Unidades",
      "% de itens com unidade normalizada com sucesso para canônica",
      computeUnitNormalizationRate(items),
      "percent",
      /* warn @ */ 70,
      /* crit @ */ 50,
    ),
    buildKpi(
      "semantic_match_rate",
      "Taxa de Match Semântico",
      "% de itens com candidato semântico com score ≥ 0.85",
      computeSemanticMatchRate(items),
      "percent",
      /* warn @ */ 40,
      /* crit @ */ 20,
    ),
    buildKpi(
      "review_turnaround_ms",
      "Tempo de Revisão",
      "Tempo médio entre criação do item e decisão de revisão (ms)",
      computeReviewTurnaroundMs(items),
      "ms",
    ),
    buildKpi(
      "pipeline_success_rate",
      "Taxa de Sucesso do Pipeline",
      "% de itens que completaram todos os 7 estágios de normalização sem falha",
      computePipelineSuccessRate(items),
      "percent",
      /* warn @ */ 85,
      /* crit @ */ 70,
    ),
    buildKpi(
      "avg_confidence",
      "Confiança Média Global",
      "Confiança média global de todos os itens processados (0–100%)",
      computeAvgConfidence(items),
      "percent",
      /* warn @ */ 60,
      /* crit @ */ 40,
    ),
    buildKpi(
      "retry_rate",
      "Taxa de Retry",
      "% de sessões de importação que precisaram de pelo menos 1 retry",
      computeRetryRate(sessions),
      "percent",
      /* warn @ */ 15,
      /* crit @ */ 30,
    ),
  ];

  return {
    organizationId,
    periodStart,
    periodEnd,
    sessionCount: sessions.length,
    itemCount:    items.length,
    kpis,
    createdAt:    new Date().toISOString(),
  };
}

// ─── Individual KPI getters ───────────────────────────────────────────────────

export function getKpi(
  snapshot: ImportAnalyticsSnapshot,
  key:      string,
): ImportKpi | null {
  return snapshot.kpis.find(k => k.key === key) ?? null;
}

export function getHealthyKpis(snapshot: ImportAnalyticsSnapshot): ImportKpi[] {
  return snapshot.kpis.filter(k => k.isHealthy);
}

export function getUnhealthyKpis(snapshot: ImportAnalyticsSnapshot): ImportKpi[] {
  return snapshot.kpis.filter(k => !k.isHealthy);
}

export function isSnapshotHealthy(snapshot: ImportAnalyticsSnapshot): boolean {
  return snapshot.kpis.every(k => k.isHealthy);
}

// ─── Trend comparison ─────────────────────────────────────────────────────────

export interface KpiTrend {
  key:      string;
  previous: number;
  current:  number;
  delta:    number;
  direction: "up" | "down" | "stable";
}

export function compareSnapshots(
  previous: ImportAnalyticsSnapshot,
  current:  ImportAnalyticsSnapshot,
): KpiTrend[] {
  return current.kpis.map(kpi => {
    const prev = previous.kpis.find(k => k.key === kpi.key);
    const prevVal = prev?.value ?? 0;
    const delta   = kpi.value - prevVal;
    return {
      key:       kpi.key,
      previous:  prevVal,
      current:   kpi.value,
      delta:     Math.round(delta * 100) / 100,
      direction: Math.abs(delta) < 0.01 ? "stable" : delta > 0 ? "up" : "down",
    };
  });
}
