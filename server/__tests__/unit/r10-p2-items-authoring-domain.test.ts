/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R10 / P2 — contratos de domínio (puros): SEM-044 (marcador de edição humana), SEM-045 (proveniência real de
 * descrição/unidade), SEM-087 B (emissão exige ETP/TR/Edital oficiais), SEM-089 (chave dfdj: sem colisão),
 * SEM-090 (quantidade nula ≠ 0).
 */
import { describe, it, expect } from "vitest";
import { draftContentHash } from "../../domain/generatedDocument";
import { withHumanEditMarker, readHumanEditMarker, resolveDraftOrigin } from "../../domain/humanEditMarker";
import { resolveCanonicalContext, itemPath } from "../../domain/canonicalProcurementContext";
import { missingOfficialKinds, processIssueRefusalMessage, PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS } from "../../domain/processIssuance";
import { dfdJustificationExecutionKey } from "../../services/authoring/dfdJustificationAuthoring";
import { normalizeQuantity, storedQuantity, intelligentItemLogicalKey, consolidateQuotes, quoteContentHash, type PriceQuote } from "../../domain/priceQuoteConsolidation";
import { computeItemEstimates, renderAuthoritativeItemsBlock, formatQuantityOrReview, QUANTITY_NOT_INFORMED_TEXT } from "../../domain/authoritativeItems";

describe("SEM-044 — marcador de edição humana", () => {
  const H = "a".repeat(64);
  it("adiciona origem + ator + hash, preserva a lineage de geração e é idempotente (substitui ator/hash)", () => {
    const gen = ["ai:gpt", "srcdigest:abc", "srcd:dfd=1"];
    const once = withHumanEditMarker(gen, 7, H);
    expect(once).toEqual([...gen, "edicao_humana", "edicao_humana:ator=7", `edicao_humana:hash=${"a".repeat(16)}`]);
    const twice = withHumanEditMarker(once, 9, "b".repeat(64));
    expect(twice.filter((s) => s.startsWith("edicao_humana"))).toEqual(["edicao_humana", "edicao_humana:ator=9", `edicao_humana:hash=${"b".repeat(16)}`]);
    expect(twice.slice(0, 3)).toEqual(gen);
    expect(readHumanEditMarker(twice)).toEqual({ actorUserId: 9, contentHash: "b".repeat(16) });
    expect(readHumanEditMarker(gen)).toBeNull();
  });
  it("origem: gerado → manual após edição humana; importado vence; ledger cobre linhas antigas sem marcador", () => {
    const draft = { content: "texto", sources: ["ai:x", "srcdigest:1"] };
    expect(resolveDraftOrigin(draft, null)).toBe("generated");
    expect(resolveDraftOrigin({ ...draft, sources: withHumanEditMarker(draft.sources, 7, H) }, null)).toBe("manual");
    expect(resolveDraftOrigin({ ...draft, sources: ["origem:import", "edicao_humana"] }, null)).toBe("import");
    // legado: sem marcador, mas o ledger descreve o conteúdo vigente com human_edit
    const edit = { operation: "human_edit", actorUserId: 7, newContentHash: draftContentHash("texto"), createdAt: "2026-01-01T00:00:00.000Z" };
    expect(resolveDraftOrigin(draft, edit)).toBe("manual");
    // ledger de regeneração (IA) no conteúdo vigente ⇒ continua gerado; hash divergente não inventa autoria humana "manual" por omissão
    expect(resolveDraftOrigin(draft, { ...edit, operation: "ai_regenerate" })).toBe("generated");
  });
});

