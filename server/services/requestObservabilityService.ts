/**
 * Kernel — Institutional Request Observability
 *
 * Métricas de solicitações: tempo de resposta, tempo médio, solicitações por
 * domínio, pendências, filas, gargalos e produtividade. Funções puras +
 * emissão estruturada (console). Determinístico.
 */

import type { BusinessDomainCode } from "../domain/institutionalRequest";

export interface RequestMetricRow {
  readonly destinationDomain: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Contagem de pendências por domínio de destino (fila). */
export function pendingByDomain(rows: readonly RequestMetricRow[]): Record<string, number> {
  const pendingStatuses = new Set(["PENDING", "RECEIVED", "IN_PROGRESS", "WAITING_INFORMATION"]);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (pendingStatuses.has(r.status)) out[r.destinationDomain] = (out[r.destinationDomain] ?? 0) + 1;
  }
  return out;
}

/** Tempo médio (ms) entre criação e última atualização de solicitações concluídas. */
export function averageResponseMs(rows: readonly RequestMetricRow[]): number {
  const done = rows.filter(r => r.status === "COMPLETED" || r.status === "RETURNED" || r.status === "ARCHIVED");
  if (done.length === 0) return 0;
  let total = 0;
  for (const r of done) {
    const created = Date.parse(r.createdAt);
    const updated = Date.parse(r.updatedAt);
    if (!Number.isNaN(created) && !Number.isNaN(updated) && updated >= created) total += updated - created;
  }
  return total / done.length;
}

/** Identifica o domínio com maior fila de pendências (gargalo). */
export function bottleneckDomain(rows: readonly RequestMetricRow[]): string | null {
  const pending = pendingByDomain(rows);
  let max = 0; let domain: string | null = null;
  for (const [d, n] of Object.entries(pending)) {
    if (n > max) { max = n; domain = d; }
  }
  return domain;
}

export function recordRequestMetric(params: {
  organizationId: number;
  correlationId: string;
  sourceDomain: BusinessDomainCode;
  destinationDomain: BusinessDomainCode;
  eventName: string;
}): void {
  console.info(JSON.stringify({ metric: "institutional_request_metric", ...params }));
}
