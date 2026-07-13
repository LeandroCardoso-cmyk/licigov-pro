/**
 * FASE 5 — Contract Observability (Contratos)
 *
 * Métricas do domínio: origem, tipo, documentos gerados, aditivos, apostilamentos,
 * pareceres, ocorrências e tempo de elaboração. Funções puras + emissão estruturada.
 * Determinístico, multi-tenant. Foco documental — nunca métricas financeiras.
 */

export interface ContractMetricRow {
  readonly originType: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Distribuição por origem (processo_licitatorio/contratacao_direta/externo). */
export function byOrigin(rows: readonly ContractMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.originType] = (out[r.originType] ?? 0) + 1;
  return out;
}

/** Distribuição por status. */
export function byStatus(rows: readonly ContractMetricRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** Contratos importados (externos). */
export function importedCount(rows: readonly ContractMetricRow[]): number {
  return rows.filter(r => r.originType === "externo").length;
}

/** Tempo médio (ms) de elaboração (criação → última atualização). */
export function averageElaborationMs(rows: readonly ContractMetricRow[]): number {
  if (rows.length === 0) return 0;
  let total = 0; let n = 0;
  for (const r of rows) {
    const c = Date.parse(r.createdAt); const u = Date.parse(r.updatedAt);
    if (!Number.isNaN(c) && !Number.isNaN(u) && u >= c) { total += u - c; n++; }
  }
  return n === 0 ? 0 : total / n;
}

export function recordContractMetric(params: {
  organizationId: number; correlationId: string; originType: string; eventName: string;
}): void {
  console.info(JSON.stringify({ metric: "contract_metric", ...params }));
}
