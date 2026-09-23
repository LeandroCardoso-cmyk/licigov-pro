/**
 * P0 PILOTO — fundação Document Intake + Pesquisa de Preços → Itens Inteligentes → TR → Edital (UNITÁRIO).
 *
 * Puro (sem DB/rede): contrato monetário, consolidação por chave lógica, bloco autoritativo de itens,
 * extração tabular (LONGO/LARGO/ambíguo), projeção documental, correção monetária, contexto de autoria
 * ETP/TR (digest/lineage/[REVISAR]), autoria estruturada com contexto REAL via seam `invoke`, sugestão de
 * itens de TR importado e formas de início do processo.
 */
import { describe, it, expect } from "vitest";
import {
  parseBRL, parseBRLDetailed, averageCents, multiplyQuantityCents, formatBRL, reaisToCents, centsToDecimalString, sumCents,
} from "../../domain/money";
import {
  intelligentItemLogicalKey, consolidateQuotes, mergeQuotes, canonicalUnit, normalizeDescription, type PriceQuote,
} from "../../domain/priceQuoteConsolidation";
import {
  computeItemEstimates, renderAuthoritativeItemsBlock, extractAuthoritativeItemsBlock, AUTHORITATIVE_ITEMS_BEGIN,
} from "../../domain/authoritativeItems";
import { detectHeadingLevel, pageTextToBlocks, buildDocumentProjection, isDocumentImportType } from "../../domain/documentProjection";
import { docxHtmlToBlocks } from "../../parsers/docxParser";
import { CsvParser } from "../../parsers/csvParser";
import { mapHeaderColumns, normalizeHeader } from "../../parsers/tabularExtraction";
import { validateCorrections } from "../../domain/importCorrectionFields";
import { extractItemsFromText } from "../../domain/priceResearch";
import { buildDocumentAuthoringContext, confirmedCatalogFromDecision, type DocumentAuthoringInputs } from "../../services/authoring/authoringContext";
import { generateStructuredAuthoring, buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { suggestItemsFromBlocks, importLineageMarkers } from "../../services/documentIntakeService";
import { initialStageForStartOption, createProcurementWorkspace, usesDFD } from "../../domain/procurementProcess";

// ─── 1. Contrato monetário ────────────────────────────────────────────────────────

describe("P0 — contrato monetário BRL (centavos, half-up, ambíguo ≠ chute)", () => {
  it("formatos brasileiros e canônicos", () => {
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("R$ 18,90")).toBe(1890);   // antes virava 0 no parser de colar
    expect(parseBRL("1234.56")).toBe(123456);
    expect(parseBRL("1.234")).toBe(123400);    // milhar BR
    expect(parseBRL(25.5)).toBe(2550);
    expect(parseBRL("")).toBeNull();
  });
  it("valor ambíguo NÃO é adivinhado", () => {
    expect(parseBRLDetailed("1,234").reason).toBe("ambiguous");
    expect(parseBRL("1,234")).toBeNull();
    expect(parseBRLDetailed("abc").reason).toBe("invalid");
  });
  it("média em centavos half-up e total = qtd × preço", () => {
    expect(averageCents([10000, 11000, 9000])).toBe(10000); // 100/110/90 → 100,00
    expect(averageCents([100, 101])).toBe(101);              // 100,5 → 101 (half-up)
    expect(multiplyQuantityCents(10, 10000)).toBe(100000);   // 10 × 100,00 = 1.000,00
    expect(multiplyQuantityCents("2,5", 333)).toBe(833);     // 832,5 → 833
    expect(sumCents([100000, 2550])).toBe(102550);
  });
  it("formatação e conversões determinísticas (sem /100 em reais)", () => {
    expect(formatBRL(123456789)).toBe("R$ 1.234.567,89");
    expect(formatBRL(5)).toBe("R$ 0,05");
    expect(reaisToCents("25.50")).toBe(2550);
    expect(reaisToCents(25.5)).toBe(2550);
    expect(centsToDecimalString(750)).toBe("7.50");
  });
  it("colar texto: 'R$ 18,90' → 18.90 (antes 0 em silêncio)", () => {
    const items = extractItemsFromText("Papel A4;10;resma;R$ 18,90;Papelaria X", { researchId: "r", processId: "p", organizationId: 1 });
    expect(items[0].value).toBe(18.9);
    expect(items[0].supplier).toBe("Papelaria X");
  });
});

