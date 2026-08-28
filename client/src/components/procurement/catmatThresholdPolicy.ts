/**
 * Política PURA de entrada do LIMIAR institucional de CATMAT/CATSER (fail-closed).
 * Extraída para ser determinística e testável — sem React/tRPC.
 *
 * Regras (espelham o backend `setCATMATThreshold`, `minScore ∈ [0,1]`, `reason` ≥ 3):
 *  - o percentual é digitado em 0–100 e convertido para score 0–1;
 *  - entrada inválida (vazia, fora de faixa, justificativa curta) → NÃO produz payload
 *    (a UI não dispara a mutation) — nunca há default silencioso.
 */

export interface CatmatThresholdInput {
  readonly minScore: number;
  readonly reason: string;
}

export type CatmatThresholdParse =
  | { readonly ok: true; readonly value: CatmatThresholdInput }
  | { readonly ok: false; readonly error: string };

/** Valida e normaliza a entrada humana do limiar. Fail-closed: sem número válido → recusa. */
export function parseThresholdInput(percentRaw: string, reasonRaw: string): CatmatThresholdParse {
  const trimmed = String(percentRaw).trim();
  // Vazio NÃO vira 0 (Number("") === 0): sem valor explícito, recusa — fail-closed, nunca default.
  if (trimmed.length === 0) return { ok: false, error: "Informe um score entre 0 e 100." };
  const pct = Number(trimmed);
  if (!Number.isFinite(pct)) return { ok: false, error: "Informe um score entre 0 e 100." };
  if (pct < 0 || pct > 100) return { ok: false, error: "O score deve estar entre 0 e 100." };
  const reason = reasonRaw.trim();
  if (reason.length < 3) return { ok: false, error: "Informe uma justificativa (mín. 3 caracteres)." };
  return { ok: true, value: { minScore: pct / 100, reason } };
}
