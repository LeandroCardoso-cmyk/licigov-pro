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

/**
 * NEW-038 (2º passe) — `contract_workspaces.value` é DECIMAL(15,2) em REAIS (o editor do contrato lê/grava reais e o
 * rótulo usa `formatCurrency` sem dividir). Texto digitado ("1.234,56") ⇒ reais com 2 casas (1234.56), ou `undefined`
 * quando vazio/ilegível. NUNCA centavos: o wizard de contrato avulso mandava `Math.round(x * 100)` e o contrato nascia
 * com o valor ×100.
 */
export function parseReaisInputToDecimal(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const n = parseFloat(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}
