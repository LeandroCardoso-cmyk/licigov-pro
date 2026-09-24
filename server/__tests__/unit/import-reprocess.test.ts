/**
 * Layout v2 — regra de domínio do REPROCESSAMENTO seguro: qualquer intervenção humana ⇒ FORBIDDEN.
 */
import { describe, it, expect } from "vitest";
import {
  assessReprocessEligibility, isReextractionReservationActive, REEXTRACTION_LEASE_MS, REEXTRACTION_STAGE,
  REPROCESS_EXPLANATION, type ReprocessFacts,
} from "../../domain/importReprocess";

const now = new Date("2026-09-24T12:00:00Z");
const base: ReprocessFacts = {
  status: "awaiting_review", isDocumentImport: false, promotionStatus: "none", hasPromotionLedger: false,
  stage: "awaiting_review", updatedAt: now, now,
  staging: { total: 10, pending: 10, approved: 0, rejected: 0, skipped: 0, corrected: 0 }, correctionHistory: 0,
};
const st = (over: Partial<ReprocessFacts["staging"]>) => ({ ...base, staging: { ...base.staging, ...over } });

describe("assessReprocessEligibility", () => {
  it("sessão em revisão, tudo pendente, sem correção nem promoção ⇒ ELEGÍVEL (com a explicação institucional)", () => {
    expect(assessReprocessEligibility(base)).toEqual({ eligible: true, blockers: [], message: REPROCESS_EXPLANATION });
  });
  it.each([
    ["item aceito", st({ pending: 9, approved: 1 }), "ITEMS_REVIEWED"],
    ["item rejeitado", st({ pending: 9, rejected: 1 }), "ITEMS_REVIEWED"],
    ["item pulado", st({ pending: 9, skipped: 1 }), "ITEMS_REVIEWED"],
    ["item corrigido", st({ corrected: 1 }), "ITEMS_CORRECTED"],
    ["histórico de correção", { ...base, correctionHistory: 1 }, "ITEMS_CORRECTED"],
    ["promovida (projeção)", { ...base, promotionStatus: "promoted" }, "PROMOTED"],
    ["promovida (ledger)", { ...base, hasPromotionLedger: true }, "PROMOTED"],
    ["aprovada", { ...base, status: "approved" }, "NOT_AWAITING_REVIEW"],
    ["rejeitada", { ...base, status: "rejected" }, "NOT_AWAITING_REVIEW"],
    ["documento (DFD/ETP/TR)", { ...base, isDocumentImport: true }, "DOCUMENT_IMPORT"],
    ["reprocessamento em andamento", { ...base, stage: REEXTRACTION_STAGE }, "REPROCESS_IN_PROGRESS"],
  ] as const)("%s ⇒ FORBIDDEN (%s)", (_l, facts, blocker) => {
    const r = assessReprocessEligibility(facts as ReprocessFacts);
    expect(r.eligible).toBe(false);
    expect(r.blockers).toContain(blocker);
    expect(r.message.length).toBeGreaterThan(10);
  });
  it("reserva expirada (processo reiniciado no meio) pode ser retomada; reserva vigente não", () => {
    const old = new Date(now.getTime() - REEXTRACTION_LEASE_MS - 1000);
    expect(isReextractionReservationActive(REEXTRACTION_STAGE, old, now)).toBe(false);
    expect(isReextractionReservationActive(REEXTRACTION_STAGE, now, now)).toBe(true);
    expect(assessReprocessEligibility({ ...base, stage: REEXTRACTION_STAGE, updatedAt: old }).eligible).toBe(true);
  });
});
