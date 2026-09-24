/**
 * Contexto Canônico da Contratação — domínio PURO (resolução, política de autoridade, proveniência,
 * superação consciente, conflito, identidade de item, evidência de preço, versão/digest).
 * Casos 1–16 (domínio) + casos A–G (quantidade: fonte ≠ necessidade).
 */
import { describe, it, expect } from "vitest";
import {
  resolveCanonicalContext, resolveField, isSourceAllowed, factValueHash, canonicalItemKey, itemPath,
  AUTHORITY_POLICY, CANONICAL_CONTEXT_VERSION,
  type ContextInputs, type FactAssertion, type ContextPath, type ContextSourceType, type AssertionStatus, type FactValue,
} from "../../domain/canonicalProcurementContext";

let seq = 0;
function fact(
  path: ContextPath, value: FactValue, sourceType: ContextSourceType,
  extra: Partial<FactAssertion> & { status?: AssertionStatus } = {},
): FactAssertion {
  return {
    id: ++seq, path, value, valueHash: factValueHash(value), sourceType, sourceId: "doc-1", sourceVersion: "v1",
    status: "confirmed", actorUserId: 3, basisValueHash: null, createdAt: "2026-02-01T10:00:00.000Z", ...extra,
  };
}

function iitem(id: string, description: string, quantity: number, over: Partial<ContextInputs["intelligentItems"][number]> = {}) {
  return { id, description, unit: "UN", quantity, status: "aprovado", averagePriceCents: 10_000, quoteCount: 3, ...over };
}