// ─── 2. Consolidação por chave lógica ───────────────────────────────────────────

const q = (over: Partial<PriceQuote>): PriceQuote => ({
  quoteId: "q", researchId: "r", description: "Papel A4 75g", quantity: 10, unit: "resma",
  supplier: "", brand: "", model: "", source: "", valueCents: 10000, ...over,
});

describe("P0 — consolidação determinística (sem fuzzy)", () => {
  it("chave: descrição normalizada | unidade canônica | quantidade exata", () => {
    const a = intelligentItemLogicalKey({ description: "Papel A4 75g.", unit: "Resma", quantity: 10 });
    const b = intelligentItemLogicalKey({ description: "  papel  a4 75G ", unit: "RESMAS", quantity: 10.0 });
    expect(a).toBe(b);
    expect(intelligentItemLogicalKey({ description: "Papel A4 75g", unit: "resma", quantity: 11 })).not.toBe(a);
    expect(canonicalUnit("Unid.")).toBe(canonicalUnit("UN"));
    expect(normalizeDescription("Cadeira Giratória")).toBe(normalizeDescription("cadeira giratoria"));
  });
  it("3 fornecedores do mesmo item → 1 item, média 100,00; item parecido fica separado", () => {
    const groups = consolidateQuotes([
      q({ quoteId: "1", supplier: "A", valueCents: 10000 }),
      q({ quoteId: "2", supplier: "B", valueCents: 11000 }),
      q({ quoteId: "3", supplier: "C", valueCents: 9000 }),
      q({ quoteId: "4", description: "Papel A4 90g", supplier: "A", valueCents: 12000 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].averageCents).toBe(10000);
    expect(groups[0].quotes.map((x) => x.supplier)).toEqual(["A", "B", "C"]);
  });
  it("replay: merge por quoteId não duplica", () => {
    const base = [q({ quoteId: "1" }), q({ quoteId: "2" })];
    expect(mergeQuotes(base, [q({ quoteId: "2" }), q({ quoteId: "1" })])).toHaveLength(2);
    expect(mergeQuotes(base, [q({ quoteId: "3" })])).toHaveLength(3);
  });
  it("cotação sem preço não entra na média", () => {
    const [g] = consolidateQuotes([q({ quoteId: "1", valueCents: 10000 }), q({ quoteId: "2", valueCents: null })]);
    expect(g.averageCents).toBe(10000);
    expect(g.quotes).toHaveLength(2);
  });
});

// ─── 3. Bloco autoritativo ──────────────────────────────────────────────────────

describe("P0 — bloco AUTORITATIVO de itens (servidor, nunca IA)", () => {
  const items = [
    { id: "i1", description: "Papel A4", quantity: 10, unit: "resma", averagePriceCents: 10000, quoteCount: 3, confirmedCatalogCode: "461234", suggestedCatalogCode: "461234" },
    { id: "i2", description: "Caneta azul", quantity: 100, unit: "un", averagePriceCents: 150, quoteCount: 2, confirmedCatalogCode: null, suggestedCatalogCode: "999" },
  ];
  it("valor do item = qtd × média; global = Σ; origem das cotações", () => {
    const est = computeItemEstimates(items);
    expect(est.globalTotalCents).toBe(100000 + 15000);
    const md = renderAuthoritativeItemsBlock(est);
    expect(md).toContain("| 2 | Papel A4 | 10 | resma | 100,00 | 1.000,00 | 461234 | 3 |");
    expect(md).toContain("| 1 | Caneta azul | 100 | un | 1,50 | 150,00 | a revisar (sugestão não confirmada) | 2 |");
    expect(md).toContain("**Valor estimado global:** R$ 1.150,00");
    expect(md).toContain("Baseado em 5 cotação(ões) válida(s) em 2 item(ns) aprovado(s)."); // risco A: contagem de VÁLIDAS
    expect(md).not.toContain("| 999 |"); // sugestão NUNCA vira código oficial
  });
  it("determinístico em bytes e independente da ordem; extraível por marcadores", () => {
    const a = renderAuthoritativeItemsBlock(computeItemEstimates(items));
    const b = renderAuthoritativeItemsBlock(computeItemEstimates([...items].reverse()));
    expect(a).toBe(b);
    expect(extractAuthoritativeItemsBlock(`x\n${a}\ny`)).toBe(a);
    expect(a.startsWith(AUTHORITATIVE_ITEMS_BEGIN)).toBe(true);
  });
  it("sem itens aprovados → [REVISAR], nada inventado; item sem preço sinalizado", () => {
    expect(renderAuthoritativeItemsBlock(computeItemEstimates([]))).toContain("[REVISAR: nenhum Item Inteligente aprovado");
    const md = renderAuthoritativeItemsBlock(computeItemEstimates([{ ...items[0], averagePriceCents: 0 }]));
    expect(md).toContain("[REVISAR: sem preço]");
    expect(md).toContain("**Valor estimado global:** R$ 0,00");
  });
});

// ─── 4. Extração tabular (longo / largo / ambíguo) ──────────────────────────────

const csv = new CsvParser();
const csvOpts = { importSessionId: 1, organizationId: 1, sourceFileId: "k", sourceFileName: "p.csv", sourceMimeType: "text/csv", sourceChecksum: "c".repeat(64) };

describe("P0 — pesquisa de preços: formatos LONGO e LARGO determinísticos", () => {
  it("mapeamento: 'VALOR UNITÁRIO' é preço (não unidade); fornecedor/marca/modelo/obs./fonte", () => {
    const m = mapHeaderColumns(["DESCRICAO", "QTD", "UNIDADE", "VALOR UNITARIO", "FORNECEDOR", "MARCA", "MODELO", "OBSERVACAO", "FONTE"].map(normalizeHeader));
    expect(m).toMatchObject({ description: 0, quantity: 1, unit: 2, unitPrice: 3, supplier: 4, brand: 5, model: 6, notes: 7, source: 8 });
  });
  it("LONGO: uma linha por cotação, campos de 1ª classe preservados", async () => {
    const text = [
      "Descrição;Qtd;Unidade;Valor unitário;Fornecedor;Marca;Modelo;Observação;Fonte",
      "Cadeira giratória;10;un;R$ 100,00;Móveis A;Flexform;CG-1;entrega 30d;Proposta 12/2026",
      "Cadeira giratória;10;un;R$ 110,00;Móveis B;Cavaletti;X2;;Painel de Preços",
    ].join("\n");
    const r = await csv.parse(Buffer.from(text), csvOpts);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ rawDescription: "Cadeira giratória", rawUnitPrice: "R$ 100,00", rawSupplier: "Móveis A", rawBrand: "Flexform", rawModel: "CG-1", rawNotes: "entrega 30d", rawSource: "Proposta 12/2026" });
  });
  it("LARGO (mapa comparativo): uma cotação por coluna de fornecedor", async () => {
    const text = [
      "Item;Descrição;Qtd;Unid;Empresa A (R$);Empresa B (R$);Empresa C (R$);Média",
      "1;Cadeira giratória;10;un;100,00;110,00;90,00;100,00",
      "2;Mesa;5;un;300,00;;320,00;310,00",
    ].join("\n");
    const r = await csv.parse(Buffer.from(text), csvOpts);
    expect(r.warnings.map((w) => w.code)).toContain("WIDE_FORMAT_EXPANDED");
    const cadeira = r.items.filter((i) => i.rawDescription === "Cadeira giratória");
    expect(cadeira.map((i) => [i.rawSupplier, i.rawUnitPrice])).toEqual([["Empresa A", "100,00"], ["Empresa B", "110,00"], ["Empresa C", "90,00"]]);
    expect(r.items.filter((i) => i.rawDescription === "Mesa")).toHaveLength(2); // célula vazia não vira cotação
    expect(r.items.some((i) => i.rawUnitPrice === "310,00")).toBe(false);     // coluna estatística (Média) ignorada
  });
  it("AMBÍGUO: preço unitário explícito + colunas de fornecedor → aviso, sem expansão (sem chute)", async () => {
    const text = ["Descrição;Qtd;Unid;Valor unitário;Empresa A;Empresa B", "Cadeira;10;un;100,00;100,00;110,00"].join("\n");
    const r = await csv.parse(Buffer.from(text), csvOpts);
    expect(r.warnings.map((w) => w.code)).toContain("WIDE_FORMAT_AMBIGUOUS");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].rawSupplier ?? null).toBeNull();
  });
});