describe("SEM-045 — proveniência real de descrição/unidade do item canônico", () => {
  const base = { organizationId: 1, processId: "p", process: { number: "1", object: "obj", responsibleUserId: 1, createdAt: "2026-01-01T00:00:00.000Z" }, organization: null, assertions: [], intelligentItems: [] } as any;
  const item = (id: string, d: any, u: any = d, extra: any = {}) => ({
    id, description: "Detergente", unit: "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: "f", createdBy: 11,
    provenance: { description: { at: "2026-02-01T00:00:00.000Z", ...d }, unit: { at: "2026-02-01T00:00:00.000Z", ...u } }, ...extra,
  });
  const ctx = (items: any[]) => resolveCanonicalContext({ ...base, procurementItems: items });

  it("manual/corrigido por humano ⇒ user/confirmed com o ator real", () => {
    const c = ctx([item("m", { source: "manual", sourceId: null, overriddenBy: null }), item("o", { source: "dfd", sourceId: "doc1", overriddenBy: 22 })]);
    const [m, o] = [c.items.find((i) => i.key === "m")!, c.items.find((i) => i.key === "o")!];
    expect(m.description).toMatchObject({ status: "confirmed", actorUserId: 11, source: { type: "user", id: "pitem:m" } });
    expect(o.description).toMatchObject({ status: "confirmed", actorUserId: 22, source: { type: "user" } });
  });
  it("aceito como veio do DFD ⇒ fonte dfd (com o documento); da Pesquisa ⇒ pessoa que aceitou, origem preservada no id", () => {
    const c = ctx([item("d", { source: "dfd", sourceId: "doc1", overriddenBy: null }), item("r", { source: "price_research", sourceId: "ii9", overriddenBy: null })]);
    expect(c.items.find((i) => i.key === "d")!.description).toMatchObject({ status: "confirmed", actorUserId: 11, source: { type: "dfd", id: "pitem:d:dfd:doc1" } });
    const r = c.items.find((i) => i.key === "r")!;
    expect(r.unit.source).toMatchObject({ type: "user", id: "pitem:r:price_research:ii9" });
    expect(r.description.actorUserId).toBe(11);
  });
  it("sem pessoa que confirmou ⇒ observed (nunca inventa confirmação); valores não mudam", () => {
    const c = ctx([item("x", { source: "dfd", sourceId: "doc1", overriddenBy: null }, undefined, { createdBy: 0 })]);
    expect(c.items[0].description).toMatchObject({ value: "Detergente", status: "observed", actorUserId: 0 });
  });
  it("sem proveniência (legado) mantém a projeção anterior; ledger humano continua tendo precedência", () => {
    const c = ctx([{ ...item("l", { source: "manual", sourceId: null, overriddenBy: null }), provenance: undefined }]);
    expect(c.items[0].description).toMatchObject({ status: "confirmed", source: { type: "user", id: "pitem:l" } });
    expect(itemPath("l", "description")).toBe("items.l.description");
  });
});

describe("SEM-087 B — emissão do processo exige ETP, TR e Edital oficiais", () => {
  it("lista com precisão o que falta", () => {
    expect(missingOfficialKinds({ etp: null, tr: { v: 1 }, edital: { v: 1 } })).toEqual(["etp"]);
    expect(missingOfficialKinds({ etp: null, tr: null, edital: { v: 1 } })).toEqual(["etp", "tr"]);
    expect(missingOfficialKinds({ etp: {}, tr: {}, edital: {} })).toEqual([]);
    const m = processIssueRefusalMessage(["etp", "tr"])!;
    expect(m).toContain(PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS);
    expect(m).toContain("ETP sem versão OFICIAL emitida; TR sem versão OFICIAL emitida");
    expect(m).not.toContain("Edital sem");
    expect(processIssueRefusalMessage([])).toBeNull();
  });
});

