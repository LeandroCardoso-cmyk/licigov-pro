/**
 * Contexto Canônico no DFD — frontend:
 *  - view-model dos indicadores (rótulos/ações por estado, sem decisão de autoridade no cliente);
 *  - componente discreto de origem (ações explícitas, bloqueadas com edição não salva);
 *  - REGRESSÃO de UI: o DFDWorkspace mantém título, seções, editor, "Salvar rascunho" e "Criar DFD do
 *    zero"; o assistido só ACRESCENTA a lista de origem e o botão de rascunho de IA.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fieldIndicator, assistSummary, originLabel, shouldRotateAssistKeyOnError, shouldProceedWithFieldAction, type DFDFieldViewUI } from "./dfdFieldSources";
import DFDFieldSources from "./DFDFieldSources";

const f = (over: Partial<DFDFieldViewUI>): DFDFieldViewUI => ({
  key: "identificacao.unidade", label: "Setor/unidade demandante", state: "prefilled",
  documentValue: "Sec. Educação", contextValue: "Sec. Educação", origin: "process", contextOrigin: "process", reconcilable: false, ...over,
});

const state = vi.hoisted(() => ({ doc: null as null | Record<string, unknown>, assist: null as null | Record<string, unknown> }));
vi.mock("../../lib/trpc", () => {
  const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false, error: null, data: undefined });
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: () => {} }) }) });
  return {
    trpc: {
      useUtils: () => utils,
      procurementProcess: {
        loadDFD: { useQuery: () => ({ data: { document: state.doc }, isLoading: false }) },
        dfdAssistState: { useQuery: () => ({ data: state.assist }) },
        generateDFD: { useMutation: mutation },
        saveDFD: { useMutation: mutation },
        importDFD: { useMutation: mutation },
        reconcileDFDField: { useMutation: mutation },
        generateDFDJustification: { useMutation: mutation },
      },
    },
  };
});
vi.mock("@/hooks/ingestion/useIngestionCapabilities", () => ({ useIngestionCapabilities: () => ({ enabled: false }) }));
vi.mock("@/components/ingestion/DocumentImportPanel", () => ({ DocumentImportPanel: () => null }));

import DFDWorkspace from "./DFDWorkspace";

// A suíte de frontend roda em node sem transform JSX automático: os componentes usam o runtime clássico.
(globalThis as unknown as { React: typeof React }).React = React;

describe("indicadores de origem (view-model)", () => {
  it("rótulos por estado, com ação explícita só onde há informação de origem", () => {
    expect(fieldIndicator(f({})).text).toBe("Preenchido pelo Processo");
    expect(fieldIndicator(f({ state: "user_modified", origin: "user" })).text).toBe("Alterado por você");
    expect(fieldIndicator(f({ state: "ai_draft" })).text).toMatch(/^Rascunho gerado por IA/);
    expect(fieldIndicator(f({ state: "stale", reconcilable: true }))).toMatchObject({ text: "Informação de origem atualizada", action: "Atualizar no rascunho", confirmAction: false });
    expect(fieldIndicator(f({ state: "unknown", documentValue: null, contextValue: null })).text).toBe("Informação ainda não definida");
    expect(fieldIndicator(f({ state: "conflict", reconcilable: true }))).toMatchObject({ action: "Usar informação de origem", confirmAction: true });
    expect(fieldIndicator(f({ state: "conflict", contextValue: null }))).toMatchObject({ action: null });
    expect(originLabel("derived")).toMatch(/cálculo do sistema/);
    expect(assistSummary([f({}), f({ state: "unknown" }), f({ state: "stale" })])).toEqual({ filled: 1, pending: 1, attention: 1 });
  });

  it("rotação de chave: erro definitivo roda, transitório mantém (retry idempotente)", () => {
    expect(shouldRotateAssistKeyOnError("PRECONDITION_FAILED")).toBe(true);
    expect(shouldRotateAssistKeyOnError("CONFLICT")).toBe(true);
    expect(shouldRotateAssistKeyOnError("INTERNAL_SERVER_ERROR")).toBe(false);
    expect(shouldRotateAssistKeyOnError(undefined)).toBe(false);
  });
});

describe("DFDFieldSources (componente discreto)", () => {
  it("lista origem por campo e oferece 'Atualizar no rascunho' apenas no campo desatualizado", () => {
    const html = renderToStaticMarkup(createElement(DFDFieldSources, {
      fields: [f({}), f({ key: "item:0123456789abcdef", label: "Quantidade prevista — Cadeira", state: "stale", reconcilable: true })],
      dirty: false, busyKey: null, onAction: () => {},
    }));
    expect(html).toContain("Origem das informações");
    expect(html).toContain("Preenchido pelo Processo");
    expect(html.match(/>Atualizar no rascunho</g)).toHaveLength(1);
    expect(html).toContain('data-state="stale"');
  });

  it("com edição não salva, ações ficam bloqueadas e o motivo é explicado", () => {
    const html = renderToStaticMarkup(createElement(DFDFieldSources, {
      fields: [f({ state: "available", reconcilable: true })], dirty: true, busyKey: null, onAction: () => {},
    }));
    expect(html).toContain("Salve suas alterações");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("sem campos (contexto indisponível) não renderiza nada", () => {
    expect(renderToStaticMarkup(createElement(DFDFieldSources, { fields: [], dirty: false, busyKey: null, onAction: () => {} }))).toBe("");
  });
});

describe("Explicabilidade da reconciliação — valor atual × valor de origem × origem (A–H)", () => {
  const RESP = { key: "identificacao.responsavel", label: "Responsável pela demanda" };
  const divergent = f({ ...RESP, state: "conflict", documentValue: "Aristides Fernandes Junior", contextValue: "Maria Souza", origin: "user", contextOrigin: "etp", reconcilable: true });
  const render = (fields: DFDFieldViewUI[], dirty = false) =>
    renderToStaticMarkup(createElement(DFDFieldSources, { fields, dirty, busyKey: null, onAction: () => {} }));

  it("A) divergência real: valor atual, valor de origem e origem visíveis ANTES de qualquer clique", () => {
    const html = render([divergent]);
    expect(html).toContain("Valor atual no DFD");
    expect(html).toContain("Aristides Fernandes Junior");
    expect(html).toContain("Valor de origem");
    expect(html).toContain("Maria Souza");
    expect(html).toMatch(/<dt[^>]*>Origem<\/dt><dd[^>]*>ETP<\/dd>/);
    expect(html).toContain(">Usar informação de origem<");
  });

  it("B) acessibilidade: botão com rótulo que nomeia campo, valores e origem, e descrito pela lista de valores", () => {
    const html = render([divergent]);
    expect(html).toContain('aria-label="Usar informação de origem em &quot;Responsável pela demanda&quot;: substituir &quot;Aristides Fernandes Junior&quot; por &quot;Maria Souza&quot; (origem: ETP)"');
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<dl id="${id}"`);
  });

  it("C) sem fonte válida (sem valor de origem): nenhum botão e nenhuma troca possível — em QUALQUER estado", () => {
    for (const state of ["conflict", "stale", "available"] as const) {
      const ind = fieldIndicator(f({ ...RESP, state, contextValue: null, reconcilable: true }));
      expect(ind.action).toBeNull();
      expect(ind.confirmMessage).toBeNull();
    }
    expect(render([f({ ...RESP, state: "conflict", contextValue: null, reconcilable: false })])).not.toContain("<button");
  });

  it("D) piloto: valor humano sem origem válida ⇒ 'Alterado por você' / 'sem informação de origem válida', sem ação", () => {
    expect(fieldIndicator(f({ ...RESP, state: "user_modified", origin: "user", contextValue: null }))).toMatchObject({ text: "Alterado por você", action: null, details: null });
    const legacy = fieldIndicator(f({ ...RESP, state: "user_modified", origin: null, contextValue: null }));
    expect(legacy).toMatchObject({ action: null, details: null, tone: "neutral" });
    expect(legacy.text).toMatch(/sem informação de origem válida/);
    expect(render([f({ ...RESP, state: "user_modified", origin: "user", contextValue: null })])).not.toContain("Diverge da informação de origem");
  });

  it("E) confirmação obrigatória da substituição, com os valores (nunca troca 'às cegas')", () => {
    const ind = fieldIndicator(divergent);
    expect(ind.confirmAction).toBe(true);
    expect(ind.confirmMessage).toBe(
      'Substituir o valor de "Responsável pela demanda" no DFD?\n\nValor atual no DFD: Aristides Fernandes Junior\nValor de origem: Maria Souza\nOrigem: ETP\n\nO valor anterior fica no histórico.',
    );
    // "Atualizar no rascunho" (valor do sistema/vazio) mostra os valores mas não exige confirmação
    expect(fieldIndicator(f({ state: "stale", reconcilable: true, documentValue: "10", contextValue: "12", contextOrigin: "user" }))).toMatchObject({ confirmAction: false, confirmMessage: null, action: "Atualizar no rascunho" });
  });

  it("E2) MANTER × USAR: cancelar a confirmação mantém o rascunho (nada enviado); confirmar prossegue; sem valores nunca", () => {
    const seen: string[] = [];
    expect(shouldProceedWithFieldAction(divergent, (m) => { seen.push(m); return false; })).toBe(false); // Manter valor do rascunho
    expect(seen[0]).toContain("Valor de origem: Maria Souza");
    expect(shouldProceedWithFieldAction(divergent, () => true)).toBe(true); // Usar valor de origem
    const noSource = f({ ...RESP, state: "conflict", contextValue: null, reconcilable: true });
    expect(shouldProceedWithFieldAction(noSource, () => true)).toBe(false);
    expect(shouldProceedWithFieldAction(undefined, () => true)).toBe(false);
    const confirm = vi.fn(() => false);
    expect(shouldProceedWithFieldAction(f({ state: "available", documentValue: null, contextValue: "x", reconcilable: true }), confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled(); // preencher campo vazio não substitui valor humano
  });

  it("F) edição não salva: botão desabilitado, valores continuam visíveis", () => {
    const html = render([divergent], true);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Maria Souza");
    expect(html).toContain("Salve suas alterações");
  });

  it("G) campo vazio no DFD: 'não preenchido' em vez de valor em branco; genérico para qualquer campo (itens incluídos)", () => {
    const ind = fieldIndicator(f({ key: "item:0123456789abcdef01234567", label: "Quantidade prevista — Cadeira", state: "available", documentValue: null, contextValue: "30", contextOrigin: "user", reconcilable: true }));
    expect(ind.details).toEqual([
      { label: "Valor atual no DFD", value: "não preenchido" }, { label: "Valor de origem", value: "30" }, { label: "Origem", value: "você" },
    ]);
  });

  it("H) layout/tema: tokens do design system (dark mode), grade responsiva, quebra de valores longos; sem cor fixa", () => {
    const html = render([divergent]);
    const dl = /<dl[^>]*class="([^"]+)"/.exec(html)![1];
    expect(dl).toContain("grid-cols-1");
    expect(dl).toContain("sm:grid-cols-[max-content_1fr]");
    expect(dl).toContain("bg-muted/50");
    expect(html).toContain("break-words");
    expect(dl).not.toMatch(/(bg|text)-(white|black|gray|slate|zinc)-?/);
    // campos sem divergência nem ação seguem com a MESMA linha discreta (sem lista de valores)
    expect(render([f({})])).not.toContain("<dl");
  });
});

describe("DFDWorkspace — regressão de UI (mesma página, mesmo fluxo)", () => {
  beforeEach(() => { state.doc = null; state.assist = null; });

  it("sem DFD: mesma entrada ('Criar DFD do zero' + importação), sem elementos novos", () => {
    const html = renderToStaticMarkup(createElement(DFDWorkspace, { processId: "p1" }));
    expect(html).toContain("DFD — Documento de Formalização da Demanda");
    expect(html).toContain("Art. 12, § 1º da Lei 14.133/2021");
    expect(html).toContain("Criar DFD do zero");
    expect(html).toContain("Importar DFD existente");
    expect(html).not.toContain("Origem das informações");
    expect(html).not.toContain("Gerar rascunho da justificativa");
  });

  it("com DFD e contexto: mesmo editor e 'Salvar rascunho' + origem discreta + IA supervisionada", () => {
    state.doc = { id: "d1", kind: "dfd", title: "DFD", content: "# DFD", status: "rascunho", sources: [], contentHash: "h" };
    state.assist = { available: true, fields: [f({})], stale: false };
    const html = renderToStaticMarkup(createElement(DFDWorkspace, { processId: "p1" }));
    expect(html).toContain("Conteúdo do DFD");
    expect(html).toContain("<textarea");
    expect(html).toContain("Salvar rascunho");
    expect(html).toContain("Revisão obrigatória");
    expect(html).toContain("Origem das informações");
    expect(html).toContain("Gerar rascunho da justificativa (IA)");
    expect(html).toContain("Rascunho");
  });

  it("divergência real no workspace: valores visíveis na mesma lista de origem, editor intacto", () => {
    state.doc = { id: "d1", kind: "dfd", title: "DFD", content: "# DFD", status: "rascunho", sources: [], contentHash: "h" };
    state.assist = { available: true, fields: [f({ key: "identificacao.responsavel", label: "Responsável pela demanda", state: "conflict", documentValue: "Aristides Fernandes Junior", contextValue: "Maria Souza", contextOrigin: "etp", reconcilable: true })], stale: false };
    const html = renderToStaticMarkup(createElement(DFDWorkspace, { processId: "p1" }));
    expect(html).toContain("<textarea");
    expect(html).toContain("Valor atual no DFD");
    expect(html).toContain("Aristides Fernandes Junior");
    expect(html).toContain("Maria Souza");
  });

  it("contexto indisponível: DFD idêntico ao anterior (sem lista de origem e sem botão de IA)", () => {
    state.doc = { id: "d1", kind: "dfd", title: "DFD", content: "# DFD", status: "rascunho", sources: [], contentHash: "h" };
    state.assist = { available: false, fields: [] };
    const html = renderToStaticMarkup(createElement(DFDWorkspace, { processId: "p1" }));
    expect(html).toContain("Salvar rascunho");
    expect(html).not.toContain("Origem das informações");
    expect(html).not.toContain("Gerar rascunho da justificativa");
  });
});
