/**
 * P0 piloto — exibição monetária no cliente. O CÁLCULO é sempre do servidor (centavos inteiros, half-up);
 * aqui só se formata o valor recebido em CENTAVOS para pt-BR ("R$ 1.234,56").
 */
export function formatCentsBRL(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const neg = safe < 0;
  const abs = Math.abs(safe);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}R$ ${int},${frac}`;
}