describe("SEM-089 — chave dfdj: resistente a colisão", () => {
  it("chave curta inalterada (compatível com execuções existentes)", () => {
    expect(dfdJustificationExecutionKey("ai-1")).toBe("dfdj:ai-1");
    const k59 = "k".repeat(59);
    expect(dfdJustificationExecutionKey(k59)).toBe(`dfdj:${k59}`);
  });
  it("chaves longas com mesmo prefixo NÃO colidem, cabem em 64 e são determinísticas", () => {
    const a = "x".repeat(80) + "A", b = "x".repeat(80) + "B";
    const [ka, kb] = [dfdJustificationExecutionKey(a), dfdJustificationExecutionKey(b)];
    expect(ka).not.toBe(kb);
    expect(ka.length).toBeLessThanOrEqual(64);
    expect(ka).toBe(dfdJustificationExecutionKey(a));
    // o truncamento antigo colidia:
    expect(`dfdj:${a}`.slice(0, 64)).toBe(`dfdj:${b}`.slice(0, 64));
  });
  it("chave curta que imita o formato hasheado não colide com a hasheada de outra", () => {
    const long = "y".repeat(100);
    const hashed = dfdJustificationExecutionKey(long);
    const forged = hashed.slice("dfdj:".length); // "h1:<hash>" como chave do cliente
    expect(dfdJustificationExecutionKey(forged)).not.toBe(hashed);
  });
});

describe("SEM-090 — quantidade nula ≠ 0", () => {
  it("normalizeQuantity/storedQuantity: só finita e > 0 é quantidade; persistência coage UMA vez para 0", () => {
    expect(normalizeQuantity(null)).toBeNull();
    expect(normalizeQuantity(0)).toBeNull();
    expect(normalizeQuantity("0.000")).toBeNull();
    expect(normalizeQuantity(-3)).toBeNull();
    expect(normalizeQuantity(NaN)).toBeNull();
    expect(normalizeQuantity("12.5")).toBe(12.5);
    expect(storedQuantity(null)).toBe(0);
    expect(storedQuantity(7)).toBe(7);
  });
  it("chave lógica: codificação preservada (compat. com ids/aliases/vínculos persistidos) e hash de conteúdo estável", () => {
    expect(intelligentItemLogicalKey({ description: "Caneta", unit: "UN", quantity: null })).toBe(intelligentItemLogicalKey({ description: "Caneta", unit: "UN", quantity: 0 }));
    expect(intelligentItemLogicalKey({ description: "Caneta", unit: "UN", quantity: 10 })).toBe("caneta|UN|10000");
    const q = { description: "c", unit: "UN", supplier: "", brand: "", model: "", source: "", valueCents: 100 };
    expect(quoteContentHash({ ...q, quantity: null })).toBe(quoteContentHash({ ...q, quantity: 0 }));
  });
  it("consolidação carrega null (não 0) e separa de quantidade informada", () => {
    const mk = (id: string, quantity: number | null): PriceQuote => ({ quoteId: id, researchId: "r", description: "Caneta", quantity, unit: "UN", supplier: "S", brand: "", model: "", source: "", valueCents: 100 });
    const g = consolidateQuotes([mk("a", null), mk("b", 10), mk("c", 0)]);
    expect(g.map((x) => x.quantity)).toEqual([null, 10]);
    expect(g[0].quotes).toHaveLength(2); // null e 0 são a mesma "não informada"
  });
  it("leitores: TR/Edital/ETP mostram [REVISAR] e não calculam valor — nunca 0", () => {
    const row = (id: string, quantity: number) => ({ id, description: `Item ${id}`, quantity, unit: "UN", averagePriceCents: 1000, quoteCount: 1, confirmedCatalogCode: null, suggestedCatalogCode: null });
    const est = computeItemEstimates([row("a", 0), row("b", 5)], { preserveOrder: true });
    expect(est.unknownQuantityItemCount).toBe(1);
    expect(est.globalTotalCents).toBe(5000);
    const txt = renderAuthoritativeItemsBlock(est, { quantitySource: "canonical_planned" });
    expect(txt).toContain(`| 1 | Item a | ${QUANTITY_NOT_INFORMED_TEXT} | UN |`);
    expect(txt).not.toMatch(/\| Item a \| 0 \|/);
    expect(txt).toMatch(/sem quantidade informada/);
    expect(formatQuantityOrReview(null)).toBe(QUANTITY_NOT_INFORMED_TEXT);
    expect(formatQuantityOrReview(2.5)).toBe("2,5");
  });
});