// ─── 5. Projeção documental ─────────────────────────────────────────────────────

describe("P0 — projeção documental (extração + organização, nunca geração)", () => {
  it("títulos determinísticos (nível 1 reservado ao título do documento; numeração começa no 2)", () => {
    expect(detectHeadingLevel("1. OBJETO")).toBe(2);
    expect(detectHeadingLevel("3.2 Requisitos da contratação")).toBe(3);
    expect(detectHeadingLevel("JUSTIFICATIVA DA NECESSIDADE")).toBe(2);
    expect(detectHeadingLevel("A presente contratação visa atender a demanda da Secretaria de Saúde, conforme o planejamento anual.")).toBeNull();
  });
  it("PDF (texto por página) → blocos com página; projeção com hash estável", () => {
    const blocks = pageTextToBlocks("1. OBJETO\nAquisição de cadeiras.\n- item a\n2. JUSTIFICATIVA\nReposição.", 1, 0);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list_item", "heading", "paragraph"]);
    const p1 = buildDocumentProjection(blocks, { pages: 1 });
    const p2 = buildDocumentProjection(pageTextToBlocks("1. OBJETO\nAquisição de cadeiras.\n- item a\n2. JUSTIFICATIVA\nReposição.", 1, 0), { pages: 1 });
    expect(p1.contentHash).toBe(p2.contentHash);
    expect(p1.content).toContain("Aquisição de cadeiras.");
    expect(p1.stats.headings).toBe(2);
  });
  it("DOCX (HTML do mammoth) → títulos, parágrafos e tabela preservados na ordem", () => {
    const blocks = docxHtmlToBlocks("<h1>TERMO DE REFERÊNCIA</h1><p>Objeto: cadeiras.</p><table><tr><td>Descrição</td><td>Qtd</td></tr><tr><td>Cadeira</td><td>10</td></tr></table><ul><li>Garantia 12 meses</li></ul>");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "table", "list_item"]);
    const proj = buildDocumentProjection(blocks);
    expect(proj.content).toContain("| Cadeira | 10 |");
  });
  it("tipos documentais do motor", () => {
    expect(isDocumentImportType("document_tr")).toBe(true);
    expect(isDocumentImportType("price_research")).toBe(false);
  });
  it("TR importado: tabelas de itens viram SUGESTÃO (não materializada)", () => {
    const blocks = docxHtmlToBlocks("<table><tr><td>Descrição</td><td>Quantidade</td><td>Unidade</td><td>Valor unitário</td></tr><tr><td>Cadeira giratória</td><td>10</td><td>un</td><td>100,00</td></tr></table>");
    const s = suggestItemsFromBlocks(blocks);
    expect(s).toEqual([{ tableIndex: 0, row: 1, description: "Cadeira giratória", quantity: "10", unit: "un", unitPrice: "100,00" }]);
  });
  it("lineage do rascunho importado sem storageKey e com checksum abreviado", () => {
    const m = importLineageMarkers({ sessionId: 7, checksum: "a".repeat(64), parserType: "docx", parserVersion: "2.1.0", kind: "tr", projectionVersion: "document-projection/1.0" });
    expect(m).toEqual(["origem:import", "import:7", "checksum:aaaaaaaaaaaa", "parser:docx@2.1.0", "kind:tr", "projection:document-projection/1.0"]);
    expect(m.join(" ")).not.toMatch(/imports\//);
  });
});

