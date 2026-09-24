/**
 * Pesquisa de Preços — revisão ITEM-CÊNTRICA (componentes REAIS via react-dom/server, sem DOM).
 *
 * Regressão crítica do piloto: 5 itens lógicos × 30 cotações NUNCA viram 30 linhas principais. A fixture é
 * sanitizada (fictícia) e passa pela MESMA projeção do servidor (domain/priceResearchReviewGroups).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceResearchReviewList, PriceResearchReviewSummary } from "./PriceResearchReviewList";
import { ExtractionActionsPanel, ExtractionObservationsPanel } from "./ExtractionDetailsPanels";
import {
  formatQuantity, groupDecisionSummary, mainAverage, reconciliationView, reviewCounters, splitWarnings, toggleExpanded,
  type PriceResearchReview,
} from "@/lib/ingestion/priceResearchReview";
import { buildPriceResearchReviewProjection, type ReviewStagingRow } from "../../../../server/domain/priceResearchReviewGroups";
import { buildReviewFixtureRows, REVIEW_FIXTURE_ITEMS } from "../../../../server/__tests__/fixtures/priceResearchReviewFixture";

/** Mesmo formato do DTO `ingestion.getPriceResearchReview` (contadores separados + linha de staging por cotação). */
function toDto(rows: ReviewStagingRow[]): PriceResearchReview {
  const p = buildPriceResearchReviewProjection(rows);
  const withItem = <T extends { stagingRowId: number }>(q: T) => ({ ...q, stagingItem: { id: q.stagingRowId } });
  return {
    counts: {
      logicalItems: p.logicalItemCount, quotes: p.quoteCount, items: p.itemStatusCounts, quoteStatus: p.quoteStatusCounts,
      unassignedQuotes: p.unassignedQuotes.length, ambiguousItems: p.ambiguousGroupCount,
    },
    groups: p.groups.map((g) => ({ ...g, quotes: g.quotes.map(withItem) })),
    unassignedQuotes: p.unassignedQuotes.map(withItem),
  } as unknown as PriceResearchReview;
}

const noop = () => {};
const renderList = (review: PriceResearchReview, initialExpanded: string[] = []) =>
  renderToStaticMarkup(createElement(PriceResearchReviewList, {
    review, initialExpanded, onDecideGroups: noop, onReviewQuote: noop, onOpenQuote: noop,
  }));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const ITEM = /data-testid="price-research-item"/g;
const QUOTE = /data-testid="price-research-quote"/g;

