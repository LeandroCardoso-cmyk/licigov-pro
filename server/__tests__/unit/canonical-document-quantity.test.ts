/**
 * P0.3 — UMA fonte semântica para a quantidade da contratação: com Itens da contratação, ETP, TR e Edital
 * consomem a MESMA projeção (`canonicalDocumentItems`): quantidade = PREVISTA, nunca `sourceQuantity` /
 * `intelligent_items.quantity`; preço = referência vinculada; estimativa = prevista × referência, por item.
 */
import { describe, it, expect } from "vitest";
import {
  buildDocumentAuthoringContext, canonicalDocumentItems, type ContextItem, type DocumentAuthoringInputs,
} from "../../services/authoring/authoringContext";
import { buildEditalSourceContext, type EditalSourceInputs } from "../../services/authoring/editalContext";
import {
  resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, type FactAssertion,
} from "../../domain/canonicalProcurementContext";
import { buildDFDPrefill, renderDFDContent } from "../../domain/dfdPrefill";

const A = "a1a1a1a1a1a1a1a1a1a1a1a1", B = "b2b2b2b2b2b2b2b2b2b2b2b2", C = "c3c3c3c3c3c3c3c3c3c3c3c3";
const L1 = "l1l1l1l1l1l1l1l1l1l1l1l1", L2 = "l2l2l2l2l2l2l2l2l2l2l2l2";
let seq = 0;
const planned = (item: string, v: number, basis: string | null = null): FactAssertion => ({
  id: ++seq, path: itemPath(item, "plannedQuantity"), value: v, valueHash: factValueHash(v), sourceType: "user", sourceId: "items-area",
  sourceVersion: `r${seq}:informed`, status: "confirmed", actorUserId: 5, basisValueHash: basis, createdAt: "2026-02-01T00:00:00.000Z",
});
const ii = (id: string, description: string, quantity: number, priceCents: number): ContextItem => ({
  id, description, quantity, unit: "UN", averagePriceCents: priceCents, quoteCount: 3,
  confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current",
  quotes: [{ quoteId: `${id}-q`, supplier: "Fornecedor", brand: "", model: "", valueCents: priceCents }],
});
type Row = { id: string; d: string; source: ContextItem; lot?: string | null; ord?: number };
function ctxOf(rows: Row[], facts: FactAssertion[], lots = false) {
  return resolveCanonicalContext({
    organizationId: 7, processId: "p1", process: { number: "1", object: "Limpeza", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    responsibleUserName: null, organization: null, assertions: facts,
    intelligentItems: rows.map((x) => ({ id: x.source.id, description: x.source.description, unit: "UN", quantity: x.source.quantity, status: "aprovado", averagePriceCents: x.source.averagePriceCents, quoteCount: 3 })),
    procurementItems: rows.map((x, n) => ({ id: x.id, description: x.d, unit: "UN", lotId: x.lot ?? null, ordinal: x.ord ?? n + 1, status: "active", revision: 1, fingerprint: canonicalItemKey(x.d, "UN") })),
    priceLinks: rows.map((x) => ({ itemId: x.id, intelligentItemId: x.source.id })),
    ...(lots ? { lots: [{ id: L1, code: "01", name: "Lote 1", ordinal: 1, status: "active" }, { id: L2, code: "02", name: "Lote 2", ordinal: 2, status: "active" }] } : {}),
  });
}
const project = (rows: Row[], facts: FactAssertion[], lots = false, extra: ContextItem[] = []) =>
  canonicalDocumentItems(ctxOf(rows, facts, lots), [...rows.map((r) => r.source), ...extra]);
const doc = (kind: "etp" | "tr", p: ReturnType<typeof project> | null, legacy: ContextItem[] = []) => buildDocumentAuthoringContext({
  organizationId: 7, processId: "p1", kind, object: "Limpeza", processObject: "Limpeza", processNumber: "1",
  dfd: null, etp: null, approvedItems: p ? p.items : legacy, pendingItemCount: 0, canonical: p?.state,
} satisfies DocumentAuthoringInputs);
const edital = (p: ReturnType<typeof project> | null, legacy: EditalSourceInputs["approvedItems"] = []) => buildEditalSourceContext({
  organizationId: 7, processId: "p1", object: "Limpeza", modality: "pregao", form: "eletronico", platform: "compras_gov",
  processObject: "Limpeza", processNumber: "1", currentStage: null, dfd: null, etp: null, tr: null,
  approvedItems: legacy, criterioJulgamento: null, regimeContratacao: null, canonical: p ?? undefined,
});

describe("P0.3 — ETP consome a quantidade PREVISTA (projeção compartilhada)", () => {
  it("ETP 1) fonte = 1, prevista = 50 ⇒ o quantitativo é 50 (NUNCA 1)", () => {
    const etp = doc("etp", project([{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 1, 10_000) }], [planned(A, 50)]));
    expect(etp.quantitySource).toBe("canonical_planned");
    expect(etp.promptContext).toContain("Detergente — 50 UN (quantidade prevista)");
    expect(etp.promptContext).not.toMatch(/Detergente — 1 UN/);
    expect(etp.promptContext).toContain("R$ 5.000,00");
    expect(etp.lineageMarkers).toContain("qtd:prevista");
  });

  it("ETP 2) fonte = 50, prevista ausente ⇒ \"[a definir]\" (não assume 50); estimativa global NÃO calculada", () => {
    const p = project([{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 50, 10_000) }], []);
    const etp = doc("etp", p);
    expect(etp.promptContext).toContain("quantidade prevista: [a definir]");
    expect(etp.promptContext).toContain("NÃO inferir nem usar a quantidade da Pesquisa");
    expect(etp.promptContext).not.toMatch(/Detergente — 50 UN/);
    expect(etp.promptContext).toMatch(/Valor estimado global: \[REVISAR: 1 item\(ns\) sem quantidade prevista/);
    expect(etp.missing).toContain("quantidade_prevista");
    expect(etp.estimate.rows[0].quantity).toBe(0); // nunca 50 da fonte
  });

  it("ETP 3) prevista 50 → 60 ⇒ novo digest (replay/CONFLICT/source_changed) e o novo contexto usa 60", () => {
    const src = ii("ii1", "Detergente", 1, 10_000);
    const f50 = planned(A, 50);
    const a = doc("etp", project([{ id: A, d: "Detergente", source: src }], [f50]));
    const b = doc("etp", project([{ id: A, d: "Detergente", source: src }], [f50, planned(A, 60, f50.valueHash)]));
    expect(b.sourcesDigest).not.toBe(a.sourcesDigest);
    expect(b.promptContext).toContain("Detergente — 60 UN (quantidade prevista)");
  });

  it("ETP 4) A = 10 e B = 5 ⇒ cada item com a SUA quantidade (sem cruzamento)", () => {
    const etp = doc("etp", project([
      { id: A, d: "Cadeira", source: ii("iiA", "Cadeira", 1, 10_000) },
      { id: B, d: "Mesa", source: ii("iiB", "Mesa", 7, 2_000) },
    ], [planned(A, 10), planned(B, 5)]));
    expect(etp.promptContext).toContain("Cadeira — 10 UN (quantidade prevista)");
    expect(etp.promptContext).toContain("Mesa — 5 UN (quantidade prevista)");
  });

  it("ETP: Item Inteligente aprovado SEM vínculo é sinalizado e NÃO entra como necessidade", () => {
    const etp = doc("etp", project([{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 1, 10_000) }], [planned(A, 5)], false, [ii("ii9", "Desinfetante", 12, 5_000)]));
    expect(etp.promptContext).not.toContain("Desinfetante");
    expect(etp.promptContext).toContain("1 Item(ns) Inteligente(s) aprovado(s) da Pesquisa NÃO vinculado(s)");
  });

  it("ETP legado (sem Itens da contratação): prompt e snapshot inalterados (quantidade da cotação, sem chaves novas)", () => {
    const etp = doc("etp", null, [ii("ii1", "Detergente", 3, 10_000)]);
    expect(etp.quantitySource).toBe("legacy");
    expect(etp.promptContext).toContain("## Itens Inteligentes aprovados (1)");
    expect(etp.promptContext).toContain("Detergente — 3 UN · 3 cotação(ões)");
    expect(JSON.stringify(etp.snapshot)).not.toMatch(/"qs"|"lot"/);
  });
});

