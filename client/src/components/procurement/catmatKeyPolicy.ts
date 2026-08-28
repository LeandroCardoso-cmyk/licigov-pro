/**
 * Política PURA de idempotency key para as decisões governadas de CATMAT/CATSER
 * (`itemIntelligence.decidirCATMAT`). Extraída para ser determinística e testável.
 *
 * Uma "tentativa lógica" é uma decisão humana com um payload específico (item + decisão + código/
 * sugestão + justificativa). A key deve estar VINCULADA a esse payload lógico:
 *
 *  - nova ação/intenção humana (payload diferente)                → NOVA key;
 *  - mesmo payload + erro transitório/rede/INTERNAL_SERVER_ERROR  → MESMA key (retry replay-safe);
 *  - retry do MESMO logical attempt                               → MESMA key;
 *  - sucesso                                                      → rotacionar (próxima ação, nova key);
 *  - mudança de payload/decisão                                   → NOVA logical attempt, NOVA key;
 *  - erro de validação (exige correção humana)                   → a correção é NOVA logical attempt.
 *
 * Só um erro TRANSITÓRIO com o MESMO payload reutiliza a key — assim um commit no servidor seguido de
 * timeout/rede não gera uma segunda entrada no ledger quando o usuário tenta de novo.
 */

export interface CatmatDecisionPayload {
  readonly itemId: string;
  readonly decision: "confirmado" | "rejeitado" | "substituido" | "sem_correspondencia_segura";
  readonly suggestionId?: string;
  readonly catmatCode?: string;
  readonly catmatDescription?: string;
  readonly justification?: string;
}

export interface CatmatKeyState {
  readonly key: string;
  readonly fingerprint: string;
}

/** Fingerprint determinístico do payload LÓGICO da decisão (mesma decisão humana ⇒ mesmo fingerprint). */
export function catmatPayloadFingerprint(p: CatmatDecisionPayload): string {
  return [
    p.itemId,
    p.decision,
    p.suggestionId ?? "",
    (p.catmatCode ?? "").trim(),
    (p.catmatDescription ?? "").trim(),
    (p.justification ?? "").trim(),
  ].join("|");
}

/**
 * Códigos de erro que constituem OUTCOME DESCONHECIDO/transitório — o commit no servidor pode ter
 * ocorrido, então o retry precisa reusar a mesma key (replay-safe). Erros determinísticos de negócio
 * (validação, conflito, permissão, não encontrado) NÃO reusam: a próxima é uma nova tentativa lógica.
 */
export function isRetryableCatmatError(code: string | null | undefined): boolean {
  if (!code) return true; // erro de rede sem código tRPC ⇒ outcome desconhecido
  return code === "INTERNAL_SERVER_ERROR" || code === "TIMEOUT";
}

/**
 * Seleciona a key para a tentativa ATUAL. Reutiliza a key anterior somente quando o payload lógico é o
 * MESMO e o último erro foi transitório (retry do mesmo logical attempt); caso contrário gera uma nova.
 */
export function selectCatmatKey(
  prev: CatmatKeyState | null,
  fingerprint: string,
  lastErrorRetryable: boolean,
  gen: () => string,
): CatmatKeyState {
  if (prev && prev.fingerprint === fingerprint && lastErrorRetryable) {
    return prev;
  }
  return { key: gen(), fingerprint };
}
