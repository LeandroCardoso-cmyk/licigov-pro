/**
 * R9 / SEM-052 · SEM-054 — renderização REAL (react-dom/server, sem DOM) dos componentes de Itens Inteligentes
 * com o client tRPC mockado:
 *
 *   - Workspace: "Aprovar" DESABILITADO com motivo visível para "Fonte alterada" / "Identidade a revisar";
 *     habilitado com fonte vigente; preço médio em centavos (referência canônica) e outliers exibidos;
 *     "Aplicar cotações atualizadas" só ABRE a confirmação (nenhuma prévia/aplicação no render, e o workspace
 *     não chama mais a mutação diretamente);
 *   - Confirmação: comparativo atual × proposto (cotações, média em centavos), revogação declarada, botão de
 *     confirmação; confirmação STALE (CONFLICT) ⇒ aviso + recarga da prévia, sem erro genérico;
 *   - Painel do item: bloqueio com motivo, referência canônica e outliers; aprovar desabilitado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

type Mut = { mutate: (...a: unknown[]) => void; isPending: boolean; error: unknown };
const st = vi.hoisted(() => ({
  items: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, error: null as unknown, refetch: () => Promise.resolve() },
  preview: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, error: null as unknown, refetch: (() => Promise.resolve()) as () => Promise<unknown> },
  panel: { data: undefined as unknown, isLoading: false },
  apply: { mutate: () => {}, isPending: false, error: null } as Mut,
  applyOpts: null as null | { onError?: (e: unknown) => void; onSuccess?: () => void },
  previewCalls: 0,
}));
const mutation = vi.hoisted(() => () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false, error: null, data: undefined }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      procurementProcess: { listItems: { invalidate: () => {} } },
      itemIntelligence: { getItem: { invalidate: () => {} } },
    }),
    procurementProcess: {
      listItems: { useQuery: () => st.items },
      approveItem: { useMutation: mutation },
      rejectItem: { useMutation: mutation },
      previewItemSourceUpdate: { useQuery: () => { st.previewCalls += 1; return st.preview; } },
      applyItemSourceUpdate: { useMutation: (opts: typeof st.applyOpts) => { st.applyOpts = opts; return st.apply; } },
    },
    itemIntelligence: {
      getItem: { useQuery: () => st.panel },
      decidirCATMAT: { useMutation: mutation },
      getCATMATDecisions: { useQuery: () => ({ data: { current: null, history: [] }, isLoading: false, refetch: () => Promise.resolve() }) },
      getCATMATThreshold: { useQuery: () => ({ data: { configured: true, minScore: 0.5, version: 1 } }) },
    },
  },
}));
vi.mock("@/components/procurement/CatmatThresholdConfig", () => ({ default: () => null }));

(globalThis as { React?: typeof React }).React = React;

import ItemIntelligenceWorkspace from "@/components/procurement/ItemIntelligenceWorkspace";
import ItemSourceUpdateConfirm from "@/components/procurement/ItemSourceUpdateConfirm";
import ProcurementItemPanel from "@/components/procurement/ProcurementItemPanel";

const render = (el: Parameters<typeof createElement>[0], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(el as never, props));

/** O <button> cujo texto é exatamente `label` (atributos inclusos). */
function button(html: string, label: string): string {
  const m = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  if (!m) throw new Error(`botão "${label}" não encontrado`);
  return m[0];
}

const item = (over: Record<string, unknown>) => ({
  id: "i1", description: "Cadeira giratória", quantity: 10, unit: "un", averagePrice: 200, averagePriceCents: 20000,
  suggestedCATMAT: "461234", status: "pendente", sourceState: "current", sourceStateReason: null, quoteCount: 3,
  pendingQuoteCount: null, suppliers: [], priceOutliers: [], ...over,
});
const withItems = (...items: unknown[]) => {
  st.items = { data: { items, total: items.length }, isLoading: false, isFetching: false, isError: false, error: null, refetch: () => Promise.resolve() };
};

