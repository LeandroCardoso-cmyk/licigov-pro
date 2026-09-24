/**
 * U2A / U2A-OCR — Testes UNITÁRIOS (puros, sem motor de OCR e sem banco):
 *  - invariantes validItemCount === 0 ⇒ aprovar/promover PROIBIDO;
 *  - classificação determinística do desfecho da extração (OCR_REQUIRED / OCR_FAILED / PARSER_FAILED /
 *    NO_VALID_ITEMS / REVIEW_REQUIRED / READY_FOR_REVIEW);
 *  - heurística de "texto útil" (não é text.length > 0);
 *  - reconstrução de layout a partir de palavras com bbox (colunas, continuação, célula ambígua);
 *  - token numérico suspeito (nunca corrigido);
 *  - fingerprint de replay (estável e sensível a motor/versão/configuração);
 *  - configuração do OCR (limites e kill-switch).
 */
import { describe, it, expect } from "vitest";
import {
  assertSessionApprovable, assertSessionPromotable, classifyRowsOutcome, ImportInvariantViolation,
  OUTCOME_STAGE, isDeterministicParserError,
} from "../../domain/importOutcome";
import { assessPageText, assessDocumentText, MIN_USEFUL_CHARS } from "../../parsers/nativeTextAssessment";
import { buildOcrPageLayout, isSuspiciousNumericToken, groupWordsIntoRows } from "../../parsers/ocrLayout";
import { computeExtractionFingerprint, deriveExtractionMode } from "../../domain/extractionLineage";
import { resolveOcrConfig } from "../../config/ocr";
import type { OcrPageResult, OcrWord } from "../../domain/ocr";
import { detectWideFormat, mapHeaderColumns, normalizeHeader } from "../../parsers/tabularExtraction";

// ─── Invariantes ──────────────────────────────────────────────────────────────────

describe("invariantes de aprovação/promoção (validItemCount === 0 ⇒ proibido)", () => {
  it("sessão sem itens NÃO é aprovável", () => {
    expect(() => assertSessionApprovable({ total: 0, pending: 0, approved: 0 })).toThrow(ImportInvariantViolation);
    expect(() => assertSessionApprovable({ total: 0, pending: 0, approved: 0 })).toThrow(/NO_VALID_ITEMS_TO_APPROVE/);
  });
  it("sessão com todos os itens rejeitados/pulados NÃO é aprovável", () => {
    expect(() => assertSessionApprovable({ total: 3, pending: 0, approved: 0 })).toThrow(/NO_VALID_ITEMS_TO_APPROVE/);
  });
  it("revisão incompleta continua bloqueando (código explícito)", () => {
    expect(() => assertSessionApprovable({ total: 3, pending: 1, approved: 2 })).toThrow(/REVIEW_INCOMPLETE/);
  });
  it("≥1 item aprovado e zero pendentes ⇒ aprovável", () => {
    expect(() => assertSessionApprovable({ total: 3, pending: 0, approved: 1 })).not.toThrow();
  });
  it("promoção com zero itens válidos é PROIBIDA", () => {
    expect(() => assertSessionPromotable(0)).toThrow(/NO_VALID_ITEMS_TO_PROMOTE/);
    expect(() => assertSessionPromotable(1)).not.toThrow();
  });
  it("violação carrega o código de domínio", () => {
    try { assertSessionPromotable(0); } catch (e) { expect((e as ImportInvariantViolation).code).toBe("NO_VALID_ITEMS_TO_PROMOTE"); }
  });
});

// ─── Classificação do desfecho ─────────────────────────────────────────────────────

