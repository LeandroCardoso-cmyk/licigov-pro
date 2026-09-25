/**
 * Itens da contratação — frontend: view-model (agrupamento por lote, quantidades, proveniência) e estados
 * renderizados (vazio, sem lotes, com lotes, quantidade desconhecida, "Usar N", governança, candidatos
 * ambíguos). Regressão: a página do processo ganha UMA aba discreta, sem reorganizar as demais.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  groupItems, plannedQuantityLabel, provenanceLines, sourceQuantityLabel, adoptableQuantities, quantityInputError,
  type ItemView, type LotView,
} from "./procurementItemsView";

const state = vi.hoisted(() => ({ ws: null as unknown, cands: null as unknown }));
vi.mock("../../lib/trpc", () => {
  const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, isSuccess: false, error: null, data: undefined });
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: () => {} }) }) });
  const m = new Proxy({}, { get: () => ({ useMutation: mutation }) });
  return {
    trpc: {
      useUtils: () => utils,
      procurementItems: new Proxy({}, {
        get: (_t, k) => k === "workspace" ? { useQuery: () => ({ data: state.ws, isLoading: false, isError: false, refetch: () => {} }) }
          : k === "candidates" ? { useQuery: () => ({ data: state.cands, isLoading: false }) }
            : (m as Record<string, unknown>)[k as string],
      }),
    },
  };
});

import ProcurementItemsWorkspace, { CandidatesPanel } from "./ProcurementItemsWorkspace";
(globalThis as unknown as { React: typeof React }).React = React;

const item = (over: Partial<ItemView>): ItemView => ({
  id: "a".repeat(24), description: "Concentrado ativado", unit: "Tambor", lotId: null, ordinal: 1, revision: 1, origin: "price_research",
  provenance: { description: { source: "price_research", overriddenBy: null, sourceValue: "Concentrado ativado" }, unit: { source: "price_research", overriddenBy: null, sourceValue: "Tambor" }, lot: { assignedBy: null, source: null }, manual: null },
  plannedQuantity: { value: null, status: "unknown", sourceType: null, mode: null, actorUserId: null },
  sources: [{ sourceType: "price_research", sourceId: "ii1", sourceQuantity: 1, sourceLotCode: null, sourceDescription: "Concentrado ativado", sourceUnit: "Tambor" }],
  unitReferencePriceCents: 45000, priceAmbiguous: false, estimatedTotalCents: null, ...over,
});
const lot = (over: Partial<LotView>): LotView => ({ id: "l".repeat(24), code: "01", name: "Materiais de limpeza", description: null, ordinal: 1, revision: 1, itemCount: 0, ...over });
const workspace = (items: ItemView[], lots: LotView[] = [], over: Record<string, unknown> = {}) => ({
  items, lots, withdrawn: [], hasLots: lots.length > 0,
  stats: { itemCount: items.length, lotCount: lots.length, unassignedItemCount: 0, unknownQuantityCount: 0, conflictCount: 0 },
  estimatedTotalCents: null, contextVersion: 1, contextDigest: "d", governance: { locked: false, reason: null, officialEmittedKinds: [] },
  sources: { priceResearchItems: 5, dfdRows: 0 }, ...over,
});
const render = () => renderToStaticMarkup(createElement(ProcurementItemsWorkspace, { processId: "p1" }));

describe("view-model", () => {
  it("sem lotes ⇒ lista simples; com lotes ⇒ lotes em ordem + 'Sem lote'", () => {
    const a = item({}), b = item({ id: "b".repeat(24), lotId: "l".repeat(24) });
    expect(groupItems([a, b], [])).toEqual([{ lot: null, title: "", items: [a, b] }]);
    const g = groupItems([a, b], [lot({})]);
    expect(g.map((x) => [x.title, x.items.length])).toEqual([["LOTE 01 — Materiais de limpeza", 1], ["Sem lote / não atribuídos", 1]]);
  });

  it("quantidade: 'Não definida' ≠ quantidade no documento; proveniência por campo; adoção só onde prevista está vazia", () => {
    const it0 = item({});
    expect(plannedQuantityLabel(it0.plannedQuantity)).toBe("Não definida");
    expect(sourceQuantityLabel(it0.sources[0])).toBe("Quantidade no documento: 1");
    const it1 = item({ plannedQuantity: { value: 35, status: "confirmed", sourceType: "user", mode: "informed", actorUserId: 7 }, provenance: { ...it0.provenance, description: { source: "user", overriddenBy: 7, sourceValue: "Concentrado" } } });
    expect(provenanceLines(it1)).toEqual([
      'Descrição: alterada pelo usuário #7 (na fonte: "Concentrado")', "Unidade: Pesquisa de Preços",
      "Quantidade prevista: Informada pelo usuário #7", "Quantidade no documento: 1 (Pesquisa de Preços)",
    ]);
    expect(adoptableQuantities([it0, it1]).map((r) => r.item.id)).toEqual([it0.id]);
    expect(quantityInputError("1.200,5")).toBeNull();
    expect(quantityInputError("0")).toMatch(/maior que zero/);
  });
});

describe("ProcurementItemsWorkspace — estados", () => {
  beforeEach(() => { state.ws = null; state.cands = null; });

  it("vazio: convida a preparar da pesquisa ou adicionar manualmente", () => {
    state.ws = workspace([]);
    const html = render();
    expect(html).toContain("Itens da contratação");
    expect(html).toContain("Preparar a partir da pesquisa");
    expect(html).toContain("+ Adicionar item");
    expect(html).toContain("+ Criar lote");
    expect(html).toContain("5 item(ns) identificado(s) na Pesquisa de Preços");
    expect(html).toContain("Nenhum item da contratação ainda");
  });

  it("sem lotes: lista simples com quantidade prevista vazia, quantidade do documento e 'Usar 1'", () => {
    state.ws = workspace([item({})]);
    const html = render();
    expect(html).not.toContain("LOTE ");
    expect(html).toContain("Quantidade prevista");
    expect(html).toContain("Não definida");
    expect(html).toContain("Quantidade no documento: 1");
    expect(html).toContain("Usar 1");
    expect(html).toContain("Origem: Pesquisa de Preços");
    expect(html).toContain("Não encontrou um item?");
    expect(html).toContain("Usar quantidades do documento");
  });

  it("com lotes: agrupamento por lote e seletor de lote no item", () => {
    const l = lot({ itemCount: 1 });
    state.ws = workspace([item({ lotId: l.id }), item({ id: "c".repeat(24), description: "Rodo", origin: "manual", sources: [] })], [l]);
    const html = render();
    expect(html).toContain("LOTE 01 — Materiais de limpeza");
    expect(html).toContain("Sem lote / não atribuídos");
    expect(html).toContain("Origem: Informado manualmente");
    expect(html).toContain("Lote 01 — Materiais de limpeza</option>");
  });

  it("governança: necessidade formalizada ⇒ aviso e ações bloqueadas", () => {
    state.ws = workspace([item({})], [], { governance: { locked: true, reason: "Esta necessidade já foi formalizada (TR emitido). Uma alteração governada da necessidade é necessária.", officialEmittedKinds: ["tr"] } });
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain("alteração governada da necessidade");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\+ Adicionar item/);
  });

  it("dark mode/acessibilidade: tokens semânticos, disabled sem opacity, controles rotulados", () => {
    const src = readFileSync(resolve(__dirname, "./ProcurementItemsWorkspace.tsx"), "utf8");
    expect(src).not.toMatch(/opacity-50|bg-white|text-black/);
    expect(src).toMatch(/aria-label="Mover para cima"/);
    expect(src).toMatch(/sm:grid-cols-/); // responsivo: empilha em telas pequenas
  });
});

describe("Preparar itens — candidatos", () => {
  const cand = (over: Record<string, unknown>) => ({
    candidateKey: "k".repeat(24), sourceType: "price_research", sourceId: "ii1", sourceItemKey: "x", sourceDigest: "d",
    description: "Concentrado ativado", unit: "Tambor", sourceQuantity: 1, sourceLotCode: null, fingerprint: "f",
    match: { status: "new", canonicalItemId: null, candidateItemIds: [], reason: null }, duplicateOfCandidateKey: null, sourceLotId: null, ...over,
  });
  it("descrição/unidade pré-preenchidas, quantidade prevista vazia, 'Usar 1' explícito; ambíguo/possível exige decisão; lote da fonte proposto", () => {
    state.cands = {
      sourceDigest: "0".repeat(32), counts: { sourceItemCount: 4 },
      candidates: [
        cand({}),
        cand({ candidateKey: "m".repeat(24), description: "Cera", match: { status: "possible_match", canonicalItemId: null, candidateItemIds: ["a".repeat(24)], reason: "Possível item já cadastrado." } }),
        cand({ candidateKey: "n".repeat(24), description: "Rodo", sourceLotCode: "01", match: { status: "ambiguous", canonicalItemId: null, candidateItemIds: ["a".repeat(24), "b".repeat(24)], reason: "x" } }),
        cand({ candidateKey: "o".repeat(24), description: "Pano", match: { status: "linked", canonicalItemId: "a".repeat(24), candidateItemIds: ["a".repeat(24)], reason: null } }),
      ],
    };
    const html = renderToStaticMarkup(createElement(CandidatesPanel, { processId: "p1", source: "price_research", lots: [], items: [item({})], onClose: () => {}, onDone: () => {}, onError: () => {} }));
    expect(html).toContain("4 item(ns) identificado(s)");
    expect(html).toContain('value="Concentrado ativado"');
    expect(html).toContain('value="Tambor"');
    expect(html).toContain('placeholder="Não definida"');
    expect(html).toContain("Usar 1 como quantidade prevista");
    expect(html).toContain("Possível item já cadastrado");
    expect(html).toContain("Mais de um item cadastrado corresponde");
    expect(html).toContain("Já está nos itens da contratação");
    expect(html).toMatch(/data-status="new"[\s\S]*checked=""/); // novo vem marcado; nada é gravado sem confirmar
    expect(html).toContain("Nada é gravado até a confirmação");
  });
});

describe("Regressão — página do processo", () => {
  it("apenas UMA aba discreta nova; ordem e demais abas preservadas", () => {
    const page = readFileSync(resolve(__dirname, "../../pages/ProcessoLicitatorio.tsx"), "utf8");
    const labels = [...page.matchAll(/\{ key: "(\w+)", label: "([^"]+)"/g)].map((m) => m[2]);
    expect(labels).toEqual(["Visão Geral", "DFD", "Pesquisa de Preços", "Itens da contratação", "Itens Inteligentes", "ETP", "TR", "Edital"]);
    expect(page).toContain('case "contract_items":');
  });
});
