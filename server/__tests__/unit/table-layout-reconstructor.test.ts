/**
 * Layout v2 — reconstrução tabular GEOMÉTRICA (unidade, tokens sintéticos — sem PDF, sem OCR).
 *
 * Generalização (não passa só no Golden E): A tabela simples · B descrição multilinha (topo/centro/base/densa) ·
 * C número variável de fontes (3/5/8) · D células vazias e marcadores de ausência · E linhas de total ·
 * F página sem itens · cabeçalho vertical · "R$" separado · colunas não alinhadas · cabeçalho herdado ·
 * convergência nativo × OCR · determinismo · desempenho (≈ O(n log n)).
 */
import { describe, it, expect } from "vitest";
import { reconstructPageTable, classifyFragmentText, PDF_LAYOUT_VERSION } from "../../parsers/layout/tableLayoutReconstructor";
import { tokensFromOcrPage, tokensFromPdfTextItems, type PositionedTextToken } from "../../parsers/layout/positionedText";
import { extractItemsFromLayoutTable, inferHeaderlessRoles } from "../../parsers/layout/layoutExtraction";
import type { TabularContext } from "../../parsers/tabularExtraction";
import type { OcrPageResult } from "../../domain/ocr";

const FS = 10;
let seq = 0;
/** Token nativo sintético: largura proporcional ao texto (0,5 em por caractere). */
function tok(text: string, x: number, y: number, o: { size?: number; vertical?: boolean; align?: "left" | "right" | "center"; w?: number } = {}): PositionedTextToken {
  const size = o.size ?? FS;
  const len = text.length * size * 0.5;
  const width = o.vertical ? size : len;
  const height = o.vertical ? len : size;
  const x0 = o.align === "right" ? x - width : o.align === "center" ? x - width / 2 : x;
  return { text, x: x0, y, width, height, page: 1, fontSize: size, orientation: o.vertical ? "vertical" : "horizontal", confidence: null, source: "native", seq: seq++ };
}

const ctx = (): TabularContext => ({
  importSessionId: 1, parserType: "pdf", parserVersion: "t", sourceFileId: "k", sourceFileName: "f.pdf",
  sourceMimeType: "application/pdf", sourceChecksum: "a".repeat(64), maxItems: 5000,
});

/** Grade simples: cabeçalho + linhas; valores numéricos alinhados à direita da coluna. */
function grid(header: string[] | null, rows: string[][], colX: number[], o: { y0?: number; pitch?: number; title?: string } = {}): PositionedTextToken[] {
  const out: PositionedTextToken[] = [];
  let y = o.y0 ?? 60;
  const pitch = o.pitch ?? 22;
  if (o.title) { out.push(tok(o.title, colX[0], 20, { size: 14 })); }
  const numeric = (s: string) => /\d/.test(s) && !/[A-Za-z]{3}/.test(s);
  const put = (cells: string[]) => {
    cells.forEach((c, i) => { if (c) out.push(numeric(c) || c === "/////" ? tok(c, colX[i + 1] - 10, y, { align: "right" }) : tok(c, colX[i], y)); });
    y += pitch;
  };
  if (header) put(header);
  rows.forEach(put);
  return out;
}

describe("A — tabela simples horizontal", () => {
  it("cabeçalho + 3 linhas → matriz 3 × 5, sem avisos de estrutura", () => {
    const colX = [40, 240, 300, 380, 480, 580];
    const r = reconstructPageTable(grid(
      ["Descricao", "Unidade", "Qtd", "Valor Unitario", "Valor Total"],
      [["Cadeira giratoria", "UN", "10", "1.234,56", "12.345,60"], ["Mesa de reuniao", "UN", "2", "850,00", "1.700,00"], ["Papel A4 resma", "CX", "12,5", "23,90", "298,75"]],
      colX, { title: "Pesquisa de precos" },
    ));
    expect(r.table?.header).toEqual(["Descricao", "Unidade", "Qtd", "Valor Unitario", "Valor Total"]);
    expect(r.table?.rows).toEqual([
      ["Cadeira giratoria", "UN", "10", "1.234,56", "12.345,60"],
      ["Mesa de reuniao", "UN", "2", "850,00", "1.700,00"],
      ["Papel A4 resma", "CX", "12,5", "23,90", "298,75"],
    ]);
    expect(r.roles).toMatchObject({ item: 3, header: 1 });
    expect(r.layoutVersion).toBe(PDF_LAYOUT_VERSION);
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => [i.rawDescription, i.rawUnit, i.rawQuantity, i.rawUnitPrice, i.rawTotalPrice])).toEqual([
      ["Cadeira giratoria", "UN", "10", "1.234,56", "12.345,60"],
      ["Mesa de reuniao", "UN", "2", "850,00", "1.700,00"],
      ["Papel A4 resma", "CX", "12,5", "23,90", "298,75"],
    ]);
  });
});