describe("classifyRowsOutcome — nunca revisão com zero itens", () => {
  const base = { itemCount: 0, warningCodes: [] as string[], itemsNeedAttention: false };
  it("zero itens + OCR_REQUIRED ⇒ OCR_REQUIRED", () => {
    expect(classifyRowsOutcome({ ...base, warningCodes: ["OCR_REQUIRED", "SCANNED_PDF_UNSUPPORTED"] })).toBe("OCR_REQUIRED");
  });
  it("zero itens + OCR_FAILED ⇒ OCR_FAILED (prevalece sobre OCR_REQUIRED)", () => {
    expect(classifyRowsOutcome({ ...base, warningCodes: ["OCR_FAILED", "OCR_REQUIRED"] })).toBe("OCR_FAILED");
  });
  it("zero itens sem OCR ⇒ NO_VALID_ITEMS", () => {
    expect(classifyRowsOutcome({ ...base, warningCodes: ["NO_ITEMS_EXTRACTED"] })).toBe("NO_VALID_ITEMS");
    expect(classifyRowsOutcome({ ...base, warningCodes: ["OCR_NO_ITEMS"] })).toBe("NO_VALID_ITEMS");
  });
  it("erro fatal determinístico ⇒ PARSER_FAILED; transitório ⇒ null (retry existente)", () => {
    expect(classifyRowsOutcome({ ...base, fatalCode: "CORRUPT_FILE" })).toBe("PARSER_FAILED");
    expect(classifyRowsOutcome({ ...base, fatalCode: "PROTECTED_PDF" })).toBe("PARSER_FAILED");
    expect(classifyRowsOutcome({ ...base, fatalCode: "PROCESSING_TIMEOUT" })).toBeNull();
    expect(isDeterministicParserError("PARSER_FAILURE")).toBe(false);
  });
  it("itens com atenção ⇒ REVIEW_REQUIRED; limpos ⇒ READY_FOR_REVIEW", () => {
    expect(classifyRowsOutcome({ itemCount: 2, warningCodes: [], itemsNeedAttention: true })).toBe("REVIEW_REQUIRED");
    expect(classifyRowsOutcome({ itemCount: 2, warningCodes: [], itemsNeedAttention: false })).toBe("READY_FOR_REVIEW");
  });
  it("estágios distinguíveis e estáveis", () => {
    expect(new Set(Object.values(OUTCOME_STAGE)).size).toBe(Object.keys(OUTCOME_STAGE).length);
    expect(OUTCOME_STAGE.READY_FOR_REVIEW).toBe("awaiting_review"); // compatível com o estágio anterior
  });
});

// ─── Heurística de texto útil ──────────────────────────────────────────────────────

describe("heurística determinística de texto útil (não é text.length > 0)", () => {
  it("carimbo/número de página isolado NÃO é texto útil", () => {
    expect(assessPageText(1, "-- 1 of 3 --", false).useful).toBe(false);
    expect(assessPageText(1, "Fl. 12", false).useful).toBe(false);
    expect(assessPageText(1, "", false).reason).toBe("no_text");
  });
  it("página com tabela estruturada é útil mesmo com pouco texto", () => {
    expect(assessPageText(1, "x", true)).toMatchObject({ useful: true, reason: "tables" });
  });
  it("texto real com palavras suficientes é útil", () => {
    const a = assessPageText(1, "Cadeira giratória UN 10 1.234,56 12.345,60 Mesa de reunião UN 2 850,00", false);
    expect(a.usefulChars).toBeGreaterThanOrEqual(MIN_USEFUL_CHARS);
    expect(a.useful).toBe(true);
  });
  it("documento: suficiente só quando TODAS as páginas têm texto útil", () => {
    const d = assessDocumentText([{ num: 1, text: "Cadeira giratória UN 10 1.234,56 12.345,60 Mesa" }, { num: 2, text: "" }], new Map());
    expect(d.sufficient).toBe(false);
    expect(d.pagesWithout).toBe(1);
  });
});

// ─── Layout OCR ────────────────────────────────────────────────────────────────────

/** Palavras sintéticas: cada célula é colocada em x fixo por coluna (fonte ~10px/char, linha 24px). */
function page(rows: string[][], colX: number[], opts: { conf?: (r: number, c: number) => number; y0?: number } = {}): OcrPageResult {
  const words: OcrWord[] = [];
  rows.forEach((cells, r) => cells.forEach((cell, c) => {
    if (!cell) return;
    let x = colX[c];
    for (const t of cell.split(" ")) {
      words.push({ text: t, confidence: opts.conf?.(r, c) ?? 95, bbox: { x0: x, y0: (opts.y0 ?? 100) + r * 30, x1: x + t.length * 10, y1: (opts.y0 ?? 100) + r * 30 + 20 } });
      x += t.length * 10 + 6; // espaço simples ≈ 0,6 char
    }
  }));
  return { pageNumber: 1, text: rows.map((r) => r.join(" ")).join("\n"), confidence: 90, width: 1700, height: 2200, lines: [{ text: "", confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words }], durationMs: 1, warnings: [] };
}

