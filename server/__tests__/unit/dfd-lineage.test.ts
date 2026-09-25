/**
 * P0.2 — Linhagem do DFD: a IDENTIDADE de cada linha da tabela de itens é o `canonicalItemId` persistido
 * (marcador `pr:` em generated_documents.sources). Fingerprint serve só para RECUPERAÇÃO quando não há id
 * persistido (1 ⇒ liga; 0 ⇒ não liga; >1 ⇒ ambíguo). Lote é pertencimento, nunca identidade. Casos F–J.
 */
import { describe, it, expect } from "vitest";
import { canonicalItemKey } from "../../domain/canonicalProcurementContext";
import {
  renderDFDContent, prefillMarkers, writeMarkers, readMarkers, linkDFDRows, parseDFD, refreshRowLineage,
  computeDFDFieldStates, reconcileDFDField, unlinkedDFDRows, dfdRowKey,
  type DFDPrefill, type DFDPrefillItem,
} from "../../domain/dfdPrefill";

const X = "a1a1a1a1a1a1a1a1a1a1a1a1", Y = "b2b2b2b2b2b2b2b2b2b2b2b2";

const item = (key: string, description: string, plannedQuantity: number | null, lotCode: string | null = null, unit = "UN"): DFDPrefillItem => ({
  key, fingerprint: canonicalItemKey(description, unit), lotCode, description, unit, plannedQuantity,
  qtyOrigin: plannedQuantity === null ? null : "user", qtyConflict: false,
});
const prefillOf = (items: DFDPrefillItem[]): DFDPrefill => ({
  contractVersion: "dfd-prefill/1", contextVersion: 1, contextDigest: "0123456789abcdef0123", object: "Material de limpeza",
  values: {}, items, hasLots: items.some((i) => i.lotCode !== null),
});
function generate(items: DFDPrefillItem[]) {
  const pf = prefillOf(items);
  return { pf, content: renderDFDContent(pf), sources: writeMarkers(["estrutura:art_12_par_1_lei_14133"], prefillMarkers(pf)) };
}
const links = (content: string, current: DFDPrefillItem[], sources: string[], sl: Parameters<typeof linkDFDRows>[3] = []) =>
  linkDFDRows(parseDFD(content), current, sources, sl).map((l) => [l.row.description, l.itemId, l.via, l.ambiguous]);

