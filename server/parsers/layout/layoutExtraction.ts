/**
 * Matriz reconstruída pela geometria → itens brutos pelo MESMO extrator canônico (`tableToRawItems`, o mesmo de
 * CSV/XLSX/DOCX/getTable). Não há segundo parser de negócio: aqui só se ANOTA o resultado com o que a geometria
 * sabe (linha física de origem, células descartadas, fonte não identificada) e se faz a CONFERÊNCIA com as
 * evidências impressas no documento:
 *
 *   - média impressa (coluna de média) × média CALCULADA das cotações válidas (contrato monetário: centavos
 *     inteiros, half-up uma vez) → divergência acima da tolerância ⇒ DOCUMENT_AVERAGE_MISMATCH (revisão);
 *   - total impresso (linha de total) × total CALCULADO (Σ quantidade × média calculada) → `validation`.
 *
 * As evidências NUNCA substituem nem "ajustam" valores: a média/total impressos não viram item nem preço; o
 * cálculo determinístico é a fonte canônica e a divergência vai para a revisão humana.
 */
import type { RawExtractedItem } from "../../domain/importExtraction";
import type { ExtractionWarning } from "../../domain/importConfidence";
import type { ImportWarning } from "../../domain/importTypes";
import { averageCents, multiplyQuantityCents, parseBRLDetailed, type Cents } from "../../domain/money";
import { normalizeDecimal } from "../../domain/importCorrectionFields";
import { isStatHeader, mapHeaderColumns, normalizeHeader, tableToRawItems, type TabularContext, type TabularOutcome } from "../tabularExtraction";
import { PDF_LAYOUT_VERSION, type NormalizedTableMatrix, type PageLayoutResult } from "./tableLayoutReconstructor";
import type { PositionedTextSource } from "./positionedText";

/** Tolerância da média impressa × calculada (arredondamento do emissor): 1 centavo. */
export const AVERAGE_TOLERANCE_CENTS = 1;
/** Tolerância do total impresso × calculado: 1 centavo por item (arredondamentos acumulados). */
export const TOTAL_TOLERANCE_CENTS_PER_ITEM = 1;

export interface LayoutRowReconciliation {
  row:                    number;
  validQuotes:            number;
  calculatedAverageCents: Cents | null;
  documentAverageCents:   Cents | null;
  averageMatches:         boolean | null;
  calculatedTotalCents:   Cents | null;
}

export interface LayoutTableValidation {
  page:                 number;
  tableIndex:           number;
  itemRows:             number;
  validQuotes:          number;
  documentTotalCents:   Cents | null;
  calculatedTotalCents: Cents;
  totalMatches:         boolean | null;
  averageChecks:        number;
  averageMismatches:    number;
  rows:                 LayoutRowReconciliation[];
}

export interface LayoutTableOutcome extends TabularOutcome {
  validation: LayoutTableValidation;
  /** Tabela efetivamente usada (com cabeçalho inferido pela estrutura, quando for o caso). */
  table:      NormalizedTableMatrix;
}

/** Coluna de MÉDIA impressa (conferência) — semântica genérica do cabeçalho, nunca preço de cotação. */
function averageColumn(headerNorm: string[]): number {
  return headerNorm.findIndex((h) => /\bMEDIA\b|\bMEDIO\b/.test(h));
}

/** Valor do total impresso: coluna de total da tabela, senão o último valor da linha de resumo. */
function documentTotal(table: NormalizedTableMatrix, totalCol: number): Cents | null {
  for (const s of table.summaryRows) {
    const cell = totalCol >= 0 && s.cells[totalCol] ? s.cells[totalCol] : [...s.cells].reverse().find((c) => c !== "");
    if (!cell) continue;
    const p = parseBRLDetailed(cell);
    if (p.cents !== null) return p.cents;
  }
  return null;
}