// ─── 6. Correção monetária ──────────────────────────────────────────────────────

describe("P0 — correção humana de cotação (contrato monetário)", () => {
  it("normaliza 'R$ 7,50' → '7.50'; rejeita ambíguo e negativo; campos de cotação aceitos", () => {
    const ok = validateCorrections("price_research", { unitPrice: "R$ 7,50", supplier: " Empresa  A ", brand: "X" });
    expect(ok).toMatchObject({ ok: true, overlay: { unitPrice: "7.50", supplier: "Empresa A", brand: "X" } });
    expect(validateCorrections("price_research", { unitPrice: "1,234" })).toMatchObject({ ok: false, code: "AMBIGUOUS_MONEY" });
    expect(validateCorrections("price_research", { unitPrice: "-3,00" })).toMatchObject({ ok: false, code: "NEGATIVE_MONEY" });
  });
});

// ─── 7. Contexto de autoria ETP/TR ─────────────────────────────────────────────

const ctxInput = (over: Partial<DocumentAuthoringInputs> = {}): DocumentAuthoringInputs => ({
  organizationId: 1, processId: "p1", kind: "tr", object: "Aquisição de cadeiras",
  processObject: "Aquisição de cadeiras", processNumber: "2026/0001",
  dfd: { present: true, status: "rascunho", contentHash: "dfd-h", content: "DFD: a Secretaria de Educação precisa de 10 cadeiras.", origin: "import" },
  etp: { present: true, status: "rascunho", contentHash: "etp-h", content: "ETP: solução é aquisição direta com garantia.", origin: "generated" },
  // Hardening P0 — ContextItem carrega as cotações RENDERIZADAS (fornecedor/marca/modelo/valor) e o estado
  // da fonte (contrato superado: antes só nomes de fornecedores, que ficavam fora do digest).
  approvedItems: [{
    id: "i1", description: "Cadeira giratória", quantity: 10, unit: "un", averagePriceCents: 10000, quoteCount: 3,
    confirmedCatalogCode: "461234", suggestedCatalogCode: "461234", sourceState: "current",
    quotes: [
      { quoteId: "q1", supplier: "A", brand: "", model: "", valueCents: 10000 },
      { quoteId: "q2", supplier: "B", brand: "", model: "", valueCents: 11000 },
      { quoteId: "q3", supplier: "C", brand: "", model: "", valueCents: 9000 },
    ],
  }],
  pendingItemCount: 1,
  ...over,
});

