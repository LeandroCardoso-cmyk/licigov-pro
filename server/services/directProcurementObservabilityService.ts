/**
 * FASE 5 — Direct Procurement Observability (Contratação Direta)
 *
 * Métricas do domínio: modalidade, fundamento, procedimento, plataforma, tempo
 * por etapa, propostas recebidas, parecer solicitado/recebido, ratificação e
 * publicação. Funções puras + emissão estruturada. Determinístico, multi-tenant.
 */

export interface DirectProcurementMetricRow {
  readonly procurementType: string;
  readonly procedureType: string;
  readonly currentStage: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Distribuição por modalidade (dispensa/inexigibilidade). */
export function byProcurementType(rows: readonly DirectProcurementMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.procurementType] = (out[r.procurementType] ?? 0) + 1;
  return out;
}

/** Distribuição por procedimento (eletronico/presencial/indefinido). */
export function byProcedureType(rows: readonly DirectProcurementMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.procedureType] = (out[r.procedureType] ?? 0) + 1;
  return out;
}

/** Processos concluídos (publicados/concluídos/arquivados). */
export function concludedProcesses(rows: readonly DirectProcurementMetricRow[]): number {
  return rows.filter(r => r.currentStage === "PUBLICATION" || r.currentStage === "CONTRACT" || r.currentStage === "ARCHIVED").length;
}

/** Processos aguardando parecer jurídico. */
export function awaitingLegalOpinion(rows: readonly DirectProcurementMetricRow[]): number {
  return rows.filter(r => r.status === "aguardando_parecer" || r.currentStage === "LEGAL_OPINION").length;
}

/** Tempo médio (ms) do ciclo dos processos concluídos. */
export function averageCycleMs(rows: readonly DirectProcurementMetricRow[]): number {
  const done = rows.filter(r => r.currentStage === "CONTRACT" || r.currentStage === "ARCHIVED" || r.currentStage === "PUBLICATION");
  if (done.length === 0) return 0;
  let total = 0;
  for (const r of done) {
    const c = Date.parse(r.createdAt); const u = Date.parse(r.updatedAt);
    if (!Number.isNaN(c) && !Number.isNaN(u) && u >= c) total += u - c;
  }
  return total / done.length;
}

export function recordDirectProcurementMetric(params: {
  organizationId: number;
  correlationId: string;
  procurementType: string;
  eventName: string;
}): void {
  console.info(JSON.stringify({ metric: "direct_procurement_metric", ...params }));
}
