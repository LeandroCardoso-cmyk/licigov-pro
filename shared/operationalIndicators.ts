/**
 * R9 / SEM-070 — Constantes compartilhadas (cliente × servidor) dos indicadores do Centro de Operações.
 *
 * "Contratos vencendo" = contratos DISTINTOS (nunca eventos/alertas) cuja data de término vigente
 * (o evento de vencimento mais recente do contrato) cai entre HOJE e HOJE + CONTRACT_EXPIRING_WINDOW_DAYS
 * (inclusive nas duas pontas), e que não estão encerrados/rescindidos/arquivados.
 */
export const CONTRACT_EXPIRING_WINDOW_DAYS = 30;

/** Soma N dias a uma data local ISO (YYYY-MM-DD), de forma determinística (UTC, sem fuso). */
export function addIsoDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