/**
 * Formato monetário ESTRITO de documento (pt-BR "1.234,56"/"234,56", milhar "1.234", decimal "18.90", inteiro).
 * O contrato monetário aceita formas mais largas (ex.: "1.14000" = 1,14); aqui elas são tratadas como
 * AMBÍGUAS — típicas de OCR que perdeu a vírgula — e nunca entram na inferência estrutural.
 */
const STRICT_MONEY_RE = /^(?:R\$\s?)?-?(?:\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+,\d{2}|\d+\.\d{2}|\d+)$/;
export function isStrictMoneyText(v: string | null | undefined): boolean {
  return STRICT_MONEY_RE.test((v ?? "").trim());
}
const moneyCents = (v: string | undefined): Cents | null => {
  if (!isStrictMoneyText(v)) return null;
  const p = parseBRLDetailed(v ?? "");
  return p.cents !== null && p.cents > 0 ? p.cents : null;
};

/**
 * Tabela SEM cabeçalho legível (ex.: rótulos em texto vertical que o OCR não leu): papéis inferidos pela
 * ESTRUTURA, sem palavra-chave do documento —
 *   descrição = coluna textual de texto mais longo; unidade = coluna textual curta; quantidade = 1ª coluna de
 *   valores após a descrição; MÉDIA = coluna cujos valores são a média (contrato monetário, ±1 centavo) das
 *   demais colunas de valor na mesma linha; TOTAL = coluna idêntica a quantidade × média; percentual = coluna "%".
 * As colunas restantes são FONTES sem identidade (rótulo sintético ⇒ fornecedor nunca inventado + aviso).
 * Retorna null quando a estrutura não é conclusiva (o extrator usa a ordem posicional, com aviso).
 */
export function inferHeaderlessRoles(table: NormalizedTableMatrix): { header: string[]; synthesized: boolean[] } | null {
  const C = table.columnKinds.length;
  const rows = table.rows;
  const meanLen = (c: number) => { const v = rows.map((r) => r[c]).filter(Boolean); return v.length ? v.reduce((a, x) => a + x.length, 0) / v.length : 0; };
  const moneyShare = (c: number) => { const v = rows.map((r) => r[c]).filter(Boolean); return v.length ? v.filter((x) => moneyCents(x) !== null).length / v.length : 0; };
  const textCols = [...Array(C).keys()].filter((c) => table.columnKinds[c] === "text");
  if (textCols.length === 0) return null;
  const desc = textCols.reduce((best, c) => (meanLen(c) > meanLen(best) ? c : best), textCols[0]);
  if (meanLen(desc) < 6) return null;
  const unitCands = textCols.filter((c) => c !== desc && meanLen(c) <= 12);
  const unit = unitCands.find((c) => c > desc) ?? unitCands[0] ?? -1;
  const after = Math.max(desc, unit);
  const valueCols = [...Array(C).keys()].filter((c) => c > after && table.columnKinds[c] !== "percent" && table.columnKinds[c] !== "text" && moneyShare(c) >= 0.5);
  if (valueCols.length === 0) return null;
  const qty = valueCols.length >= 2 ? valueCols[0] : -1;
  let rest = valueCols.filter((c) => c !== qty);

  // Coluna DERIVADA (média das demais): testada da direita para a esquerda; colunas gêmeas (mesmos valores,
  // ex.: total com quantidade 1) ficam fora do conjunto de comparação.
  const same = (a: number, b: number) => {
    const pairs = rows.map((r) => [moneyCents(r[a]), moneyCents(r[b])]).filter(([x, y]) => x !== null && y !== null);
    return pairs.length > 0 && pairs.filter(([x, y]) => Math.abs(x! - y!) <= AVERAGE_TOLERANCE_CENTS).length / pairs.length >= 0.8;
  };
  let avg = -1;
  let twins: number[] = [];
  for (const c of [...rest].reverse()) {
    const tw = rest.filter((o) => o !== c && same(o, c));
    const others = rest.filter((o) => o !== c && !tw.includes(o));
    let tested = 0, hits = 0;
    for (const r of rows) {
      const v = moneyCents(r[c]);
      const vals = others.map((o) => moneyCents(r[o])).filter((x): x is Cents => x !== null);
      if (v === null || vals.length < 2) continue;
      tested++;
      if (Math.abs(averageCents(vals) - v) <= AVERAGE_TOLERANCE_CENTS) hits++;
    }
    if (tested > 0 && hits / tested >= 0.8) { avg = c; twins = tw; break; }
  }
  // Total = quantidade × média (gêmea quando a quantidade é 1, ou múltiplo exato).
  const total = avg < 0 ? -1 : rest.find((c) => c !== avg && rows.every((r) => {
    const t = moneyCents(r[c]), a = moneyCents(r[avg]);
    if (t === null || a === null) return true;
    const q = qty >= 0 ? normalizeDecimal(r[qty] ?? "") : null;
    return Math.abs(multiplyQuantityCents(q ?? "1", a) - t) <= AVERAGE_TOLERANCE_CENTS;
  }) && (twins.includes(c) || qty >= 0)) ?? -1;
  rest = rest.filter((c) => c !== avg && c !== total);
  if (rest.length === 0) return null;

  const header = [...Array(C).keys()].map((c) => `Coluna ${c + 1}`);
  const synthesized = Array<boolean>(C).fill(true);
  const set = (c: number, label: string) => { if (c >= 0) { header[c] = label; synthesized[c] = false; } };
  const index = [...Array(C).keys()].find((c) => c < desc && table.columnKinds[c] === "integer") ?? -1;
  set(index, "Item");
  set(desc, "Descrição");
  set(unit, "Unidade");
  set(qty, "Quantidade");
  set(avg, "Média");
  set(total, "Valor Total");
  table.columnKinds.forEach((k, c) => { if (k === "percent") set(c, "Percentual"); });
  if (rest.length === 1) set(rest[0], "Valor Unitário");
  return { header, synthesized };
}

