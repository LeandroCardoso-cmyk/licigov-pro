/**
 * P0 piloto — exibição monetária no cliente. O CÁLCULO é sempre do servidor (centavos inteiros, half-up);
 * aqui só se formata o valor recebido em CENTAVOS para pt-BR ("R$ 1.234,56").
 *
 * R6 / PR-14 (SEM-012, INV-16): o formatador é ÚNICO e vive em `@shared/money` (mesmo do servidor).
 */
export { formatCentsBRL, MONEY_MEANING } from "@shared/money";

/**
 * NEW-036 — o cadastro LEGADO de contrato (`/contratos/novo` → `contracts.*`) trabalha em REAIS. Estas duas funções
 * são a única ponte centavos ⇄ texto em reais desse formulário: o prefill (processo/contratação direta, em centavos)
 * e a leitura do campo digitado ("1.500,50" ⇒ 1500.5). O ponto é separador de milhar; a vírgula, decimal.
 */
export function centsToLegacyReaisInput(cents: number | null | undefined): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return (n / 100).toFixed(2).replace(".", ",");
}

export function parseLegacyReaisInput(text: string): number {
  return parseFloat(text.replace(/[^\d,]/g, "").replace(",", "."));
}