const X = [40, 120, 520, 640, 800, 1000];

describe("reconstrução de layout a partir do OCR (geometria, sem inferência de conteúdo)", () => {
  it("cabeçalho reconhecido ⇒ matriz com colunas pela posição", () => {
    const l = buildOcrPageLayout(page([
      ["Item", "Descrição", "Unidade", "Quantidade", "Valor Unitário", "Valor Total"],
      ["1", "Cadeira giratória", "UN", "10", "R$ 1.234,56", "12.345,60"],
      ["2", "Papel A4 resma", "CX", "12,5", "23,90", "298,75"],
    ], X));
    expect(l.kind).toBe("table");
    if (l.kind !== "table") return;
    expect(l.matrix[1]).toEqual(["1", "Cadeira giratória", "UN", "10", "R$ 1.234,56", "12.345,60"]);
    expect(l.matrix[2][3]).toBe("12,5");
  });
  it("descrição quebrada em duas linhas físicas é unida e sinalizada", () => {
    const l = buildOcrPageLayout(page([
      ["Item", "Descrição", "Unidade", "Quantidade", "Valor Unitário", "Valor Total"],
      ["1", "Cadeira giratória com", "UN", "10", "1.234,56", "12.345,60"],
      ["", "braços reguláveis", "", "", "", ""],
    ], X));
    if (l.kind !== "table") throw new Error("esperava tabela");
    expect(l.matrix).toHaveLength(2);
    expect(l.matrix[1][1]).toBe("Cadeira giratória com braços reguláveis");
    expect(l.rowMeta[1].mergedContinuation).toBe(true);
  });
  it("sem cabeçalho ⇒ linhas com colunas separadas por espaços largos", () => {
    const l = buildOcrPageLayout(page([["Cadeira giratória", "UN", "10", "1.234,56", "12.345,60"]], X.slice(1)));
    expect(l.kind).toBe("lines");
    if (l.kind === "lines") expect(l.lines[0]).toMatch(/Cadeira giratória {3}UN {3}10/);
  });
  it("confiança por célula = mínimo das palavras", () => {
    const l = buildOcrPageLayout(page([
      ["Item", "Descrição", "Unidade", "Quantidade", "Valor Unitário", "Valor Total"],
      ["1", "Cadeira", "UN", "10", "1.234,56", "12.345,60"],
    ], X, { conf: (r, c) => (r === 1 && c === 4 ? 41 : 96) }));
    if (l.kind !== "table") throw new Error("esperava tabela");
    expect(l.rowMeta[1].confidence[4]).toBe(41);
  });
  it("página sem palavras ⇒ empty", () => {
    expect(buildOcrPageLayout({ pageNumber: 3, text: "", confidence: 0, width: 1, height: 1, lines: [], durationMs: 0, warnings: [] }).kind).toBe("empty");
  });
  it("agrupamento por linha independe da ordem das palavras", () => {
    const p = page([["a1", "b1"], ["a2", "b2"]], [10, 300]);
    const shuffled = [...p.lines[0].words].reverse();
    expect(groupWordsIntoRows(shuffled).map((r) => r.map((w) => w.text))).toEqual([["a1", "b1"], ["a2", "b2"]]);
  });
});

describe("mapa comparativo: coluna de numeração nunca vira fornecedor", () => {
  it("cabeçalho de índice mal lido ('tem' em vez de 'Item') com valores 1,2,3 não é coluna de preço", () => {
    const headers = ["tem", "Descricao", "Unidade", "Qtd", "Empresa Alfa", "Empresa Beta"];
    const rows = [["1", "Cadeira", "UN", "10", "1.198,00", "1.250,00"], ["2", "Mesa", "UN", "2", "850,00", "910,50"], ["3", "Papel", "CX", "5", "20,00", "21,00"]];
    const wide = detectWideFormat(headers, rows, mapHeaderColumns(headers.map(normalizeHeader)));
    expect(wide).toEqual({ kind: "wide", supplierColumns: [4, 5] });
  });
});