describe("B — descrição multilinha", () => {
  const colX = [40, 200, 260, 330, 420];
  const head = ["Descricao", "Unid", "Qtd", "Valor"].map((h, i) => tok(h, colX[i], 40));
  /** Item com descrição de 3 linhas; valores na linha `at` (0 = topo, 1 = centro, 2 = base). */
  const item = (y: number, lines: string[], vals: string[], at: number) => [
    ...lines.map((l, k) => tok(l, colX[0], y + k * 12)),
    tok(vals[0], colX[1], y + at * 12), tok(vals[1], colX[3] - 6, y + at * 12, { align: "right" }), tok(vals[2], colX[4] - 6, y + at * 12, { align: "right" }),
  ];
  it.each([[0, "topo"], [1, "centro"], [2, "base"]])("valores alinhados ao %s ⇒ UMA descrição por item", (at) => {
    const toks = [...head, ...item(70, ["OLEO LUBRIFICANTE", "PARA MOTOR DIESEL", "TAMBOR 200 LITROS"], ["TB", "1,00", "950,31"], at),
      ...item(120, ["GRAXA A BASE DE", "LITIO NLGI 2", "POTE 1 KG"], ["UN", "2,00", "67,23"], at)];
    const r = reconstructPageTable(toks);
    expect(r.table?.rows.map((x) => x[0])).toEqual(["OLEO LUBRIFICANTE PARA MOTOR DIESEL TAMBOR 200 LITROS", "GRAXA A BASE DE LITIO NLGI 2 POTE 1 KG"]);
    expect(r.table?.rowMeta.map((m) => m.physicalRows)).toEqual([3, 3]);
    expect(r.warnings.map((w) => w.code)).not.toContain("LAYOUT_ORPHAN_TEXT");
  });
  it("preço centralizado ENTRE duas linhas da descrição (linha física própria) ⇒ mesma célula", () => {
    const toks = [...head, tok("OLEO HIDRAULICO", colX[0], 70), tok("ISO VG 68", colX[0], 82),
      tok("TB", colX[1], 76), tok("1,00", colX[3] - 6, 76, { align: "right" }), tok("1.134,28", colX[4] - 6, 76, { align: "right" })];
    const r = reconstructPageTable(toks);
    expect(r.table?.rows).toEqual([["OLEO HIDRAULICO ISO VG 68", "TB", "1,00", "1.134,28"]]);
  });
  it("tabela DENSA (sem espaço entre itens): limite inferido pelo alinhamento, com aviso de revisão", () => {
    const toks = [...head, ...item(70, ["ITEM UM LINHA A", "ITEM UM LINHA B", "ITEM UM LINHA C"], ["UN", "1,00", "10,00"], 0),
      ...item(106, ["ITEM DOIS LINHA A", "ITEM DOIS LINHA B", "ITEM DOIS LINHA C"], ["UN", "1,00", "20,00"], 0)];
    const r = reconstructPageTable(toks);
    expect(r.table?.rows.map((x) => x[0])).toEqual(["ITEM UM LINHA A ITEM UM LINHA B ITEM UM LINHA C", "ITEM DOIS LINHA A ITEM DOIS LINHA B ITEM DOIS LINHA C"]);
    expect(r.warnings.map((w) => w.code)).toContain("LAYOUT_ROW_BOUNDARY_INFERRED");
  });
});

