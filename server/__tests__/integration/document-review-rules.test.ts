/**
 * PR C.2B — Regras puras de revisão/aprovação documental (unit, sem DB).
 *
 * Cobre a extensão canônica do state machine (devolução in_review→draft) e a segregação de
 * deveres reutilizada (`assertInstitutionalDecisionRules`). O comportamento end-to-end
 * (idempotência, version-aware, multi-tenant, ledger) é coberto contra MySQL real em
 * `document-review-mysql-smoke.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { isValidTransition, WORKFLOW_TRANSITIONS } from "../../domain/documentTypes";
import { assertInstitutionalDecisionRules } from "../../services/documentWorkflowService";

describe("PR C.2B — transições do workflow documental", () => {
  it("habilita devolução para ajustes: in_review → draft", () => {
    expect(isValidTransition("in_review", "draft")).toBe(true);
    expect(WORKFLOW_TRANSITIONS.in_review).toContain("draft");
  });

  it("mantém as transições canônicas de revisão", () => {
    expect(isValidTransition("draft", "in_review")).toBe(true);
    expect(isValidTransition("in_review", "approved")).toBe(true);
    expect(isValidTransition("in_review", "rejected")).toBe(true);
    expect(isValidTransition("approved", "in_review")).toBe(false); // reabrir aprovado não é permitido
    expect(isValidTransition("draft", "approved")).toBe(false);      // não pula revisão
  });
});

describe("PR C.2B — segregação de deveres nas decisões documentais", () => {
  it("aprovação exige revisor ≠ autor", () => {
    expect(() => assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 5, authorUserId: 5, reason: null }))
      .toThrow(/autor.*não pode aprová-lo|revisor distinto/i);
    expect(() => assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 6, authorUserId: 5, reason: null }))
      .not.toThrow();
  });

  it("aprovação exige revisor humano identificado (IA/sistema não aprova)", () => {
    expect(() => assertInstitutionalDecisionRules({ toState: "approved", actorUserId: 0, authorUserId: 5, reason: null }))
      .toThrow(/revisor humano identificado/i);
  });

  it("rejeição e devolução (draft) exigem justificativa não-vazia", () => {
    expect(() => assertInstitutionalDecisionRules({ toState: "rejected", actorUserId: 6, authorUserId: 5, reason: "  " }))
      .toThrow(/justificativa obrigatória/i);
    expect(() => assertInstitutionalDecisionRules({ toState: "draft", actorUserId: 6, authorUserId: 5, reason: null }))
      .toThrow(/justificativa obrigatória/i);
    expect(() => assertInstitutionalDecisionRules({ toState: "draft", actorUserId: 6, authorUserId: 5, reason: "faltou seção X" }))
      .not.toThrow();
  });
});
