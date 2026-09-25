/**
 * P0.1 — TR × Contexto Canônico: com Itens da contratação, o quadro autoritativo do TR usa a quantidade
 * PREVISTA (nunca a da cotação), o preço de referência já vinculado ao item e estimativa = previsto × preço,
 * por item. Sem quantidade prevista ⇒ bloqueio (nunca cai para a quantidade da fonte, nunca assume 1).
 */
import { describe, it, expect } from "vitest";
import {
  buildDocumentAuthoringContext, canonicalTRItems, type ContextItem, type DocumentAuthoringInputs,
} from "../../services/authoring/authoringContext";
import {
  resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, type FactAssertion,
} from "../../domain/canonicalProcurementContext";

const A = "a1a1a1a1a1a1a1a1a1a1a1a1", B = "b2b2b2b2b2b2b2b2b2b2b2b2";
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
function ctxOf(items: Array<{ id: string; d: string; source: ContextItem }>, facts: FactAssertion[]) {
  return resolveCanonicalContext({
    organizationId: 7, processId: "p1", process: { number: "1", object: "Limpeza", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    responsibleUserName: null, organization: null, assertions: facts,
    intelligentItems: items.map((x) => ({ id: x.source.id, description: x.source.description, unit: "UN", quantity: x.source.quantity, status: "aprovado", averagePriceCents: x.source.averagePriceCents, quoteCount: 3 })),
    procurementItems: items.map((x, n) => ({ id: x.id, description: x.d, unit: "UN", lotId: null, ordinal: n + 1, status: "active", revision: 1, fingerprint: canonicalItemKey(x.d, "UN") })),
    priceLinks: items.map((x) => ({ itemId: x.id, intelligentItemId: x.source.id })),
  });
}
const base = (approvedItems: ContextItem[], canonical?: DocumentAuthoringInputs["canonical"]): DocumentAuthoringInputs => ({
  organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", processObject: "Limpeza", processNumber: "1",
  dfd: null, etp: null, approvedItems, pendingItemCount: 0, canonical,
});
const build = (items: Array<{ id: string; d: string; source: ContextItem }>, facts: FactAssertion[]) => {
  const approved = items.map((x) => x.source);
  const p = canonicalTRItems(ctxOf(items, facts), approved);
  return { p, tr: buildDocumentAuthoringContext(base(p.items, p.state)) };
};

describe("P0.1 — TR consome a quantidade PREVISTA do Contexto Canônico", () => {
  it("A) fonte = 1, prevista = 50, referência = R$ 100 ⇒ Qtd 50, unitário R$ 100, total R$ 5.000 (NUNCA 1)", () => {
    const src = ii("ii1", "Detergente", 1, 10_000);
    const { tr } = build([{ id: A, d: "Detergente", source: src }], [planned(A, 50)]);
    expect(tr.quantitySource).toBe("canonical_planned");
    expect(tr.estimate.rows.map((r) => [r.id, r.quantity, r.averagePriceCents, r.estimatedTotalCents])).toEqual([[A, 50, 10_000, 500_000]]);
    expect(tr.authoritativeBlock).toContain("| 1 | Detergente | 50 | UN | 100,00 | 5.000,00 |");
    expect(tr.authoritativeBlock).toContain("Qtd. prevista");
    expect(tr.authoritativeBlock).not.toMatch(/\| Detergente \| 1 \| UN \|/);
    expect(tr.promptContext).toContain("Detergente — 50 UN (quantidade prevista)");
  });

  it("B) fonte = 50, prevista = 50 ⇒ usa 50; proveniência continua separando fonte × prevista", () => {
    const src = ii("ii1", "Detergente", 50, 10_000);
    const ctx = ctxOf([{ id: A, d: "Detergente", source: src }], [planned(A, 50)]);
    expect(ctx.items[0].priceContext.sourceQuantities).toEqual([50]);
    expect(ctx.items[0].plannedQuantity).toMatchObject({ value: 50, source: { type: "user" } });
    const { tr } = build([{ id: A, d: "Detergente", source: src }], [planned(A, 50)]);
    expect(tr.estimate.rows[0].quantity).toBe(50);
  });

  it("C) fonte = 1, prevista ausente ⇒ bloqueia (missingPlannedQuantity); nada assume 1", () => {
    const { p, tr } = build([{ id: A, d: "Detergente", source: ii("ii1", "Detergente", 1, 10_000) }], []);
    expect(p.state.missingPlannedQuantity).toEqual([{ id: A, description: "Detergente" }]);
    expect(tr.estimate.rows[0].quantity).not.toBe(1);
    expect(tr.canonical?.missingPlannedQuantity).toHaveLength(1);
  });

  it("D) A (10 × R$100) e B (5 × R$20) ⇒ R$1.000, R$100, total R$1.100 — sem média nem quantidade cruzada", () => {
    const { tr } = build([
      { id: A, d: "Cadeira", source: ii("iiA", "Cadeira", 1, 10_000) },
      { id: B, d: "Mesa", source: ii("iiB", "Mesa", 7, 2_000) },
    ], [planned(A, 10), planned(B, 5)]);
    expect(tr.estimate.rows.map((r) => [r.id, r.estimatedTotalCents])).toEqual([[A, 100_000], [B, 10_000]]);
    expect(tr.estimate.globalTotalCents).toBe(110_000);
    expect(tr.authoritativeBlock).toContain("**Valor estimado global:** R$ 1.100,00");
  });

  it("E) prevista 20 → 30 ⇒ novo digest (replay/CONFLICT/SOURCE_CHANGED) e o novo quadro usa 30", () => {
    const src = ii("ii1", "Detergente", 1, 10_000);
    const f20 = planned(A, 20);
    const a = build([{ id: A, d: "Detergente", source: src }], [f20]).tr;
    const same = build([{ id: A, d: "Detergente", source: src }], [{ ...f20 }]).tr;
    const b = build([{ id: A, d: "Detergente", source: src }], [f20, planned(A, 30, f20.valueHash)]).tr;
    expect(same.sourcesDigest).toBe(a.sourcesDigest); // mesma quantidade ⇒ replay consistente
    expect(b.sourcesDigest).not.toBe(a.sourcesDigest);
    expect(b.estimate.rows[0].quantity).toBe(30);
    expect(b.lineageMarkers).toContain("qtd:prevista");
  });

  it("Item Inteligente aprovado SEM vínculo com Itens da contratação é contado (nunca presumido como necessidade)", () => {
    const linked = ii("ii1", "Detergente", 1, 10_000);
    const orphan = ii("ii9", "Desinfetante", 12, 5_000);
    const p = canonicalTRItems(ctxOf([{ id: A, d: "Detergente", source: linked }], [planned(A, 5)]), [linked, orphan]);
    expect(p.state.unlinkedApprovedItemCount).toBe(1);
    expect(p.items.map((i) => i.id)).toEqual([A]);
  });

  it("legado (processo sem Itens da contratação): quadro e snapshot inalterados (quantidade da cotação, sem chaves novas)", () => {
    const tr = buildDocumentAuthoringContext(base([ii("ii1", "Detergente", 3, 10_000)]));
    expect(tr.quantitySource).toBe("legacy");
    expect(tr.canonical).toBeNull();
    expect(JSON.stringify(tr.snapshot)).not.toContain('"qs"');
    expect(tr.authoritativeBlock).toContain("| 1 | Detergente | 3 | UN | 100,00 | 300,00 |");
    expect(tr.authoritativeBlock).toContain("Itens Inteligentes APROVADOS");
  });
});
