/**
 * PR C.2 — Governança operacional supervisionada de CATMAT/CATSER (domínio PURO).
 *
 * Regras determinísticas para as decisões HUMANAS sobre sugestões CATMAT/CATSER.
 * Nenhuma chamada de IA, banco ou rede aqui — apenas invariantes de negócio,
 * unitariamente testáveis. A IA/heurística apenas SUGERE (domínio catmatMatching);
 * a decisão final é sempre de um servidor e é registrada em ledger imutável.
 *
 * Invariantes:
 *   - O código CATMAT NUNCA é fabricado: `confirmado` só aceita um código que veio
 *     de uma sugestão real; `substituido` exige um código informado explicitamente
 *     pelo servidor (override manual, jamais gerado pelo sistema).
 *   - Justificativa é OBRIGATÓRIA em rejeição, substituição e sem-correspondência
 *     (decisões que contrariam ou dispensam a sugestão) — rastreabilidade.
 *   - `sem_correspondencia_segura` é a saída FAIL-CLOSED assumida por um humano:
 *     não há código associado.
 */

export type CATMATGovernanceDecision =
  | "confirmado"
  | "rejeitado"
  | "substituido"
  | "sem_correspondencia_segura";

export const CATMAT_GOVERNANCE_DECISIONS: readonly CATMATGovernanceDecision[] = [
  "confirmado",
  "rejeitado",
  "substituido",
  "sem_correspondencia_segura",
] as const;

/** Estados que contrariam/dispensam a sugestão exigem justificativa auditável. */
export function requiresJustification(decision: CATMATGovernanceDecision): boolean {
  return decision !== "confirmado";
}

/** Estados que fixam um código CATMAT no item (o código nunca é fabricado). */
export function requiresCatmatCode(decision: CATMATGovernanceDecision): boolean {
  return decision === "confirmado" || decision === "substituido";
}

export interface DecisionValidationInput {
  readonly decision: CATMATGovernanceDecision;
  readonly catmatCode?: string | null;
  readonly justification?: string | null;
  /** Códigos das sugestões REAIS disponíveis para o item (proveniência do domínio). */
  readonly suggestionCodes: readonly string[];
}

export type DecisionValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const isBlank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

/**
 * Valida uma decisão humana ANTES de persistir no ledger. Fail-closed: qualquer
 * ambiguidade resulta em recusa explícita (nunca "resolve" inventando dado).
 */
export function validateDecision(input: DecisionValidationInput): DecisionValidation {
  const { decision, catmatCode, justification, suggestionCodes } = input;

  if (requiresJustification(decision) && isBlank(justification)) {
    return { ok: false, reason: "justification_required" };
  }

  if (requiresCatmatCode(decision)) {
    if (isBlank(catmatCode)) {
      return { ok: false, reason: "catmat_code_required" };
    }
    // `confirmado` NUNCA fabrica: o código tem de pertencer a uma sugestão real.
    if (decision === "confirmado" && !suggestionCodes.includes(catmatCode!.trim())) {
      return { ok: false, reason: "confirm_requires_existing_suggestion" };
    }
  } else {
    // rejeição e sem-correspondência não fixam código.
    if (!isBlank(catmatCode)) {
      return { ok: false, reason: "catmat_code_not_allowed_for_decision" };
    }
  }

  return { ok: true };
}

/**
 * Proveniência a registrar no ledger para cada decisão. `confirmado` herda a fonte
 * da sugestão decidida (o serviço só confirma sugestão VERIFICADA no catálogo oficial);
 * `substituido` é override MANUAL — `manual+<fonte>` quando o mesmo código tem evidência
 * oficial verificada; rejeição e sem-correspondência não carregam código.
 * Nunca declara uma fonte sem evidência: sem fonte conhecida ⇒ `sem-proveniencia`.
 */
export function decisionSource(
  decision: CATMATGovernanceDecision,
  suggestionSource?: string | null,
  manualEvidenceSource?: string | null,
): string | null {
  if (decision === "confirmado") return suggestionSource ?? "sem-proveniencia";
  if (decision === "substituido") return manualEvidenceSource ? `manual+${manualEvidenceSource}`.slice(0, 40) : "manual";
  return null;
}
