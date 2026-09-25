/**
 * DFD — rascunho supervisionado da justificativa: contexto GOVERNADO (sem preço/pessoa), prompt com regras
 * anti-invenção, guarda determinística de números e seam determinístico (mock provider).
 */
import { describe, it, expect } from "vitest";
import {
  justificationFacts, buildJustificationPrompt, guardJustificationOutput, generateDFDJustificationText,
} from "../../services/authoring/dfdJustificationAuthoring";
import { resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash } from "../../domain/canonicalProcurementContext";

const K = "a1a1a1a1a1a1a1a1a1a1a1a1"; // id estável do Item Canônico
const ctx = resolveCanonicalContext({
  organizationId: 7, processId: "p1",
  process: { number: "2026/0001", object: "Mobiliário escolar", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
  organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
  assertions: [{
    id: 1, path: itemPath(K, "plannedQuantity"), value: 30, valueHash: factValueHash(30), sourceType: "user", sourceId: "u", sourceVersion: "v",
    status: "confirmed", actorUserId: 3, basisValueHash: null, createdAt: "2026-01-02T00:00:00.000Z",
  }],
  intelligentItems: [{ id: "i1", description: "Cadeira giratória", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 45_000, quoteCount: 3 }],
  procurementItems: [{ id: K, description: "Cadeira giratória", unit: "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: canonicalItemKey("Cadeira giratória", "UN") }],
  priceLinks: [{ itemId: K, intelligentItemId: "i1" }],
});

describe("DFD — autoria supervisionada da justificativa", () => {
  it("fatos autorizados: sem preço, sem orçamento e sem nome de pessoa", () => {
    const f = justificationFacts(ctx);
    expect(f.objeto).toBe("Mobiliário escolar");
    expect(f.itens).toEqual([{ descricao: "Cadeira giratória", unidade: "UN", quantidadePrevista: "30" }]);
    const prompt = buildJustificationPrompt(f);
    expect(prompt).not.toMatch(/R\$|450|Fulana/);
    expect(prompt).toContain("Não invente fatos, quantidades, prazos, valores");
    expect(prompt).toContain("[REVISAR:");
    expect(prompt).toContain("art. 12");
  });

  it("guarda: número não confirmado vira [REVISAR: …]; referência normativa do prompt e trechos já marcados ficam", () => {
    const f = justificationFacts(ctx);
    const g = guardJustificationOutput("Conforme a Lei 14.133/2021, serão 30 cadeiras em 45 dias [REVISAR: prazo de 10 dias].", f);
    expect(g.text).toBe("Conforme a Lei 14.133/2021, serão 30 cadeiras em [REVISAR: 45] dias [REVISAR: prazo de 10 dias].");
    expect(g.unverifiedNumbers).toEqual(["45"]);
  });

  it("seam determinístico (mock provider): sem chamada ao Engine; executionId derivado do input", async () => {
    let seen = "";
    const r = await generateDFDJustificationText({
      organizationId: 7, processId: "p1", ctx, correlationId: "c", actorUserId: 3, idempotencyKey: "k",
      invoke: async (p) => { seen = p; return "## Título\n**A demanda** decorre da necessidade de 200 cadeiras."; },
    });
    expect(seen).toContain("Mobiliário escolar");
    expect(r.text).toBe("A demanda decorre da necessidade de [REVISAR: 200] cadeiras.");
    expect(r.executionId).toMatch(/^seam-[a-f0-9]{16}$/);
    expect(r.provider).toBeNull();
    expect(r.contextDigest).toBe(ctx.digest);
    const again = await generateDFDJustificationText({ organizationId: 7, processId: "p1", ctx, correlationId: "c2", actorUserId: 9, idempotencyKey: "k2", invoke: async () => "x" });
    expect(again.inputDigest).toBe(r.inputDigest); // mesmo contexto governado ⇒ mesmo input
  });
});
