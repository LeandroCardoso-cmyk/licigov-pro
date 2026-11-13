/**
 * F3 — acabamento documental profissional do Edital completo e do TR (homologação F2, processo sintético 2167/2026).
 *  A) tabela larga: larguras proporcionais ao conteúdo (DOCX e PDF), nenhuma palavra partida ("HOMOLO/GAÇÃO"), nada cortado;
 *  B) aviso no PDF: sem o glifo "⚠" (inexistente na Helvetica, desenhado por cima do texto) — ícone vetorial, texto em ordem;
 *  C) anexos em página nova e títulos presos ao conteúdo seguinte;
 *  D) hierarquia de títulos única DOCX/PDF; o TR incorporado preserva a hierarquia relativa abaixo do título do Anexo;
 *  E) identificação simples do TR incorporado, sem título repetido; SHA-256 completo preservado (discreto, ao fim do TR).
 * Puro: sem DB, sem rede, sem IA. Fixtures SINTÉTICAS (modelo BLL do repositório + TR fictício).
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import { consolidateEditalWithTr, embedTrContent, trIdentificationBlock, type ConsolidationTr } from "../../domain/editalConsolidation";
import { renderAuthoritativeItemsBlock, type AuthoritativeItemsEstimate } from "../../domain/authoritativeItems";
import {
  buildInstitutionalModel, HEADING_SIZES_PT, isAnnexHeading, planTableColumns, renderInstitutionalDOCX, renderInstitutionalPDF,
  TABLE_FONT_SIZES_PT, trimTrailingBreaks, type InstitutionalMeta,
} from "../../services/documentConverter";
import { BASE_SCENARIO, BLL_MODEL_DIR, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import { readZipEntry } from "../helpers/zipText";

const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8"));
const EDITAL = (() => {
  const r = composeTemplate(bllComposeRequest(ast, BASE_SCENARIO, { aiNarratives: [] }));
  if (!r.ok) throw new Error("compose");
  return r.value.content.text;
})();

const DESCS = [
  "Caneta esferográfica azul, corpo transparente [SINTÉTICO — HOMOLOGAÇÃO]",
  "Papel sulfite A4 75g/m², resma com 500 folhas [SINTÉTICO — HOMOLOGAÇÃO]",
  "Grampeador de mesa para 25 folhas, estrutura metálica [SINTÉTICO — HOMOLOGAÇÃO]",
  "Pasta suspensa marmorizada com haste plástica [SINTÉTICO — HOMOLOGAÇÃO]",
];
const ITEMS_BLOCK = renderAuthoritativeItemsBlock({
  rows: DESCS.map((description, i) => ({
    index: i + 1, description, quantity: 120 * (i + 1), unit: i % 2 ? "resma" : "unidade", averagePriceCents: 1234 * (i + 1),
    estimatedTotalCents: 1234 * (i + 1) * 120 * (i + 1), confirmedCatalogCode: i % 2 ? null : "BR0461234", suggestedCatalogCode: i === 1 ? "x" : null,
    quoteCount: 3, priceBlockedReason: null,
  })),
  globalTotalCents: 1_000_000, itemCount: DESCS.length, pricedItemCount: DESCS.length, unpricedItemCount: 0, unknownQuantityItemCount: 0, quoteCount: 12,
  fictitiousQuoteCount: 0, suspectedQuoteCount: 0, confirmedClassificationCount: 2, pendingClassificationCount: 2,
} as unknown as AuthoritativeItemsEstimate, { quantitySource: "canonical_planned" });

// TR no formato do motor (structuredAuthoringService.renderMarkdown + quadro autoritativo de itens).
const TR_CONTENT = [
  "# Termo de Referência — Aquisição sintética de material de expediente", "",
  "## 1. Definição do objeto", "_Art. 6º, XXIII, a, Lei 14.133/2021_", "", "Aquisição sintética para a Secretaria Fictícia de Administração.", "",
  "## 2. Fundamentação da contratação", "_Art. 6º, XXIII, b_", "", "Fundamentação sintética.", "",
  "### 2.1. Previsão no plano de contratações", "", "Previsão sintética no plano anual.", "",
  ITEMS_BLOCK, "",
  "## 3. Modelo de execução", "_Art. 6º, XXIII, e_", "", "Entrega em até 10 (dez) dias úteis; **conferência técnica** da especificação.",
].join("\n");
const TR: ConsolidationTr = {
  documentId: "trdoc0000000000000001", version: 2, emissionNumber: 1, emittedAtLabel: "05/11/2026 às 10:00", contentHash: "b".repeat(64), content: TR_CONTENT,
};
const META: InstitutionalMeta = {
  organizationName: "Município Sintético de Homologação", documentTitle: "Edital — completo, com anexos", processNumber: "9999/2026",
  statusLabel: "EMITIDO", isDraft: false, version: 3, emissionNumber: 1, exportedAtLabel: "13/11/2026 às 18:00",
};
const consolidated = (): string => {
  const r = consolidateEditalWithTr(EDITAL, TR);
  if (!r.ok) throw new Error(r.message);
  return r.content;
};

async function pdfPages(buf: Buffer): Promise<string[]> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ pages: Array<{ text: string }> }>; destroy?(): Promise<void> };
  };
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  const res = await parser.getText();
  await parser.destroy?.();
  return res.pages.map((p) => p.text);
}

/** Medição sintética de largura fixa (6 pt/caractere a 9 pt) — o algoritmo é puro e não depende de fonte. */
const mono = (t: string, _b: boolean, size: number): number => t.length * (size / 9) * 6;