function inputs(over: Partial<ContextInputs> = {}): ContextInputs {
  return {
    organizationId: 7, processId: "proc-1",
    process: { number: "2026/0001", object: "Aquisição de cadeiras", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    responsibleUserName: "Servidora Responsável",
    organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
    assertions: [], intelligentItems: [], ...over,
  };
}

const KEY_CADEIRA = canonicalItemKey("Cadeira giratória", "UN");

describe("Contexto Canônico — domínio", () => {
  it("1) projeta fatos do Processo e da Organização com origem e estado confirmados", () => {
    const ctx = resolveCanonicalContext(inputs());
    expect(ctx.contractVersion).toBe(CANONICAL_CONTEXT_VERSION);
    expect(ctx.process.object).toMatchObject({ value: "Aquisição de cadeiras", status: "confirmed", source: { type: "process", id: "proc-1" } });
    expect(ctx.process.number.value).toBe("2026/0001");
    expect(ctx.organization.name.value).toBe("Prefeitura de Teste");
    expect(ctx.organization.location.value).toBe("Teste/PR");
    expect(ctx.demand.responsibleParty).toMatchObject({ value: "Servidora Responsável", source: { type: "process" } });
  });

  it("2) campo sem fonte fica UNKNOWN (nunca inventado)", () => {
    const ctx = resolveCanonicalContext(inputs({ responsibleUserName: null, organization: null }));
    expect(ctx.demand.requestingUnit).toMatchObject({ value: null, status: "unknown", source: null });
    expect(ctx.planning.priority.status).toBe("unknown");
    expect(ctx.organization.name.status).toBe("unknown");
    expect(ctx.stats.unknownFields).toBeGreaterThan(0);
  });

  it("3) política: Pesquisa de Preços/Item Inteligente NUNCA são autoridade de plannedQuantity", () => {
    expect(isSourceAllowed(itemPath(KEY_CADEIRA, "plannedQuantity"), "price_research")).toBe(false);
    expect(isSourceAllowed(itemPath(KEY_CADEIRA, "plannedQuantity"), "intelligent_item")).toBe(false);
    expect(isSourceAllowed(itemPath(KEY_CADEIRA, "plannedQuantity"), "dfd")).toBe(true);
    expect(isSourceAllowed(itemPath(KEY_CADEIRA, "description"), "intelligent_item")).toBe(true);
    // Defesa em profundidade: mesmo que exista no ledger, o resolvedor ignora.
    const f = resolveField(itemPath(KEY_CADEIRA, "plannedQuantity"), [fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 999, "price_research")]);
    expect(f.status).toBe("unknown");
  });

  it("4) ai_draft não afirma fato algum (nenhum caminho da política aceita IA)", () => {
    for (const sources of Object.values(AUTHORITY_POLICY)) expect(sources).not.toContain("ai_draft");
    const f = resolveField("demand.requestingUnit", [fact("demand.requestingUnit", "Unidade inventada", "ai_draft")]);
    expect(f.value).toBeNull();
  });

  it("5) por fonte vale a afirmação mais recente (ledger id)", () => {
    const a = fact("demand.requestingUnit", "Secretaria A", "dfd");
    const b = fact("demand.requestingUnit", "Secretaria B", "dfd", { basisValueHash: null });
    const f = resolveField("demand.requestingUnit", [b, a].reverse());
    expect(f.value).toBe("Secretaria B");
    expect(f.status).toBe("confirmed");
  });

  it("6) superação consciente: humano altera no DFD o valor pré-preenchido do Processo", () => {
    const ctx0 = resolveCanonicalContext(inputs());
    const human = fact("demand.responsibleParty", "Outro Servidor", "dfd", { basisValueHash: ctx0.demand.responsibleParty.valueHash });
    const ctx = resolveCanonicalContext(inputs({ assertions: [human] }));
    expect(ctx.demand.responsibleParty).toMatchObject({ value: "Outro Servidor", source: { type: "dfd" }, actorUserId: 3 });
    expect(ctx.stats.conflictCount).toBe(0);
  });

  it("7) CONFLITO: fontes de mesma autoridade divergem sem superação → valor null + divergências expostas", () => {
    const a = fact("demand.requestingUnit", "Secretaria de Saúde", "process", { sourceId: "proc-1" });
    const b = fact("demand.requestingUnit", "Secretaria de Educação", "dfd", { sourceId: "gdoc-1" });
    const f = resolveField("demand.requestingUnit", [a, b]);
    expect(f.status).toBe("conflict");
    expect(f.value).toBeNull();
    expect(f.conflict!.map((c) => c.value).sort()).toEqual(["Secretaria de Educação", "Secretaria de Saúde"]);
  });

  it("8) corroboração: mesmo valor por duas fontes → resolvido, com corroboratedBy", () => {
    const a = fact("demand.requestingUnit", "Secretaria de Saúde", "process", { sourceId: "proc-1" });
    const b = fact("demand.requestingUnit", "  Secretaria   de Saúde ", "dfd", { sourceId: "gdoc-1" });
    const f = resolveField("demand.requestingUnit", [a, b]);
    expect(f.status).toBe("confirmed");
    expect(f.corroboratedBy).toHaveLength(1);
  });

  it("9) autoridade por estado: approved > confirmed (sem conflito)", () => {
    const a = fact("planning.priority", "média", "dfd", { status: "confirmed" });
    const b = fact("planning.priority", "alta", "approved_document", { status: "approved", sourceId: "off-1" });
    const f = resolveField("planning.priority", [a, b]);
    expect(f).toMatchObject({ value: "alta", status: "approved" });
  });

  it("10) digest determinístico e independente da ordem de leitura", () => {
    const items = [iitem("i1", "Cadeira giratória", 1), iitem("i2", "Mesa de escritório", 5)];
    const facts = [fact("planning.priority", "alta", "dfd"), fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 30, "dfd")];
    const a = resolveCanonicalContext(inputs({ intelligentItems: items, assertions: facts }));
    const b = resolveCanonicalContext(inputs({ intelligentItems: [...items].reverse(), assertions: [...facts].reverse() }));
    expect(a.digest).toBe(b.digest);
    expect(a.items.map((i) => i.key)).toEqual(b.items.map((i) => i.key));
  });

  it("11) digest muda ⇔ fato muda (timestamps/atores não entram)", () => {
    const f1 = fact("planning.priority", "alta", "dfd");
    const base = resolveCanonicalContext(inputs({ assertions: [f1] }));
    const sameFactOtherTime = resolveCanonicalContext(inputs({ assertions: [{ ...f1, createdAt: "2030-01-01T00:00:00.000Z", actorUserId: 99 }] }));
    const changed = resolveCanonicalContext(inputs({ assertions: [{ ...f1, value: "baixa", valueHash: factValueHash("baixa") }] }));
    expect(sameFactOtherTime.digest).toBe(base.digest);
    expect(changed.digest).not.toBe(base.digest);
  });

  it("12) versão = maior id do ledger consumido (0 = só projeções)", () => {
    expect(resolveCanonicalContext(inputs()).version).toBe(0);
    const f = fact("planning.priority", "alta", "dfd", { id: 42 });
    expect(resolveCanonicalContext(inputs({ assertions: [f] })).version).toBe(42);
  });

  it("13) identidade do item SEM quantidade: cotações com quantidades distintas convergem para UM item", () => {
    const ctx = resolveCanonicalContext(inputs({
      intelligentItems: [iitem("i1", "Cadeira giratória", 1), iitem("i2", "cadeira GIRATÓRIA.", 10, { unit: "un" })],
    }));
    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0].key).toBe(KEY_CADEIRA);
    expect(ctx.items[0].priceContext.sourceQuantities).toEqual([1, 10]);
    expect(ctx.items[0].priceContext.intelligentItemIds).toEqual(["i1", "i2"]);
  });

  it("14) itens REJEITADOS não entram no contexto", () => {
    const ctx = resolveCanonicalContext(inputs({ intelligentItems: [iitem("i1", "Cadeira giratória", 1, { status: "rejeitado" })] }));
    expect(ctx.items).toHaveLength(0);
  });

  it("15) preço de referência = média ponderada por cotações só de itens APROVADOS", () => {
    const ctx = resolveCanonicalContext(inputs({
      intelligentItems: [
        iitem("i1", "Cadeira giratória", 1, { averagePriceCents: 10_000, quoteCount: 3 }),
        iitem("i2", "Cadeira giratória", 5, { averagePriceCents: 20_000, quoteCount: 1 }),
        iitem("i3", "Cadeira giratória", 7, { averagePriceCents: 99_999, quoteCount: 5, status: "pendente" }),
      ],
    }));
    expect(ctx.items[0].priceContext.unitReferencePriceCents).toBe(12_500); // (3×100 + 1×200)/4
  });

  it("16) estatísticas e isolamento de escopo: contexto carrega organizationId/processId do chamador", () => {
    const ctx = resolveCanonicalContext(inputs({ assertions: [fact("demand.requestingUnit", "Sec. Saúde", "process", { sourceId: "proc-1" })] }));
    expect(ctx.organizationId).toBe(7);
    expect(ctx.processId).toBe("proc-1");
    expect(ctx.stats.knownFields).toBe(6); // número, objeto, órgão, localidade, unidade, responsável
    expect(ctx.stats.conflictCount).toBe(0);
    const other = resolveCanonicalContext({ ...inputs(), organizationId: 8 });
    expect(other.digest).not.toBe(resolveCanonicalContext(inputs()).digest);
  });
});