describe("C — número variável de fontes (mapa comparativo)", () => {
  it.each([3, 5, 8])("%i colunas de fonte ⇒ %i cotações por item, fornecedor = cabeçalho", (n) => {
    const colX = [40, 200, 260, ...Array.from({ length: n + 1 }, (_, i) => 330 + i * 70)];
    const sources = Array.from({ length: n }, (_, i) => `Fonte ${String.fromCharCode(65 + i)}`);
    const values = (base: number) => Array.from({ length: n }, (_, i) => `${base + i},00`);
    const r = reconstructPageTable(grid(["Descricao", "Unid", "Qtde", ...sources], [["Item um", "UN", "1,00", ...values(100)], ["Item dois", "CX", "2,00", ...values(200)]], colX));
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items).toHaveLength(2 * n);
    expect(out.items.filter((i) => i.rawDescription === "Item um").map((i) => i.rawSupplier)).toEqual(sources);
    expect(out.validation.validQuotes).toBe(2 * n);
  });
});

describe("D — células vazias e marcadores de ausência", () => {
  it('"/////" e "-" nunca viram preço (nem 0): célula vazia registrada; demais cotações preservadas', () => {
    const colX = [40, 200, 260, 330, 400, 470, 540];
    const r = reconstructPageTable(grid(["Descricao", "Unid", "Qtde", "Fonte A", "Fonte B", "Fonte C"],
      [["Item um", "UN", "1,00", "10,00", "/////", "12,00"], ["Item dois", "UN", "1,00", "", "-", "30,00"]], colX));
    expect(r.table?.rows).toEqual([["Item um", "UN", "1,00", "10,00", "", "12,00"], ["Item dois", "UN", "1,00", "", "", "30,00"]]);
    expect(r.table?.rowMeta[0].discarded).toEqual([{ column: 4, raw: "/////", reason: "placeholder" }]);
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => i.rawUnitPrice)).toEqual(["10,00", "12,00", "30,00"]);
    expect(out.items.some((i) => i.rawUnitPrice === "0" || i.rawUnitPrice === "0,00" || i.rawUnitPrice === "/////")).toBe(false);
  });
});

describe("E — linhas de total", () => {
  it("linha de total (sem identificação do item) é RESUMO: evidência de conferência, nunca item", () => {
    const colX = [40, 60, 220, 280, 350, 420, 490, 560];
    const toks = grid(["Item", "Descricao", "Unid", "Qtde", "Fonte A", "Fonte B", "Media"],
      [["1", "Item um", "UN", "1,00", "10,00", "20,00", "15,00"], ["2", "Item dois", "UN", "2,00", "30,00", "50,00", "40,00"]], colX);
    toks.push(tok("TOTAL GERAL", 60, 60 + 3 * 22), tok("95,00", 560 - 6, 60 + 3 * 22, { align: "right" }), tok("190,00", 490 - 6, 60 + 3 * 22, { align: "right" }));
    const r = reconstructPageTable(toks);
    expect(r.table?.rows).toHaveLength(2);
    expect(r.table?.summaryRows.map((s) => s.label)).toEqual(["TOTAL GERAL"]);
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => i.rawDescription)).not.toContain("TOTAL GERAL");
    expect(out.validation).toMatchObject({ documentTotalCents: 9500, calculatedTotalCents: 1500 + 8000, totalMatches: true, averageMismatches: 0 });
  });
  it("média impressa divergente ⇒ DOCUMENT_AVERAGE_MISMATCH (o valor calculado é a fonte canônica; nada é ajustado)", () => {
    const colX = [40, 200, 260, 330, 400, 470, 540];
    const r = reconstructPageTable(grid(["Descricao", "Unid", "Qtde", "Fonte A", "Fonte B", "Media"], [["Item um", "UN", "1,00", "10,00", "20,00", "16,00"]], colX));
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => i.rawUnitPrice)).toEqual(["10,00", "20,00"]);
    expect(out.items[0].extractionWarnings.map((w) => w.code)).toContain("DOCUMENT_AVERAGE_MISMATCH");
    expect(out.validation.rows[0]).toMatchObject({ calculatedAverageCents: 1500, documentAverageCents: 1600, averageMatches: false });
  });
});

