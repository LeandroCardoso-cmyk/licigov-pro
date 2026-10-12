/**
 * R9 / SEM-049, SEM-055, SEM-056, SEM-069 — Itens da contratação (frontend):
 *  - SEM-049: "Usar N" mostra o diff vínculo × atual ANTES de adotar e envia o valor ATUAL confirmado;
 *  - SEM-055: "Usar N" sobre prevista já definida pede confirmação (antigo → novo); o lote "Usar quantidades do
 *    documento" não pré-escolhe fonte nenhuma (a quantidade COTADA nunca é o padrão);
 *  - SEM-056: o campo "Quantidade prevista" é hidratado pelo R5.1 (`useHydratedForm`) e re-hidrata após cada escrita;
 *  - SEM-069: candidato de item RETIRADO aparece travado e explicado (o servidor recusa reincluir).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  adoptReplaceConfirmText, adoptableQuantities, bulkAdoptChanges, sourceChoiceKey, sourceQuantityDiffText, adoptableSourceValue,
  itemFormHydration, ITEM_FORM_EMPTY, type ItemView,
} from "./procurementItemsView";
import { hydrateFormState } from "../../lib/formHydration";

const state = vi.hoisted(() => ({ ws: null as unknown, cands: null as unknown }));
vi.mock("./ItemsParticipationCard", () => ({ default: () => null }));
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

import ProcurementItemsWorkspace, { BulkAdoptPanel, CandidatesPanel } from "./ProcurementItemsWorkspace";
(globalThis as unknown as { React: typeof React }).React = React;

const src = (over: Partial<ItemView["sources"][number]>): ItemView["sources"][number] => ({
  sourceType: "dfd", sourceId: "doc1", sourceQuantity: 10, sourceLotCode: null, sourceDescription: "Detergente", sourceUnit: "UN",
  currentQuantity: 10, sourceFound: true, ...over,
});
const item = (over: Partial<ItemView>): ItemView => ({
  id: "a".repeat(24), description: "Detergente", unit: "UN", lotId: null, ordinal: 1, revision: 1, origin: "dfd",
  provenance: { description: { source: "dfd", overriddenBy: null, sourceValue: "Detergente" }, unit: { source: "dfd", overriddenBy: null, sourceValue: "UN" }, lot: { assignedBy: null, source: null }, manual: null },
  plannedQuantity: { value: null, status: "unknown", sourceType: null, mode: null, actorUserId: null },
  sources: [src({})], unitReferencePriceCents: null, priceAmbiguous: false, estimatedTotalCents: null, ...over,
});
const workspace = (items: ItemView[]) => ({
  items, lots: [], withdrawn: [], hasLots: false,
  stats: { itemCount: items.length, lotCount: 0, unassignedItemCount: 0, unknownQuantityCount: 0, conflictCount: 0 },
  estimatedTotalCents: null, contextVersion: 1, contextDigest: "d", governance: { locked: false, reason: null, officialEmittedKinds: [] },
  sources: { priceResearchItems: 0, priceResearchSessionsPending: 0, dfdRows: 0 },
});
const render = () => renderToStaticMarkup(createElement(ProcurementItemsWorkspace, { processId: "p1" }));
const noop = () => {};

beforeEach(() => { state.ws = null; state.cands = null; });

describe("R9 / SEM-049 — diff vínculo × atual antes de 'Usar N'", () => {
  it("fonte mudou: mostra vínculo × atual e o botão usa o valor ATUAL", () => {
    const s = src({ sourceQuantity: 10, currentQuantity: 12 });
    expect(sourceQuantityDiffText(s)).toBe("A quantidade na fonte mudou — vínculo: 10 × atual: 12.");
    expect(adoptableSourceValue(s)).toBe(12);
    state.ws = workspace([item({ sources: [s] })]);
    const html = render();
    expect(html).toContain("vínculo: 10 × atual: 12");
    expect(html).toContain("Usar 12");
    expect(html).not.toContain("Usar 10");
  });

  it("fonte igual ao vínculo: sem diff; fonte ausente: sem botão e aviso explícito", () => {
    expect(sourceQuantityDiffText(src({}))).toBeNull();
    const gone = src({ sourceFound: false, currentQuantity: null });
    expect(adoptableSourceValue(gone)).toBeNull();
    state.ws = workspace([item({ sources: [gone] })]);
    const html = render();
    expect(html).toContain("Fonte não encontrada no documento vigente");
    expect(html).not.toMatch(/>Usar \d/);
  });

  it("payload antigo (sem currentQuantity) ⇒ atual = vínculo (sem diff inventado)", () => {
    const legacy = { sourceType: "dfd", sourceId: "d", sourceQuantity: 7, sourceLotCode: null, sourceDescription: "x", sourceUnit: "UN" };
    expect(adoptableSourceValue(legacy)).toBe(7);
    expect(sourceQuantityDiffText(legacy)).toBeNull();
  });
});

describe("R9 / SEM-055 — confirmação ao substituir e lote sem pré-escolha", () => {
  it("'Usar N' sobre prevista definida pede confirmação antigo → novo; vazia/conflito não", () => {
    expect(adoptReplaceConfirmText({ value: 35, status: "confirmed", sourceType: "user", mode: "informed", actorUserId: 7 }, 12))
      .toBe("Substituir a quantidade prevista 35 por 12? A quantidade prevista atual foi definida antes e será trocada pela da fonte.");
    expect(adoptReplaceConfirmText({ value: null, status: "unknown", sourceType: null, mode: null, actorUserId: null }, 12)).toBeNull();
    expect(adoptReplaceConfirmText({ value: 3, status: "conflict", sourceType: null, mode: null, actorUserId: null }, 12)).toBeNull();
    const src0 = readFileSync(resolve(__dirname, "./ProcurementItemsWorkspace.tsx"), "utf8");
    expect(src0).toMatch(/adoptReplaceConfirmText\(item\.plannedQuantity, next\)/);
    expect(src0).toMatch(/window\.confirm\(ask\)/);
    expect(src0).toMatch(/confirmReplace: true/);
  });

  it("lote: TODAS as fontes listadas (DFD e cotada), NENHUMA pré-escolhida; nada é enviado sem escolha", () => {
    const quoted = src({ sourceType: "price_research", sourceId: "ii1", sourceQuantity: 1, currentQuantity: 1 });
    const dfd = src({});
    const rows = adoptableQuantities([item({ sources: [quoted, dfd] }), item({ id: "b".repeat(24), plannedQuantity: { value: 5, status: "confirmed", sourceType: "user", mode: "informed", actorUserId: 1 } })]);
    expect(rows).toHaveLength(1); // item com prevista definida não entra no lote
    expect(rows[0].sources.map(sourceChoiceKey)).toEqual(["price_research:ii1", "dfd:doc1"]);
    expect(bulkAdoptChanges(rows, {})).toEqual([]);
    expect(bulkAdoptChanges(rows, { [rows[0].item.id]: "" })).toEqual([]);
    expect(bulkAdoptChanges(rows, { [rows[0].item.id]: "dfd:doc1" })).toEqual([
      { itemId: rows[0].item.id, expectedRevision: 1, mode: "adopt_source", sourceType: "dfd", sourceId: "doc1", expectedSourceQuantity: 10 },
    ]);
    const html = renderToStaticMarkup(createElement(BulkAdoptPanel, { processId: "p1", rows, onClose: noop, onDone: noop, onError: noop }));
    expect(html).toContain('<option value="" selected="">Não usar</option>');
    expect(html).toContain("Quantidade cotada (não é a necessidade): 1");
    expect(html).toContain("Quantidade no DFD: 10");
    expect(html).not.toMatch(/<option value="(price_research|dfd):[^"]*" selected/);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Confirmar 0 item(ns)");
  });
});

describe("R9 / SEM-056 — Quantidade prevista hidratada (R5.1) e re-hidratada após escrita", () => {
  it("a chave da versão persistida muda a cada escrita e o estado hidratado traz o valor vigente", () => {
    const before = itemFormHydration(item({}));
    const after = itemFormHydration(item({ revision: 2, plannedQuantity: { value: 10, status: "confirmed", sourceType: "user", mode: "adopted_source:dfd", actorUserId: 1 } }));
    expect(before.key).not.toBe(after.key);
    expect(hydrateFormState(before.server, ITEM_FORM_EMPTY).qty).toBe("");
    expect(hydrateFormState(after.server, ITEM_FORM_EMPTY).qty).toBe("10"); // após "Usar 10" o campo mostra 10 (não reverte)
    // valor mudado por outra via sem revisão (contexto canônico) também re-hidrata
    expect(itemFormHydration(item({ plannedQuantity: { value: 3, status: "confirmed", sourceType: "dfd", mode: null, actorUserId: null } })).key).not.toBe(before.key);
  });

  it("componente usa useHydratedForm (sem useState fixo) e não oferece 'Salvar quantidade' antes de hidratar", () => {
    const code = readFileSync(resolve(__dirname, "./ProcurementItemsWorkspace.tsx"), "utf8");
    expect(code).toMatch(/useHydratedForm\(\{ server, empty: ITEM_FORM_EMPTY/);
    expect(code).not.toMatch(/useState\(formatQty\(/);
    expect(code).not.toMatch(/useState\(item\.description\)/);
    state.ws = workspace([item({ plannedQuantity: { value: 35, status: "confirmed", sourceType: "user", mode: "informed", actorUserId: 7 } })]);
    const html = render();
    expect(html).not.toContain("Salvar quantidade"); // 1º render (não hidratado) nunca é "alteração"
    expect(html).toMatch(/placeholder="Não definida" disabled=""/);
    expect(html).toContain(">35<"); // valor vigente exibido
  });
});

describe("R9 / SEM-069 — candidato de item retirado", () => {
  it("fica travado (não selecionável) e explica como reincluir; não conta para confirmação", () => {
    state.cands = {
      sourceDigest: "0".repeat(32), counts: { sourceItemCount: 1 },
      candidates: [{
        candidateKey: "k".repeat(24), sourceType: "dfd", sourceId: "doc1", sourceItemKey: "x", sourceDigest: "d", description: "Detergente", unit: "UN",
        sourceQuantity: 10, sourceLotCode: null, fingerprint: "f", match: { status: "new", canonicalItemId: null, candidateItemIds: [], reason: null },
        duplicateOfCandidateKey: null, sourceLotId: null, withdrawnItemId: "w".repeat(24),
      }],
    };
    const html = renderToStaticMarkup(createElement(CandidatesPanel, { processId: "p1", source: "dfd", lots: [], items: [], onClose: noop, onDone: noop, onError: noop }));
    expect(html).toContain("Este item foi retirado da contratação e não é reincluído automaticamente.");
    expect(html).toMatch(/<input type="checkbox" disabled=""/);
    expect(html).toContain("Confirmar 0 item(ns)");
  });
});
