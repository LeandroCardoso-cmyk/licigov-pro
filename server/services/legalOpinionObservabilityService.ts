/**
 * FASE 5 — Legal Opinion Observability (Parecer Jurídico)
 *
 * Métricas do domínio: tempo de análise, tempo médio, pareceres emitidos,
 * solicitações por origem, tempo de resposta e produtividade. Funções puras +
 * emissão estruturada (console). Determinístico, multi-tenant.
 */

export interface LegalOpinionMetricRow {
  readonly sourceDomain: string;
  readonly currentStage: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Pareceres emitidos (assinados/devolvidos/arquivados após conclusão). */
export function emittedOpinions(rows: readonly LegalOpinionMetricRow[]): number {
  return rows.filter(r => r.currentStage === "SIGNED" || r.currentStage === "RETURNED" || r.currentStage === "ARCHIVED").length;
}

/** Solicitações por domínio de origem. */
export function requestsByOrigin(rows: readonly LegalOpinionMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.sourceDomain] = (out[r.sourceDomain] ?? 0) + 1;
  return out;
}

/** Tempo médio (ms) entre criação e última atualização de pareceres concluídos. */
export function averageAnalysisMs(rows: readonly LegalOpinionMetricRow[]): number {
  const done = rows.filter(r => r.currentStage === "RETURNED" || r.currentStage === "ARCHIVED" || r.currentStage === "SIGNED");
  if (done.length === 0) return 0;
  let total = 0;
  for (const r of done) {
    const created = Date.parse(r.createdAt);
    const updated = Date.parse(r.updatedAt);
    if (!Number.isNaN(created) && !Number.isNaN(updated) && updated >= created) total += updated - created;
  }
  return total / done.length;
}

/** Pareceres ainda em aberto (na caixa/análise/elaboração/revisão). */
export function pendingOpinions(rows: readonly LegalOpinionMetricRow[]): number {
  const open = new Set(["INBOX", "RECEIVED", "UNDER_ANALYSIS", "WAITING_INFORMATION", "DRAFT", "REVIEW"]);
  return rows.filter(r => open.has(r.currentStage)).length;
}

/** Produtividade: pareceres emitidos por procurador (workspaces concluídos). */
export function productivity(rows: readonly LegalOpinionMetricRow[]): { emitted: number; pending: number; throughput: number } {
  const emitted = emittedOpinions(rows);
  const pending = pendingOpinions(rows);
  const total = rows.length || 1;
  return { emitted, pending, throughput: emitted / total };
}

export function recordLegalOpinionMetric(params: {
  organizationId: number;
  correlationId: string;
  sourceDomain: string;
  eventName: string;
}): void {
  console.info(JSON.stringify({ metric: "legal_opinion_metric", ...params }));
}