describe("P0.2 — linhagem do DFD por canonicalItemId", () => {
  it("F) gerar DFD persiste a linhagem pr:<canonicalItemId> e a linha → X (via linhagem)", () => {
    const { content, sources } = generate([item(X, "Detergente neutro", 50)]);
    expect(sources).toContain(`pr:${X}=1:${dfdRowKey(canonicalItemKey("Detergente neutro", "UN"), null)}`);
    expect(readMarkers(sources).rows[X]).toEqual({ itemNo: 1, rowKey: dfdRowKey(canonicalItemKey("Detergente neutro", "UN"), null) });
    expect(links(content, [item(X, "Detergente neutro", 50)], sources)).toEqual([["Detergente neutro", X, "lineage", false]]);
  });

  it("G) descrição, unidade, fingerprint e ORDEM mudam (no item e/ou no texto) ⇒ a linha continua ligada a X", () => {
    const { content, sources } = generate([item(X, "Detergente neutro", 50), item(Y, "Sabão em pó", 10)]);
    // 1. Item renomeado na Área de Itens (novo fingerprint) e reordenado — o DFD não muda.
    const renamed = [item(Y, "Sabão em pó", 10), item(X, "Detergente neutro biodegradável 500 ml", 50, null, "FR")];
    expect(links(content, renamed, sources)).toEqual([
      ["Detergente neutro", X, "lineage", false], ["Sabão em pó", Y, "lineage", false],
    ]);
    // 2. Servidor reescreve a descrição/unidade da linha no DFD — fingerprint da linha muda; o nº do item fica.
    const edited = content.replace("| 1 | Detergente neutro | UN |", "| 1 | Detergente líquido neutro concentrado | L |");
    expect(parseDFD(edited).items[0].fingerprint).not.toBe(canonicalItemKey("Detergente neutro", "UN"));
    expect(links(edited, renamed, sources)[0]).toEqual(["Detergente líquido neutro concentrado", X, "lineage", false]);
    // 3. Salvar regrava a linhagem a partir do vínculo ATUAL: a identidade sobrevive a novas edições.
    const saved = refreshRowLineage(edited, sources, renamed);
    expect(readMarkers(saved).rows[X]).toEqual({ itemNo: 1, rowKey: dfdRowKey(parseDFD(edited).items[0].fingerprint, null) });
    const edited2 = edited.replace("| 1 | Detergente líquido neutro concentrado |", "| 1 | Detergente (qualquer marca) |");
    expect(links(edited2, renamed, saved)[0]).toEqual(["Detergente (qualquer marca)", X, "lineage", false]);
    // Linha ligada por id NUNCA é proposta como candidata nova.
    expect(unlinkedDFDRows(edited2, saved, prefillOf(renamed))).toEqual([]);
  });

  it("H) item muda de lote (L01 → L02) ⇒ id inalterado, campo itemlot:X desatualizado e reconciliação atualiza SÓ a célula Lote", () => {
    const { content, sources } = generate([item(X, "Detergente neutro", 50, "L01"), item(Y, "Sabão em pó", 10, "L01")]);
    const moved = prefillOf([item(X, "Detergente neutro", 50, "L02"), item(Y, "Sabão em pó", 10, "L01")]);
    // Sem reconciliar: a linha (Lote L01) continua sendo X — lote é pertencimento, não identidade.
    expect(links(content, moved.items, sources)[0]).toEqual(["Detergente neutro", X, "lineage", false]);
    const st = computeDFDFieldStates(content, sources, moved).find((v) => v.key === `itemlot:${X}`)!;
    expect(st).toMatchObject({ state: "stale", documentValue: "L01", contextValue: "L02", reconcilable: true });
    const r = reconcileDFDField(content, sources, `itemlot:${X}`, moved)!;
    expect(r.content).toContain("| L02 | 1 | Detergente neutro | UN | 50 |");
    expect(r.content).toContain("| L01 | 2 | Sabão em pó | UN | 10 |");
    expect(parseDFD(r.content).items).toHaveLength(2); // nenhuma linha nova
    expect(links(r.content, moved.items, r.sources)[0]).toEqual(["Detergente neutro", X, "lineage", false]);
    expect(readMarkers(r.sources).rows[X].rowKey).toBe(dfdRowKey(canonicalItemKey("Detergente neutro", "UN"), "L02"));
    expect(computeDFDFieldStates(r.content, r.sources, moved).find((v) => v.key === `itemlot:${X}`)!.state).toBe("prefilled");
  });

  it("I) X e Y com o MESMO fingerprint ⇒ a linhagem liga cada linha ao seu id e nunca troca", () => {
    const { content, sources } = generate([item(X, "Papel A4", 100), item(Y, "Papel A4", 40)]);
    expect(links(content, [item(X, "Papel A4", 100), item(Y, "Papel A4", 40)], sources)).toEqual([
      ["Papel A4", X, "lineage", false], ["Papel A4", Y, "lineage", false],
    ]);
    // Ordem invertida no contexto e quantidade editada na linha 1 — continua X na linha 1, Y na linha 2.
    const edited = content.replace("| 1 | Papel A4 | UN | 100 |", "| 1 | Papel A4 | UN | 120 |");
    const reversed = [item(Y, "Papel A4", 40), item(X, "Papel A4", 100)];
    const l = linkDFDRows(parseDFD(edited), reversed, sources);
    expect(l.map((x) => [x.row.quantity, x.itemId])).toEqual([[120, X], [40, Y]]);
    const views = computeDFDFieldStates(edited, sources, prefillOf(reversed));
    expect(views.find((v) => v.key === `item:${X}`)).toMatchObject({ documentValue: "120" });
    expect(views.find((v) => v.key === `item:${Y}`)).toMatchObject({ documentValue: "40", state: "prefilled" });
  });

  it("J) DFD legado SEM canonicalItemId: fingerprint com 2 itens ⇒ AMBÍGUO (nunca escolhe); 1 ⇒ liga; 0 ⇒ não liga", () => {
    const legacy = generate([item(X, "Papel A4", 100), item(Y, "Caneta azul", 10)]);
    const noLineage = legacy.sources.filter((s) => !s.startsWith("pr:"));
    expect(readMarkers(noLineage).rows).toEqual({});
    // 2 itens com o mesmo fingerprint da linha "Papel A4" ⇒ ambígua; "Caneta azul" ⇒ 0 itens ⇒ sem vínculo.
    const two = [item(X, "Papel A4", 100), item(Y, "Papel A4", 40)];
    expect(links(legacy.content, two, noLineage)).toEqual([
      ["Papel A4", null, null, true], ["Caneta azul", null, null, false],
    ]);
    // Exatamente 1 ⇒ liga por recuperação (fingerprint), marcado como tal.
    expect(links(legacy.content, [item(X, "Papel A4", 100)], noLineage)[0]).toEqual(["Papel A4", X, "fingerprint", false]);
  });

  it("vínculo de fonte persistido (Área de Itens) tem precedência sobre fingerprint no DFD legado", () => {
    const legacy = generate([item(X, "Papel A4", 100)]);
    const noLineage = legacy.sources.filter((s) => !s.startsWith("pr:"));
    const two = [item(X, "Papel A4", 100), item(Y, "Papel A4", 40)];
    const sl = [{ fingerprint: canonicalItemKey("Papel A4", "UN"), lotKey: null, itemId: Y }];
    expect(links(legacy.content, two, noLineage, sl)[0]).toEqual(["Papel A4", Y, "source_link", false]);
  });

  it("linhagem de item REMOVIDO (inativo) é ignorada — nunca liga a linha a um id fora do conjunto ativo", () => {
    const { content, sources } = generate([item(X, "Detergente neutro", 50)]);
    expect(links(content, [item(Y, "Outro item", 5)], sources)).toEqual([["Detergente neutro", null, null, false]]);
  });
});