describe("revisão item-cêntrica — 5 itens × 30 cotações", () => {
  const review = toDto(buildReviewFixtureRows());

  it("REGRESSÃO CRÍTICA: 5 itens principais (não 30); cotações recolhidas por padrão", () => {
    const html = renderList(review);
    expect(count(html, ITEM)).toBe(5);
    expect(count(html, QUOTE)).toBe(0);
    expect(count(html, /aria-expanded="false"/g)).toBe(5);
  });

  it("REGRESSÃO CRÍTICA: expandidos, os 5 itens somam exatamente 30 cotações subordinadas", () => {
    const html = renderList(review, review.groups.map((g) => g.groupKey));
    expect(count(html, ITEM)).toBe(5);
    expect(count(html, QUOTE)).toBe(30);
  });

  it("contadores: 5 Itens, 30 Cotações, 5 Itens pendentes — e a linha de status das cotações separada", () => {
    const html = renderToStaticMarkup(createElement(PriceResearchReviewSummary, { counts: review.counts, sessionId: 7, procurementProcessId: "P-1" }));
    const tile = (key: string) => html.match(new RegExp(`data-testid="price-research-counter-${key}"[^>]*><div[^>]*>(\\d+)</div><div[^>]*>([^<]+)</div>`))!;
    expect(tile("items").slice(1)).toEqual(["5", "Itens"]);
    expect(tile("quotes").slice(1)).toEqual(["30", "Cotações"]);
    expect(tile("pending").slice(1)).toEqual(["5", "Itens pendentes"]);
    expect(tile("reviewed").slice(1)).toEqual(["0", "Itens revisados"]);
    expect(tile("rejected").slice(1)).toEqual(["0", "Itens rejeitados"]);
    expect(html).toContain("Cotações: 30 pendentes · 0 aceitas · 0 rejeitadas · 0 puladas");
    expect(html).not.toMatch(/>30<\/div><div[^>]*>(Total|Pendentes|Itens)</);
  });

  it("cada descrição aparece UMA vez como texto; quantidade, unidade, média e nº de cotações por item", () => {
    const html = renderList(review);
    for (const item of REVIEW_FIXTURE_ITEMS) {
      const escaped = item.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(count(html, new RegExp(`>${escaped}<`, "g"))).toBe(1);
    }
    expect(count(html, /Qtd\. <span class="tabular-nums">1,00<\/span> · Tambor/g)).toBe(3);
    expect(html).toContain("Qtd. <span class=\"tabular-nums\">1,00</span> · Un");
    expect(html).toContain("Qtd. <span class=\"tabular-nums\">1,00</span> · Fardo");
    const averages = [...html.matchAll(/data-testid="price-research-item-average">([^<]+)</g)].map((m) => m[1]);
    expect(averages).toEqual(["R$ 950,31", "R$ 67,23", "R$ 1.134,28", "R$ 145,29", "R$ 1.052,82"]);
    const counts = [...html.matchAll(/data-testid="price-research-item-quote-count">([^<]+)</g)].map((m) => m[1]);
    expect(counts).toEqual(["7 cotações", "7 cotações", "5 cotações", "5 cotações", "6 cotações"]);
    expect(html).toContain("Ver 7 cotações");
  });

  it("reconciliação: média do documento e calculada visíveis, ✓ Valores reconciliados", () => {
    const html = renderList(review);
    expect(html).toContain("Média do documento: <span class=\"tabular-nums\">R$ 950,31</span>");
    expect(html).toContain("Média calculada: <span class=\"tabular-nums\">R$ 950,31</span>");
    expect(count(html, /Valores reconciliados/g)).toBe(5);
  });

  it("expandir mostra as cotações do item com fonte REAL, valor e status; recolher volta ao resumo", () => {
    const key = review.groups[0].groupKey;
    const html = renderList(review, [key]);
    expect(count(html, QUOTE)).toBe(7);
    expect(html).toContain(`aria-controls="pr-item-${key}-quotes"`);
    expect(html).toContain(`id="pr-item-${key}-quotes"`);
    expect(html).toContain("Ocultar cotações");
    for (const s of ["Fonte A", "Fonte B", "Fonte G"]) expect(html).toContain(`>${s}<`);
    expect(html).toContain("R$ 750,31");
    expect(html).toContain(">Pendente<");
    // toggle puro: recolhe e expande de novo
    const closed = toggleExpanded(new Set([key]), key);
    expect(closed.has(key)).toBe(false);
    expect(toggleExpanded(closed, key).has(key)).toBe(true);
    expect(count(renderList(review, [...closed]), QUOTE)).toBe(0);
  });

  it("acessibilidade por teclado: controles nativos (button) com aria-expanded/aria-controls e rótulos", () => {
    const html = renderList(review, [review.groups[0].groupKey]);
    expect(count(html, /<button[^>]*aria-expanded=/g)).toBe(5);
    expect(html).toMatch(/<button[^>]*role="checkbox"[^>]*aria-label="Selecionar item: PRODUTO FICTÍCIO ALFA/);
    expect(html).toContain('role="region" aria-label="Cotações do item PRODUTO FICTÍCIO ALFA');
    expect(html).toContain('aria-label="Aceitar cotação de Fonte A"');
    expect(html).toContain('aria-labelledby="pr-item-');
  });

  it("dark mode e responsivo: tokens de tema, variantes dark:, grade que reorganiza e sem scroll horizontal no nível principal", () => {
    const html = renderList(review, [review.groups[0].groupKey])
      + renderToStaticMarkup(createElement(PriceResearchReviewSummary, { counts: review.counts }));
    expect(html).toContain("bg-card");
    expect(html).toMatch(/dark:text-green-300/);
    expect(html).toMatch(/dark:border-amber-800/);
    expect(html).not.toMatch(/\b(bg-white|text-gray-\d+|text-black)\b/);
    expect(html).not.toContain("overflow-x-auto");
    expect(html).toContain("grid-cols-2 gap-2 sm:grid-cols-5");
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]");
    expect(html).toContain("break-words");
  });
});

