/**
 * Mensagem de erro de domínio legível: o servidor prefixa erros estáveis com o código
 * (ex.: "PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista…") para que testes/clientes detectem o
 * caso; na tela mostramos só a frase institucional.
 */
export function domainErrorMessage(message: string | null | undefined, fallback: string): string {
  const text = (message ?? "").replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, "").trim();
  return text || fallback;
}
