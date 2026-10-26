/**
 * SEC-AUD-2026-10 / xlsx — leitura de XLSX com `exceljs` (substitui o SheetJS 0.18.5 no caminho XLSX; o npm não
 * publica versão corrigida das advisories GHSA-4r6h-8v6p-xvw6 e GHSA-5pgg-2g8v-p4x9).
 *
 * Produz a MESMA matriz que `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })` com `cellDates: true`
 * produzia (comparado por teste diferencial em server/__tests__/unit/xlsx-exceljs-parity.test.ts):
 *   - intervalo = células existentes no arquivo (inclusive vazias só com formatação, como a tag <dimension>);
 *     a matriz começa na primeira linha/coluna usada, não em A1;
 *   - linhas vazias dentro do intervalo entram preenchidas com ""; aba sem células ⇒ [[""]];
 *   - número → number, texto → string, booleano → boolean, data → Date;
 *   - fórmula → valor em CACHE (nunca executada); sem cache → "";
 *   - erro (#N/A…) → ""; célula mesclada secundária → ""; rich text e hyperlink → texto.
 * Limites: diretório ZIP declarado e descompressão REAL antes do leitor; intervalo por aba e total da pasta antes de
 * alocar a matriz (spreadsheetLimits.ts). Em produção esta função roda só dentro do worker isolado
 * (xlsxReadIsolated.ts), nunca no processo principal.
 */
import ExcelJS from "exceljs";
import {
  assertSheetWithinLimits, scanZipRealContent, SPREADSHEET_LIMITS, SpreadsheetLimitError, type SpreadsheetLimits,
} from "./spreadsheetLimits";

export type MatrixCell = string | number | boolean | Date;

export interface WorkbookMatrices {
  sheetNames: string[];
  matrices: Map<string, MatrixCell[][]>;
}

function richTextToString(rt: Array<{ text?: string }>): string {
  return rt.map((r) => r.text ?? "").join("");
}

/** Converte o valor de uma célula do exceljs para o valor "cru" que o SheetJS entregava. */
export function excelCellValue(value: ExcelJS.CellValue): MatrixCell {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("error" in value) return "";
    if ("richText" in value && Array.isArray(value.richText)) return richTextToString(value.richText);
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: unknown }).result;
      if (result === undefined || result === null) return "";
      if (typeof result === "object" && result !== null && "error" in result) return "";
      return excelCellValue(result as ExcelJS.CellValue);
    }
    if ("hyperlink" in value) {
      const text = (value as { text?: unknown }).text;
      if (typeof text === "string") return text;
      if (text && typeof text === "object" && "richText" in text) return richTextToString((text as { richText: Array<{ text?: string }> }).richText);
      return "";
    }
  }
  return String(value);
}

/** Lê um XLSX e devolve a matriz de cada aba, na ordem do arquivo. Lança SpreadsheetLimitError. */
export async function readXlsxMatrices(buffer: Buffer, limits: SpreadsheetLimits = SPREADSHEET_LIMITS): Promise<WorkbookMatrices> {
  await scanZipRealContent(buffer, limits); // bytes e células REAIS, antes de o JSZip descomprimir tudo em memória
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets = wb.worksheets;
  if (sheets.length > limits.maxSheets) {
    throw new SpreadsheetLimitError("TOO_MANY_SHEETS", `Planilha com ${sheets.length} abas (limite ${limits.maxSheets}).`);
  }
  const sheetNames: string[] = [];
  const matrices = new Map<string, MatrixCell[][]>();
  const budget = { remaining: limits.maxMatrixCellsPerWorkbook };
  for (const ws of sheets) {
    sheetNames.push(ws.name);
    matrices.set(ws.name, worksheetMatrix(ws, limits, budget));
  }
  return { sheetNames, matrices };
}

function worksheetMatrix(ws: ExcelJS.Worksheet, limits: SpreadsheetLimits, budget: { remaining: number }): MatrixCell[][] {
  // Intervalo usado: linhas/células EXISTENTES no arquivo (row.model inclui células só formatadas, como a
  // <dimension> que o SheetJS usava). findRow não cria linhas.
  let minR = 0, maxR = 0, minC = 0, maxC = 0;
  const present = new Map<number, ExcelJS.Row>();
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.findRow(r);
    const model = row?.model;
    if (!row || !model || !model.cells || model.cells.length === 0) continue;
    present.set(r, row);
    if (!minR) minR = r;
    maxR = r;
    const rowMin = model.min ?? 0, rowMax = model.max ?? 0;
    if (rowMin > 0 && (!minC || rowMin < minC)) minC = rowMin;
    if (rowMax > maxC) maxC = rowMax;
  }
  if (!minR) return [[""]]; // aba sem células: o SheetJS lia a <dimension> "A1" ⇒ uma linha com uma célula vazia
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  assertSheetWithinLimits(ws.name, rows, cols, limits);
  // Orçamento AGREGADO entre abas: várias abas esparsas no limite individual não somam uma matriz gigante.
  budget.remaining -= rows * cols;
  if (budget.remaining < 0) {
    throw new SpreadsheetLimitError("TOO_MANY_CELLS", `A pasta excede o limite de ${limits.maxMatrixCellsPerWorkbook} células somando as abas.`);
  }

  const out: MatrixCell[][] = [];
  for (let r = minR; r <= maxR; r++) {
    const line: MatrixCell[] = new Array(cols).fill("");
    const row = present.get(r);
    if (row) {
      row.eachCell((cell, c) => {
        if (c < minC || c > maxC) return;
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return; // secundária ⇒ ""
        line[c - minC] = excelCellValue(cell.value);
      });
    }
    out.push(line);
  }
  return out;
}
