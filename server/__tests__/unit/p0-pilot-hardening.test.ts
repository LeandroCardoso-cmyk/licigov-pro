/**
 * P0 PILOTO — HARDENING (unitário, sem DB): contrato monetário tipado (XLSX real), identidade de conteúdo
 * da cotação, digest de fontes = snapshot efetivamente consumido, payload de idempotência do createSession,
 * cobertura documental explícita e contagem de cotações válidas.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { numericToCents, parseBRLDetailed, canonicalDecimalToCents, multiplyQuantityCents, numberToDecimalString } from "../../domain/money";
import { XlsxParser } from "../../parsers/xlsxParser";
import { resolveEffectiveMoney, resolveEffectiveQuantity } from "../../domain/importCorrectionFields";
import { quoteContentHash, quoteSetSignature, mergeQuotes, consolidateQuotes, type PriceQuote } from "../../domain/priceQuoteConsolidation";
import { buildDocumentAuthoringContext, type DocumentAuthoringInputs, type ContextItem } from "../../services/authoring/authoringContext";
import { buildEditalSourceContext, type EditalSourceInputs } from "../../services/authoring/editalContext";
import { createSessionPayloadHash } from "../../routers/ingestionRouter";
import { selectDocumentExcerpt, canonicalJson } from "../../domain/canonicalJson";
import { computeItemEstimates, renderAuthoritativeItemsBlock } from "../../domain/authoritativeItems";

// ─── B1 — contrato monetário ────────────────────────────────────────────────────

describe("B1 — número nativo × texto localizado (centavos, half-up UMA vez)", () => {
  it("NUMBER nativo", () => {
    expect(numericToCents(1.234)).toBe(123);   // R$ 1,234 → 123 centavos (NUNCA R$ 1.234,00)
    expect(numericToCents(1.005)).toBe(101);   // decimal exato "1.005" → half-up → 101 (documentado)
    expect(numericToCents(1.0049)).toBe(100);  // sem arredondamento duplo (toFixed(3) daria "1.005" → 101)
    expect(numericToCents(100)).toBe(10000);
    expect(numericToCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(numberToDecimalString(1e-7)).toBe("0.0000001");
    expect(parseBRLDetailed(1.234).cents).toBe(123); // number ⇒ caminho nativo, nunca o parser de texto
  });
  it("TEXTO localizado", () => {
    expect(parseBRLDetailed("1,234").reason).toBe("ambiguous"); // rejeitado por ambiguidade
    expect(parseBRLDetailed("1.234,56").cents).toBe(123456);
    expect(parseBRLDetailed("R$ 18,90").cents).toBe(1890);
    expect(parseBRLDetailed("1.234").cents).toBe(123400);        // texto pt-BR: milhar
    expect(canonicalDecimalToCents("7.50")).toBe(750);
    expect(canonicalDecimalToCents("1.234,5")).toBeNull();
  });
  it("quantidade exata × preço, arredondamento único", () => {
    expect(multiplyQuantityCents(2.5, 333)).toBe(833);
    expect(multiplyQuantityCents(0.3333, 300)).toBe(100); // 99,99 → 100 (half-up no resultado, sem truncar qtd)
  });
  it("XLSX REAL: célula numérica 1.234 é preservada como número (1,23), texto '1.234,56' pelo parser pt-BR", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Descrição", "Qtd", "Unid", "Valor unitário", "Fornecedor"],
      ["Clipes", 10, "cx", 1.234, "Papelaria A"],
      ["Grampos", 5, "cx", 1.005, "Papelaria A"],
      ["Papel A4", 2, "resma", "1.234,56", "Papelaria B"],
      ["Caneta", 100, "un", 100, "Papelaria C"],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Cotações");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await new XlsxParser().parse(buf, {
      importSessionId: 1, organizationId: 1, sourceFileId: "k", sourceFileName: "cot.xlsx",
      sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceChecksum: "c".repeat(64),
    });
    const by = (d: string) => r.items.find((i) => i.rawDescription === d)!;
    expect(by("Clipes").rawUnitPrice).toBe("1,234");                                  // exibição pt-BR (sem milhar)
    expect(by("Clipes").rawTypedValues?.rawUnitPrice).toEqual({ type: "number", value: "1.234" });
    expect(resolveEffectiveMoney(by("Clipes") as never, "unitPrice")).toMatchObject({ cents: 123, origin: "typed_number" });
    expect(resolveEffectiveMoney(by("Grampos") as never, "unitPrice").cents).toBe(101);
    expect(by("Papel A4").rawTypedValues?.rawUnitPrice).toBeUndefined();               // célula de TEXTO
    expect(resolveEffectiveMoney(by("Papel A4") as never, "unitPrice")).toMatchObject({ cents: 123456, origin: "text" });
    expect(resolveEffectiveMoney(by("Caneta") as never, "unitPrice").cents).toBe(10000);
    expect(resolveEffectiveQuantity(by("Caneta") as never)).toBe("100");
  });
  it("correção humana vence o bruto (canônica)", () => {
    const item = { rawUnitPrice: "1,234", rawTypedValues: { rawUnitPrice: { type: "number", value: "1.234" } }, correctedPayload: { unitPrice: "12.34" } };
    expect(resolveEffectiveMoney(item, "unitPrice")).toMatchObject({ cents: 1234, origin: "correction" });
  });
});

// ─── B2 — identidade de conteúdo da cotação ─────────────────────────────────────

const q = (over: Partial<PriceQuote>): PriceQuote => ({
  quoteId: "q1", researchId: "r", description: "Papel A4", quantity: 10, unit: "resma",
  supplier: "A", brand: "", model: "", source: "", valueCents: 10000, ...over,
});

describe("B2 — quoteId + contentHash (nunca só quoteId)", () => {
  it("mesmo quoteId com preço novo ⇒ conjunto MUDOU", () => {
    expect(quoteContentHash(q({}))).not.toBe(quoteContentHash(q({ valueCents: 20000 })));
    const before = [q({})];
    const after = mergeQuotes(before, [q({ valueCents: 20000 })]);
    expect(after).toHaveLength(1);
    expect(after[0].valueCents).toBe(20000);
    expect(quoteSetSignature(after)).not.toBe(quoteSetSignature(before));
    expect(quoteSetSignature(mergeQuotes(before, [q({})]))).toBe(quoteSetSignature(before)); // replay idêntico
  });
  it("fornecedor/marca/modelo/fonte fazem parte do conteúdo", () => {
    const base = quoteContentHash(q({}));
    for (const o of [{ supplier: "B" }, { brand: "X" }, { model: "M" }, { source: "Painel" }, { quantity: 11 }]) {
      expect(quoteContentHash(q(o))).not.toBe(base);
    }
  });
  it("consolidação conta só cotações válidas (risco A)", () => {
    const [g] = consolidateQuotes([q({ quoteId: "1" }), q({ quoteId: "2", valueCents: 12000 }), q({ quoteId: "3", valueCents: null })]);
    expect(g.pricedQuoteCount).toBe(2);
    expect(g.averageCents).toBe(11000);
    const md = renderAuthoritativeItemsBlock(computeItemEstimates([{ id: "i", description: "Papel A4", quantity: 10, unit: "resma", averagePriceCents: 11000, quoteCount: g.pricedQuoteCount, confirmedCatalogCode: null, suggestedCatalogCode: null }]));
    expect(md).toContain("Baseado em 2 cotação(ões) válida(s)");
  });
});

// ─── B6 — digest = snapshot efetivamente consumido ────────────────────────────────

const item = (over: Partial<ContextItem> = {}): ContextItem => ({
  id: "i1", description: "Cadeira giratória", quantity: 10, unit: "un", averagePriceCents: 10000, quoteCount: 2,
  confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current",
  quotes: [
    { quoteId: "a", supplier: "Móveis A", brand: "", model: "", valueCents: 9000 },
    { quoteId: "b", supplier: "Móveis B", brand: "", model: "", valueCents: 11000 },
  ],
  ...over,
});
const ctx = (over: Partial<DocumentAuthoringInputs> = {}): DocumentAuthoringInputs => ({
  organizationId: 1, processId: "p1", kind: "tr", object: "Cadeiras", processObject: "Cadeiras", processNumber: "2026/0001",
  dfd: { present: true, status: "rascunho", contentHash: "h", content: "# DFD\nPrecisamos de cadeiras.", origin: "import" },
  etp: { present: true, status: "rascunho", contentHash: "h2", content: "# ETP\nAquisição.", origin: "generated" },
  approvedItems: [item()], pendingItemCount: 0, ...over,
});
const d = (o: Partial<DocumentAuthoringInputs> = {}) => buildDocumentAuthoringContext(ctx(o));

describe("B6 — altera o prompt ⇔ altera o digest", () => {
  const base = d();
  it("retry idêntico ⇒ digest idêntico (e prompt idêntico)", () => {
    expect(d().sourcesDigest).toBe(base.sourcesDigest);
    expect(d().promptContext).toBe(base.promptContext);
  });
  const changes: Array<[string, Partial<DocumentAuthoringInputs>]> = [
    ["fornecedor", { approvedItems: [item({ quotes: [{ quoteId: "a", supplier: "Móveis Z", brand: "", model: "", valueCents: 9000 }, item().quotes[1]] })] }],
    ["valor", { approvedItems: [item({ averagePriceCents: 10100 })] }],
    ["valor de cotação", { approvedItems: [item({ quotes: [{ ...item().quotes[0], valueCents: 9100 }, item().quotes[1]] })] }],
    ["quantidade", { approvedItems: [item({ quantity: 11 })] }],
    ["número do processo (consumido no prompt)", { processNumber: "2026/0002" }],
    ["itens pendentes (a contagem aparece no prompt)", { pendingItemCount: 3 }],
    ["fonte alterada do item", { approvedItems: [item({ sourceState: "source_changed" })] }],
    ["conteúdo do DFD", { dfd: { ...ctx().dfd!, content: "# DFD\nPrecisamos de 12 cadeiras." } }],
  ];
  for (const [label, o] of changes) {
    it(`${label} ⇒ digest E prompt/quadro mudam`, () => {
      const c = d(o);
      expect(c.sourcesDigest).not.toBe(base.sourcesDigest);
      expect(c.promptContext + (c.authoritativeBlock ?? "")).not.toBe(base.promptContext + (base.authoritativeBlock ?? ""));
    });
  }
  it("reordenar as MESMAS cotações/itens ⇒ digest NÃO muda; reidentificar (quoteId) sem mudar conteúdo também não", () => {
    expect(d({ approvedItems: [item({ quotes: [...item().quotes].reverse() })] }).sourcesDigest).toBe(base.sourcesDigest);
    expect(d({ approvedItems: [item({ quotes: item().quotes.map((x, i) => ({ ...x, quoteId: `novo-${i}` })) })] }).sourcesDigest).toBe(base.sourcesDigest);
    const two = [item(), item({ id: "i2", description: "Mesa" })];
    expect(d({ approvedItems: two }).sourcesDigest).toBe(d({ approvedItems: [...two].reverse() }).sourcesDigest);
  });
  it("rótulo de hash sem mudança de conteúdo ⇒ digest estável (não é consumido)", () => {
    expect(d({ dfd: { ...ctx().dfd!, contentHash: "outro" } }).sourcesDigest).toBe(base.sourcesDigest);
  });
});

describe("Risco C — cobertura documental explícita (seleção por seções)", () => {
  it("cabe → full; não cabe → partial com TODAS as seções representadas", () => {
    expect(selectDocumentExcerpt("# A\ncurto", 100).coverage).toBe("full");
    const big = ["# 1. Objeto", "x".repeat(5000), "# 2. Justificativa", "y".repeat(5000), "# 3. Prazo", "Entrega em 20 dias."].join("\n");
    const ex = selectDocumentExcerpt(big, 3000);
    expect(ex.coverage).toBe("partial");
    expect(ex.sections).toEqual(["1. Objeto", "2. Justificativa", "3. Prazo"]);
    expect(ex.text).toContain("# 3. Prazo");
    expect(ex.text).toContain("Entrega em 20 dias.");   // seção final NÃO é descartada por truncamento cego
    expect(ex.text).toContain("seção resumida");
    const c = d({ dfd: { ...ctx().dfd!, content: big } });
    expect(c.promptContext).toContain("cobertura: PARCIAL");
    expect(c.lineageMarkers).toContain("coverage:dfd=partial");
  });
});

describe("B6 — Edital: número do processo e recorte consumido entram no digest", () => {
  const e = (o: Partial<EditalSourceInputs> = {}): EditalSourceInputs => ({
    organizationId: 1, processId: "p1", object: "Cadeiras", modality: "pregao", form: "eletronico", platform: "compras_gov",
    processObject: "Cadeiras", processNumber: "2026/0001", currentStage: "NOTICE",
    dfd: null, etp: null, tr: { present: true, status: "rascunho", contentHash: "t", content: "# TR\nPrazo 20 dias." },
    approvedItems: [], criterioJulgamento: null, regimeContratacao: null, ...o,
  });
  it("processNumber muda o digest; hash-rótulo sem mudança de texto não", () => {
    const base = buildEditalSourceContext(e()).sourcesDigest;
    expect(buildEditalSourceContext(e({ processNumber: "2026/0009" })).sourcesDigest).not.toBe(base);
    expect(buildEditalSourceContext(e({ tr: { ...e().tr!, contentHash: "outro" } })).sourcesDigest).toBe(base);
    expect(buildEditalSourceContext(e({ tr: { ...e().tr!, content: "# TR\nPrazo 30 dias." } })).sourcesDigest).not.toBe(base);
  });
});

describe("Idempotência do createSession — payload estrutural", () => {
  const p = { organizationId: 1, procurementProcessId: "p1", importType: "price_research", checksum: "a".repeat(64), sourceMimeType: "text/csv", sourceSize: 10, importPurpose: null };
  it("mesmo payload ⇒ mesmo hash; processo/tipo/arquivo/tenant diferentes ⇒ hash diferente", () => {
    const h = createSessionPayloadHash(p);
    expect(createSessionPayloadHash({ ...p })).toBe(h);
    expect(createSessionPayloadHash({ ...p, procurementProcessId: "p2" })).not.toBe(h);
    expect(createSessionPayloadHash({ ...p, importType: "document_tr" })).not.toBe(h);
    expect(createSessionPayloadHash({ ...p, checksum: "b".repeat(64) })).not.toBe(h);
    expect(createSessionPayloadHash({ ...p, organizationId: 2 })).not.toBe(h);
  });
  it("JSON canônico: ordem de chaves irrelevante", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
});
