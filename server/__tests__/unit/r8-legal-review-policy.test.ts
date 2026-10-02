/**
 * R8 — scaffolding fail-closed das políticas jurídicas (PR-19 / PR-20; SEM-010, SEM-011, SEM-084).
 * Nenhuma regra é afirmada como validada sem parecer registrado.
 */
import { describe, it, expect } from "vitest";
import {
  LEGAL_POLICIES, LEGAL_POLICY_PENDING, NOT_VALIDATED_LEGAL_POLICY_PENDING,
  assertLegalPolicyValidated, legalPolicyMarker, legalPolicyReviewLine, type LegalPolicy, type LegalPolicyId,
} from "../../domain/legalReviewPolicy";
import { buildAddendumTermContent } from "../../domain/instrumentTerms";

const IDS = Object.keys(LEGAL_POLICIES) as LegalPolicyId[];

describe("R8 — políticas jurídicas pendentes (fail-closed)", () => {
  it("todas as políticas nascem PENDING_LEGAL_REVIEW, sem parecer", () => {
    for (const id of IDS) expect(LEGAL_POLICIES[id]).toMatchObject({ status: "PENDING_LEGAL_REVIEW", opinionReference: null });
  });

  it("pendente ⇒ marcador NOT_VALIDATED, linha [REVISAR] e assert recusa", () => {
    for (const id of IDS) {
      expect(legalPolicyMarker(id)).toEqual({ policy: id, validation: NOT_VALIDATED_LEGAL_POLICY_PENDING, opinionReference: null });
      expect(legalPolicyReviewLine(id)).toMatch(/^> \[REVISAR: /);
      expect(() => assertLegalPolicyValidated(id)).toThrow(LEGAL_POLICY_PENDING);
    }
  });

  it("VALIDATED sem referência de parecer continua não validada; com referência, libera", () => {
    const id: LegalPolicyId = "SEM-084_CANONICAL_ADDENDUM_LIMITS";
    const noRef = { ...LEGAL_POLICIES, [id]: { ...LEGAL_POLICIES[id], status: "VALIDATED", opinionReference: null } as LegalPolicy };
    expect(() => assertLegalPolicyValidated(id, noRef)).toThrow(LEGAL_POLICY_PENDING);
    const ok = { ...LEGAL_POLICIES, [id]: { ...LEGAL_POLICIES[id], status: "VALIDATED", opinionReference: "Parecer nº X/2026" } as LegalPolicy };
    expect(() => assertLegalPolicyValidated(id, ok)).not.toThrow();
    expect(legalPolicyMarker(id, ok).validation).toBe("VALIDATED");
    expect(legalPolicyReviewLine(id, ok)).toBeNull();
  });

  it("termo aditivo de valor carrega o aviso do art. 125 não verificado", () => {
    const c = { contractNumber: "CT-1", contractor: "F", object: "O", term: "12 meses" };
    const content = buildAddendumTermContent(c, { id: "a1", sequence: 1, addendumType: "valor", justification: "J", newValue: 10, newTerm: "", status: "aguardando_parecer" });
    expect(content).toContain("art. 125 da Lei 14.133/2021) não verificados pelo sistema");
    const qual = buildAddendumTermContent(c, { id: "a2", sequence: 2, addendumType: "qualitativo", justification: "J", newValue: 0, newTerm: "", status: "finalizado" });
    expect(qual).not.toContain("art. 125");
  });
});
