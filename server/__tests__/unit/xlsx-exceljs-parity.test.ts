/**
 * SEC-AUD-2026-10 / xlsx — teste DIFERENCIAL: o leitor novo (exceljs) produz a mesma matriz que o SheetJS 0.18.5
 * produzia (`sheet_to_json(header:1, defval:"")`, `cellDates:true`) num corpus sintético representativo, escrito
 * por dois geradores diferentes (exceljs e SheetJS). Também cobre limites (ZIP bomb, entradas, células, abas),
 * entrada malformada, roteamento XLSX × XLS legado no parser e a exportação de itens.
 * Limitação: não há arquivos reais de Excel/LibreOffice no repositório; o corpus é sintético.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { readXlsxMatrices, type MatrixCell } from "../../parsers/excelWorkbookMatrix";
import { assertZipWithinLimits, detectSpreadsheetContainer, SpreadsheetLimitError } from "../../parsers/spreadsheetLimits";
import { xlsxParser } from "../../parsers/xlsxParser";
import { buildItemsWorkbook } from "../../services/excelService";

type Build = (wb: ExcelJS.Workbook) => void;

const norm = (m: unknown[][]) => JSON.parse(JSON.stringify(m, (_k, v) => (v instanceof Date ? `D:${v.toISOString()}` : v)));

function legacyMatrices(buf: Buffer): { names: string[]; m: Record<string, unknown[][]> } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const m: Record<string, unknown[][]> = {};
  for (const n of wb.SheetNames) m[n] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: "" }) as unknown[][];
  return { names: wb.SheetNames, m };
}

async function expectParity(buf: Buffer) {
  const legacy = legacyMatrices(buf);
  const next = await readXlsxMatrices(buf);
  expect(next.sheetNames).toEqual(legacy.names);
  for (const n of legacy.names) expect(norm(next.matrices.get(n) as MatrixCell[][])).toEqual(norm(legacy.m[n]));
}

async function viaExcelJS(build: Build): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function viaSheetJS(sheets: Record<string, unknown[][]>, opts: XLSX.WritingOptions = {}): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [n, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), n);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", ...opts }) as Buffer;
}

const EXCELJS_CORPUS: Record<string, Build> = {
  "cotações típicas (cabeçalho, acentos, moeda, decimais)": (wb) => {
    const ws = wb.addWorksheet("Mapa comparativo");
    ws.addRow(["Item", "Descrição", "Unidade", "Qtd", "Fornecedor", "Preço unitário"]);
    ws.addRow([1, "Caneta esferográfica azul — ação/ç/ã/é", "UN", 50, "Papelaria São José LTDA", 1.234]);
    ws.addRow([2, "Papel A4 75g/m² (resma)", "RS", 10, "Distribuidora Ômega", 23.9]);
    ws.getCell("F3").numFmt = '"R$" #,##0.00';
    ws.addRow([3, "Grampeador 26/6", "UN", 2, "Fornecedor & Cia", 0.1 + 0.2]);
  },
  "células vazias, linhas vazias e intervalo fora de A1": (wb) => {
    const ws = wb.addWorksheet("S");
    ws.getCell("C3").value = "Descrição";
    ws.getCell("D3").value = "Valor";
    ws.getCell("C5").value = "Item após linha vazia";
    ws.getCell("E7").value = 7;
  },
  "células só formatadas antes dos dados (dimension)": (wb) => {
    const ws = wb.addWorksheet("S");
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    ws.getCell("C3").value = "x";
    ws.getCell("C6").font = { bold: true };
  },
  "datas e formatos (dd/mm/aaaa, hora, porcentagem)": (wb) => {
    const ws = wb.addWorksheet("Datas");
    ws.getCell("A1").value = new Date(Date.UTC(2026, 9, 25));
    ws.getCell("A2").value = 45000; ws.getCell("A2").numFmt = "dd/mm/yyyy";
    ws.getCell("A3").value = new Date(Date.UTC(2026, 0, 1, 13, 30));
    ws.getCell("A4").value = 0.5; ws.getCell("A4").numFmt = "0%";
  },
  "fórmulas com e sem cache, erros e strings perigosas": (wb) => {
    const ws = wb.addWorksheet("F");
    ws.getCell("A1").value = 2;
    ws.getCell("A2").value = { formula: "A1*3", result: 6 };
    ws.getCell("A3").value = { formula: "A1*4" };
    ws.getCell("A4").value = { formula: "1/0", result: { error: "#DIV/0!" } };
    ws.getCell("A5").value = { error: "#N/A" };
    ws.getCell("A6").value = "=HYPERLINK(\"http://evil.invalid\",\"x\")";
    ws.getCell("A7").value = "+5";
    ws.getCell("A8").value = "@SUM(A1)";
    ws.getCell("A9").value = "-2+3";
  },
  "mescladas, rich text, hyperlink e booleanos": (wb) => {
    const ws = wb.addWorksheet("M");
    ws.mergeCells("A1:C1"); ws.getCell("A1").value = "Cabeçalho mesclado";
    ws.getCell("A2").value = { richText: [{ text: "Rico " }, { font: { bold: true }, text: "texto" }] };
    ws.getCell("B2").value = { text: "site", hyperlink: "https://example.invalid" };
    ws.getCell("C2").value = true;
    ws.getCell("C3").value = false;
  },
  "várias abas (capa, oculta) na ordem do arquivo": (wb) => {
    wb.addWorksheet("Capa").addRow(["DADOS FICTÍCIOS PARA HOMOLOGAÇÃO"]);
    const h = wb.addWorksheet("Oculta"); h.state = "hidden"; h.addRow(["segredo de aba oculta", 1]);
    wb.addWorksheet("Itens").addRow(["Descrição", "Preço"]);
    wb.addWorksheet("Vazia");
  },
  "números grandes, negativos e texto longo/unicode": (wb) => {
    const ws = wb.addWorksheet("N");
    ws.addRow([123456789012, -0.001, 1e-10, "😀 emoji e  nbsp", "x".repeat(5000)]);
  },
};

// O SheetJS 0.18 convertia datas pelo fuso LOCAL do processo; o exceljs não depende de fuso. Produção roda em
// UTC (sem TZ no Railway) ⇒ paridade exata lá. Em fuso ≠ UTC os casos com data não são comparáveis.
const UTC_PROCESS = new Date(2026, 0, 1).getTimezoneOffset() === 0 && new Date(2026, 6, 1).getTimezoneOffset() === 0;
const HAS_DATES = new Set(["datas e formatos (dd/mm/aaaa, hora, porcentagem)"]);

describe("xlsx → exceljs: paridade de matriz com o leitor anterior", () => {
  for (const [label, build] of Object.entries(EXCELJS_CORPUS)) {
    it.skipIf(HAS_DATES.has(label) && !UTC_PROCESS)(`(gerado por exceljs) ${label}`, async () => expectParity(await viaExcelJS(build)));
  }

  it("datas do leitor novo independem do fuso do processo (meia-noite UTC do dia da célula)", async () => {
    const buf = await viaExcelJS((wb) => { const ws = wb.addWorksheet("D"); ws.getCell("A1").value = 45000; ws.getCell("A1").numFmt = "dd/mm/yyyy"; });
    const m = (await readXlsxMatrices(buf)).matrices.get("D")!;
    expect((m[0][0] as Date).toISOString()).toBe("2023-03-15T00:00:00.000Z");
  });

  it.skipIf(!UTC_PROCESS)("(gerado por SheetJS) tipos mistos, vazios, datas, várias abas", async () => {
    await expectParity(viaSheetJS({
      Itens: [["Descrição", "Qtd", "Preço"], ["Caneta", 10, 1.5], [], ["Papel", "", 23.9], [null, null, new Date(Date.UTC(2026, 9, 25))]],
      Notas: [["Observação"], ["=1+1"]],
    }));
  });

  it("(gerado por SheetJS) strings inline em vez de sharedStrings", async () => {
    await expectParity(viaSheetJS({ S: [["a", "b"], ["ç", 1]] }, { bookSST: false }));
  });
});

describe("xlsx → exceljs: limites e entrada malformada", () => {
  async function sample(): Promise<Buffer> {
    return viaExcelJS((wb) => { wb.addWorksheet("S").addRow(["a", 1]); });
  }
  function patchCentralDirectory(buf: Buffer, fn: (b: Buffer, cdh: number, eocd: number) => void): Buffer {
    const b = Buffer.from(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    fn(b, b.readUInt32LE(eocd + 16), eocd);
    return b;
  }

  it("aceita um XLSX normal", async () => {
    expect(assertZipWithinLimits(await sample()).entries).toBeGreaterThan(3);
  });

  it("ZIP bomb: tamanho descomprimido declarado acima do limite ⇒ recusa sem descomprimir", async () => {
    const bomb = patchCentralDirectory(await sample(), (b, cdh) => b.writeUInt32LE(260 * 1024 * 1024, cdh + 24));
    expect(() => assertZipWithinLimits(bomb)).toThrow(SpreadsheetLimitError);
    const r = await xlsxParser.parse(bomb, { importSessionId: 1 } as never);
    expect(r.errors[0]).toMatchObject({ code: "SIZE_EXCEEDED", fatal: true });
    expect(r.items).toEqual([]);
  });

  it("taxa de compressão anômala numa entrada ⇒ recusa", async () => {
    const ratio = patchCentralDirectory(await sample(), (b, cdh) => { b.writeUInt32LE(100, cdh + 20); b.writeUInt32LE(50 * 1024 * 1024, cdh + 24); });
    expect(() => assertZipWithinLimits(ratio)).toThrow(/compressão anômala/);
  });

  it("número de entradas excessivo ⇒ recusa", async () => {
    const many = patchCentralDirectory(await sample(), (b, _cdh, eocd) => b.writeUInt16LE(5000, eocd + 10));
    expect(() => assertZipWithinLimits(many)).toThrow(/estrutura interna excessiva/);
  });

  it("células por aba acima do limite ⇒ recusa", async () => {
    const big = await viaExcelJS((wb) => { const ws = wb.addWorksheet("S"); ws.getCell("A1").value = 1; ws.getCell("AZZ3000").value = 2; });
    await expect(readXlsxMatrices(big)).rejects.toMatchObject({ code: "TOO_MANY_CELLS" });
  });

  it("ZIP truncado / bytes aleatórios / vazio ⇒ CORRUPT_FILE, sem exceção", async () => {
    const ok = await sample();
    for (const bad of [ok.subarray(0, ok.length - 40), Buffer.from("PK\u0003\u0004 não é xlsx"), Buffer.from("texto qualquer"), Buffer.alloc(0)]) {
      const r = await xlsxParser.parse(bad, { importSessionId: 1 } as never);
      expect(r.items).toEqual([]);
      expect(r.errors[0]?.fatal).toBe(true);
      expect(["CORRUPT_FILE", "SIZE_EXCEEDED"]).toContain(r.errors[0]?.code);
    }
  });

  it("detecta o contêiner pelo conteúdo", async () => {
    expect(detectSpreadsheetContainer(await sample())).toBe("zip");
    const one = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(one, XLSX.utils.aoa_to_sheet([["a"]]), "S");
    const xls = XLSX.write(one, { type: "buffer", bookType: "biff8" }) as Buffer;
    expect(detectSpreadsheetContainer(xls)).toBe("cfb");
    expect(detectSpreadsheetContainer(Buffer.from("a,b\n1,2"))).toBe("unknown");
  });
});

describe("XlsxParser — roteamento e preservação do XLS legado", () => {
  const rows = [["Descrição", "Unidade", "Quantidade", "Valor unitário"], ["Caneta azul", "UN", 10, 2.5], ["Papel A4", "RS", 5, 23.9]];

  it("XLSX usa exceljs e extrai os itens", async () => {
    const r = await xlsxParser.parse(viaSheetJS({ Itens: rows }), { importSessionId: 1 } as never);
    expect(r.errors).toEqual([]);
    expect(r.rawMetadata).toMatchObject({ engine: "exceljs", parserVersion: "1.3.0" });
    expect(r.items.length).toBe(2);
  });

  it("XLS (BIFF8) continua suportado pelo leitor legado — nada removido em silêncio", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Itens");
    const xls = XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
    const r = await xlsxParser.parse(xls, { importSessionId: 1 } as never);
    expect(r.errors).toEqual([]);
    expect(r.rawMetadata).toMatchObject({ engine: "sheetjs-legacy-xls" });
    expect(r.items.length).toBe(2);
  });

  it("mesmo resultado (itens) para o mesmo conteúdo em XLSX e XLS", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Itens");
    const a = await xlsxParser.parse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, { importSessionId: 1 } as never);
    const b = await xlsxParser.parse(XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer, { importSessionId: 1 } as never);
    // id aleatório e extractedAt variam por execução; o resto (valores, locais, rawRowData) é idêntico.
    const strip = (items: unknown[]) => JSON.parse(JSON.stringify(items, (k, v) => (k === "id" || k === "extractedAt" ? undefined : v)));
    expect(strip(a.items)).toEqual(strip(b.items));
  });
});

describe("excelService — exportação com exceljs", () => {
  it("mesmas células, aba e larguras; texto iniciado por '=' fica como texto (sem fórmula)", async () => {
    const data = [["Item", "Descrição", "Unidade"], [1, "=HYPERLINK(\"http://evil.invalid\")", "UN"], [], ["", "", "VALOR TOTAL:", "10.00"]];
    const buf = await buildItemsWorkbook(data);
    const read = XLSX.read(buf, { type: "buffer" });
    expect(read.SheetNames).toEqual(["Itens"]);
    const sheet = read.Sheets["Itens"];
    expect(sheet["B2"]).toMatchObject({ t: "s", v: "=HYPERLINK(\"http://evil.invalid\")" });
    expect(sheet["B2"].f).toBeUndefined();
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })).toEqual([
      ["Item", "Descrição", "Unidade", ""], [1, "=HYPERLINK(\"http://evil.invalid\")", "UN", ""], ["", "", "", ""], ["", "", "VALOR TOTAL:", "10.00"],
    ]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("Itens")!.getColumn(3).width).toBe(50);
  });
});