describe("F — página sem itens", () => {
  it("identificação/assinatura/rodapé ⇒ pageHasNoItemTable (nenhuma linha vira item)", () => {
    const toks = [
      tok("ENTE PUBLICO EXEMPLO", 60, 40), tok("Local e data: Municipio Exemplo, 01 de janeiro de 2026.", 60, 80),
      tok("______________________", 200, 160), tok("Servidor Responsavel", 200, 176), tok("Matricula no 0000", 200, 192), tok("Pagina 2 de 2", 700, 560),
    ];
    const r = reconstructPageTable(toks);
    expect(r.pageHasNoItemTable).toBe(true);
    expect(r.table).toBeNull();
  });
});

describe("cabeçalho vertical, moeda separada, colunas não alinhadas, cabeçalho herdado", () => {
  it("rótulos em texto VERTICAL viram cabeçalho da coluna; grupo que atravessa colunas não é rótulo", () => {
    const colX = [40, 200, 260, 330, 380, 430];
    const toks = [
      tok("FONTES DE PESQUISA", 330, 20),
      tok("Descricao", 40, 90), tok("Unid", 200, 90), tok("Qtde", 260, 90),
      tok("Fornecedor A", 352, 40, { vertical: true, size: 8 }), tok("Fornecedor B", 402, 40, { vertical: true, size: 8 }),
      ...grid(null, [["Item um", "UN", "1,00", "10,00", "12,00"], ["Item dois", "UN", "1,00", "20,00", "22,00"]], colX, { y0: 120 }),
    ];
    const r = reconstructPageTable(toks);
    expect(r.table?.header).toEqual(["Descricao", "Unid", "Qtde", "Fornecedor A", "Fornecedor B"]);
    expect(r.table?.columnGroups.map((g) => g.label)).toEqual(["FONTES DE PESQUISA"]);
    expect(r.warnings.map((w) => w.code)).toContain("LAYOUT_VERTICAL_HEADERS");
  });
  it('"R$" à esquerda e valor à direita na MESMA célula ⇒ uma coluna ("R$ 950,31"), não duas', () => {
    const toks = [tok("Descricao", 40, 40), tok("Unid", 200, 40), tok("Qtde", 260, 40), tok("Media", 340, 40),
      tok("Item um", 40, 70), tok("UN", 200, 70), tok("1,00", 290, 70, { align: "right" }), tok("R$", 332, 70), tok("950,31", 420, 70, { align: "right" }),
      tok("Item dois", 40, 92), tok("UN", 200, 92), tok("1,00", 290, 92, { align: "right" }), tok("R$", 332, 92), tok("1.052,82", 420, 92, { align: "right" })];
    const r = reconstructPageTable(toks);
    expect(r.columnCount).toBe(4);
    expect(r.table?.rows.map((x) => x[3])).toEqual(["R$ 950,31", "R$ 1.052,82"]);
  });
  it("texto com espaços em fonte proporcional (colunas não alinhadas) ⇒ columnsUnresolved (o parser usa as linhas)", () => {
    const toks = [tok("Descricao", 40, 40), tok("Qtd", 126, 40), tok("Unid", 159, 40), tok("V.Unit", 193, 40), tok("Total", 238, 40),
      tok("Caneta azul", 40, 60), tok("100", 130, 60), tok("UN", 163, 60), tok("1,50", 197, 60), tok("150,00", 241, 60),
      tok("Papel A4 resma", 40, 80), tok("50", 139, 80), tok("RESMA", 169, 80), tok("18,90", 216, 80), tok("945,00", 263, 80)];
    const r = reconstructPageTable(toks);
    expect(r.columnsUnresolved).toBe(true);
    expect(r.table).toBeNull();
  });
  it("tabela que continua na página seguinte SEM cabeçalho herda o cabeçalho (mesmo nº de colunas)", () => {
    const colX = [40, 200, 260, 330, 400];
    const p1 = reconstructPageTable(grid(["Descricao", "Unid", "Qtde", "Valor"], [["Item um", "UN", "1,00", "10,00"]], colX));
    const p2 = reconstructPageTable(grid(null, [["Item dois", "UN", "1,00", "20,00"]], colX).map((t) => ({ ...t, page: 2 })), {
      page: 2, carriedHeader: { header: p1.table!.header!, headerSynthesized: p1.table!.headerSynthesized, columnGroups: [] },
    });
    expect(p2.table?.header).toEqual(["Descricao", "Unid", "Qtde", "Valor"]);
    expect(p2.warnings.map((w) => w.code)).toContain("LAYOUT_HEADER_CARRIED_OVER");
  });
});

