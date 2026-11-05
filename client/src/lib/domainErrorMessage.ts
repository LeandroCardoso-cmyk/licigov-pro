/** Motivos de fonte que significam "falta informar" (não falha técnica). Espelho de `canonicalSources.ts` (`incomplete(...)`). */
export const INCOMPLETE_SOURCE_REASONS = ["CANONICAL_ITEMS_REQUIRED", "PLANNED_QUANTITY_MISSING"] as const;
const INCOMPLETE_SOURCE_RE = new RegExp(`^(?:[A-Z][A-Z0-9_]{2,}:\\s*)?(?:SOURCE_UNAVAILABLE\\s+—\\s+)?[A-Z_]+\\s+—\\s+(${INCOMPLETE_SOURCE_REASONS.join("|")}):\\s*([\\s\\S]+)$`);

/**
 * Mensagem de erro de domínio legível: o servidor prefixa erros estáveis com o código
 * (ex.: "PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista…") para que testes/clientes detectem o
 * caso; na tela mostramos só a frase institucional.
 */
export function domainErrorMessage(message: string | null | undefined, fallback: string): string {
  const raw = message ?? "";
  // LICIGOV-FAST S3 — fonte do modelo institucional ÍNTEGRA, mas falta informação na origem (Itens da contratação): mostra só a
  // orientação. Restrito a estes motivos: falha técnica/integridade/escopo continua aparecendo como tal (nunca vira "pendência").
  const incomplete = INCOMPLETE_SOURCE_RE.exec(raw);
  if (incomplete && incomplete[2].trim()) return incomplete[2].trim();
  const text = raw.replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, "").trim();
  return text || fallback;
}