describe("P0.3 — Edital consome a quantidade PREVISTA (MESMA projeção)", () => {
  it("EDITAL 1) fonte = 1, prevista = 50 ⇒ Quantidade 50 no quadro autoritativo e no prompt", () => {
    const ed = edital(project([{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 1, 10_000) }], [planned(A, 50)]));
    expect(ed.quantitySource).toBe("canonical_planned");
    expect(ed.authoritativeBlock).toContain("| 1 | Detergente | 50 | UN | 100,00 | 5.000,00 |");
    expect(ed.authoritativeBlock).toContain("Qtd. prevista");
    expect(ed.authoritativeBlock).not.toMatch(/\| Detergente \| 1 \| UN \|/);
    expect(ed.promptContext).toContain("Detergente — 50 UN (quantidade prevista)");
    expect(ed.lineageMarkers).toContain("qtd:prevista");
  });

  it("EDITAL 2/3) 5 itens canônicos, 1 sem prevista ⇒ estado aponta o item (a geração bloqueia; nada vem da Pesquisa)", () => {
    const rows: Row[] = ["Rodo", "Balde", "Pano", "Luva", "Escova"].map((d, n) => ({ id: String(n + 1).repeat(24), d, source: ii(`ii${n}`, d, 35, 1_000) }));
    const p = project(rows, rows.slice(0, 4).map((r) => planned(r.id, 10)));
    expect(p.state.missingPlannedQuantity).toEqual([{ id: rows[4].id, description: "Escova" }]);
    const ed = edital(p);
    expect(ed.canonical?.missingPlannedQuantity).toHaveLength(1);
    expect(ed.authoritativeBlock).not.toMatch(/\| Escova \| 35 \|/);
  });

  it("EDITAL 4) A 10 × R$100 e B 5 × R$20 ⇒ R$1.000, R$100, total R$1.100", () => {
    const ed = edital(project([
      { id: A, d: "Cadeira", source: ii("iiA", "Cadeira", 1, 10_000) },
      { id: B, d: "Mesa", source: ii("iiB", "Mesa", 7, 2_000) },
    ], [planned(A, 10), planned(B, 5)]));
    expect(ed.authoritativeBlock).toContain("| 1 | Cadeira | 10 | UN | 100,00 | 1.000,00 |");
    expect(ed.authoritativeBlock).toContain("| 2 | Mesa | 5 | UN | 20,00 | 100,00 |");
    expect(ed.authoritativeBlock).toContain("**Valor estimado global:** R$ 1.100,00");
  });

  it("EDITAL 5) lote 01 {A,B}, lote 02 {C}; mover B → 02 mantém o id, muda a estrutura e o digest", () => {
    const src = { A: ii("iiA", "Cadeira", 1, 10_000), B: ii("iiB", "Mesa", 1, 2_000), C: ii("iiC", "Armário", 1, 5_000) };
    const facts = [planned(A, 10), planned(B, 5), planned(C, 2)];
    const before = edital(project([
      { id: A, d: "Cadeira", source: src.A, lot: L1, ord: 1 }, { id: B, d: "Mesa", source: src.B, lot: L1, ord: 2 }, { id: C, d: "Armário", source: src.C, lot: L2, ord: 3 },
    ], facts, true));
    const after = edital(project([
      { id: A, d: "Cadeira", source: src.A, lot: L1, ord: 1 }, { id: B, d: "Mesa", source: src.B, lot: L2, ord: 2 }, { id: C, d: "Armário", source: src.C, lot: L2, ord: 3 },
    ], facts, true));
    expect(before.promptContext).toContain("Mesa — 5 UN (quantidade prevista) · lote 01");
    expect(after.promptContext).toContain("Mesa — 5 UN (quantidade prevista) · lote 02");
    expect(after.sourcesDigest).not.toBe(before.sourcesDigest); // novo draft ⇒ source_changed; oficial nunca muda sozinho
    expect(after.authoritativeBlock).toContain("| 2 | Mesa | 5 | UN | 20,00 | 100,00 |");
  });

  it("EDITAL: prevista 50 → 60 ⇒ novo digest (mesma chave ⇒ CONFLICT; drafts ⇒ source_changed)", () => {
    const src = ii("ii1", "Detergente", 1, 10_000);
    const f50 = planned(A, 50);
    const a = edital(project([{ id: A, d: "Detergente", source: src }], [f50]));
    const same = edital(project([{ id: A, d: "Detergente", source: src }], [{ ...f50 }]));
    const b = edital(project([{ id: A, d: "Detergente", source: src }], [f50, planned(A, 60, f50.valueHash)]));
    expect(same.sourcesDigest).toBe(a.sourcesDigest);
    expect(b.sourcesDigest).not.toBe(a.sourcesDigest);
    expect(b.authoritativeBlock).toContain("| 1 | Detergente | 60 | UN | 100,00 | 6.000,00 |");
  });

  it("EDITAL legado (sem Itens da contratação): mesma fórmula de digest e quadro (quantidade da cotação)", () => {
    const legacy = [{ id: "ii1", description: "Detergente", quantity: 3, unit: "UN", averagePrice: 100, suggestedCATMAT: null, quoteCount: 3, sourceState: "current" }];
    const ed = edital(null, legacy);
    expect(ed.quantitySource).toBe("legacy");
    expect(ed.canonical).toBeNull();
    expect(ed.authoritativeBlock).toContain("| 1 | Detergente | 3 | UN | 100,00 | 300,00 |");
    expect(ed.lineageMarkers).not.toContain("qtd:prevista");
    expect(ed.promptContext).toContain("## Itens aprovados (1)");
  });
});

describe("P0.3 — transversal: sourceQuantity = 1 ≠ plannedQuantity = 50 ponta a ponta", () => {
  it("DFD, ETP, TR e Edital expressam 50; a Pesquisa continua com 1", () => {
    const rows: Row[] = [{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 1, 10_000) }];
    const ctx = ctxOf(rows, [planned(A, 50)]);
    const p = canonicalDocumentItems(ctx, rows.map((r) => r.source));
    expect(ctx.items[0].priceContext.sourceQuantities).toEqual([1]); // evidência preservada
    expect(renderDFDContent(buildDFDPrefill(ctx))).toContain("| 1 | Detergente | UN | 50 |");
    expect(doc("etp", p).promptContext).toContain("Detergente — 50 UN (quantidade prevista)");
    expect(doc("tr", p).authoritativeBlock).toContain("| 1 | Detergente | 50 | UN | 100,00 | 5.000,00 |");
    expect(edital(p).authoritativeBlock).toContain("| 1 | Detergente | 50 | UN | 100,00 | 5.000,00 |");
    for (const text of [doc("etp", p).promptContext, doc("tr", p).promptContext, edital(p).promptContext]) {
      expect(text).not.toMatch(/Detergente — 1 UN/);
    }
  });
});
