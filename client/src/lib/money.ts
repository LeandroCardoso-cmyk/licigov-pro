/**
 * P0 piloto — exibição monetária no cliente. O CÁLCULO é sempre do servidor (centavos inteiros, half-up);
 * aqui só se formata o valor recebido em CENTAVOS para pt-BR ("R$ 1.234,56").
 *
 * R6 / PR-14 (SEM-012, INV-16): o formatador é ÚNICO e vive em `@shared/money` (mesmo do servidor).
 */
export { formatCentsBRL, MONEY_MEANING } from "@shared/money";
