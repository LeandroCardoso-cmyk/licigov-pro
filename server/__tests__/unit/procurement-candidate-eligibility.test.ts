/**
 * Hotfix — ELEGIBILIDADE de Itens Inteligentes como candidatos a Itens da contratação (domínio puro).
 * Regra: LINEAGE + ESTADO DO WORKFLOW — nunca descrição, quantidade, preço ou nº de cotações; sem IA/fuzzy.
 */
import { describe, it, expect } from "vitest";
import {
  priceResearchCandidateEligibility, priceResearchCandidateSources, summarizePriceResearchEligibility, matchCandidates,
  type IntelligentItemSource, type PriceResearchRecord,
} from "../../domain/procurementItems";

const PROMOTED: PriceResearchRecord = { researchId: "rs-a", provenance: "promoted_session", importSessionId: 11 };
const PROMOTED_B: PriceResearchRecord = { researchId: "rs-b", provenance: "promoted_session", importSessionId: 12 };
const MANUAL: PriceResearchRecord = { researchId: "rs-m", provenance: "manual_import", importSessionId: null };
const map = (...r: PriceResearchRecord[]) => new Map(r.map((x) => [x.researchId, x]));

const item = (over: Partial<IntelligentItemSource> = {}): IntelligentItemSource => ({
  id: "ii1", description: "Concentrado ativado", unit: "Tambor", quantity: 1, status: "pendente", approvedBy: null,
  sourceResearchId: "rs-a", evidenceResearchIds: ["rs-a"], ...over,
});

/** 5 itens lógicos promovidos (as 30 cotações já foram consolidadas em 5 Itens Inteligentes pela promoção). */
const FIVE = ["Concentrado ativado", "Esfregão Master 30 cm", "Concentrado alcalino R-15", "Pano costurado tipo retalho", "Detergente automotivo"]
  .map((d, n) => item({ id: `ii${n + 1}`, description: d, quantity: [1, 20, 0, 35, 1][n], evidenceResearchIds: Array(6).fill("rs-a") }));
/** Item LEGADO tipo incidente: importação manual de texto, sem revisão, qtd 0 / R$ 0 / 0 cotações. */
const LEGACY = item({ id: "legacy", description: "Fornecedor Exemplo Ltda", unit: "un", quantity: 0, sourceResearchId: "rs-m", evidenceResearchIds: ["rs-m"] });