describe("F3-A — larguras de coluna proporcionais ao conteúdo (algoritmo comum DOCX/PDF)", () => {
  const grid = [
    ["Item", "Descrição", "Qtd.", "Valor (R$)"].map((text) => ({ text, bold: true })),
    ["1", "Caneta esferográfica azul [SINTÉTICO — HOMOLOGAÇÃO]", "120", "1.480,80"].map((text) => ({ text, bold: false })),
  ];

  it("soma = largura útil; nenhuma coluna menor que a sua maior palavra; a descrição recebe o maior espaço", () => {
    const { widths, fontSize } = planTableColumns(grid, 300, mono, 3);
    expect(fontSize).toBe(9);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 6);
    expect(widths[1]).toBeGreaterThan(Math.max(widths[0], widths[2], widths[3]));
    for (const [i, word] of [[0, "Item"], [1, "esferográfica"], [1, "HOMOLOGAÇÃO]"], [3, "1.480,80"]] as const) {
      expect(widths[i], word).toBeGreaterThanOrEqual(mono(word, false, 9) + 6);
    }
  });

  it("palavras que não cabem: a fonte diminui antes de partir palavras; no limite, mínimos proporcionais (nada é descartado)", () => {
    const wide = [Array.from({ length: 8 }, () => ({ text: "esferográficas", bold: false }))];
    const a = planTableColumns(wide, 8 * (mono("esferográficas", false, 8) + 8), mono, 3);
    expect(a.fontSize).toBe(8);
    const b = planTableColumns(wide, 200, mono, 3);
    expect(b.fontSize).toBe(TABLE_FONT_SIZES_PT[TABLE_FONT_SIZES_PT.length - 1]);
    expect(b.widths.reduce((x, y) => x + y, 0)).toBeCloseTo(200, 6);
    expect(new Set(b.widths.map((w) => w.toFixed(6))).size).toBe(1);
  });

  it("[T1] DOCX: grade FIXA com larguras desiguais (twips), alinhamento numérico à direita, texto integral nas células", async () => {
    const model = buildInstitutionalModel(TR_CONTENT, { ...META, documentTitle: "TR — Termo de Referência" });
    const xml = readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "";
    const tbl = xml.slice(xml.indexOf("Qtd. prevista") - 4000, xml.indexOf("Qtd. prevista"));
    expect(tbl).toContain('<w:tblLayout w:type="fixed"/>');
    const cols = [...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    expect(cols).toHaveLength(8);
    expect(cols.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9666);
    expect(Math.max(...cols)).toBeGreaterThan(Math.min(...cols) * 3);   // a descrição não é mais uma coluna igual às outras
    expect(xml).toContain('<w:jc w:val="right"/>');
    const plain = xml.replace(/<[^>]+>/g, "");
    for (const d of DESCS) expect(plain).toContain(d);
  });

  it("[T2] PDF: descrições inteiras, sem palavra partida (\"HOMOLO\\nGAÇÃO\"), cabeçalho e todas as linhas presentes", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel(TR_CONTENT, { ...META, documentTitle: "TR — Termo de Referência" })));
    const text = pages.join("\n");
    for (const w of ["HOMOLOGAÇÃO]", "esferográfica", "marmorizada", "CATMAT/CATSER", "Cotações", "referência"]) {
      expect(text.split(/\s+/).some((tok) => tok.includes(w)), w).toBe(true);
    }
    expect(text.match(/HOMOLOGAÇÃO/g)?.length).toBe(DESCS.length);
    for (const v of ["1.480,80", "BR0461234", "Valor estimado global"]) expect(text).toContain(v);
  });
});

