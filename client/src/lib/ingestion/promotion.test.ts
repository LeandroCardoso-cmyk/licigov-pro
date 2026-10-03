/**
 * PR B.2.4 — Testes puros da elegibilidade de promoção (cliente).
 */
import { describe, it, expect } from "vitest";
import { isPromotableType, canPromoteSession, promotionConflictMessage, promotionImpactLines, promotionAffectsExisting, type PromotionPreviewView } from "./promotion";

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

// R9 / SEM-053 — linhas de impacto: só formatação dos contadores do servidor (sem cálculo no cliente).
describe("R9 / SEM-053 — promotionImpactLines", () => {
  const base: PromotionPreviewView = {
    quotesToPromote: 1,
    intelligentItems: { create: 1, merge: 0, unchanged: 0, preserved: 0, sourceChanged: 0, sourceChangedApproved: 0, reviewRequired: 0, reconciled: 0 },
    merges: [], sourceChanges: [], detailLimit: 50,
  };

  it("somente criação: cotações + novos; nada afeta itens existentes", () => {
    const lines = promotionImpactLines(base);
    expect(lines.map((l) => l.key)).toEqual(["quotes", "create"]);
    expect(lines[0].text).toBe("1 cotação aprovada será gravada na Pesquisa de Preços deste processo.");
    expect(lines[1].text).toBe("1 Item Inteligente novo será criado.");
    expect(promotionAffectsExisting(base)).toBe(false);
  });

  it("mescla, fonte alterada (com aprovados) e identidade a revisar aparecem e afetam itens existentes", () => {
    const p: PromotionPreviewView = { ...base, intelligentItems: { ...base.intelligentItems, create: 0, merge: 3, sourceChanged: 2, sourceChangedApproved: 2, reviewRequired: 1, preserved: 4 } };
    const lines = promotionImpactLines(p);
    expect(lines.map((l) => l.key)).toEqual(["quotes", "create", "merge", "source_changed", "review_required", "unchanged"]);
    expect(lines.find((l) => l.key === "create")!.text).toBe("0 Itens Inteligentes novos serão criados.");
    expect(lines.find((l) => l.key === "merge")!.text).toContain("3 Itens Inteligentes existentes terão as cotações MESCLADAS");
    expect(lines.find((l) => l.key === "source_changed")!.text).toContain("2 deles estão aprovados");
    expect(lines.find((l) => l.key === "review_required")!.text).toContain("Identidade a revisar");
    expect(lines.filter((l) => l.affectsExisting).map((l) => l.key)).toEqual(["merge", "source_changed", "review_required"]);
    expect(promotionAffectsExisting(p)).toBe(true);
  });
});
