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
import { fieldIndicator, assistSummary, originLabel, shouldRotateAssistKeyOnError, type DFDFieldViewUI } from "./dfdFieldSources";
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
    expect(html.match(/Atualizar no rascunho/g)).toHaveLength(1);
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

  it("contexto indisponível: DFD idêntico ao anterior (sem lista de origem e sem botão de IA)", () => {
    state.doc = { id: "d1", kind: "dfd", title: "DFD", content: "# DFD", status: "rascunho", sources: [], contentHash: "h" };
    state.assist = { available: false, fields: [] };
    const html = renderToStaticMarkup(createElement(DFDWorkspace, { processId: "p1" }));
    expect(html).toContain("Salvar rascunho");
    expect(html).not.toContain("Origem das informações");
    expect(html).not.toContain("Gerar rascunho da justificativa");
  });
});
