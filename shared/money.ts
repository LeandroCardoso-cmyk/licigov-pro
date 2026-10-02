/**
 * R6 / PR-14 (SEM-012, INV-16) — formatador monetário ÚNICO (cliente e servidor).
 *
 * Todo valor persistido em CENTAVOS inteiros é exibido por `formatCentsBRL` — nunca `value.toLocaleString` sobre
 * centavos (que exibia R$ 12.345,67 como "R$ 1.234.567,00") nem `Intl.NumberFormat` direto. Determinístico e
 * independente do locale do runtime ("R$ 1.234,56").
 *
 * O rótulo diz o SIGNIFICADO do valor (`MONEY_MEANING`): estimado ≠ referência ≠ adjudicado ≠ contratado.
 */
export function formatCentsBRL(cents: number | string | null | undefined): string {
  const n = typeof cents === "string" ? Number(cents) : cents;
  const safe = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
  const neg = safe < 0;
  const abs = Math.abs(safe);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}R$ ${int},${frac}`;
}

export const MONEY_MEANING = {
  estimated: "Valor estimado",
  reference: "Valor de referência",
  awarded: "Valor adjudicado",
  contracted: "Valor contratado",
} as const;
