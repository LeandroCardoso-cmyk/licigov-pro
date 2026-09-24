/**
 * Pesquisa de Preços — projeção de revisão por ITEM LÓGICO (domínio puro).
 * Contrato homologado (fixture sanitizada): 30 cotações ⇒ 5 itens (7/7/5/5/6), médias e total conferidos.
 */
import { describe, it, expect } from "vitest";
import {
  buildPriceResearchReviewProjection, deriveGroupStatus, groupRevisionOf, planGroupReview, reviewGroupKey,
  quoteLineage, ReviewGroupKeyCollision, type ReviewStagingRow,
} from "../domain/priceResearchReviewGroups";
import { consolidateQuotes, intelligentItemLogicalKey, type PriceQuote } from "../domain/priceQuoteConsolidation";
import { sumCents } from "../domain/money";
import { buildReviewFixtureRows, REVIEW_FIXTURE_EXPECTED, REVIEW_FIXTURE_ITEMS, FIXTURE_SOURCES } from "./fixtures/priceResearchReviewFixture";

const rows = () => buildReviewFixtureRows();

describe("projeção item-cêntrica — contrato 5 itens × 30 cotações", () => {
  it("30 cotações formam 5 itens lógicos (nunca 30), com 7/7/5/5/6 cotações", () => {
    const p = buildPriceResearchReviewProjection(rows());
    expect(p.logicalItemCount).toBe(REVIEW_FIXTURE_EXPECTED.logicalItems);
    expect(p.quoteCount).toBe(REVIEW_FIXTURE_EXPECTED.quotes);
    expect(p.logicalItemCount).not.toBe(p.quoteCount);
    expect(p.groups.map((g) => g.quoteCount)).toEqual([...REVIEW_FIXTURE_EXPECTED.quotesPerItem]);
    expect(p.groups.reduce((a, g) => a + g.quotes.length, 0)).toBe(30);
    expect(p.unassignedQuotes).toHaveLength(0);
  });

  it("descrição, unidade e quantidade aparecem UMA vez por item", () => {
    const p = buildPriceResearchReviewProjection(rows());
    expect(p.groups.map((g) => g.description)).toEqual(REVIEW_FIXTURE_ITEMS.map((i) => i.description));
    expect(p.groups.map((g) => g.unit)).toEqual(["Tambor", "Un", "Tambor", "Fardo", "Tambor"]);
    expect(new Set(p.groups.map((g) => g.quantity))).toEqual(new Set(["1"])); // decimal canônico; a UI exibe "1,00"
  });

  it("médias por item conferem com o documento e o total com 3.349,93", () => {
    const p = buildPriceResearchReviewProjection(rows());
    expect(p.groups.map((g) => g.extractedAverageCents)).toEqual([...REVIEW_FIXTURE_EXPECTED.averagesCents]);
    expect(p.groups.map((g) => g.documentAverageCents)).toEqual([...REVIEW_FIXTURE_EXPECTED.averagesCents]);
    expect(p.groups.every((g) => g.averageMatches === true)).toBe(true);
    expect(p.groups.map((g) => g.consideredAverageCents)).toEqual([...REVIEW_FIXTURE_EXPECTED.averagesCents]);
    expect(sumCents(p.groups.map((g) => g.extractedAverageCents!))).toBe(REVIEW_FIXTURE_EXPECTED.totalCents);
  });

  it("contadores de ITENS e de COTAÇÕES são separados", () => {
    const p = buildPriceResearchReviewProjection(rows());
    expect(p.itemStatusCounts).toEqual({ pending: 5, partially_reviewed: 0, reviewed: 0, rejected: 0 });
    expect(p.quoteStatusCounts).toEqual({ pending: 30, approved: 0, rejected: 0, skipped: 0 });
  });

  it("cada cotação preserva identidade: linha de staging, fonte real, valor, lineage, confiança e warnings", () => {
    const p = buildPriceResearchReviewProjection(rows());
    const q = p.groups[0].quotes[0];
    expect(q).toMatchObject({ stagingRowId: 101, sourceLabel: "Fonte A", sourceResolved: true, amountCents: 75031, rawAmount: "R$ 750,31", status: "pending", confidence: 0.92 });
    expect(q.lineage).toMatchObject({ page: 1, row: 3, column: 4, identifier: "I / 001 / 001", sourceRowKey: "p:1|t:0|r:3" });
    expect(q.warnings.map((w) => w.code)).toEqual(["LAYOUT_STACKED_CELLS"]);
    expect(p.groups[0].quotes.map((x) => x.sourceLabel)).toEqual(FIXTURE_SOURCES);
    expect(p.groups[0].identity).toEqual({ status: "consistent", identifiers: ["I / 001 / 001"], sourceRowKeys: ["p:1|t:0|r:3"] });
  });

  it("cotação nunca aparece em dois itens; toda linha de staging aparece exatamente uma vez", () => {
    const p = buildPriceResearchReviewProjection(rows());
    const ids = p.groups.flatMap((g) => g.quotes.map((q) => q.stagingRowId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort((a, b) => a - b)).toEqual(rows().map((r) => r.id));
  });

  it("ordem determinística (documento) e groupKey estável independente da ordem de entrada", () => {
    const a = buildPriceResearchReviewProjection(rows());
    const b = buildPriceResearchReviewProjection([...rows()].reverse());
    expect(b.groups.map((g) => g.groupKey)).toEqual(a.groups.map((g) => g.groupKey));
    expect(a.groups.map((g) => g.position)).toEqual([1, 2, 3, 4, 5]);
    expect(a.groups[0].groupKey).toMatch(/^[0-9a-f]{32}$/);
    // a chave deriva SOMENTE da identidade canônica — outra sessão/ids produz a mesma chave para o mesmo item
    const other = buildPriceResearchReviewProjection(buildReviewFixtureRows({ firstId: 9001 }));
    expect(other.groups.map((g) => g.groupKey)).toEqual(a.groups.map((g) => g.groupKey));
    expect(a.groups[0].groupKey).toBe(reviewGroupKey(intelligentItemLogicalKey({ description: REVIEW_FIXTURE_ITEMS[0].description, unit: "Tambor", quantity: 1 })));
  });
});

describe("status derivado e revisão mista", () => {
  it("deriva pending / partially_reviewed / reviewed / rejected sem persistir estado", () => {
    expect(deriveGroupStatus({ pending: 3, approved: 0, rejected: 0, skipped: 0 })).toBe("pending");
    expect(deriveGroupStatus({ pending: 2, approved: 1, rejected: 0, skipped: 0 })).toBe("partially_reviewed");
    expect(deriveGroupStatus({ pending: 0, approved: 6, rejected: 1, skipped: 0 })).toBe("reviewed");
    expect(deriveGroupStatus({ pending: 0, approved: 0, rejected: 2, skipped: 1 })).toBe("rejected");
  });

  it("rejeitar uma cotação preserva a média do documento e a extraída; a média considerada é separada", () => {
    // Rejeita a cotação mais alta do item 1 (id 105 = média + 200,00).
    const p = buildPriceResearchReviewProjection(buildReviewFixtureRows({ status: (id) => (id === 105 ? "rejected" : "pending") }));
    const g = p.groups[0];
    expect(g.status).toBe("partially_reviewed");
    expect(g.documentAverageCents).toBe(95031);
    expect(g.extractedAverageCents).toBe(95031);
    expect(g.hasExclusions).toBe(true);
    expect(g.consideredQuoteCount).toBe(6);
    expect(g.consideredAverageCents).toBe(Math.round((95031 * 7 - 115031) / 6)); // (valores restantes)/6, half-up
    expect(g.averageMatches).toBe(true); // reconciliação é sobre a EXTRAÇÃO, não sobre a decisão
    expect(p.itemStatusCounts).toEqual({ pending: 4, partially_reviewed: 1, reviewed: 0, rejected: 0 });
    expect(p.quoteStatusCounts).toEqual({ pending: 29, approved: 0, rejected: 1, skipped: 0 });
  });

  it("média impressa divergente ⇒ aviso explícito, sem escolher silenciosamente uma das médias", () => {
    const r = rows().map((x) => (x.id <= 107 ? { ...x, rawMetadata: { layout: { page: 1, tableIndex: 0, row: 3, identifier: "I / 001 / 001", reconciliation: { documentAverageCents: 99999 } } } } : x));
    const g = buildPriceResearchReviewProjection(r).groups[0];
    expect(g.documentAverageCents).toBe(99999);
    expect(g.extractedAverageCents).toBe(95031);
    expect(g.averageMatches).toBe(false);
    expect(g.warnings.map((w) => w.code)).toContain("GROUP_AVERAGE_MISMATCH");
  });

  it("fonte não identificada é sinalizada e nunca inventada", () => {
    const r = rows().map((x) => (x.id === 108 ? { ...x, rawSupplier: null, extractionWarnings: [{ code: "SOURCE_IDENTITY_UNRESOLVED", severity: "warning", message: "fonte" }] } : x));
    const g = buildPriceResearchReviewProjection(r).groups[1];
    expect(g.quotes[0]).toMatchObject({ sourceLabel: null, sourceResolved: false });
    expect(g.unresolvedSourceCount).toBe(1);
    expect(g.warnings.find((w) => w.code === "SOURCE_IDENTITY_UNRESOLVED")).toMatchObject({ count: 1, severity: "warning" });
  });

  it("cotação sem valor válido não entra na média e é sinalizada", () => {
    const r = rows().map((x) => (x.id === 101 ? { ...x, rawUnitPrice: "/////" } : x));
    const g = buildPriceResearchReviewProjection(r).groups[0];
    expect(g.pricedQuoteCount).toBe(6);
    expect(g.quotes[0].amountCents).toBeNull();
    expect(g.warnings.map((w) => w.code)).toContain("QUOTE_WITHOUT_VALID_AMOUNT");
  });

  it("linhas sem descrição não formam item (como na promoção), mas continuam listadas para revisão", () => {
    const r = [...rows(), { ...rows()[0], id: 999, rawDescription: "  " }];
    const p = buildPriceResearchReviewProjection(r);
    expect(p.logicalItemCount).toBe(5);
    expect(p.unassignedQuotes.map((q) => q.stagingRowId)).toEqual([999]);
    expect(p.quoteCount).toBe(31);
  });
});

describe("identidade: colisão e divisão falham fechado", () => {
  it("duas linhas distintas do documento com a mesma chave lógica ⇒ ITEM_IDENTITY_COLLISION (ambíguo)", () => {
    // Item 3 passa a ter a mesma descrição/unidade/quantidade do item 1, mas é outra linha do documento.
    const r = rows().map((x) => (x.rawDescription === REVIEW_FIXTURE_ITEMS[2].description ? { ...x, rawDescription: REVIEW_FIXTURE_ITEMS[0].description } : x));
    const p = buildPriceResearchReviewProjection(r);
    expect(p.logicalItemCount).toBe(4);
    const g = p.groups[0];
    expect(g.quoteCount).toBe(12);
    expect(g.identity.status).toBe("ambiguous");
    expect(g.warnings.map((w) => w.code)).toContain("ITEM_IDENTITY_COLLISION");
    expect(p.ambiguousGroupCount).toBe(1);
    const plan = planGroupReview(p, [{ groupKey: g.groupKey, expectedRevision: g.revision }]);
    expect(plan).toEqual({ ok: false, error: { code: "IDENTITY_AMBIGUOUS", groupKey: g.groupKey } });
  });

  it("uma linha do documento repartida entre itens (descrição corrigida em uma cotação) ⇒ ITEM_IDENTITY_SPLIT", () => {
    const r = rows().map((x) => (x.id === 101 ? { ...x, correctedPayload: { description: "OUTRA DESCRIÇÃO FICTÍCIA" }, correctionRevision: 1 } : x));
    const p = buildPriceResearchReviewProjection(r);
    expect(p.logicalItemCount).toBe(6);
    const split = p.groups.filter((g) => g.warnings.some((w) => w.code === "ITEM_IDENTITY_SPLIT"));
    expect(split).toHaveLength(2);
    expect(split.every((g) => g.identity.status === "ambiguous")).toBe(true);
  });

  it("formato longo (uma cotação por linha) agrupa pela chave canônica sem falso positivo", () => {
    const long: ReviewStagingRow[] = [1, 2, 3].map((n) => ({
      id: n, rawDescription: "ITEM LONGO FICTÍCIO", rawQuantity: "2", rawUnit: "UN", rawUnitPrice: `${n}0,00`, rawSupplier: `Fonte ${n}`,
      sourceLocation: { location: { sheet: "Planilha1", row: n + 1 } }, reviewStatus: "pending",
    }));
    const p = buildPriceResearchReviewProjection(long);
    expect(p.logicalItemCount).toBe(1);
    expect(p.groups[0].identity.status).toBe("consistent");
    expect(p.groups[0].extractedAverageCents).toBe(2000);
    expect(p.groups[0].documentAverageCents).toBeNull();
    expect(p.groups[0].averageMatches).toBeNull();
  });

  it("colisão de groupKey entre chaves lógicas diferentes interrompe a projeção (fail closed)", () => {
    expect(() => buildPriceResearchReviewProjection(rows(), { groupKeyOf: () => "0".repeat(32) })).toThrow(ReviewGroupKeyCollision);
  });

  it("lineage lê o layout primeiro e a localização da fonte como fallback", () => {
    expect(quoteLineage({ sourceLocation: { location: { sheet: "S", row: 4, column: 2 }, tableIndex: 1 } }))
      .toEqual({ page: null, sheet: "S", tableIndex: 1, row: 4, column: 2, identifier: null, sourceRowKey: "s:S|t:1|r:4" });
    expect(quoteLineage({ rawMetadata: "{}", sourceLocation: null }).sourceRowKey).toBeNull();
  });
});

describe("planejamento da decisão por item", () => {
  it("afeta apenas as cotações PENDENTES do item; decisões anteriores são preservadas", () => {
    const p = buildPriceResearchReviewProjection(buildReviewFixtureRows({ status: (id) => (id === 102 ? "rejected" : "pending") }));
    const g = p.groups[0];
    const plan = planGroupReview(p, [{ groupKey: g.groupKey, expectedRevision: g.revision }]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.entries[0].quoteIds).toEqual([101, 103, 104, 105, 106, 107]);
  });

  it("revisão velha ⇒ STALE_REVISION; chave inexistente ⇒ GROUP_NOT_FOUND; repetida ⇒ DUPLICATE_GROUP", () => {
    const p = buildPriceResearchReviewProjection(rows());
    const g = p.groups[0];
    expect(planGroupReview(p, [{ groupKey: g.groupKey, expectedRevision: "0".repeat(16) }]))
      .toEqual({ ok: false, error: { code: "STALE_REVISION", groupKey: g.groupKey, currentRevision: g.revision } });
    expect(planGroupReview(p, [{ groupKey: "f".repeat(32), expectedRevision: g.revision }]))
      .toMatchObject({ ok: false, error: { code: "GROUP_NOT_FOUND" } });
    expect(planGroupReview(p, [{ groupKey: g.groupKey, expectedRevision: g.revision }, { groupKey: g.groupKey, expectedRevision: g.revision }]))
      .toMatchObject({ ok: false, error: { code: "DUPLICATE_GROUP" } });
  });

  it("a revisão do item muda quando o status ou a correção de uma cotação mudam (e só do próprio item)", () => {
    const base = buildPriceResearchReviewProjection(rows());
    const changed = buildPriceResearchReviewProjection(buildReviewFixtureRows({ status: (id) => (id === 101 ? "approved" : "pending") }));
    expect(changed.groups[0].revision).not.toBe(base.groups[0].revision);
    expect(changed.groups.slice(1).map((g) => g.revision)).toEqual(base.groups.slice(1).map((g) => g.revision));
    expect(groupRevisionOf([{ id: 1, reviewStatus: "pending", correctionRevision: 0 }]))
      .not.toBe(groupRevisionOf([{ id: 1, reviewStatus: "pending", correctionRevision: 1 }]));
  });

  it("chaves de outra sessão/tenant não pertencem a esta projeção quando o conteúdo difere", () => {
    const foreign = buildPriceResearchReviewProjection([{ ...rows()[0], id: 5000, rawDescription: "ITEM DE OUTRO TENANT FICTÍCIO" }]);
    const p = buildPriceResearchReviewProjection(rows());
    const plan = planGroupReview(p, [{ groupKey: foreign.groups[0].groupKey, expectedRevision: foreign.groups[0].revision }]);
    expect(plan).toMatchObject({ ok: false, error: { code: "GROUP_NOT_FOUND" } });
  });
});

describe("regressão de promoção: projeção ≡ consolidação canônica (5 Itens Inteligentes, não 30)", () => {
  it("as 30 cotações aprovadas consolidam em 5 itens com as MESMAS chaves e médias da revisão", () => {
    const p = buildPriceResearchReviewProjection(rows());
    const quotes: PriceQuote[] = rows().map((r) => ({
      quoteId: `q${r.id}`, researchId: "r1", description: r.rawDescription!, quantity: 1, unit: r.rawUnit!,
      supplier: r.rawSupplier ?? "", brand: "", model: "", source: "", valueCents: Number(r.rawUnitPrice!.replace(/\D/g, "")),
    }));
    const consolidated = consolidateQuotes(quotes);
    expect(consolidated).toHaveLength(5);
    expect(consolidated.map((c) => reviewGroupKey(c.logicalKey))).toEqual(p.groups.map((g) => g.groupKey));
    expect(consolidated.map((c) => c.averageCents)).toEqual(p.groups.map((g) => g.extractedAverageCents));
    expect(consolidated.map((c) => c.pricedQuoteCount)).toEqual([7, 7, 5, 5, 6]);
  });
});