describe("F3-B — aviso no PDF sem glifo ausente na fonte; quebras preservadas", () => {
  it("só remove quebras/espaços FINAIS; as internas (entre parágrafos do aviso) ficam", () => {
    expect(trimTrailingBreaks([{ text: "a" }, { text: "\n" }, { text: "b" }, { text: "\n" }, { text: " " }])).toEqual([{ text: "a" }, { text: "\n" }, { text: "b" }]);
    expect(trimTrailingBreaks([{ text: "aviso \n" }])).toEqual([{ text: "aviso" }]);
    expect(trimTrailingBreaks([{ text: "\n" }])).toEqual([{ text: "" }]);
  });

  it("[T3] PDF: sem \"⚠\" (nem caractere substituto colado ao texto); aviso inteiro, em ordem, antes da tabela; DOCX mantém o ⚠", async () => {
    const model = buildInstitutionalModel(TR_CONTENT, { ...META, documentTitle: "TR — Termo de Referência" });
    const text = (await pdfPages(await renderInstitutionalPDF(model))).join("\n");
    expect(text).not.toContain("⚠");
    const flat = text.replace(/\s+/g, " ");
    const iNotice = flat.indexOf("Tabela gerada pelo sistema a partir dos Itens da contratação");
    expect(iNotice).toBeGreaterThan(0);
    expect(flat[iNotice - 1]).toBe(" ");   // nada desenhado/colado imediatamente antes da 1ª palavra
    expect(flat.indexOf("Valor estimado do item = quantidade prevista × preço de referência.")).toBeGreaterThan(iNotice);
    expect(flat.indexOf("Qtd. prevista")).toBeGreaterThan(iNotice);
    const xml = readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "";
    expect(xml).toContain("⚠ ");
  });
});

describe("F3-C/D — anexos, paginação e hierarquia de títulos", () => {
  it("escala única: título de seção/anexo do Edital > títulos do TR incorporado; só \"ANEXO <romano>\" de nível ≤ 2 é anexo", () => {
    expect(HEADING_SIZES_PT[2]).toBeGreaterThan(HEADING_SIZES_PT[3]);
    expect(HEADING_SIZES_PT[3]).toBeGreaterThan(HEADING_SIZES_PT[4]);
    const h = (level: 1 | 2 | 3 | 4, text: string) => ({ kind: "heading" as const, level, runs: [{ text }] });
    expect(isAnnexHeading(h(2, "ANEXO II — MODELO DE PROPOSTA"))).toBe(true);
    expect(isAnnexHeading(h(2, "33. DOS ANEXOS"))).toBe(false);
    expect(isAnnexHeading(h(3, "ANEXO I — subtítulo interno"))).toBe(false);
    expect(isAnnexHeading(h(2, "Anexos e apêndices"))).toBe(false);
  });

  it("[T4][T5] DOCX: anexos com quebra de página antes; títulos com \"manter com o próximo\"; Arial; hierarquia do TR em 2 níveis", async () => {
    const buf = await renderInstitutionalDOCX(buildInstitutionalModel(consolidated(), META));
    const xml = readZipEntry(buf, "word/document.xml") ?? "";
    const styles = readZipEntry(buf, "word/styles.xml") ?? "";
    const paraOf = (t: string) => { const i = xml.indexOf(t); return xml.slice(xml.lastIndexOf("<w:p>", i), i); };
    for (const a of ["ANEXO I — TERMO DE REFERÊNCIA", "ANEXO II —", "ANEXO III —", "ANEXO IV —"]) expect(paraOf(a), a).toContain("<w:pageBreakBefore/>");
    expect(paraOf("33. DOS ANEXOS")).not.toContain("<w:pageBreakBefore/>");
    expect(paraOf(">1. Definição do objeto<")).toContain('w:val="Heading4"');
    expect(paraOf(">2.1. Previsão no plano de contratações<")).toContain('w:val="Heading5"');
    expect(paraOf(">ANEXO II —")).toContain('w:val="Heading3"');
    const heading = (id: string) => styles.slice(styles.indexOf(`w:styleId="${id}"`), styles.indexOf("</w:style>", styles.indexOf(`w:styleId="${id}"`)));
    for (const id of ["Heading3", "Heading4", "Heading5"]) expect(heading(id), id).toContain("<w:keepNext/>");
    expect(heading("Heading3")).toContain(`<w:sz w:val="${HEADING_SIZES_PT[2] * 2}"/>`);
    expect(heading("Heading4")).toContain(`<w:sz w:val="${HEADING_SIZES_PT[3] * 2}"/>`);
    expect(styles).toContain('w:ascii="Arial"');
  });

  it("[T4] PDF: cada anexo abre uma página (título no topo), sem páginas vazias; ordem do Edital preservada", async () => {
    const pages = await pdfPages(await renderInstitutionalPDF(buildInstitutionalModel(consolidated(), META)));
    for (const a of ["ANEXO I — TERMO DE REFERÊNCIA", "ANEXO II —", "ANEXO III —", "ANEXO IV —"]) {
      const p = pages.find((t) => t.includes(a));
      expect(p, a).toBeDefined();
      expect(p!.trimStart().startsWith(a), a).toBe(true);
    }
    expect(pages.every((t) => t.replace(/Edital — completo.*Página \d+ de \d+/s, "").trim().length > 0)).toBe(true);
    const all = pages.join("\n");
    expect(all.indexOf("33. DOS ANEXOS")).toBeLessThan(all.indexOf("ANEXO I — TERMO DE REFERÊNCIA"));
    expect(all.indexOf("3. Modelo de execução")).toBeLessThan(all.indexOf("ANEXO II —"));
  });

  it("modelo: até 4 níveis (\"####\" não colapsa mais em \"###\"); 5–6 limitados a 4", () => {
    const m = buildInstitutionalModel("# a\n\n## b\n\n### c\n\n#### d\n\n###### e", META);
    expect(m.blocks.map((b) => (b.kind === "heading" ? b.level : 0))).toEqual([1, 2, 3, 4, 4]);
  });
});