export function extractItemsFromLayoutTable(
  tableIn: NormalizedTableMatrix, ctx: TabularContext, o: { tableIndex: number; source: PositionedTextSource },
): LayoutTableOutcome {
  // Sem cabeçalho (ou cabeçalho sem coluna de descrição reconhecível): papéis pela estrutura, com aviso.
  let table = tableIn;
  const inferenceWarnings: ImportWarning[] = [];
  const headerUsable = table.header && mapHeaderColumns(table.header.map(normalizeHeader)).description >= 0;
  if (!headerUsable) {
    const inferred = inferHeaderlessRoles(table);
    if (inferred) {
      table = { ...table, header: inferred.header, headerSynthesized: inferred.synthesized };
      inferenceWarnings.push({ code: "LAYOUT_HEADER_INFERRED", severity: "warning", location: `page:${table.page}`, message: "Cabeçalho da tabela não legível: papéis das colunas inferidos pela estrutura (descrição, unidade, quantidade, média, total); fontes sem identificação — confira na revisão." });
    }
  }
  const offset = table.header ? 1 : 0;
  const matrix = table.header ? [table.header, ...table.rows] : table.rows;
  const out = tableToRawItems(
    matrix, ctx, { positionalFallback: "five_columns", headerRow: table.header ? 0 : undefined, noHeader: !table.header },
    (r, col) => ({ location: { page: table.page, row: r + 1, ...(col === undefined ? {} : { column: col + 1 }) }, extras: { tableIndex: o.tableIndex } }),
  );

  const headerNorm = (table.header ?? []).map(normalizeHeader);
  const roles = table.header ? mapHeaderColumns(headerNorm) : null;
  const avgCol = averageColumn(headerNorm);
  const qtyCol = roles?.quantity ?? -1;

  const byRow = new Map<number, RawExtractedItem[]>();
  for (const item of out.items) {
    const r = (item.sourceLocation.location.row ?? 0) - 1 - offset;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(item);
  }

  const rows: LayoutRowReconciliation[] = [];
  let validQuotes = 0, calculatedTotal = 0, averageMismatches = 0, averageChecks = 0;
  for (const [r, items] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const meta = table.rowMeta[r];
    const cells = table.rows[r];
    if (!meta || !cells) continue;

    // Cotações válidas = valores que o contrato monetário aceita (> 0). "/////" já é célula vazia.
    const quoteCents: Cents[] = [];
    for (const it of items) {
      const c = moneyCents(it.rawUnitPrice ?? undefined);
      if (c !== null) quoteCents.push(c);
    }
    const calculatedAverage = quoteCents.length ? averageCents(quoteCents) : null;
    const docAvg = avgCol >= 0 ? parseBRLDetailed(cells[avgCol] ?? "").cents : null;
    const averageMatches = calculatedAverage !== null && docAvg !== null ? Math.abs(calculatedAverage - docAvg) <= AVERAGE_TOLERANCE_CENTS : null;
    const qty = qtyCol >= 0 ? normalizeDecimal(cells[qtyCol] ?? "") : null;
    const rowTotal = calculatedAverage === null ? null : multiplyQuantityCents(qty ?? "1", calculatedAverage);
    validQuotes += quoteCents.length;
    if (rowTotal !== null) calculatedTotal += rowTotal;
    if (averageMatches !== null) { averageChecks++; if (!averageMatches) averageMismatches++; }
    const recon: LayoutRowReconciliation = {
      row: r + 1, validQuotes: quoteCents.length, calculatedAverageCents: calculatedAverage,
      documentAverageCents: docAvg, averageMatches, calculatedTotalCents: rowTotal,
    };
    rows.push(recon);

    const discarded = meta.discarded.map((d) => ({ column: table.header?.[d.column] ?? `Coluna ${d.column + 1}`, raw: d.raw, reason: d.reason }));
    for (const item of items) {
      const warnings: ExtractionWarning[] = [];
      const col = typeof item.sourceLocation.location.column === "number" ? item.sourceLocation.location.column - 1 : undefined;
      // Fonte/fornecedor sem rótulo legível: o valor é preservado, a identidade NÃO é inventada.
      if (col !== undefined && table.headerSynthesized[col] && item.rawSupplier) {
        item.rawSupplier = null;
        warnings.push({ code: "SOURCE_IDENTITY_UNRESOLVED", severity: "warning", field: "supplier", message: `A fonte da cotação (coluna ${col + 1}) não foi identificada no cabeçalho; o valor foi preservado — informe a fonte na revisão.` });
      }
      if (meta.mergedContinuation) {
        warnings.push({ code: "LAYOUT_MULTILINE_MERGED", severity: "info", field: "description", message: `Descrição montada a partir de ${meta.physicalRows} linhas do documento.` });
      }
      if (discarded.length > 0) {
        const unreadable = meta.discarded.some((d) => d.reason === "non_numeric");
        warnings.push({
          code: "LAYOUT_PLACEHOLDER_DISCARDED", severity: unreadable ? "warning" : "info",
          message: unreadable
            ? `${discarded.length} célula(s) desta linha sem valor numérico legível desconsiderada(s) — confira no documento original.`
            : `${discarded.length} célula(s) com marcador de ausência nesta linha desconsiderada(s) (não são preço).`,
        });
      }
      if (meta.spansColumns) {
        warnings.push({ code: "MERGED_CELL", severity: "warning", message: "Um trecho desta linha ocupa mais de uma coluna — confira a atribuição das colunas." });
      }
      const price = item.rawUnitPrice ?? null;
      if (price && (parseBRLDetailed(price).reason === "ambiguous" || (/\d/.test(price) && !isStrictMoneyText(price)))) {
        warnings.push({ code: "AMBIGUOUS_MONEY_VALUE", severity: "warning", field: "unit_price", rawValue: String(item.rawUnitPrice).slice(0, 80), message: "Valor ambíguo pelo contrato monetário — não foi interpretado; corrija na revisão." });
      }
      if (averageMatches === false) {
        warnings.push({
          code: "DOCUMENT_AVERAGE_MISMATCH", severity: "warning", field: "unit_price",
          message: `Média impressa no documento (${cells[avgCol]}) difere da média calculada das ${quoteCents.length} cotações válidas — confira as cotações.`,
        });
      }
      item.extractionWarnings = [...item.extractionWarnings, ...warnings];
      if (warnings.some((w) => w.severity === "warning")) item.confidenceMetadata.requiresReview = true;
      item.parserMetadata = { ...item.parserMetadata, layoutVersion: PDF_LAYOUT_VERSION, textSource: o.source };
      item.rawMetadata = {
        ...item.rawMetadata,
        layout: {
          version: PDF_LAYOUT_VERSION, page: table.page, tableIndex: o.tableIndex, row: r + 1,
          lineText: meta.lineText.slice(0, 2000), bbox: meta.bbox, physicalRows: meta.physicalRows,
          discardedCells: discarded, reconciliation: recon,
        },
      };
    }
  }

  const docTotal = documentTotal(table, roles?.totalPrice ?? -1);
  const totalMatches = docTotal === null ? null : Math.abs(docTotal - calculatedTotal) <= TOTAL_TOLERANCE_CENTS_PER_ITEM * Math.max(1, rows.length);
  const warnings: ImportWarning[] = [...inferenceWarnings, ...out.warnings.map((w) => ({ ...w, location: w.location ?? `page:${table.page}` }))];
  // Nenhuma perda SILENCIOSA: coluna com valores monetários que não virou cotação nem tem papel conhecido
  // (quantidade, média, total, preço) é sinalizada para a revisão (ex.: coluna com leitura ruidosa no OCR).
  if (table.header) {
    const known = new Set([roles?.quantity, roles?.totalPrice, roles?.unitPrice, roles?.description, roles?.unit, avgCol].filter((c): c is number => c !== undefined && c >= 0));
    headerNorm.forEach((h, c) => { if (isStatHeader(h)) known.add(c); });
    const expanded = new Set(out.items.map((i) => i.sourceLocation.location.column).filter((c): c is number => typeof c === "number").map((c) => c - 1));
    const lost = table.header.map((_, c) => c).filter((c) => !known.has(c) && !expanded.has(c) && table.columnKinds[c] !== "percent" && table.columnKinds[c] !== "integer"
      && table.rows.some((r) => moneyCents(r[c]) !== null));
    if (lost.length > 0) {
      warnings.push({
        code: "LAYOUT_VALUES_NOT_EXTRACTED", severity: "warning", location: `page:${table.page}`,
        message: `Coluna(s) ${lost.map((c) => `"${table.header![c]}"`).join(", ")} com valores monetários não viraram cotação (estrutura ou leitura inconsistente) — confira no documento original.`,
      });
    }
  }

  if (totalMatches === false) {
    warnings.push({ code: "TOTAL_RECONCILIATION_MISMATCH", severity: "warning", location: `page:${table.page}`, message: "O total impresso no documento difere do total calculado a partir das cotações válidas — confira antes de aprovar." });
  }
  if (averageMismatches > 0) {
    warnings.push({ code: "DOCUMENT_AVERAGE_MISMATCH", severity: "warning", location: `page:${table.page}`, message: `${averageMismatches} item(ns) com média impressa diferente da média calculada.` });
  }

  return {
    ...out, warnings, table,
    validation: {
      page: table.page, tableIndex: o.tableIndex, itemRows: rows.length, validQuotes, documentTotalCents: docTotal,
      calculatedTotalCents: calculatedTotal, totalMatches, averageChecks, averageMismatches, rows,
    },
  };
}

/** Avisos da reconstrução geométrica de uma página como avisos da importação. */
export function layoutWarningsToImport(result: PageLayoutResult): ImportWarning[] {
  return result.warnings.map((w) => ({ code: w.code, message: w.message, severity: w.severity, location: `page:${result.page}` }));
}
