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
    // M8 — histórico somente leitura das importações (painel do item e Pesquisa de Preços).
    ingestion: { listSessionHistory: { useQuery: () => ({ data: { sessions: [], hasMore: false }, isLoading: false, error: null }) } },
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
      buscarClassificacaoOficial: { useMutation: mutation },
      verificarCodigoOficial: { useMutation: mutation },
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
import { ItemDrawer } from "@/pages/ProcessoLicitatorio";

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

  it("homologação visual M8: item já aprovado com fonte vigente ⇒ botão mostra 'Aprovado ✓' desabilitado (sem ação pendente)", () => {
    withItems(item({ status: "aprovado", sourceState: "current" }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(button(html, "Aprovado ✓")).toContain('disabled=""');
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
    expect(html).toMatch(/Cotações com preço<\/th><td[^>]*>1<\/td><td[^>]*>2<\/td>/);
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
    expect(html).toContain("Média de 3 cotação(ões) importada(s) com preço.");
    expect(html).not.toContain("válida(s)");
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

describe("CATMAT/CATSER oficial — ProcurementItemPanel: buscar classificação e confirmar só código verificado", () => {
  const base = {
    item: {
      id: "i1", organizationId: 1, processId: "p1", sourceResearchId: "r1", description: "Notebook", quantity: 10, unit: "un",
      averagePrice: 4000, suppliers: [], suggestedCATMAT: null, alternativeCATMAT: [], specifications: [], risks: [], recommendations: [],
      status: "aprovado", approvedBy: 1, correlationId: "c", createdAt: "", updatedAt: "",
    },
    recommendations: [], risks: [], history: [], graphNodeIds: [],
    governance: { sourceState: "current", sourceStateReason: null, approvalBlock: null, referencePriceCents: 400000, validQuoteCount: 3, priceOutliers: [] },
  };
  const cand = (over: Record<string, unknown>) => ({
    id: "m1", catmatCode: "451868", catmatDescription: "COMPUTADOR PORTÁTIL (NOTEBOOK)", score: 0.5, rank: 0, decision: "busca_atual", state: "busca_atual",
    source: "api-comprasgov:catmat", verified: true, catalogType: "catmat", retrievedAt: "2026-10-16T12:00:00.000Z", evidenceSnapshotId: "s1", verificationNote: null, ...over,
  });

  it("oferece a busca no CATMAT (material) e no CATSER (serviço); sem aviso de candidatos locais", () => {
    st.panel = { data: { ...base, catmat: [] }, isLoading: false };
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(html).toContain('data-testid="catmat-official-search"');
    expect(button(html, "Buscar no CATMAT \\(material\\)")).not.toContain('disabled=""');
    expect(button(html, "Buscar no CATSER \\(serviço\\)")).not.toContain('disabled=""');
    expect(html).not.toContain("Candidatos gerados localmente");
    // Verificação oficial POR CÓDIGO nos dois catálogos (desabilitada até o servidor informar o código).
    expect(html).toContain('data-testid="catmat-verify-code"');
    expect(button(html, "Verificar código no CATMAT")).toContain('disabled=""');
    expect(button(html, "Verificar código no CATSER")).toContain('disabled=""');
  });

  it("candidato verificado ⇒ proveniência oficial e Confirmar habilitado; legado sem proveniência ⇒ Confirmar desabilitado com motivo", () => {
    st.panel = { data: { ...base, catmat: [cand({})] }, isLoading: false };
    const ok = render(ProcurementItemPanel, { itemId: "i1" });
    expect(ok).toContain("Verificado no catálogo oficial CATMAT");
    expect(button(ok, "Confirmar")).not.toContain('disabled=""');
    st.panel = { data: { ...base, catmat: [cand({ catmatCode: "583920", verified: false, source: "sem-proveniencia", catalogType: null, retrievedAt: null, verificationNote: "Código sem consulta oficial registrada para este órgão." })] }, isLoading: false };
    const legacy = render(ProcurementItemPanel, { itemId: "i1" });
    expect(legacy).toContain("Sem proveniência verificável");
    expect(button(legacy, "Confirmar")).toContain('disabled=""');
  });
});

describe("M8 hardening — sugestões: busca atual × histórico × código verificado × decisão (ledger)", () => {
  const base = {
    item: {
      id: "i1", organizationId: 1, processId: "p1", sourceResearchId: "r1", description: "Tradução juramentada", quantity: 1, unit: "sv",
      averagePrice: 100, suppliers: [], suggestedCATMAT: null, alternativeCATMAT: [], specifications: [], risks: [], recommendations: [],
      status: "pendente", approvedBy: null, correlationId: "c", createdAt: "", updatedAt: "",
    },
    recommendations: [], risks: [], history: [], graphNodeIds: [],
    governance: { sourceState: "current", sourceStateReason: null, approvalBlock: null, referencePriceCents: 10000, validQuoteCount: 1, priceOutliers: [], fictitiousQuoteCount: 0 },
  };
  const s = (code: string, state: string, rank = 0) => ({
    id: `m${code}`, catmatCode: code, catmatDescription: `SERVIÇO ${code}`, score: 0.8, rank, decision: state, state,
    source: "api-comprasgov:catser", verified: true, catalogType: "catser", retrievedAt: "2026-10-16T12:00:00.000Z", evidenceSnapshotId: "s1", verificationNote: null,
  });

  it("histórica verificada (ex.: 21490 após nova busca) fica em 'Sugestões anteriores', sem botão Confirmar; atual e código verificado são confirmáveis", () => {
    st.panel = { data: { ...base, catmat: [s("1000", "busca_atual"), s("2000", "codigo_verificado"), s("21490", "historico"), s("3000", "origem_nao_identificada")] }, isLoading: false };
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    const [current, previous] = html.split('data-testid="catmat-previous-suggestions"');
    expect(current).toContain("Candidato da busca atual");
    expect(current).toContain("Código informado e verificado");
    expect(current).toContain("#1 1000");
    expect((current.match(/>Confirmar<\/button>/g) ?? []).length).toBe(2);
    expect(previous).toContain("Sugestões anteriores (2) — não pertencem à busca mais recente; não podem ser confirmadas");
    expect(previous).toContain("21490");
    expect(previous).toContain("Histórico — não retornou na busca mais recente");
    expect(previous).toContain("Sugestão anterior — origem da busca não registrada");
    expect(previous).toContain("verificação não é recomendação atual");
    expect(previous).not.toContain(">Confirmar</button>");
    expect(previous).not.toContain("ainda não é decisão");
  });
});

describe("M8 hardening — cotações fictícias nunca aparecem como válidas", () => {
  it("Workspace: item com cotações fictícias ⇒ 'valor demonstrativo', sem 'Referência canônica' nem 'válida(s)'", () => {
    withItems(item({ quoteCount: 2, fictitiousQuoteCount: 2, averagePriceCents: 15000 }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(html).toContain("Valor demonstrativo (fonte fictícia) — não é referência oficial");
    expect(html).toContain("2 cotação(ões) fictícia(s) — valor demonstrativo, não utilizável como pesquisa de preços oficial");
    expect(html).not.toContain("Referência canônica ao aprovar");
    expect(html).not.toContain("válida(s)");
  });

  it("Workspace: sem fictícias ⇒ cotações importadas (não 'válidas')", () => {
    withItems(item({ quoteCount: 3, fictitiousQuoteCount: 0 }));
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(html).toContain("3 cotação(ões) importada(s) com preço");
    expect(html).toContain("Referência canônica ao aprovar");
  });

  const fictitiousPanel = (referenceBlockedReason: "FICTITIOUS_SOURCE" | null) => ({ data: {
    item: { id: "i1", organizationId: 1, processId: "p1", sourceResearchId: "r1", description: "Caneta", quantity: 10, unit: "un", averagePrice: 150, suppliers: [], suggestedCATMAT: null, alternativeCATMAT: [], specifications: [], risks: [], recommendations: [], status: "pendente", approvedBy: null, correlationId: "c", createdAt: "", updatedAt: "" },
    catmat: [], recommendations: [], risks: [], history: [], graphNodeIds: [],
    governance: { sourceState: "current", sourceStateReason: null, approvalBlock: null, referencePriceCents: 15000, validQuoteCount: 2, priceOutliers: [], fictitiousQuoteCount: 2, referenceBlockedReason },
  }, isLoading: false });

  it("Painel (órgão real): fonte fictícia ⇒ aprovação operacional disponível, mas NÃO vira referência oficial", () => {
    st.panel = fictitiousPanel("FICTITIOUS_SOURCE");
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(html).toContain("Média operacional (fonte fictícia) — ao aprovar, NÃO vira preço de referência oficial");
    expect(html).toContain('data-testid="fictitious-quotes-warning"');
    expect(html).toContain("não constitui(em) pesquisa de preços oficial");
    expect(html).toContain("A aprovação operacional continua disponível");
    expect(html).not.toContain("vira a referência do item");
    expect(html).not.toContain("Ao aprovar, o preço de referência canônico será");
    expect(html).not.toContain("válida(s)");
  });

  it("Painel (homologação sintética autorizada pelo backend): valor demonstrativo declarado como tal", () => {
    st.panel = fictitiousPanel(null);
    const html = render(ProcurementItemPanel, { itemId: "i1" });
    expect(html).toContain("Valor demonstrativo (homologação sintética autorizada) — ao aprovar, vira a referência do item");
    expect(html).toContain("não constituem pesquisa de preços oficial");
    expect(html).not.toContain("Ao aprovar, o preço de referência canônico será");
  });
});

describe("M8 hardening — ItemDrawer: um único cabeçalho 'Inteligência do Item' e um único Fechar", () => {
  it("drawer + painel ⇒ 1 título, 1 botão Fechar (com nome acessível), diálogo nomeado pelo título", () => {
    st.panel = { data: undefined, isLoading: true };
    const html = render(ItemDrawer, { itemId: "i1", onClose: () => {} });
    expect((html.match(/Inteligência do item/gi) ?? []).length).toBe(1);
    expect((html.match(/aria-label="Fechar"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Fechar painel do item"'); // fundo clicável (fora do cabeçalho)
    expect(html).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="item-intelligence-panel-title"/);
    expect(html).toContain('id="item-intelligence-panel-title"');
    expect(html).not.toContain("<svg"); // sem o X duplicado do lucide
  });
});