describe("P0 — contexto REAL de autoria (ETP/TR)", () => {
  it("TR usa DFD + ETP + itens aprovados + cotações; bloco autoritativo presente", () => {
    const c = buildDocumentAuthoringContext(ctxInput());
    expect(c.promptContext).toContain("10 cadeiras");
    expect(c.promptContext).toContain("garantia");
    expect(c.promptContext).toContain("Cadeira giratória");
    expect(c.promptContext).toContain("importado e revisado");
    expect(c.usedSources).toEqual(["dfd", "etp", "itens", "pesquisa_precos"]);
    expect(c.authoritativeBlock).toContain("| 1 | Cadeira giratória | 10 | un | 100,00 | 1.000,00 | 461234 | 3 |");
    expect(c.lineageMarkers[0]).toMatch(/^srcdigest:[0-9a-f]{16}$/);
    expect(c.lineageMarkers).toContain("cotacoes:3");
  });
  it("ETP usa processo + DFD (sem ETP/bloco); DFD ausente → [REVISAR], nunca inventado", () => {
    const c = buildDocumentAuthoringContext(ctxInput({ kind: "etp", dfd: null }));
    expect(c.authoritativeBlock).toBeNull();
    expect(c.missing).toContain("dfd");
    expect(c.promptContext).toContain("[REVISAR: Documento de Formalização da Demanda (DFD) não localizado");
    expect(c.promptContext).not.toContain("ETP: solução");
  });
  it("digest sensível a DFD, ETP, item e classificação confirmada; estável para as mesmas fontes", () => {
    const base = buildDocumentAuthoringContext(ctxInput()).sourcesDigest;
    expect(buildDocumentAuthoringContext(ctxInput()).sourcesDigest).toBe(base);
    // Hardening P0 — o digest cobre o CONTEÚDO CONSUMIDO (recorte), não rótulos: mudar só o hash informado
    // com o mesmo conteúdo não muda o prompt ⇒ não muda o digest (contrato superado); mudar o texto muda.
    expect(buildDocumentAuthoringContext(ctxInput({ dfd: { ...ctxInput().dfd!, contentHash: "x" } })).sourcesDigest).toBe(base);
    expect(buildDocumentAuthoringContext(ctxInput({ dfd: { ...ctxInput().dfd!, content: "DFD: precisa de 12 cadeiras." } })).sourcesDigest).not.toBe(base);
    expect(buildDocumentAuthoringContext(ctxInput({ etp: { ...ctxInput().etp!, content: "ETP: locação." } })).sourcesDigest).not.toBe(base);
    const it0 = ctxInput().approvedItems[0];
    expect(buildDocumentAuthoringContext(ctxInput({ approvedItems: [{ ...it0, averagePriceCents: 10001 }] })).sourcesDigest).not.toBe(base);
    expect(buildDocumentAuthoringContext(ctxInput({ approvedItems: [{ ...it0, confirmedCatalogCode: null }] })).sourcesDigest).not.toBe(base);
  });
  it("classificação confirmada só por decisão humana confirmado/substituido", () => {
    expect(confirmedCatalogFromDecision({ decision: "confirmado", catmatCode: "1" })).toBe("1");
    expect(confirmedCatalogFromDecision({ decision: "substituido", catmatCode: "2" })).toBe("2");
    expect(confirmedCatalogFromDecision({ decision: "rejeitado", catmatCode: "3" })).toBeNull();
    expect(confirmedCatalogFromDecision(undefined)).toBeNull();
  });
  it("autoria do TR recebe o contexto REAL no prompt e o conteúdo carrega o bloco do servidor", async () => {
    const sourceContext = buildDocumentAuthoringContext(ctxInput());
    let prompt = "";
    const r = await generateStructuredAuthoring({
      organizationId: 1, kind: "tr", object: "Aquisição de cadeiras", correlationId: "p0-unit",
      sourceContext,
      // O provider "tenta" escrever um valor — o documento traz o quadro autoritativo do servidor.
      invoke: async (p) => { prompt = p; return buildMockProviderAuthoring("tr"); },
    });
    expect(prompt).toContain("10 cadeiras");
    expect(prompt).toContain("Cadeira giratória");
    expect(prompt).toContain("NÃO redija quantidades, preços");
    expect(r.content).toContain("**Valor estimado global:** R$ 1.000,00");
    expect(r.content).toContain("Fontes do processo utilizadas:** dfd, etp, itens, pesquisa_precos");
    expect(r.content.indexOf("Valor estimado global")).toBeLessThan(r.content.lastIndexOf("Revisão OBRIGATÓRIA"));
  });
});

// ─── 8. Formas de início ────────────────────────────────────────────────────────

describe("P0 — início no ponto em que a Prefeitura está (sem pré-requisito artificial)", () => {
  it("etapa inicial por forma de início", () => {
    expect(initialStageForStartOption("criar_dfd")).toBe("NEW_PROCESS");
    expect(initialStageForStartOption("importar_etp")).toBe("ETP");
    expect(initialStageForStartOption("iniciar_pesquisa")).toBe("PRICE_RESEARCH");
    expect(initialStageForStartOption("importar_tr")).toBe("TR");
    const w = createProcurementWorkspace({ organizationId: 1, processNumber: "1", object: "o", startOption: "importar_tr", responsibleUser: 1, correlationId: "c" });
    expect(w.currentStage).toBe("TR");
    expect(usesDFD(w)).toBe(false);
  });
});