describe("sem cabeçalho legível — papéis pela estrutura (nunca inventa fornecedor)", () => {
  it("descrição/unidade/quantidade + MÉDIA e TOTAL detectados como colunas DERIVADAS; fontes sem identidade", () => {
    const colX = [40, 200, 260, 330, 400, 470, 540, 610];
    const r = reconstructPageTable(grid(null, [
      ["Oleo lubrificante tambor", "TB", "1,00", "10,00", "20,00", "15,00", "15,00"],
      ["Graxa de litio pote", "UN", "2,00", "30,00", "50,00", "40,00", "80,00"],
    ], colX));
    expect(r.table?.header).toBeNull();
    const roles = inferHeaderlessRoles(r.table!);
    expect(roles?.header).toEqual(["Descrição", "Unidade", "Quantidade", "Coluna 4", "Coluna 5", "Média", "Valor Total"]);
    const out = extractItemsFromLayoutTable(r.table!, ctx(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => [i.rawDescription, i.rawUnitPrice, i.rawSupplier])).toEqual([
      ["Oleo lubrificante tambor", "10,00", null], ["Oleo lubrificante tambor", "20,00", null],
      ["Graxa de litio pote", "30,00", null], ["Graxa de litio pote", "50,00", null],
    ]);
    expect(out.items[0].extractionWarnings.map((w) => w.code)).toContain("SOURCE_IDENTITY_UNRESOLVED");
    expect(out.warnings.map((w) => w.code)).toContain("LAYOUT_HEADER_INFERRED");
    expect(out.validation).toMatchObject({ averageChecks: 2, averageMismatches: 0 });
  });
});

describe("convergência nativo × OCR (mesma reconstrução)", () => {
  it("as MESMAS geometrias como texto nativo e como palavras de OCR produzem a MESMA matriz", () => {
    const colX = [40, 240, 300, 380, 480, 580];
    const native = grid(["Descricao", "Unidade", "Qtd", "Fornecedor A", "Fornecedor B"],
      [["Cadeira giratoria", "UN", "10", "1.198,00", "1.250,00"], ["Mesa de reuniao", "UN", "2", "850,00", "910,50"]], colX);
    // OCR: uma palavra por caixa (as frases do nativo são quebradas em palavras com a mesma geometria).
    const words = native.flatMap((t) => {
      const parts = t.text.split(" ");
      let x = t.x;
      return parts.map((p) => { const w = { text: p, confidence: 91, bbox: { x0: x, y0: t.y, x1: x + p.length * FS * 0.5, y1: t.y + t.height } }; x += (p.length + 1) * FS * 0.5; return w; });
    });
    const page: OcrPageResult = { pageNumber: 1, text: "", confidence: 91, width: 800, height: 600, lines: [{ text: "", confidence: 91, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words }], durationMs: 1, warnings: [] };
    const fromOcr = reconstructPageTable(tokensFromOcrPage(page));
    const fromNative = reconstructPageTable(native);
    expect(fromOcr.table?.header).toEqual(fromNative.table?.header);
    expect(fromOcr.table?.rows).toEqual(fromNative.table?.rows);
    expect(fromOcr.table?.rowMeta[0].confidence.every((c) => c === 91)).toBe(true);
    expect(fromNative.table?.rowMeta[0].confidence.every((c) => c === null)).toBe(true);
  });
  it("texto nativo ROTACIONADO (transform do pdfjs) vira token vertical com caixa correta", () => {
    const [t] = tokensFromPdfTextItems([{ str: "Fornecedor A", transform: [0, 9, -9, 0, 306.462, 435.28], width: 54.477, height: 9 }], 1, (x, y) => [x, 595.28 - y]);
    expect(t.orientation).toBe("vertical");
    expect(t.y).toBeCloseTo(595.28 - 435.28 - 54.477, 1);
    expect(t.height).toBeCloseTo(54.477, 1);
  });
});

