/**
 * SEC-AUD-07 — corpus sintético de planilhas (dados fictícios) usado pelos goldens do leitor XLSX e pela sonda de
 * fuso horário. As chaves casam com server/__tests__/fixtures/spreadsheets/xlsx-goldens.json.
 */
import type ExcelJS from "exceljs";
import type { MatrixCell } from "../../parsers/excelWorkbookMatrix";

export type Build = (wb: ExcelJS.Workbook) => void;

export const XLSX_CORPUS: Record<string, Build> = {
  cotacoes: (wb) => {
    const ws = wb.addWorksheet("Mapa comparativo");
    ws.addRow(["Item", "Descrição", "Unidade", "Qtd", "Fornecedor", "Preço unitário"]);
    ws.addRow([1, "Caneta esferográfica azul — ação/ç/ã/é", "UN", 50, "Papelaria São José LTDA", 1.234]);
    ws.addRow([2, "Papel A4 75g/m² (resma)", "RS", 10, "Distribuidora Ômega", 23.9]);
    ws.getCell("F3").numFmt = '"R$" #,##0.00';
    ws.addRow([3, "Grampeador 26/6", "UN", 2, "Fornecedor & Cia", 0.1 + 0.2]);
  },
  vazios: (wb) => {
    const ws = wb.addWorksheet("S");
    ws.getCell("C3").value = "Descrição";
    ws.getCell("D3").value = "Valor";
    ws.getCell("C5").value = "Item após linha vazia";
    ws.getCell("E7").value = 7;
  },
  formatadas: (wb) => {
    const ws = wb.addWorksheet("S");
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    ws.getCell("C3").value = "x";
    ws.getCell("C6").font = { bold: true };
  },
  datas: (wb) => {
    const ws = wb.addWorksheet("Datas");
    ws.getCell("A1").value = new Date(Date.UTC(2026, 9, 25));
    ws.getCell("A2").value = 45000; ws.getCell("A2").numFmt = "dd/mm/yyyy";
    ws.getCell("A3").value = new Date(Date.UTC(2026, 0, 1, 13, 30));
    ws.getCell("A4").value = 0.5; ws.getCell("A4").numFmt = "0%";
  },
  formulas: (wb) => {
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
  mescladas: (wb) => {
    const ws = wb.addWorksheet("M");
    ws.mergeCells("A1:C1"); ws.getCell("A1").value = "Cabeçalho mesclado";
    ws.getCell("A2").value = { richText: [{ text: "Rico " }, { font: { bold: true }, text: "texto" }] };
    ws.getCell("B2").value = { text: "site", hyperlink: "https://example.invalid" };
    ws.getCell("C2").value = true;
    ws.getCell("C3").value = false;
  },
  abas: (wb) => {
    wb.addWorksheet("Capa").addRow(["DADOS FICTÍCIOS PARA HOMOLOGAÇÃO"]);
    const h = wb.addWorksheet("Oculta"); h.state = "hidden"; h.addRow(["segredo de aba oculta", 1]);
    wb.addWorksheet("Itens").addRow(["Descrição", "Preço"]);
    wb.addWorksheet("Vazia");
  },
  numeros: (wb) => {
    wb.addWorksheet("N").addRow([123456789012, -0.001, 1e-10, "😀 emoji e  nbsp", "x".repeat(40)]);
  },
};

/** Arquivos do SheetJS (outro gerador) com golden próprio. */
export const SHEETJS_FIXTURES = { "sheetjs-mixed": "sheetjs-mixed.xlsx", "sheetjs-inline": "sheetjs-inline.xlsx" } as const;

export type GoldenCell = string | number | boolean | { date: string };
export interface Golden { sheetNames: string[]; matrices: Record<string, GoldenCell[][]> }

export function toGolden(sheetNames: string[], matrices: Map<string, MatrixCell[][]>): Golden {
  const out: Record<string, GoldenCell[][]> = {};
  for (const n of sheetNames) out[n] = (matrices.get(n) ?? []).map((r) => r.map((v) => (v instanceof Date ? { date: v.toISOString() } : v)));
  return { sheetNames, matrices: out };
}