beforeEach(() => {
  st.previewCalls = 0;
  st.apply = { mutate: () => {}, isPending: false, error: null };
  st.applyOpts = null;
  st.preview = { data: undefined, isLoading: false, isFetching: false, isError: false, error: null, refetch: () => Promise.resolve() };
});

describe("R9 / SEM-054 — ItemIntelligenceWorkspace: Aprovar bloqueado com fonte não vigente", () => {
  it("Fonte alterada ⇒ Aprovar desabilitado, motivo visível; Aplicar só abre a confirmação", () => {
    withItems(item({ status: "aprovado", sourceState: "source_changed", sourceStateReason: "Pesquisa alterada", pendingQuoteCount: 2 }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    const approve = button(html, "Aprovar");
    expect(approve).toContain('disabled=""');
    expect(approve).toMatch(/title="A pesquisa de preços mudou depois da decisão/);
    expect(html).toContain("Aprovação bloqueada: A pesquisa de preços mudou depois da decisão.");
    const apply = button(html, "Aplicar cotações atualizadas \\(2\\)");
    expect(apply).toContain('aria-expanded="false"');
    // Nenhuma prévia/aplicação acontece só por exibir a linha (a confirmação abre por ação explícita).
    expect(st.previewCalls).toBe(0);
    expect(html).not.toContain("Confirmar");
  });

  it("Identidade a revisar ⇒ Aprovar desabilitado com motivo", () => {
    withItems(item({ sourceState: "review_required" }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(button(html, "Aprovar")).toContain('disabled=""');
    expect(html).toContain("Aprovação bloqueada: A identidade deste item precisa ser revisada");
  });

  it("fonte vigente ⇒ Aprovar habilitado; média em CENTAVOS como referência canônica; outliers exibidos", () => {
    withItems(item({ averagePriceCents: 123456, priceOutliers: [{ name: "Móveis C", valueCents: 40000, deviationPercent: 100 }] }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(button(html, "Aprovar")).not.toContain('disabled=""');
    expect(html).not.toContain("Aprovação bloqueada");
    expect(html).toContain("R$ 1.234,56");
    expect(html).toContain("Referência canônica ao aprovar");
    expect(html).toContain("1 cotação(ões) fora da curva");
    expect(html).toContain("Móveis C — R$ 400,00 (+100% da média)");
  });

  it("o workspace não aplica cotações diretamente (a mutação vive só na confirmação com token)", () => {
    const src = readFileSync(path.join(process.cwd(), "client/src/components/procurement/ItemIntelligenceWorkspace.tsx"), "utf8");
    expect(src).not.toContain("applyItemSourceUpdate");
    const confirm = readFileSync(path.join(process.cwd(), "client/src/components/procurement/ItemSourceUpdateConfirm.tsx"), "utf8");
    expect(confirm).toContain("applyInputFromPreview(data)");
  });
});

const PREVIEW = {
  itemId: "i1", description: "Papel A4", status: "aprovado", revokesDecision: "aprovado", statusAfter: "em_analise",
  current: { quoteCount: 1, averageCents: 10000, quotes: [] }, proposed: { quoteCount: 2, averageCents: 30000, quotes: [] },
  averageDeltaCents: 20000, added: [{ quoteId: "q2", supplier: "Papelaria Y", valueCents: 50000 }], removed: [],
  changed: [], expectedStateToken: `sui1.${"a".repeat(32)}.${"b".repeat(32)}`,
};

describe("R9 / SEM-052 — ItemSourceUpdateConfirm: comparativo antes de aplicar", () => {
  it("mostra atual × proposto (cotações e média em centavos), revogação explícita e confirmação", () => {
    st.preview = { ...st.preview, data: PREVIEW };
    const html = render(ItemSourceUpdateConfirm, { itemId: "i1", onClose: () => {} });
    expect(html).toContain("Comparativo de cotações — Papel A4");
    expect(html).toMatch(/Cotações válidas<\/th><td[^>]*>1<\/td><td[^>]*>2<\/td>/);
    expect(html).toMatch(/Preço médio \(referência\)<\/th><td[^>]*>R\$ 100,00<\/td><td[^>]*>R\$ 300,00<\/td>/);
    expect(html).toContain("+R$ 200,00");
    expect(html).toContain("Papelaria Y — R$ 500,00");
    expect(html).toContain("A aprovação humana deste item será REVOGADA");
    expect(button(html, "Confirmar: aplicar e revogar a decisão")).not.toContain('disabled=""');
    expect(html).not.toContain("mudaram depois da comparação anterior");
  });

  it("confirmação STALE (CONFLICT) ⇒ aviso, sem erro genérico, e a prévia é recarregada", () => {
    const refetch = vi.fn(() => Promise.resolve());
    st.preview = { ...st.preview, data: PREVIEW, refetch };
    const stale = { data: { code: "CONFLICT" }, message: "SOURCE_UPDATE_STALE: As cotações mudaram." };
    st.apply = { mutate: () => {}, isPending: false, error: stale };
    const html = render(ItemSourceUpdateConfirm, { itemId: "i1", onClose: () => {} });
    expect(html).toContain("mudaram depois da comparação anterior. Nada foi aplicado");
    expect(html).not.toContain("SOURCE_UPDATE_STALE");
    st.applyOpts!.onError!(stale);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("prévia recarregando ⇒ confirmação desabilitada (nunca confirma o que não está na tela)", () => {
    st.preview = { ...st.preview, data: PREVIEW, isFetching: true };
    const html = render(ItemSourceUpdateConfirm, { itemId: "i1", onClose: () => {} });
    expect(button(html, "Confirmar: aplicar e revogar a decisão")).toContain('disabled=""');
  });
});

describe("R9 / SEM-054 — ProcurementItemPanel: impacto da aprovação e bloqueio", () => {
  const panelData = (governance: Record<string, unknown>) => ({
    item: {
      id: "i1", organizationId: 1, processId: "p1", sourceResearchId: "r1", description: "Cadeira", quantity: 10, unit: "un",
      averagePrice: 200, suppliers: [], suggestedCATMAT: null, alternativeCATMAT: [], specifications: [], risks: [], recommendations: [],
      status: "pendente", approvedBy: null, correlationId: "c", createdAt: "", updatedAt: "",
    },
    catmat: [], recommendations: [], risks: [], history: [], graphNodeIds: [],
    governance: {
      sourceState: "current", sourceStateReason: null, approvalBlock: null, referencePriceCents: 20000, validQuoteCount: 3,
      priceOutliers: [], ...governance,
    },
  });

  it("fonte alterada ⇒ 'Aprovar item' desabilitado com motivo e caminho de revisão", () => {
    st.panel = { data: panelData({ sourceState: "source_changed", sourceStateReason: "Pesquisa alterada após decisão (aprovado); média proposta 300.00." }), isLoading: false };
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(button(html, "Aprovar item")).toContain('disabled=""');
    expect(html).toContain("Aprovação bloqueada");
    expect(html).toContain("Revisar cotações atualizadas");
  });

  it("fonte vigente ⇒ habilitado; mostra a referência canônica (centavos) e os outliers", () => {
    st.panel = { data: panelData({ referencePriceCents: 123456, priceOutliers: [{ name: "Móveis C", valueCents: 40000, deviationPercent: 100 }] }), isLoading: false };
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(button(html, "Aprovar item")).not.toContain('disabled=""');
    expect(html).toContain("Ao aprovar, o preço de referência canônico será");
    expect(html).toContain("R$ 1.234,56");
    expect(html).toContain("Média de 3 cotação(ões) válida(s).");
    expect(html).toContain("Móveis C — R$ 400,00 (+100% da média)");
  });

  it("identidade a revisar ⇒ desabilitado com motivo (sem botão de cotações)", () => {
    st.panel = { data: panelData({ sourceState: "review_required" }), isLoading: false };
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(button(html, "Aprovar item")).toContain('disabled=""');
    expect(html).toContain("A identidade deste item precisa ser revisada");
    expect(html).not.toContain("Revisar cotações atualizadas");
  });
});