describe("token numérico suspeito (OCR) — sinaliza, nunca corrige", () => {
  it.each(["1.2O4,56", "l0,00", "R$ 1.2S4,00", "85O,00"])("%s é suspeito", (v) => expect(isSuspiciousNumericToken(v)).toBe(true));
  it.each(["1.234,56", "1234,56", "R$ 1.234,56", "12,5", "UN", "Papel A4", ""])("%s não é suspeito", (v) => expect(isSuspiciousNumericToken(v)).toBe(false));
});

// ─── Fingerprint / linhagem ────────────────────────────────────────────────────────

describe("fingerprint de replay", () => {
  const ocr = { engine: "tesseract.js", engineVersion: "7.0.0", coreVersion: "7.0.0", language: "por", languageDataVersion: "por@1.0.0/4.0.0", config: { psm: "6", oem: 1 }, renderWidth: 2000, layoutVersion: "1" };
  const base = { sourceChecksum: "A".repeat(64), parserType: "pdf", parserVersion: "2.2.0", heuristicVersion: "1", layoutVersion: "2", pageModes: { "2": "ocr" as const, "1": "native_text" as const }, ocr };
  it("estável (mesma entrada ⇒ mesmo hash; checksum case-insensitive; ordem de páginas irrelevante)", () => {
    const a = computeExtractionFingerprint(base);
    const b = computeExtractionFingerprint({ ...base, sourceChecksum: "a".repeat(64), pageModes: { "1": "native_text", "2": "ocr" }, ocr: { ...ocr, config: { oem: 1, psm: "6" } } });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ["checksum", { sourceChecksum: "b".repeat(64) }],
    ["versão do parser", { parserVersion: "2.3.0" }],
    ["heurística", { heuristicVersion: "2" }],
    ["versão da reconstrução geométrica (layout)", { layoutVersion: "3" }],
    ["versão do motor", { ocr: { ...ocr, engineVersion: "7.1.0" } }],
    ["idioma", { ocr: { ...ocr, language: "eng" } }],
    ["configuração", { ocr: { ...ocr, config: { psm: "4", oem: 1 } } }],
    ["renderização", { ocr: { ...ocr, renderWidth: 2400 } }],
    ["modo por página", { pageModes: { "1": "native_text" as const, "2": "skipped" as const } }],
  ])("muda quando muda %s", (_label, over) => {
    expect(computeExtractionFingerprint({ ...base, ...over })).not.toBe(computeExtractionFingerprint(base));
  });
  it("modo derivado: native_text / ocr / mixed", () => {
    expect(deriveExtractionMode({ "1": "native_text" })).toBe("native_text");
    expect(deriveExtractionMode({ "1": "ocr", "2": "skipped" })).toBe("ocr");
    expect(deriveExtractionMode({ "1": "ocr", "2": "native_text" })).toBe("mixed");
  });
});

// ─── Configuração ──────────────────────────────────────────────────────────────────

describe("configuração do OCR (sem segredo; limites com teto)", () => {
  it("defaults: ligado fora de teste; desligado na suíte", () => {
    expect(resolveOcrConfig({}, { isTest: false })).toMatchObject({ enabled: true, maxPages: 20, timeoutMs: 180_000, renderWidth: 2000, maxConcurrency: 1 });
    expect(resolveOcrConfig({}, { isTest: true }).enabled).toBe(false);
  });
  it("kill-switch explícito e limites aplicados", () => {
    expect(resolveOcrConfig({ OCR_ENABLED: "false" }, { isTest: false }).enabled).toBe(false);
    const c = resolveOcrConfig({ OCR_MAX_PAGES: "999", OCR_TIMEOUT_MS: "1", OCR_RENDER_WIDTH: "99999", OCR_MAX_CONCURRENCY: "8" }, { isTest: false });
    expect(c).toMatchObject({ maxPages: 100, timeoutMs: 5_000, renderWidth: 3000, maxConcurrency: 2 });
  });
});
