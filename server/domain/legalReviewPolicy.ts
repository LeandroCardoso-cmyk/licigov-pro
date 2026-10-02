/**
 * R8 — scaffolding FAIL-CLOSED das regras que dependem de PARECER JURÍDICO (PR-19 / PR-20; SEM-010, SEM-011, SEM-084).
 *
 * Nada aqui decide direito. Cada política registra o estado da revisão jurídica; enquanto for `PENDING_LEGAL_REVIEW`:
 *  - nenhum caller pode afirmar a regra como VALIDADA (`assertLegalPolicyValidated` ⇒ PRECONDITION_FAILED);
 *  - documentos e registros carregam o marcador explícito `NOT_VALIDATED_LEGAL_POLICY_PENDING` e um aviso [REVISAR];
 *  - a regra legada que já existe continua como está (não é corrigida por inferência) e é rotulada como sob revisão.
 * Mudar o status para `VALIDATED` exige o parecer registrado (referência) — ver docs/audits/LEGAL_REVIEW_DECISION_PACKET.md.
 */
import { TRPCError } from "@trpc/server";

export type LegalPolicyId =
  | "SEM-010_DIRECT_CONTRACT_LEGAL_CATALOG"   // catálogo legado arts. 74/75 (PR-19)
  | "SEM-011_LEGACY_ADDENDUM_LIMITS"          // limites 50% / compensação / 120 meses do legado (PR-20)
  | "SEM-084_CANONICAL_ADDENDUM_LIMITS";      // limites de valor/prazo dos aditivos canônicos (art. 125) (PR-20)

export type LegalPolicyStatus = "PENDING_LEGAL_REVIEW" | "VALIDATED";

export interface LegalPolicy {
  readonly id: LegalPolicyId;
  readonly status: LegalPolicyStatus;
  /** Referência do parecer jurídico que validou a regra (obrigatória quando VALIDATED). */
  readonly opinionReference: string | null;
  readonly notice: string;
}

export const NOT_VALIDATED_LEGAL_POLICY_PENDING = "NOT_VALIDATED_LEGAL_POLICY_PENDING";
export const LEGAL_POLICY_PENDING = "LEGAL_POLICY_PENDING";

export const LEGAL_POLICIES: Readonly<Record<LegalPolicyId, LegalPolicy>> = {
  "SEM-010_DIRECT_CONTRACT_LEGAL_CATALOG": {
    id: "SEM-010_DIRECT_CONTRACT_LEGAL_CATALOG", status: "PENDING_LEGAL_REVIEW", opinionReference: null,
    notice: "Catálogo legal legado (arts. 74/75) sob revisão jurídica — enquadramento e limites não validados pelo sistema.",
  },
  "SEM-011_LEGACY_ADDENDUM_LIMITS": {
    id: "SEM-011_LEGACY_ADDENDUM_LIMITS", status: "PENDING_LEGAL_REVIEW", opinionReference: null,
    notice: "Limites de aditivo do módulo legado (art. 125) sob revisão jurídica — não validados pelo sistema.",
  },
  "SEM-084_CANONICAL_ADDENDUM_LIMITS": {
    id: "SEM-084_CANONICAL_ADDENDUM_LIMITS", status: "PENDING_LEGAL_REVIEW", opinionReference: null,
    notice: "Limites legais de valor/prazo do aditivo (art. 125 da Lei 14.133/2021) não verificados pelo sistema — política jurídica pendente.",
  },
};

export function legalPolicy(id: LegalPolicyId, registry: Readonly<Record<LegalPolicyId, LegalPolicy>> = LEGAL_POLICIES): LegalPolicy {
  return registry[id];
}

/** Marcador para metadata/auditoria: o que o sistema pode afirmar sobre a regra. */
export function legalPolicyMarker(id: LegalPolicyId, registry = LEGAL_POLICIES): { policy: LegalPolicyId; validation: string; opinionReference: string | null } {
  const p = legalPolicy(id, registry);
  return { policy: id, validation: p.status === "VALIDATED" && p.opinionReference ? "VALIDATED" : NOT_VALIDATED_LEGAL_POLICY_PENDING, opinionReference: p.opinionReference };
}

/** Linha [REVISAR] para documentos enquanto a política não estiver validada (vazio quando validada). */
export function legalPolicyReviewLine(id: LegalPolicyId, registry = LEGAL_POLICIES): string | null {
  const p = legalPolicy(id, registry);
  return p.status === "VALIDATED" && p.opinionReference ? null : `> [REVISAR: ${p.notice}]`;
}

/** Fail-closed: quem precisar da regra VALIDADA (ex.: bloquear/aprovar por limite legal) não a obtém sem parecer. */
export function assertLegalPolicyValidated(id: LegalPolicyId, registry = LEGAL_POLICIES): void {
  const p = legalPolicy(id, registry);
  if (p.status !== "VALIDATED" || !p.opinionReference) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${p.notice} (${LEGAL_POLICY_PENDING}: ${id})` });
  }
}
