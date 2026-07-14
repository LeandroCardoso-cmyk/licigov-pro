/**
 * FASE 5 — Operational Observability (Centro de Operações)
 *
 * Métricas do Centro de Operações: registros por tipo/origem, eventos por tipo,
 * vencimentos próximos e produtividade. Funções puras + emissão estruturada.
 * Determinístico, multi-tenant. NUNCA métricas financeiras.
 */

export interface OperationRecordMetricRow {
  readonly recordType: string;
  readonly origin: string;
}

export interface EventMetricRow {
  readonly eventType: string;
  readonly eventDate: string;
}

/** Registros por tipo. */
export function recordsByType(rows: readonly OperationRecordMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.recordType] = (out[r.recordType] ?? 0) + 1;
  return out;
}

/** Registros por origem (interna/externa). */
export function recordsByOrigin(rows: readonly OperationRecordMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.origin] = (out[r.origin] ?? 0) + 1;
  return out;
}

/** Eventos por tipo. */
export function eventsByType(rows: readonly EventMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.eventType] = (out[r.eventType] ?? 0) + 1;
  return out;
}

/** Vencimentos a partir de hoje (contrato/aditivo/ata). */
export function upcomingExpirations(rows: readonly EventMetricRow[], today: string): number {
  const types = new Set(["vencimento_contrato", "vencimento_aditivo", "vencimento_ata"]);
  return rows.filter(r => types.has(r.eventType) && r.eventDate >= today).length;
}

export function recordOperationalMetric(params: {
  organizationId: number;
  correlationId: string;
  eventName: string;
}): void {
  console.info(JSON.stringify({ metric: "department_operation_metric", ...params }));
}