describe("determinismo e desempenho", () => {
  const build = (items: number, sources: number) => {
    const colX = [40, 200, 260, ...Array.from({ length: sources + 1 }, (_, i) => 330 + i * 60)];
    const header = ["Descricao", "Unid", "Qtde", ...Array.from({ length: sources }, (_, i) => `Fonte ${i + 1}`)];
    const rows = Array.from({ length: items }, (_, k) => [`Item numero ${k + 1}`, "UN", "1,00", ...Array.from({ length: sources }, (_, i) => `${100 + k + i},00`)]);
    return grid(header, rows, colX, { pitch: 14 });
  };
  it("mesma entrada ⇒ mesma matriz, mesma ordem (independe da ordem original dos tokens)", () => {
    const toks = build(20, 6);
    const shuffled = [...toks].reverse().map((t, i) => ({ ...t, seq: i }));
    expect(reconstructPageTable(shuffled).table?.rows).toEqual(reconstructPageTable(toks).table?.rows);
  });
  it("≈ O(n log n): 400 itens × 10 fontes (~5.600 tokens) em bem menos de 1 s", () => {
    const toks = build(400, 10);
    const t0 = performance.now();
    const r = reconstructPageTable(toks);
    const ms = performance.now() - t0;
    expect(r.itemRowCount).toBe(400);
    expect(ms).toBeLessThan(1000);
  });
});

describe("tipos de célula", () => {
  it.each([
    ["R$", "currency"], ["/////", "placeholder"], ["-", "placeholder"], ["N/A", "placeholder"], ["12,25%", "percent"],
    ["1.234,56", "money"], ["10", "number"], ["Tambor", "text"], ["MAPA DE APURAÇÃO DE", "text"],
  ])("%s → %s", (text, kind) => {
    expect(classifyFragmentText(text)).toBe(kind);
  });
});