describe("F3-E — identificação do TR incorporado (apresentação do artefato consolidado)", () => {
  it("[T6] o título que abre o TR vira a identificação (texto verbatim, sem repetição como título); o resto do TR integral e na ordem", () => {
    const c = consolidated();
    const anexo = c.slice(c.indexOf("## ANEXO I — TERMO DE REFERÊNCIA"), c.indexOf("## ANEXO II"));
    expect(anexo).not.toMatch(/^#+ Termo de Referência/m);   // nenhum título "Termo de Referência" repetido abaixo do título do Anexo
    expect(anexo).toContain("**Termo de Referência — Aquisição sintética de material de expediente**");
    expect(anexo).toContain("Versão incorporada integralmente a este Edital: 1ª emissão oficial, revisão técnica v2, emitida em 05/11/2026 às 10:00.");
    // conteúdo oficial: toda linha não-título do TR aparece intacta, na mesma ordem
    let at = 0;
    for (const line of TR_CONTENT.split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
      const i = anexo.indexOf(line, at);
      expect(i, line).toBeGreaterThanOrEqual(0);
      at = i + line.length;
    }
    expect(anexo).toContain("### 1. Definição do objeto");
    expect(anexo).toContain("#### 2.1. Previsão no plano de contratações");
    expect(anexo).toContain("### Itens e estimativa de valor");
  });

  it("[T9] SHA-256 completo preservado, discreto (fim do TR, itálico, fora da abertura); fonte não é alterada", () => {
    const before = TR_CONTENT;
    const c = consolidated();
    const anexo = c.slice(c.indexOf("## ANEXO I"), c.indexOf("## ANEXO II"));
    const iHash = anexo.indexOf(`(SHA-256): ${TR.contentHash}_`);
    expect(iHash).toBeGreaterThan(anexo.indexOf("3. Modelo de execução"));
    expect(trIdentificationBlock(TR, "Termo de Referência")).not.toContain(TR.contentHash);
    expect(TR.content).toBe(before);
    expect(consolidateEditalWithTr(EDITAL, TR)).toEqual(consolidateEditalWithTr(EDITAL, TR));   // determinístico
  });

  it("TR legado sem título único \"Termo de Referência\" (seções em nível 1): nada é retirado; identificação genérica", () => {
    const legacy = "# 1. DO OBJETO\n\nObjeto.\n\n# 2. DO PAGAMENTO\n\n## 2.1. Prazo\n\nTrinta dias.";
    expect(embedTrContent(legacy)).toEqual({ title: null, body: "### 1. DO OBJETO\n\nObjeto.\n\n### 2. DO PAGAMENTO\n\n#### 2.1. Prazo\n\nTrinta dias." });
    expect(embedTrContent("# Termo de Referência\n\nTexto.\n\n# Outro título")).toMatchObject({ title: null });   // H1 não é único ⇒ preservado
    expect(trIdentificationBlock({ ...TR, emissionNumber: 0 })).toBe(
      "**Termo de Referência**\n\nVersão incorporada integralmente a este Edital: versão oficial emitida, revisão técnica v2, emitida em 05/11/2026 às 10:00.");
  });

  it("[T10] DOCX e PDF do Edital completo: mesmo conteúdo substancial (TR, quadro de itens, anexos II–IV, hash)", async () => {
    const model = buildInstitutionalModel(consolidated(), META);
    const docx = (readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const pdf = (await pdfPages(await renderInstitutionalPDF(model))).join(" ").replace(/\s+/g, " ");
    for (const t of ["ANEXO I — TERMO DE REFERÊNCIA", "Termo de Referência — Aquisição sintética de material de expediente", "1ª emissão oficial",
      "2.1. Previsão no plano de contratações", "Caneta esferográfica azul", "conferência técnica", "ANEXO II —", "ANEXO III —", "ANEXO IV —", TR.contentHash.slice(0, 40)]) {
      expect(docx, `docx: ${t}`).toContain(t);
      expect(pdf, `pdf: ${t}`).toContain(t);
    }
  });
});
