/**
 * R9 / SEM-048 — Governança pura da correção de extração frente à revisão/aprovação/promoção.
 *
 * Cobre: sessão promovida ⇒ SESSION_ALREADY_PROMOTED; sessão fora de revisão ⇒ SESSION_NOT_UNDER_REVIEW; item
 * decidido ⇒ reabre; sessão aprovada ⇒ aprovação invalidada; hash idempotente canônico (mesmo payload ⇒ mesmo hash,
 * payload diferente ⇒ hash diferente); compatibilidade com o histórico pré-R9; transição approved → awaiting_review.
 */
import { describe, it, expect } from "vitest";
import {
  planCorrectionReview, correctionPayloadHash, isSameCorrection, CORRECTION_REFUSAL_MESSAGE, CORRECTION_IDEMPOTENCY_OPERATION,
} from "../../domain/importCorrectionReview";
import { isValidImportTransition } from "../../domain/importTypes";

describe("R9 / SEM-048 — planCorrectionReview", () => {
  it("sessão PROMOVIDA ⇒ recusa SESSION_ALREADY_PROMOTED (qualquer status de item/sessão)", () => {
    for (const itemReviewStatus of ["pending", "approved", "rejected", "skipped"]) {
      const plan = planCorrectionReview({ sessionStatus: "approved", promotionStatus: "promoted", itemReviewStatus });
      expect(plan).toEqual({ ok: false, refusal: "SESSION_ALREADY_PROMOTED" });
    }
    expect(CORRECTION_REFUSAL_MESSAGE.SESSION_ALREADY_PROMOTED).toMatch(/^SESSION_ALREADY_PROMOTED:/);
  });

  it("sessão fora de revisão (rejeitada/arquivada/falha/em processamento) ⇒ SESSION_NOT_UNDER_REVIEW", () => {
    for (const sessionStatus of ["rejected", "archived", "failed", "parsing", "uploaded"]) {
      expect(planCorrectionReview({ sessionStatus, promotionStatus: "none", itemReviewStatus: "pending" }))
        .toEqual({ ok: false, refusal: "SESSION_NOT_UNDER_REVIEW" });
    }
  });

  it("sessão aguardando revisão + item pendente ⇒ correção sem reabertura", () => {
    expect(planCorrectionReview({ sessionStatus: "awaiting_review", promotionStatus: "none", itemReviewStatus: "pending" }))
      .toEqual({ ok: true, reopenItem: false, previousItemStatus: "pending", reopenSession: false });
  });

  it("item já decidido (aceito/rejeitado/pulado) ⇒ volta a pendente", () => {
    for (const itemReviewStatus of ["approved", "rejected", "skipped"]) {
      const plan = planCorrectionReview({ sessionStatus: "awaiting_review", promotionStatus: null, itemReviewStatus });
      expect(plan).toEqual({ ok: true, reopenItem: true, previousItemStatus: itemReviewStatus, reopenSession: false });
    }
  });

  it("sessão APROVADA (não promovida) ⇒ item reaberto E aprovação da sessão invalidada", () => {
    expect(planCorrectionReview({ sessionStatus: "approved", promotionStatus: "none", itemReviewStatus: "approved" }))
      .toEqual({ ok: true, reopenItem: true, previousItemStatus: "approved", reopenSession: true });
  });

  it("transição de domínio approved → awaiting_review é válida (reabertura); approved → queued continua inválida", () => {
    expect(isValidImportTransition("approved", "awaiting_review")).toBe(true);
    expect(isValidImportTransition("approved", "queued")).toBe(false);
  });
});

describe("R9 / SEM-048 — correctionPayloadHash (idempotência por chave + payload)", () => {
  const base = {
    organizationId: 1, importSessionId: 2, itemId: 3, expectedRevision: 0,
    corrections: { unitPrice: "7,50", description: "cabo" }, justification: "valor errado",
  };

  it("canônico: ordem das chaves e espaços da justificativa não mudam o hash", () => {
    const a = correctionPayloadHash(base);
    const b = correctionPayloadHash({ ...base, corrections: { description: "cabo", unitPrice: "7,50" }, justification: "  valor errado " });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("qualquer diferença de payload/escopo muda o hash (⇒ CONFLICT sob a mesma chave)", () => {
    const h = correctionPayloadHash(base);
    expect(correctionPayloadHash({ ...base, corrections: { unitPrice: "9,99", description: "cabo" } })).not.toBe(h);
    expect(correctionPayloadHash({ ...base, justification: "outro motivo" })).not.toBe(h);
    expect(correctionPayloadHash({ ...base, itemId: 4 })).not.toBe(h);
    expect(correctionPayloadHash({ ...base, organizationId: 9 })).not.toBe(h);
    expect(correctionPayloadHash({ ...base, expectedRevision: 1 })).not.toBe(h);
  });

  it("a operação lógica da chave é a da correção", () => {
    expect(CORRECTION_IDEMPOTENCY_OPERATION).toBe("ingestion.correctItem");
  });
});

describe("R9 / SEM-048 — isSameCorrection (histórico pré-R9 com a mesma chave)", () => {
  const prior = { stagingItemId: 3, afterPayload: { unitPrice: "7.50", description: "cabo" }, justification: "valor errado" };

  it("mesmo item + mesmo overlay + mesma justificativa ⇒ replay", () => {
    expect(isSameCorrection(prior, { itemId: 3, overlay: { unitPrice: "7.50" }, justification: " valor errado" })).toBe(true);
  });

  it("outro item, outro valor ou outra justificativa ⇒ não é replay (CONFLICT)", () => {
    expect(isSameCorrection(prior, { itemId: 4, overlay: { unitPrice: "7.50" }, justification: "valor errado" })).toBe(false);
    expect(isSameCorrection(prior, { itemId: 3, overlay: { unitPrice: "9.99" }, justification: "valor errado" })).toBe(false);
    expect(isSameCorrection(prior, { itemId: 3, overlay: { unitPrice: "7.50" }, justification: "outra" })).toBe(false);
  });
});