describe("Contexto Canônico — quantidade: Pesquisa de Preços (sourceQuantity) ≠ necessidade (plannedQuantity)", () => {
  const q = (ctx: ReturnType<typeof resolveCanonicalContext>) => ctx.items.find((i) => i.key === KEY_CADEIRA)!;

  it("A) Pesquisa com quantidade 1 NÃO vira quantidade prevista", () => {
    const it0 = q(resolveCanonicalContext(inputs({ intelligentItems: [iitem("i1", "Cadeira giratória", 1)] })));
    expect(it0.plannedQuantity).toMatchObject({ value: null, status: "unknown" });
    expect(it0.priceContext.sourceQuantities).toEqual([1]);
    expect(it0.estimatedTotalCents).toBeNull();
  });

  it("B) Pesquisa com a quantidade REAL também não é copiada em silêncio", () => {
    const ctx = resolveCanonicalContext(inputs({ intelligentItems: [iitem("i1", "Cadeira giratória", 120)] }));
    expect(q(ctx).plannedQuantity.value).toBeNull();
    expect(ctx.priceContext.complete).toBe(false);
    expect(ctx.priceContext.itemsMissingPlannedQuantity).toBe(1);
  });

  it("C) Pesquisa SEM quantidade → sourceQuantity null (formato-agnóstico)", () => {
    const it0 = q(resolveCanonicalContext(inputs({ intelligentItems: [iitem("i1", "Cadeira giratória", 0)] })));
    expect(it0.priceContext.sourceQuantities).toEqual([null]);
  });

  it("D) quantidade prevista informada no DFD + preço da Pesquisa → estimativa = previsto × referência", () => {
    const ctx = resolveCanonicalContext(inputs({
      intelligentItems: [iitem("i1", "Cadeira giratória", 1, { averagePriceCents: 45_050 })],
      assertions: [fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 30, "dfd")],
    }));
    expect(q(ctx).plannedQuantity).toMatchObject({ value: 30, source: { type: "dfd" } });
    expect(q(ctx).estimatedTotalCents).toBe(1_351_500);
    expect(ctx.priceContext).toMatchObject({ complete: true, estimatedTotalCents: 1_351_500 });
  });

  it("E) previsto diferente da quantidade da cotação NÃO é conflito (evidência ≠ autoridade)", () => {
    const ctx = resolveCanonicalContext(inputs({
      intelligentItems: [iitem("i1", "Cadeira giratória", 10)],
      assertions: [fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 30, "dfd")],
    }));
    expect(q(ctx).plannedQuantity.status).toBe("confirmed");
    expect(ctx.stats.conflictCount).toBe(0);
  });

  it("F) humano altera o previsto VENDO o valor anterior → supera; duas fontes divergentes sem base → conflito", () => {
    const first = fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 30, "dfd", { sourceId: "gdoc-1" });
    const etp = fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 40, "etp", { sourceId: "etp-1", basisValueHash: first.valueHash });
    expect(q(resolveCanonicalContext(inputs({ assertions: [first, etp] }))).plannedQuantity.value).toBe(40);
    const blind = fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 50, "tr", { sourceId: "tr-1" });
    const conflicted = q(resolveCanonicalContext(inputs({ assertions: [first, etp, blind] })));
    expect(conflicted.plannedQuantity.status).toBe("conflict");
    expect(conflicted.plannedQuantity.value).toBeNull();
    expect(conflicted.estimatedTotalCents).toBeNull();
  });

  it("G) afirmação da Pesquisa sobre plannedQuantity é ignorada pelo resolvedor (e recusada na escrita)", () => {
    const ctx = resolveCanonicalContext(inputs({
      intelligentItems: [iitem("i1", "Cadeira giratória", 1)],
      assertions: [fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 1, "price_research"), fact(itemPath(KEY_CADEIRA, "plannedQuantity"), 1, "intelligent_item")],
    }));
    expect(q(ctx).plannedQuantity.value).toBeNull();
  });
});
