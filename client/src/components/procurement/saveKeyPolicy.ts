/**
 * C.4B.3A (Blocker 5) — Política de rotação da idempotencyKey do save governado (DFD).
 *
 * A idempotencyKey identifica UMA tentativa lógica de gravação. Regra:
 *   - SUCESSO       → rotacionar (a próxima gravação é uma operação nova);
 *   - CONFLICT      → rotacionar: o estado revisado expirou; a UI recarrega e exige nova revisão, logo
 *                     a próxima tentativa parte de um estado diferente (nova operação lógica);
 *   - erro TRANSITÓRIO (network / INTERNAL_SERVER_ERROR / etc.) → MANTER a mesma chave, para que o
 *                     retry seguro seja idempotente (não duplica efeito nem cria segundo ledger).
 *
 * Puro e determinístico — testável sem jsdom (padrão do projeto).
 */
export function shouldRotateSaveKeyOnError(errorCode: string | null | undefined): boolean {
  return errorCode === "CONFLICT";
}