describe("sinais de revisão no item", () => {
  it("fonte não identificada: rótulo explícito + advertência (nunca nome inventado)", () => {
    const rows = buildReviewFixtureRows().map((r) => (r.id === 101 ? { ...r, rawSupplier: null } : r));
    const review = toDto(rows);
    const html = renderList(review, [review.groups[0].groupKey]);
    expect(html).toContain("Fonte não identificada");
    expect(html).toContain("1 cotação(ões) sem fonte identificada");
  });

  it("média divergente: ⚠ Divergência na média, ambas as médias visíveis", () => {
    const rows = buildReviewFixtureRows().map((r) => (r.id <= 107 ? { ...r, rawMetadata: { layout: { page: 1, tableIndex: 0, row: 3, reconciliation: { documentAverageCents: 99999 } } } } : r));
    const html = renderList(toDto(rows));
    expect(html).toContain("Divergência na média — revisão necessária");
    expect(html).toContain("Média do documento: <span class=\"tabular-nums\">R$ 999,99</span>");
    expect(html).toContain("Média calculada: <span class=\"tabular-nums\">R$ 950,31</span>");
  });

  it("cotação rejeitada: média original preservada e média após revisão exibida separadamente", () => {
    const review = toDto(buildReviewFixtureRows({ status: (id) => (id === 105 ? "rejected" : "pending") }));
    const g = review.groups[0];
    expect(mainAverage(g)).toEqual({ cents: g.consideredAverageCents, label: "Preço médio (após revisão)" });
    const html = renderList(review);
    expect(html).toContain("Preço médio (após revisão)");
    expect(html).toContain("Média do documento: <span class=\"tabular-nums\">R$ 950,31</span>");
    expect(html).toContain("6 considerada(s) na média");
    expect(html).toContain(">Revisão parcial<");
  });

  it("identidade ambígua: decisão em lote do item desabilitada, revisão individual orientada", () => {
    const rows = buildReviewFixtureRows().map((r) => (r.rawDescription === REVIEW_FIXTURE_ITEMS[2].description ? { ...r, rawDescription: REVIEW_FIXTURE_ITEMS[0].description } : r));
    const html = renderList(toDto(rows));
    expect(html).toContain("Decisão em lote indisponível para este item");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aceitar item<\/button>/);
  });
});

describe("helpers puros", () => {
  it("contadores nunca usam cotações como itens", () => {
    const c = reviewCounters(toDto(buildReviewFixtureRows()).counts);
    expect(c.primary.map((x) => [x.label, x.value])).toEqual([["Itens", 5], ["Cotações", 30], ["Itens pendentes", 5], ["Itens revisados", 0], ["Itens rejeitados", 0]]);
  });
  it("reconciliação, quantidade e resumo da decisão", () => {
    expect(reconciliationView({ documentAverageCents: 1, extractedAverageCents: 1, averageMatches: true }).tone).toBe("ok");
    expect(reconciliationView({ documentAverageCents: 1, extractedAverageCents: 5, averageMatches: false }).tone).toBe("mismatch");
    expect(reconciliationView({ documentAverageCents: null, extractedAverageCents: 5, averageMatches: null }).label).toBe("Média não informada no documento");
    expect(formatQuantity("1")).toBe("1,00");
    expect(formatQuantity("12.5")).toBe("12,50");
    expect(formatQuantity(null)).toBe("—");
    expect(groupDecisionSummary("approved", [{ statusCounts: { pending: 7, approved: 0, rejected: 0, skipped: 0 } }, { statusCounts: { pending: 5, approved: 0, rejected: 0, skipped: 0 } }]))
      .toBe("2 itens · 12 cotações pendente(s) serão aceitas. Decisões já registradas em cotações individuais são preservadas.");
  });
  it("advertências operacionais × informações técnicas", () => {
    expect(splitWarnings([{ severity: "warning" }, { severity: "info" }, {}])).toEqual({ operational: [{ severity: "warning" }, {}], technical: [{ severity: "info" }] });
  });
});

describe("hierarquia: observações da extração e ações técnicas secundárias", () => {
  it("observações técnicas recolhidas em 'observações da extração'; advertências operacionais destacadas", () => {
    const html = renderToStaticMarkup(createElement(ExtractionObservationsPanel, { warnings: [
      { code: "LAYOUT_STACKED_CELLS", severity: "info", message: "Célula empilhada" },
      { code: "LAYOUT_MULTILINE_MERGED", severity: "info", message: "Descrição multilinha" },
      { code: "TOTAL_RECONCILIATION_MISMATCH", severity: "warning", message: "Total diverge" },
    ] }));
    expect(html).toContain("2 observação(ões) técnica(s) da extração");
    expect(html).toContain("1 advertência(s) da extração");
    expect(count(html, /<details/g)).toBe(2);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(renderToStaticMarkup(createElement(ExtractionObservationsPanel, { warnings: [] }))).toBe("");
  });

  it("'Reprocessar extração' fica em 'Ações da extração' (recolhido) quando elegível; aviso visível só em andamento", () => {
    const props = { isReprocessing: false, error: null, onReprocess: noop };
    const eligible = renderToStaticMarkup(createElement(ExtractionActionsPanel, { ...props, reprocess: { eligible: true } }));
    expect(eligible).toContain("Ações da extração");
    expect(eligible).toMatch(/^<details/);
    expect(eligible).toContain("Reprocessar extração");
    const running = renderToStaticMarkup(createElement(ExtractionActionsPanel, { ...props, reprocess: { inProgress: true } }));
    expect(running).toContain("Reprocessando a extração");
    expect(running).not.toContain("<details");
    expect(renderToStaticMarkup(createElement(ExtractionActionsPanel, { ...props, reprocess: { eligible: false, blockers: ["ITEMS_REVIEWED"] } }))).toBe("");
  });
});
