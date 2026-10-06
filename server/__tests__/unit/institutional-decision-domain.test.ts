/**
 * R4 / R4.1 — regra pura do ledger de decisões institucionais (server/domain/institutionalDecision.ts).
 */
import { describe, it, expect } from "vitest";
import {
  AUTHORITY_NOT_VALIDATED, DECISION_FIELDS_REQUIRED, DECISION_IDEMPOTENCY_CONFLICT, DECISION_OUTCOME_INVALID,
  DECISION_STALE_REVISION, decisionId, planDecision, validateDecisionRequest, type DecisionRequest,
} from "../../domain/institutionalDecision";

const base: DecisionRequest = {
  organizationId: 7, subjectType: "direct_procurement.ratification", subjectId: "ws-1", decisionType: "ratification",
  outcome: "ratificado", decidedByName: "Autoridade", decidedByRole: "Prefeito", decidedByUserId: null,
  decidedAt: "2026-09-30", basisReference: "Despacho 1/2026", reason: "Justificativa suficiente.", evidence: ["e1"],
  recordedByUserId: 42, expectedRevision: 0, idempotencyKey: "key-00000001", correlationId: "c1",
};

describe("R4.1 — contrato de decisão institucional (puro)", () => {
  it("sem default: resultado ausente/fora do catálogo é recusado", () => {
    expect(validateDecisionRequest({ ...base, outcome: "" })).toMatchObject({ ok: false, code: DECISION_OUTCOME_INVALID });
    expect(validateDecisionRequest({ ...base, outcome: "aprovado" })).toMatchObject({ ok: false, code: DECISION_OUTCOME_INVALID });
    expect(validateDecisionRequest(base)).toEqual({ ok: true });
  });

  it("campos do ato obrigatórios (fail-closed), com a lista exata dos ausentes", () => {
    const v = validateDecisionRequest({ ...base, decidedByName: " ", decidedByRole: "", decidedAt: "2026-13-99x", basisReference: "", reason: "curta" });
    expect(v).toMatchObject({ ok: false, code: DECISION_FIELDS_REQUIRED });
    expect((v as { fields: string[] }).fields).toEqual(["decidedByName", "decidedByRole", "decidedAt", "basisReference", "reason"]);
  });

  it("primeira decisão: revisão 1, sem superação, autoridade NÃO validada e registrador ≠ autoridade", () => {
    const p = planDecision(base, { byIdempotencyKey: null, current: null });
    expect(p.kind).toBe("insert");
    if (p.kind !== "insert") return;
    expect(p.decision).toMatchObject({ revision: 1, supersedesDecisionId: null, authorityValidation: AUTHORITY_NOT_VALIDATED, recordedByUserId: 42, decidedByUserId: null });
    expect(p.decision.id).toBe(decisionId(7, "direct_procurement.ratification", "ws-1", 1));
  });

  it("replay idêntico converge; mesma chave + pedido diferente ⇒ conflito; trim não muda o pedido", () => {
    const first = planDecision(base, { byIdempotencyKey: null, current: null });
    if (first.kind !== "insert") throw new Error("unexpected");
    expect(planDecision({ ...base, reason: "  Justificativa suficiente.  " }, { byIdempotencyKey: first.decision, current: first.decision }).kind).toBe("replay");
    expect(planDecision({ ...base, outcome: "nao_ratificado" }, { byIdempotencyKey: first.decision, current: first.decision }))
      .toMatchObject({ kind: "conflict", code: DECISION_IDEMPOTENCY_CONFLICT });
  });

  it("CAS: revisão esperada ≠ corrente ⇒ stale; revisão correta supera explicitamente a corrente", () => {
    const first = planDecision(base, { byIdempotencyKey: null, current: null });
    if (first.kind !== "insert") throw new Error("unexpected");
    expect(planDecision({ ...base, idempotencyKey: "key-00000002" }, { byIdempotencyKey: null, current: first.decision }))
      .toMatchObject({ kind: "conflict", code: DECISION_STALE_REVISION, currentRevision: 1 });
    const second = planDecision({ ...base, idempotencyKey: "key-00000002", expectedRevision: 1, outcome: "nao_ratificado" }, { byIdempotencyKey: null, current: first.decision });
    expect(second).toMatchObject({ kind: "insert", decision: { revision: 2, supersedesDecisionId: first.decision.id, outcome: "nao_ratificado" } });
  });
});
