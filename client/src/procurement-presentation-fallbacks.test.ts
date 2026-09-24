/**
 * PR #247 — Fallbacks graciosos das telas presentation-critical (Pesquisa de Preços, Processos, Itens).
 *
 * Renderiza os componentes REAIS (react-dom/server, sem DOM) com o client tRPC e o hook de capabilities
 * mockados. Os estados de consulta de Processos/Itens vêm de um QueryObserver REAL do TanStack Query
 * (sucesso → refetch com falha), para que o cenário "dados em cache + erro de refetch" seja o que a
 * biblioteca realmente produz, não uma suposição do teste.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

type QueryState = { data: unknown; isLoading: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch: () => Promise<unknown> };
const state = vi.hoisted(() => ({
  processes: undefined as unknown as QueryState,
  items: undefined as unknown as QueryState,
  capabilities: { enabled: false, isLoading: false, error: null as unknown, capabilities: undefined },
}));

const mutation = vi.hoisted(() => () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false, error: null, data: undefined }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ procurementProcess: { listItems: { invalidate: () => {} } } }),
    procurementProcess: {
      listProcesses: { useQuery: () => state.processes },
      listItems: { useQuery: () => state.items },
      approveItem: { useMutation: mutation },
      rejectItem: { useMutation: mutation },
      applyItemSourceUpdate: { useMutation: mutation },
      importPriceResearch: { useMutation: mutation },
    },
  },
}));
vi.mock("@/hooks/ingestion/useIngestionCapabilities", () => ({ useIngestionCapabilities: () => state.capabilities }));
vi.mock("@/components/ingestion/DocumentIngestionLauncher", () => ({
  DocumentIngestionLauncher: () => createElement("div", { "data-testid": "canonical-launcher" }, "CANONICAL_LAUNCHER"),
}));
vi.mock("@/components/procurement/CatmatThresholdConfig", () => ({ default: () => null }));

import PesquisaPrecosWorkspace from "@/components/procurement/PesquisaPrecosWorkspace";
import ProcessoLicitatorioHome from "@/components/procurement/ProcessoLicitatorioHome";
import ItemIntelligenceWorkspace from "@/components/procurement/ItemIntelligenceWorkspace";

const render = (el: Parameters<typeof createElement>[0], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(el as never, props));

/** Estado REAL do TanStack Query: 1ª consulta ok (opcional) e depois falha. */
async function tanstackState(firstData: unknown | null): Promise<QueryState> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let calls = 0;
  const observer = new QueryObserver(qc, {
    queryKey: ["presentation-fallback"],
    queryFn: async () => {
      calls += 1;
      if (calls === 1 && firstData !== null) return firstData;
      throw new Error("backend indisponível");
    },
  });
  let r = await observer.refetch();
  if (firstData !== null) r = await observer.refetch();
  return { data: r.data, isLoading: r.isLoading, isFetching: r.isFetching, isError: r.isError, error: r.error, refetch: vi.fn() };
}

// O vitest.config (sem o plugin React do Vite) compila JSX no modo clássico; componentes que dependem do
// runtime automático (sem `import React`) precisam do React global — shim local deste teste, sem tocar config.
(globalThis as { React?: typeof React }).React = React;

const LEGACY_MARKER = "Importar e gerar Itens Inteligentes";
const STALE_WARNING = "Não foi possível atualizar os dados agora. As informações abaixo são da última consulta bem-sucedida.";

describe("PesquisaPrecosWorkspace — capabilities governam SÓ a ingestão canônica por arquivo", () => {
  beforeEach(() => { state.capabilities = { enabled: false, isLoading: false, error: null, capabilities: undefined }; });

  it("success + enabled → launcher canônico (U2B-MIN: arquivo + colar texto; sem painel legado)", () => {
    state.capabilities = { ...state.capabilities, enabled: true };
    const html = render(PesquisaPrecosWorkspace, { processId: "p1" });
    expect(html).toContain("CANONICAL_LAUNCHER");
    expect(html).not.toContain("Não foi possível consultar");
  });

  it("success + disabled → sem launcher; entrada por texto disponível", () => {
    const html = render(PesquisaPrecosWorkspace, { processId: "p1" });
    expect(html).not.toContain("CANONICAL_LAUNCHER");
    expect(html).toContain("A importação por arquivo não está habilitada para esta organização.");
    expect(html).toContain(LEGACY_MARKER);
  });

  it("error → FAIL-CLOSED para arquivo (sem launcher), aviso claro e painel legado por texto PRESERVADO", () => {
    state.capabilities = { ...state.capabilities, enabled: false, error: new Error("getCapabilities falhou") };
    const html = render(PesquisaPrecosWorkspace, { processId: "p1" });
    expect(html).not.toContain("CANONICAL_LAUNCHER");
    expect(html).toMatch(/role="alert"[^>]*>Não foi possível consultar as opções de importação por arquivo/);
    expect(html).toContain("A entrada por texto continua disponível abaixo.");
    expect(html).toContain(LEGACY_MARKER);
    expect(html).toContain("Conteúdo da pesquisa");
    // Nada é apresentado como habilitado implicitamente.
    expect(html).not.toContain("ingestão supervisionada");
  });

  it("error mesmo com capabilities anteriores 'enabled' em cache → launcher continua oculto (fail-closed)", () => {
    state.capabilities = { ...state.capabilities, enabled: true, error: new Error("refetch falhou") };
    const html = render(PesquisaPrecosWorkspace, { processId: "p1" });
    expect(html).not.toContain("CANONICAL_LAUNCHER");
    expect(html).toContain(LEGACY_MARKER);
  });
});

