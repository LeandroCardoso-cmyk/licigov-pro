/**
 * R9 — grupo A (autoridade da fonte): SEM-028 (preço só de fonte vigente), SEM-029 (objeto autoritativo do processo),
 * SEM-031 (unidade compatível, sem conversão inventada). Regras puras (domínio + builders de contexto).
 */
import { describe, it, expect } from "vitest";
import { resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, unitsCompatible, type FactAssertion } from "../../domain/canonicalProcurementContext";
import { buildDocumentAuthoringContext, canonicalDocumentItems, type ContextItem } from "../../services/authoring/authoringContext";
import { buildEditalSourceContext } from "../../services/authoring/editalContext";

const A = "a1a1a1a1a1a1a1a1a1a1a1a1";
const planned: FactAssertion = {
  id: 1, path: itemPath(A, "plannedQuantity"), value: 10, valueHash: factValueHash(10), sourceType: "user", sourceId: "items-area",
  sourceVersion: "r1:informed", status: "confirmed", actorUserId: 5, basisValueHash: null, createdAt: "2026-02-01T00:00:00.000Z",
};
function ctx(over: { sourceState?: string; iiUnit?: string; itemUnit?: string } = {}) {
  return resolveCanonicalContext({
    organizationId: 7, processId: "p1", process: { number: "1", object: "Limpeza", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    organization: null, assertions: [planned],
    intelligentItems: [{ id: "ii1", description: "Detergente", unit: over.iiUnit ?? "UN", quantity: 1, status: "aprovado", averagePriceCents: 1000, quoteCount: 3, sourceState: over.sourceState ?? "current" }],
    procurementItems: [{ id: A, description: "Detergente", unit: over.itemUnit ?? "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: canonicalItemKey("Detergente", over.itemUnit ?? "UN") }],
    priceLinks: [{ itemId: A, intelligentItemId: "ii1" }],
  });
}
const approved: ContextItem = {
  id: "ii1", description: "Detergente", quantity: 1, unit: "UN", averagePriceCents: 1000, quoteCount: 3,
  confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current", quotes: [],
};

describe("SEM-028 — preço canônico só de Item Inteligente com fonte VIGENTE", () => {
  it("current ⇒ preço de referência autoritativo", () => {
    const c = ctx();
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: 1000, priceBlockedReason: null });
    expect(c.items[0].estimatedTotalCents).toBe(10_000);
  });
  it.each(["source_changed", "review_required"])("%s ⇒ preço suspenso, total não calculado, digest muda", (state) => {
    const c = ctx({ sourceState: state });
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: null, priceBlockedReason: "SOURCE_NOT_CURRENT", priceAmbiguous: false });
    expect(c.items[0].estimatedTotalCents).toBeNull();
    expect(c.priceContext.complete).toBe(false);
    expect(c.digest).not.toBe(ctx().digest);
  });
  it("downstream (TR/Edital): o quadro autoritativo explica a suspensão em vez de usar o preço antigo", () => {
    const p = canonicalDocumentItems(ctx({ sourceState: "source_changed" }), [approved]);
    const tr = buildDocumentAuthoringContext({
      organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", processObject: "Limpeza", processNumber: "1",
      dfd: null, etp: null, approvedItems: p.items, pendingItemCount: 0, canonical: p.state,
    });
    expect(tr.authoritativeBlock).toContain("[REVISAR: preço suspenso — fonte da pesquisa alterada]");
    expect(tr.authoritativeBlock).not.toContain("10,00 |");
  });
});

describe("SEM-031 — unidade da cotação compatível com a do item (sem conversão inventada)", () => {
  it("unidades canônicas iguais são compatíveis; CX ≠ UN", () => {
    expect(unitsCompatible("unid.", "UN")).toBe(true);
    expect(unitsCompatible("CX", "UN")).toBe(false);
  });
  it("troca da unidade do item depois do vínculo ⇒ preço suspenso (UNIT_MISMATCH)", () => {
    const c = ctx({ itemUnit: "CX" });
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: null, priceBlockedReason: "UNIT_MISMATCH" });
    const p = canonicalDocumentItems(c, [approved]);
    expect(p.items[0].priceBlockedReason).toBe("UNIT_MISMATCH");
  });
});

describe("SEM-029 — objeto autoritativo é process.object", () => {
  it("objeto digitado divergente vira PROPOSTA ignorada (ETP/TR e Edital)", () => {
    const d = buildDocumentAuthoringContext({
      organizationId: 7, processId: "p1", kind: "etp", object: "Outro objeto digitado", processObject: "Limpeza", processNumber: "1",
      dfd: null, etp: null, approvedItems: [], pendingItemCount: 0,
    });
    expect(d.promptContext).toContain("Limpeza");
    expect(d.promptContext).not.toContain("Outro objeto digitado");
    expect(d.objectProposal).toEqual({ current: "Limpeza", proposed: "Outro objeto digitado", source: "client_input" });
    const e = buildEditalSourceContext({
      organizationId: 7, processId: "p1", object: "Outro objeto digitado", modality: "pregao", form: "eletronico", platform: "compras_gov",
      processObject: "Limpeza", processNumber: "1", currentStage: null, dfd: null, etp: null, tr: null, approvedItems: [],
      criterioJulgamento: null, regimeContratacao: null,
    });
    expect(e.promptContext).not.toContain("Outro objeto digitado");
    expect(e.objectProposal?.proposed).toBe("Outro objeto digitado");
  });
  it("processo sem objeto (legado) ⇒ o digitado é usado e não há proposta", () => {
    const d = buildDocumentAuthoringContext({
      organizationId: 7, processId: "p1", kind: "etp", object: "Objeto informado", processObject: null, processNumber: "1",
      dfd: null, etp: null, approvedItems: [], pendingItemCount: 0,
    });
    expect(d.promptContext).toContain("Objeto informado");
    expect(d.objectProposal).toBeNull();
  });
});
