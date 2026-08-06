/**
 * PR B.2.4 — Testes puros da elegibilidade de promoção (cliente).
 */
import { describe, it, expect } from "vitest";
import { isPromotableType, canPromoteSession, promotionConflictMessage } from "./promotion";

describe("isPromotableType", () => {
  it("price_research é promovível; demais não", () => {
    expect(isPromotableType("price_research")).toBe(true);
    expect(isPromotableType("tr_items")).toBe(false);
    expect(isPromotableType("generic")).toBe(false);
    expect(isPromotableType(undefined)).toBe(false);
  });
});

describe("canPromoteSession", () => {
  const s = (over: Record<string, unknown> = {}) => ({ status: "approved", importType: "price_research", promotionStatus: "none", ...over });

  it("elegível: aprovada + price_research + não promovida + zero pendências", () => {
    expect(canPromoteSession(s(), 0)).toBe(true);
  });
  it("não elegível: há pendências", () => {
    expect(canPromoteSession(s(), 2)).toBe(false);
  });
  it("não elegível: já promovida", () => {
    expect(canPromoteSession(s({ promotionStatus: "promoted" }), 0)).toBe(false);
  });
  it("não elegível: não aprovada", () => {
    expect(canPromoteSession(s({ status: "awaiting_review" }), 0)).toBe(false);
  });
  it("não elegível: tipo não promovível", () => {
    expect(canPromoteSession(s({ importType: "tr_items" }), 0)).toBe(false);
  });
  it("não elegível: sessão nula", () => {
    expect(canPromoteSession(null, 0)).toBe(false);
  });
});

describe("promotionConflictMessage", () => {
  it("traduz CONFLICT em mensagem acionável", () => {
    expect(promotionConflictMessage("CONFLICT")).toMatch(/Recarregue/);
  });
  it("mantém outras mensagens", () => {
    expect(promotionConflictMessage("Falha X")).toBe("Falha X");
  });
});