// ─── Layout v3 — região tabular, LogicalItemBlock e células EMPILHADAS ───────────────────────────────────────
describe("Layout v3 — região tabular, bloco lógico de item e células empilhadas", () => {
  const FS7 = 7.2;
  const t = (text: string, x: number, y: number, o: { align?: "left" | "right" | "center"; vertical?: boolean; size?: number } = {}) => tok(text, x, y, { size: o.size ?? FS7, align: o.align, vertical: o.vertical });
  const SRC = [460, 500, 540, 580]; // bordas direitas das colunas de fonte
  /** Item "empilhado": L0 = I + descrição + unidade + média; L1 = 001 + preços + %; L2 = 00n + quantidade + total. */
  function stackedItem(y: number, n: number, desc: string[], unit: string, qty: string, quotes: string[], avg: string, total: string, pct: string) {
    const L0 = y, L1 = y + 8.2, L2 = y + 16.4;
    const d0 = L1 - ((desc.length - 1) / 2) * 8.2;
    return [
      t("I", 40, L0), t("001", 36, L1), t(String(n).padStart(3, "0"), 36, L2),
      ...desc.map((d, i) => t(d, 60, d0 + i * 8.2)),
      t(unit, 310, L0 + 2.3, { align: "center" }), t(qty, 310, L1 + 5.2, { align: "center" }),
      ...quotes.map((q, i) => t(q, SRC[i], L1, { align: "right" })),
      t(avg, 640, L0 + 2.3, { align: "right" }), t(total, 640, L1 + 5.2, { align: "right" }),
      t(pct, 690, L1, { align: "right" }),
    ];
  }
  const header = () => [
    t("ANEXO", 34, 20), t("LOTE", 35, 28.2), t("ITEM", 35, 36.4),
    t("PRODUTO / SERVIÇO", 150, 28.2),
    t("UNIDADE", 310, 20, { align: "center" }), t("/", 310, 28.2, { align: "center" }), t("QTDE.", 310, 36.4, { align: "center" }),
    ...["FONTE A", "FONTE B", "NORTE SUP", "FONTE D"].map((s, i) => t(s, SRC[i] - 12, 8, { vertical: true })),
    t("ARITMÉTICA /", 612, 5, { vertical: true }), t("MÉDIA", 604, 12, { vertical: true }), t("VALOR TOTAL", 620, 5, { vertical: true }),
    t("PERCENTUAL", 675, 5, { vertical: true }),
  ];
  const body = () => [
    ...stackedItem(60, 1, ["OLEO LUBRIFICANTE PARA MOTOR", "DIESEL TAMBOR 200 LITROS", "CLASSE API CI-4"], "Tambor", "1,00", ["920,00", "/////", "985,50", "950,00"], "951,83", "951,83", "7,12%"),
    ...stackedItem(95, 2, ["GRAXA DE LITIO POTE 1 KG"], "Un", "1,00", ["65,90", "69,00", "/////", "67,00"], "67,30", "67,30", "4,70%"),
  ];
  const ctx7 = ctx;

  it("A. caixa de metadados (ID, data, 'R$', valor total) acima do título NÃO cria item nem cotação", () => {
    const toks = [
      t("ID", 36, -80, { size: 6.4 }), t("DATA", 90, -80, { size: 6.4 }), t("VALOR TOTAL", 600, -80, { size: 6.4 }),
      t("900001", 34, -70, { size: 9.9 }), t("01/01/2026", 88, -70, { size: 9.9 }), t("R$", 600, -70, { size: 9.9 }), t("1.019,13", 620, -70, { size: 9.9 }),
      t("MAPA DE APURAÇÃO DE PREÇOS", 250, -75, { size: 19.8 }),
      t("OBJETO", 36, -50, { size: 6.4 }), t("Aquisição de materiais fictícios para teste", 34, -40, { size: 9.9 }),
      ...header(), ...body(),
    ];
    const r = reconstructPageTable(toks);
    expect(r.table?.rows).toHaveLength(2);
    const out = extractItemsFromLayoutTable(r.table!, ctx7(), { tableIndex: 0, source: "native" });
    const all = out.items.flatMap((i) => [i.rawDescription, i.rawUnitPrice, i.rawQuantity, i.rawUnit]);
    for (const junk of ["900001", "01/01/2026", "R$", "1.019,13"]) expect(all).not.toContain(junk);
    expect(r.roles.preamble).toBeGreaterThan(0);
  });

  it("B/C. UNIDADE / QTDE. e MÉDIA / VALOR TOTAL empilhadas ⇒ subcolunas virtuais (unidade, quantidade, média, total)", () => {
    const r = reconstructPageTable([...header(), ...body()]);
    expect(r.table?.header).toEqual(["ANEXO", "LOTE", "ITEM", "PRODUTO / SERVIÇO", "UNIDADE", "QTDE.", "FONTE A", "FONTE B", "NORTE SUP", "FONTE D", "MÉDIA ARITMÉTICA", "VALOR TOTAL", "PERCENTUAL"]);
    const out = extractItemsFromLayoutTable(r.table!, ctx7(), { tableIndex: 0, source: "native" });
    const first = out.items.filter((i) => i.rawDescription?.startsWith("OLEO"));
    expect(first.map((i) => [i.rawUnit, i.rawQuantity])).toEqual(first.map(() => ["Tambor", "1,00"]));
    // Média e total impressos: conferência, nunca cotação.
    expect(out.items.map((i) => i.rawUnitPrice)).not.toContain("951,83");
    expect(out.items.map((i) => i.rawUnitPrice)).not.toContain("67,30");
    expect(out.validation.rows.map((x) => x.documentAverageCents)).toEqual([95183, 6730]);
    expect(out.validation.rows.map((x) => x.averageMatches)).toEqual([true, true]);
    expect(r.warnings.map((w) => w.code)).toContain("LAYOUT_STACKED_CELLS");
  });

  it("D. identificação hierárquica empilhada (I / 001 / 00n) é identidade, nunca cotação", () => {
    const r = reconstructPageTable([...header(), ...body()]);
    expect(r.table?.rowMeta.map((m) => m.identifier)).toEqual(["I / 001 / 001", "I / 001 / 002"]);
    const out = extractItemsFromLayoutTable(r.table!, ctx7(), { tableIndex: 0, source: "native" });
    expect(out.items.some((i) => /^00\d$/.test(i.rawUnitPrice ?? ""))).toBe(false);
    expect(out.items.map((i) => i.rawSupplier)).toEqual(["FONTE A", "NORTE SUP", "FONTE D", "FONTE A", "FONTE B", "FONTE D"]);
  });

  it("E/G. preços centralizados entre unidade e quantidade + descrição de 3 linhas ⇒ UM item (bloco lógico)", () => {
    const r = reconstructPageTable([...header(), ...body()]);
    expect(r.table?.rows.map((x) => x[3])).toEqual(["OLEO LUBRIFICANTE PARA MOTOR DIESEL TAMBOR 200 LITROS CLASSE API CI-4", "GRAXA DE LITIO POTE 1 KG"]);
    expect(r.table?.rowMeta.map((m) => m.physicalRows)).toEqual([3, 3]);
    expect(r.itemRowCount).toBe(2);
  });

  it("F. linhas de total com números VERTICAIS por fonte + total geral: resumo/rodapé, nunca item", () => {
    const toks = [...header(), ...body(),
      t("Valor total do anexo após análise", 100, 150),
      ...["985,90", "69,00", "985,50", "1.017,00"].map((v, i) => t(v, SRC[i] - 10, 140, { vertical: true })),
      t("R$", 600, 165), t("1.019,13", 640, 165, { align: "right" }),
      t("Valor total geral do anexo", 100, 190),
      ...["985,90", "69,00", "985,50", "1.017,00"].map((v, i) => t(v, SRC[i] - 10, 180, { vertical: true })),
    ];
    const r = reconstructPageTable(toks);
    expect(r.table?.rows).toHaveLength(2);
    const out = extractItemsFromLayoutTable(r.table!, ctx7(), { tableIndex: 0, source: "native" });
    expect(out.items.map((i) => i.rawDescription)).not.toContain("Valor total do anexo após análise");
    expect(out.items.map((i) => i.rawUnitPrice)).not.toContain("1.019,13");
    expect(out.validation).toMatchObject({ documentTotalCents: 101913, calculatedTotalCents: 95183 + 6730, totalMatches: true });
    expect(r.warnings.map((w) => w.code)).not.toContain("LAYOUT_ORPHAN_TEXT");
  });

  it("H. dois itens REALMENTE distintos muito próximos (duas linhas estruturais no mesmo bloco) ⇒ dois itens", () => {
    const toks = [...header(),
      t("I", 40, 60), t("001", 36, 60), t("ITEM ALFA", 60, 60), t("UN", 310, 60, { align: "center" }), t("1,00", 330, 60),
      ...["10,00", "11,00", "12,00", "13,00"].map((q, i) => t(q, SRC[i], 60, { align: "right" })), t("11,50", 640, 60, { align: "right" }), t("5%", 690, 60, { align: "right" }),
      t("I", 40, 68.2), t("002", 36, 68.2), t("ITEM BETA", 60, 68.2), t("UN", 310, 68.2, { align: "center" }), t("1,00", 330, 68.2),
      ...["20,00", "21,00", "22,00", "23,00"].map((q, i) => t(q, SRC[i], 68.2, { align: "right" })), t("21,50", 640, 68.2, { align: "right" }), t("5%", 690, 68.2, { align: "right" }),
    ];
    const r = reconstructPageTable(toks);
    expect(r.itemRowCount).toBe(2);
    expect(r.table?.rows.map((x) => x.find((c) => c.startsWith("ITEM")))).toEqual(["ITEM ALFA", "ITEM BETA"]);
  });
});