describe("ProcessoLicitatorioHome — falha de refetch não esconde a lista válida", () => {
  const PROCESSES = { total: 2, processes: [
    { id: "a1", processNumber: "2026/0001", status: "em_andamento", object: "Aquisição de cadeiras", currentStage: "TR", updatedAt: "2026-09-20T12:00:00Z" },
    { id: "a2", processNumber: "2026/0002", status: "rascunho", object: "Material de limpeza", currentStage: "DFD", updatedAt: "2026-09-21T12:00:00Z" },
  ] };

  it("primeira carga falha sem dados → erro completo com 'Tentar novamente'", async () => {
    state.processes = await tanstackState(null);
    expect([state.processes.data, state.processes.isError]).toEqual([undefined, true]);
    const html = render(ProcessoLicitatorioHome);
    expect(html).toContain("Não foi possível carregar os processos.");
    expect(html).toMatch(/<button type="button"[^>]*>Tentar novamente<\/button>/);
    expect(html).not.toContain(STALE_WARNING);
  });

  it("dados em cache + erro de refetch (estado real do TanStack) → lista preservada + aviso não bloqueante", async () => {
    state.processes = await tanstackState(PROCESSES);
    expect(state.processes.isError).toBe(true);
    expect(state.processes.data).toEqual(PROCESSES);
    const html = render(ProcessoLicitatorioHome);
    expect(html).toContain("2026/0001");
    expect(html).toContain("2026/0002");
    expect(html).toContain("2 processo(s) encontrado(s)");
    expect(html).toMatch(/role="alert"[^>]*><span>Não foi possível atualizar os dados agora/);
    expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("Não foi possível carregar os processos.");
  });

  it("sucesso → lista sem aviso", async () => {
    state.processes = { data: PROCESSES, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() };
    const html = render(ProcessoLicitatorioHome);
    expect(html).toContain("2026/0001");
    expect(html).not.toContain(STALE_WARNING);
  });
});

describe("ItemIntelligenceWorkspace — falha de refetch não esconde itens válidos", () => {
  const ITEMS = { items: [
    { id: "i1", description: "Cadeira giratória", quantity: 10, unit: "un", averagePrice: 100, suggestedCATMAT: "461234", status: "aprovado", sourceState: "source_changed", sourceStateReason: "cotações novas", quoteCount: 3, pendingQuoteCount: 2 },
    { id: "i2", description: "Mesa de reunião", quantity: 2, unit: "un", averagePrice: 850, suggestedCATMAT: null, status: "pendente", sourceState: "review_required", sourceStateReason: null, quoteCount: 1, pendingQuoteCount: null },
  ] };

  it("primeira carga falha sem itens → erro completo", async () => {
    state.items = await tanstackState(null);
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(html).toContain("Não foi possível carregar os itens deste processo.");
    expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("<table");
    expect(html).not.toContain(STALE_WARNING);
  });

  it("itens em cache + erro de refetch → tabela, sinais e ações preservados + aviso não bloqueante", async () => {
    state.items = await tanstackState(ITEMS);
    expect(state.items.isError).toBe(true);
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(html).toContain("<table");
    expect(html).toContain("Cadeira giratória");
    expect(html).toContain("Mesa de reunião");
    expect(html).toContain("Fonte alterada");
    expect(html).toContain("Identidade a revisar");
    expect(html).toContain("461234");
    expect(html).toContain("3 cotação(ões) válida(s)");
    expect(html).toContain("Aplicar cotações atualizadas (2)");
    expect(html).toContain("Aprovar");
    expect(html).toContain("Rejeitar");
    expect(html).toMatch(/role="alert"[^>]*><span>Não foi possível atualizar os dados agora/);
    expect(html).not.toContain("Não foi possível carregar os itens deste processo.");
  });

  it("sucesso → tabela sem aviso", () => {
    state.items = { data: ITEMS, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() };
    const html = render(ItemIntelligenceWorkspace, { processId: "p1" });
    expect(html).toContain("Cadeira giratória");
    expect(html).not.toContain(STALE_WARNING);
  });
});
