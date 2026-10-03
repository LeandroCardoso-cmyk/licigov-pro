/**
 * R9 / SEM-074 — Analytics sobre as fontes CANÔNICAS — helpers PUROS (sem DB).
 *
 * Antes, o overview de Analytics (e as estatísticas de auditoria do admin) agregavam em memória as tabelas
 * LEGADAS `processes` e `documents`, que não recebem mais escritas (o pipeline legado foi cortado — PR B —
 * e o processo/documento vivo é criado em `procurement_processes` / `generated_documents`). Resultado: painel
 * congelado, mostrando zero ou números antigos. Aqui ficam as regras puras da agregação SQL feita em
 * `server/db/admin.ts`: janela de meses, chave de mês e ordenação determinística por etapa canônica.
 */

import { STAGE_ORDER } from "./procurementProcess";

const pad = (n: number, l = 2): string => String(n).padStart(l, "0");

/**
 * Início (inclusivo) da janela de `months` meses-calendário que termina no mês de `now`, em UTC, no formato
 * DATETIME do MySQL usado pelas colunas canônicas (`YYYY-MM-DD HH:MM:SS.mmm`, UTC — ver `toDbDatetime`).
 * Ex.: now=2026-10-02, months=6 ⇒ "2026-05-01 00:00:00.000" (mai, jun, jul, ago, set, out).
 */
export function monthWindowStartUtc(now: Date, months: number): string {
  const span = Math.max(1, Math.floor(months));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (span - 1), 1, 0, 0, 0, 0));
  return `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01 00:00:00.000`;
}

/** Chave `YYYY-MM` (contrato do cliente: `documentsByMonth[].month`). */
export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

/** Linhas cruas do GROUP BY YEAR/MONTH (o driver pode devolver número como string) → contrato ordenado. */
export function toMonthCounts(rows: ReadonlyArray<{ y: number | string; m: number | string; count: number | string }>): Array<{ month: string; count: number }> {
  return rows
    .map(r => ({ month: monthKey(Number(r.y), Number(r.m)), count: Number(r.count) }))
    .filter(r => r.count > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Linhas cruas do GROUP BY `current_stage` → contrato `{ status, count }` (o campo `status` carrega a ETAPA
 * canônica, como o legado já fazia com `em_dfd`/`em_etp`… — "Distribuição dos processos por estágio").
 * Ordem determinística: a ordem canônica das etapas (STAGE_ORDER); etapas desconhecidas ao final, alfabéticas.
 */
export function toStageCounts(rows: ReadonlyArray<{ stage: string; count: number | string }>): Array<{ status: string; count: number }> {
  const rank = (s: string): number => {
    const i = (STAGE_ORDER as readonly string[]).indexOf(s);
    return i >= 0 ? i : STAGE_ORDER.length;
  };
  return rows
    .map(r => ({ status: r.stage, count: Number(r.count) }))
    .filter(r => r.count > 0)
    .sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}