describe("Elegibilidade — lineage + workflow (nunca conteúdo)", () => {
  it("1) Pesquisa em revisão (nada promovido): não existe Item Inteligente ⇒ 0 candidatos", () => {
    expect(priceResearchCandidateSources([], map())).toEqual([]);
  });

  it("2) item de sessão PROMOVIDA (revisão aprovada + promoção) ⇒ elegível, mesmo com decisão do Item pendente", () => {
    expect(priceResearchCandidateEligibility(item(), map(PROMOTED))).toEqual({ eligible: true, via: "promoted_session", importSessionIds: [11] });
  });

  it("3) item REJEITADO ⇒ inelegível, mesmo com lineage governado", () => {
    expect(priceResearchCandidateEligibility(item({ status: "rejeitado" }), map(PROMOTED))).toEqual({ eligible: false, reason: "rejected" });
  });

  it("4) pesquisa sem sessão comprovável (promoção de sessão não aprovada/omitida pelo servidor) ⇒ inelegível", () => {
    // o servidor OMITE a pesquisa cuja promoção não se comprova ⇒ desconhecida.
    expect(priceResearchCandidateEligibility(item(), map())).toEqual({ eligible: false, reason: "unknown_research" });
  });

  it("5) item ÓRFÃO (sem pesquisa de origem nem cotações com pesquisa) ⇒ inelegível", () => {
    expect(priceResearchCandidateEligibility(item({ sourceResearchId: "", evidenceResearchIds: [] }), map(PROMOTED))).toEqual({ eligible: false, reason: "no_lineage" });
  });

  it("6) LEGADO de importação manual sem revisão ⇒ inelegível (qtd 0 / preço 0 NÃO são o critério)", () => {
    expect(priceResearchCandidateEligibility(LEGACY, map(MANUAL))).toEqual({ eligible: false, reason: "manual_import_unreviewed" });
    // mesmo com quantidade e preço "bons", sem revisão humana continua inelegível
    expect(priceResearchCandidateEligibility({ ...LEGACY, quantity: 50, averagePriceCents: 10_000, quoteCount: 3 }, map(MANUAL)).eligible).toBe(false);
    // e um item promovido com qtd 0 / preço 0 continua ELEGÍVEL (o conteúdo não decide)
    expect(priceResearchCandidateEligibility(item({ quantity: 0, averagePriceCents: 0, quoteCount: 0 }), map(PROMOTED)).eligible).toBe(true);
  });

  it("7) importação manual com Item APROVADO por humano (status + approvedBy) ⇒ elegível; só status sem ator ⇒ não", () => {
    expect(priceResearchCandidateEligibility({ ...LEGACY, status: "aprovado", approvedBy: 5 }, map(MANUAL))).toEqual({ eligible: true, via: "approved_manual_import", importSessionIds: [] });
    expect(priceResearchCandidateEligibility({ ...LEGACY, status: "aprovado", approvedBy: null }, map(MANUAL)).eligible).toBe(false);
    expect(priceResearchCandidateEligibility({ ...LEGACY, status: "em_analise", approvedBy: 5 }, map(MANUAL)).eligible).toBe(false);
  });

  it("8) duas sessões promovidas no processo: cada item é elegível pela SUA sessão; itens de pesquisa desconhecida não entram", () => {
    const a = item({ id: "a", evidenceResearchIds: ["rs-a"] });
    const b = item({ id: "b", sourceResearchId: "rs-b", evidenceResearchIds: ["rs-b"] });
    const ghost = item({ id: "g", sourceResearchId: "rs-x", evidenceResearchIds: ["rs-x"] });
    const s = summarizePriceResearchEligibility([a, b, ghost], map(PROMOTED, PROMOTED_B));
    expect(s).toMatchObject({ eligibleCount: 2, legacyOrUnlinkedCount: 1, promotedSessionCount: 2 });
    // item consolidado com cotações de 2 sessões promovidas: lineage das duas
    expect(priceResearchCandidateEligibility(item({ evidenceResearchIds: ["rs-a", "rs-b"] }), map(PROMOTED, PROMOTED_B))).toMatchObject({ importSessionIds: [11, 12] });
  });

  it("9) INCIDENTE: legado + nada promovido ⇒ 0; após promoção dos 5 itens lógicos (30 cotações) ⇒ EXATAMENTE 5", () => {
    expect(priceResearchCandidateSources([LEGACY], map(MANUAL))).toHaveLength(0);
    const after = priceResearchCandidateSources([LEGACY, ...FIVE], map(MANUAL, PROMOTED));
    expect(after).toHaveLength(5);
    expect(after.map((c) => c.description)).toEqual(FIVE.map((f) => f.description));
    expect(after.some((c) => c.sourceId === "legacy")).toBe(false);
    expect(summarizePriceResearchEligibility([LEGACY, ...FIVE], map(MANUAL, PROMOTED)))
      .toEqual({ intelligentItemCount: 6, eligibleCount: 5, ineligibleCount: 1, rejectedCount: 0, legacyOrUnlinkedCount: 0, manualUnreviewedCount: 1, promotedSessionCount: 1 });
  });

  it("10/11) sourceQuantity preservada como EVIDÊNCIA; nenhuma quantidade prevista é criada", () => {
    const c = priceResearchCandidateSources(FIVE, map(PROMOTED));
    expect(c.map((x) => x.sourceQuantity)).toEqual([1, 20, null, 35, 1]);
    expect(c.every((x) => !("plannedQuantity" in x))).toBe(true);
  });

  it("12) determinístico (sem IA/fuzzy): mesmas entradas ⇒ mesmos candidatos; lineage mudou ⇒ candidatos mudam", () => {
    const a = matchCandidates(priceResearchCandidateSources(FIVE, map(PROMOTED)), [], [], []);
    const b = matchCandidates(priceResearchCandidateSources(FIVE, map(PROMOTED)), [], [], []);
    expect(b).toEqual(a);
    expect(priceResearchCandidateSources(FIVE, map())).toHaveLength(0);
  });

  it("rejeição parcial: o item rejeitado não é promovido (não vira Item Inteligente); os 4 aprovados são candidatos", () => {
    expect(priceResearchCandidateSources(FIVE.slice(1), map(PROMOTED))).toHaveLength(4);
  });
});
