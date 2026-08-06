import { describe, it, expect, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../db/connection", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/observabilityService", () => ({
  serviceLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn((_op: string, fn: () => Promise<unknown>) => fn()),
    span:  vi.fn((_op: string, fn: () => Promise<unknown>) => fn().then((r: unknown) => ({ result: r, durationMs: 1, slow: false }))),
  }),
  structuredLog: vi.fn(),
  timed: vi.fn((_s: string, _o: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  logFromCtx:  vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  detectParserType,
  isValidImportTransition,
  isTerminalStatus,
  canRetry,
} from "../../domain/importTypes";

import {
  buildProvenance,
  formatLocation,
} from "../../domain/importProvenance";

import {
  scoreToLevel,
  buildFieldConfidence,
  aggregateConfidence,
  EMPTY_CONFIDENCE,
} from "../../domain/importConfidence";

import {
  createRawItem,
  summarizeItems,
} from "../../domain/importExtraction";

import {
  normalizeUnit,
} from "../../domain/canonicalUnits";

import {
  validateFile,
} from "../../services/fileIngestionService";

import { CsvParser } from "../../parsers/csvParser";
import { XlsxParser } from "../../parsers/xlsxParser";
import { PdfParser } from "../../parsers/pdfParser";
import { DocxParser } from "../../parsers/docxParser";
import { ParserRegistry } from "../../parsers/parserRegistry";

// ─── ImportTypes ──────────────────────────────────────────────────────────────

describe("importTypes — detectParserType", () => {
  it("detecta xlsx por mime", () => {
    expect(detectParserType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "arq.xlsx")).toBe("xlsx");
  });

  it("detecta csv por mime", () => {
    expect(detectParserType("text/csv", "dados.csv")).toBe("csv");
  });

  it("detecta pdf por mime", () => {
    expect(detectParserType("application/pdf", "doc.pdf")).toBe("pdf");
  });

  it("detecta xlsx por extensão quando mime genérico", () => {
    expect(detectParserType("application/octet-stream", "planilha.xlsx")).toBe("xlsx");
  });

  it("retorna null para formato não suportado", () => {
    expect(detectParserType("image/png", "foto.png")).toBeNull();
  });
});

describe("importTypes — ALLOWED_MIME_TYPES", () => {
  it("tem xlsx registrado", () => {
    expect(ALLOWED_MIME_TYPES["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]).toBe("xlsx");
  });

  it("tem csv registrado", () => {
    expect(ALLOWED_MIME_TYPES["text/csv"]).toBe("csv");
  });

  it("tem pdf registrado", () => {
    expect(ALLOWED_MIME_TYPES["application/pdf"]).toBe("pdf");
  });
});

describe("importTypes — MAX_FILE_SIZE_BYTES", () => {
  it("é 50MB", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("importTypes — isValidImportTransition", () => {
  it("uploaded → queued é válido", () => {
    expect(isValidImportTransition("uploaded", "queued")).toBe(true);
  });

  it("queued → parsing é válido", () => {
    expect(isValidImportTransition("queued", "parsing")).toBe(true);
  });

  it("parsing → extracted é válido", () => {
    expect(isValidImportTransition("parsing", "extracted")).toBe(true);
  });

  it("approved → queued é inválido", () => {
    expect(isValidImportTransition("approved", "queued")).toBe(false);
  });

  it("failed → queued (retry) é válido", () => {
    expect(isValidImportTransition("failed", "queued")).toBe(true);
  });
});

describe("importTypes — isTerminalStatus", () => {
  it("approved é terminal", () => {
    expect(isTerminalStatus("approved")).toBe(true);
  });

  it("archived é terminal", () => {
    expect(isTerminalStatus("archived")).toBe(true);
  });

  it("rejected NÃO é terminal (pode ser reprocessado via uploaded)", () => {
    expect(isTerminalStatus("rejected")).toBe(false);
  });

  it("queued não é terminal", () => {
    expect(isTerminalStatus("queued")).toBe(false);
  });

  it("parsing não é terminal", () => {
    expect(isTerminalStatus("parsing")).toBe(false);
  });
});

describe("importTypes — canRetry", () => {
  it("pode retry quando failed e abaixo do limite", () => {
    expect(canRetry("failed", 1)).toBe(true);
  });

  it("não pode retry quando esgotou tentativas", () => {
    expect(canRetry("failed", 3)).toBe(false);
  });

  it("não pode retry quando não está em failed", () => {
    expect(canRetry("queued", 0)).toBe(false);
  });
});

// ─── ImportProvenance ─────────────────────────────────────────────────────────

describe("importProvenance — buildProvenance", () => {
  it("retorna provenance com campos obrigatórios", () => {
    const prov = buildProvenance("file-1", "planilha.csv", "text/csv", "abc123", "csv", "1.0.0", { row: 5 });
    expect(prov.sourceFileId).toBe("file-1");
    expect(prov.sourceFileName).toBe("planilha.csv");
    expect(prov.parserType).toBe("csv");
    expect(prov.location).toEqual({ row: 5 });
    expect(typeof prov.extractedAt).toBe("string");
    expect(new Date(prov.extractedAt).getTime()).toBeGreaterThan(0);
  });

  it("inclui extras quando fornecidos", () => {
    const prov = buildProvenance("f1", "a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "", "xlsx", "1.0.0", { sheet: "Planilha1", row: 2, col: 3 }, { sectionTitle: "ITENS" });
    expect(prov.sectionTitle).toBe("ITENS");
    expect(prov.location.sheet).toBe("Planilha1");
  });
});

describe("importProvenance — formatLocation", () => {
  it("formata localização de linha simples", () => {
    expect(formatLocation({ row: 10 })).toContain("10");
  });

  it("formata localização de sheet+row", () => {
    const formatted = formatLocation({ sheet: "Planilha1", row: 5 });
    expect(formatted).toContain("Planilha1");
    expect(formatted).toContain("5");
  });
});

// ─── ImportConfidence ─────────────────────────────────────────────────────────

describe("importConfidence — scoreToLevel", () => {
  it("≥0.85 é high", () => {
    expect(scoreToLevel(0.9)).toBe("high");
    expect(scoreToLevel(0.85)).toBe("high");
  });

  it("≥0.60 é medium", () => {
    expect(scoreToLevel(0.75)).toBe("medium");
    expect(scoreToLevel(0.60)).toBe("medium");
  });

  it("≥0.35 é low", () => {
    expect(scoreToLevel(0.50)).toBe("low");
    expect(scoreToLevel(0.35)).toBe("low");
  });

  it("<0.35 é uncertain", () => {
    expect(scoreToLevel(0.10)).toBe("uncertain");
  });
});

describe("importConfidence — buildFieldConfidence", () => {
  it("retorna FieldConfidence com score e level", () => {
    const fc = buildFieldConfidence("description", 0.9);
    expect(fc.field).toBe("description");
    expect(fc.score).toBe(0.9);
    expect(fc.level).toBe("high");
  });

  it("inclui reasons quando fornecidos", () => {
    const fc = buildFieldConfidence("quantity", 0.5, ["header_match"]);
    expect(fc.reasons).toContain("header_match");
  });
});

describe("importConfidence — aggregateConfidence", () => {
  it("agrega múltiplos campos corretamente", () => {
    const fields = [
      buildFieldConfidence("description", 0.9),
      buildFieldConfidence("quantity",    0.8),
      buildFieldConfidence("unit",        0.7),
    ];
    const meta = aggregateConfidence(fields);
    expect(meta.overallScore).toBeGreaterThan(0);
    expect(meta.overallLevel).toBeDefined();
    expect(meta.fieldConfidences).toHaveLength(3);
  });

  it("retorna uncertain para array vazio", () => {
    const meta = aggregateConfidence([]);
    expect(meta.overallScore).toBe(0);
    expect(meta.overallLevel).toBe("uncertain");
  });
});

describe("importConfidence — EMPTY_CONFIDENCE", () => {
  it("tem score 0 e level uncertain", () => {
    expect(EMPTY_CONFIDENCE.overallScore).toBe(0);
    expect(EMPTY_CONFIDENCE.overallLevel).toBe("uncertain");
  });
});

// ─── ImportExtraction ─────────────────────────────────────────────────────────

describe("importExtraction — createRawItem", () => {
  it("cria item com id uuid", () => {
    const prov    = buildProvenance("f1", "a.csv", "text/csv", "", "csv", "1.0.0", { row: 1 });
    const conf    = aggregateConfidence([buildFieldConfidence("description", 0.9)]);
    const meta    = { parserType: "csv", parserVersion: "1.0.0", processingMs: 1, rawCellValues: {}, inferredHeaders: [] };
    const item    = createRawItem(1, { rawDescription: "Caneta azul", rawQuantity: "10", rawUnit: "UN", rawUnitPrice: null, rawTotalPrice: null }, prov, meta, conf);
    expect(item.id).toBeTruthy();
    expect(item.rawDescription).toBe("Caneta azul");
    expect(item.importSessionId).toBe(1);
  });
});

describe("importExtraction — summarizeItems", () => {
  it("resume lista de items", () => {
    const prov = buildProvenance("f1", "a.csv", "text/csv", "", "csv", "1.0.0", { row: 1 });
    const confHigh = aggregateConfidence([buildFieldConfidence("description", 0.9), buildFieldConfidence("quantity", 0.85)]);
    const confLow  = aggregateConfidence([buildFieldConfidence("description", 0.2)]);
    const meta = { parserType: "csv", parserVersion: "1.0.0", processingMs: 1, rawCellValues: {}, inferredHeaders: [] };
    const items = [
      createRawItem(1, { rawDescription: "Item A", rawQuantity: "5", rawUnit: "UN", rawUnitPrice: null, rawTotalPrice: null }, prov, meta, confHigh),
      createRawItem(1, { rawDescription: "Item B", rawQuantity: null, rawUnit: null, rawUnitPrice: null, rawTotalPrice: null }, prov, meta, confLow),
    ];
    const summary = summarizeItems(items);
    expect(summary.total).toBe(2);
    expect(summary.avgConfidence).toBeGreaterThan(0);
  });
});

// ─── CanonicalUnits ───────────────────────────────────────────────────────────

describe("canonicalUnits — normalizeUnit", () => {
  it("normaliza UN", () => {
    const r = normalizeUnit("UN");
    expect(r.canonical).toBe("UN");
    expect(r.source).toBe("exact");
  });

  it("normaliza unidade (alias)", () => {
    const r = normalizeUnit("unidade");
    expect(r.canonical).toBe("UN");
  });

  it("normaliza KG", () => {
    const r = normalizeUnit("KG");
    expect(r.canonical).toBe("KG");
  });

  it("normaliza kg (case insensitive)", () => {
    const r = normalizeUnit("kg");
    expect(r.canonical).toBe("KG");
  });

  it("normaliza CX", () => {
    const r = normalizeUnit("CX");
    expect(r.canonical).toBe("CX");
  });

  it("normaliza caixa (alias)", () => {
    const r = normalizeUnit("caixa");
    expect(r.canonical).toBe("CX");
  });

  it("normaliza L (litro)", () => {
    const r = normalizeUnit("L");
    expect(r.canonical).toBe("L");
  });

  it("normaliza litro (alias)", () => {
    const r = normalizeUnit("litro");
    expect(r.canonical).toBe("L");
  });

  it("normaliza M (metro)", () => {
    const r = normalizeUnit("M");
    expect(r.canonical).toBe("M");
  });

  it("normaliza PCT (pacote)", () => {
    const r = normalizeUnit("PCT");
    expect(r.canonical).toBe("PCT");
  });

  it("normaliza pacote (alias)", () => {
    const r = normalizeUnit("pacote");
    expect(r.canonical).toBe("PCT");
  });

  it("retorna sem match para unidade desconhecida", () => {
    const r = normalizeUnit("XYZABC");
    expect(r.canonical).toBeNull();
    expect(r.matched).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it("retorna unknown para null", () => {
    const r = normalizeUnit(null);
    expect(r.canonical).toBeNull();
  });

  it("retorna unknown para string vazia", () => {
    const r = normalizeUnit("");
    expect(r.canonical).toBeNull();
  });

  it("strip pontos via fuzzy: U.N. → UN", () => {
    const r = normalizeUnit("U.N.");
    expect(r.canonical).toBe("UN");
  });
});

// ─── FileIngestionService — validateFile ──────────────────────────────────────

describe("fileIngestionService — validateFile", () => {
  it("rejeita buffer vazio", () => {
    const result = validateFile(Buffer.alloc(0), "text/csv", "dados.csv");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/vazio/i);
    expect(result.checksum).toBeTruthy();
  });

  it("rejeita arquivo acima do limite", () => {
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
    const result = validateFile(big, "text/csv", "huge.csv");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/excede/i);
  });

  it("rejeita mime não suportado", () => {
    const buf = Buffer.from("fake");
    const result = validateFile(buf, "image/png", "foto.png");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/não suportado/i);
  });

  it("aceita CSV válido", () => {
    const buf = Buffer.from("DESCRIÇÃO,QTDE\nCaneta,10");
    const result = validateFile(buf, "text/csv", "itens.csv");
    expect(result.valid).toBe(true);
    expect(result.parserType).toBe("csv");
    expect(result.checksum).toHaveLength(64);
  });

  it("aceita XLSX por extensão quando mime genérico", () => {
    const buf = Buffer.alloc(100);
    const result = validateFile(buf, "application/octet-stream", "planilha.xlsx");
    expect(result.valid).toBe(true);
    expect(result.parserType).toBe("xlsx");
  });

  it("aceita PDF por mime", () => {
    const buf = Buffer.from("%PDF-1.4 fake pdf content");
    const result = validateFile(buf, "application/pdf", "edital.pdf");
    expect(result.valid).toBe(true);
    expect(result.parserType).toBe("pdf");
  });

  it("calcula checksum SHA-256 idempotente", () => {
    const buf = Buffer.from("hello world");
    const r1  = validateFile(buf, "text/csv", "a.csv");
    const r2  = validateFile(buf, "text/csv", "a.csv");
    expect(r1.checksum).toBe(r2.checksum);
  });

  it("checksums diferentes para buffers diferentes", () => {
    const r1 = validateFile(Buffer.from("abc"), "text/csv", "a.csv");
    const r2 = validateFile(Buffer.from("xyz"), "text/csv", "b.csv");
    expect(r1.checksum).not.toBe(r2.checksum);
  });
});

// ─── CsvParser ────────────────────────────────────────────────────────────────

describe("CsvParser", () => {
  const parser = new CsvParser();

  it("identifica CSV por mime", () => {
    expect(parser.canHandle("text/csv", "csv")).toBe(true);
  });

  it("identifica CSV por extensão", () => {
    expect(parser.canHandle("application/octet-stream", "csv")).toBe(true);
  });

  it("parserType é csv", () => {
    expect(parser.parserType).toBe("csv");
  });

  it("parse extrai itens de CSV simples", async () => {
    const csv = "DESCRIÇÃO;QTDE;UNID;PREÇO UNIT;TOTAL\nCaneta Azul;10;UN;2,50;25,00\nPapel A4;5;PCT;15,00;75,00";
    const buf  = Buffer.from(csv, "utf8");
    const opts = { importSessionId: 1, sourceFileId: "f1", sourceFileName: "test.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.errors).toHaveLength(0);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items[0].rawDescription).toBe("Caneta Azul");
    expect(result.items[0].rawQuantity).toBe("10");
  });

  it("parse com separador vírgula", async () => {
    const csv = "DESCRIÇÃO,QTDE,UNIDADE\nItem X,3,CX";
    const buf  = Buffer.from(csv, "utf8");
    const opts = { importSessionId: 2, sourceFileId: "f2", sourceFileName: "a.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items[0].rawUnit).toBe("CX");
  });

  it("parse sem cabeçalhos usa fallback", async () => {
    const csv = "10,5,UN,2.50,25.00\n20,3,KG,10.00,30.00";
    const buf  = Buffer.from(csv, "utf8");
    const opts = { importSessionId: 3, sourceFileId: "f3", sourceFileName: "b.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("parse ignora linhas com descrição vazia", async () => {
    const csv = "DESCRIÇÃO,QTDE\nCaneta,10\n,5\nLápis,3";
    const buf  = Buffer.from(csv, "utf8");
    const opts = { importSessionId: 4, sourceFileId: "f4", sourceFileName: "c.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.items.length).toBe(2);
  });

  it("parse CSV vazio retorna sem itens mas sem erros fatais", async () => {
    const buf  = Buffer.from("DESCRIÇÃO,QTDE\n", "utf8");
    const opts = { importSessionId: 5, sourceFileId: "f5", sourceFileName: "empty.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.errors.filter(e => e.fatal)).toHaveLength(0);
    expect(result.items).toHaveLength(0);
  });

  it("summary contém processingMs", async () => {
    const buf  = Buffer.from("DESCRIÇÃO,QTDE\nItem,5", "utf8");
    const opts = { importSessionId: 6, sourceFileId: "f6", sourceFileName: "s.csv", sourceMimeType: "text/csv", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.summary.processingMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── XlsxParser ───────────────────────────────────────────────────────────────

describe("XlsxParser", () => {
  const parser = new XlsxParser();

  it("identifica xlsx por mime", () => {
    expect(parser.canHandle("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx")).toBe(true);
  });

  it("identifica xls por extensão", () => {
    expect(parser.canHandle("application/octet-stream", "xls")).toBe(true);
  });

  it("parserType é xlsx", () => {
    expect(parser.parserType).toBe("xlsx");
  });

  it("parse de buffer inválido retorna resultado sem crash", async () => {
    const buf  = Buffer.from("not an xlsx file");
    const opts = { importSessionId: 10, sourceFileId: "f10", sourceFileName: "bad.xlsx", sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceChecksum: "", organizationId: 1 };
    const result = await parser.safeParse(buf, opts);
    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("capabilities.parserVersion definida", () => {
    expect(parser.capabilities.parserVersion).toBeTruthy();
  });

  it("maxFileSizeBytes é 50MB", () => {
    expect(parser.capabilities.maxFileSizeBytes).toBe(50 * 1024 * 1024);
  });
});

// ─── PdfParser ────────────────────────────────────────────────────────────────

describe("PdfParser", () => {
  const parser = new PdfParser();

  it("identifica pdf por mime", () => {
    expect(parser.canHandle("application/pdf", "pdf")).toBe(true);
  });

  it("parserType é pdf", () => {
    expect(parser.parserType).toBe("pdf");
  });

  it("rejeita buffer sem magic bytes %PDF", async () => {
    const buf  = Buffer.from("not a pdf");
    const opts = { importSessionId: 20, sourceFileId: "f20", sourceFileName: "fake.pdf", sourceMimeType: "application/pdf", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("CORRUPT_FILE");
  });

  it("capacidade é supported (não mais stub) na B.2.3", () => {
    expect(parser.capabilities.capabilityStatus).toBe("supported");
    expect(parser.capabilities.supportsStructuredExtraction).toBe(true);
    expect(parser.capabilities.parserVersion).not.toContain("stub");
  });

  it("PDF assinado porém malformado é rejeitado (parser real, sem stub)", async () => {
    const buf  = Buffer.from("%PDF-1.4 fake content");
    const opts = { importSessionId: 21, sourceFileId: "f21", sourceFileName: "real.pdf", sourceMimeType: "application/pdf", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.items).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].fatal).toBe(true);
    expect(result.rawMetadata).not.toMatchObject({ stubMode: true });
  });
});

// ─── DocxParser ───────────────────────────────────────────────────────────────

describe("DocxParser", () => {
  const parser = new DocxParser();

  it("identifica docx por mime", () => {
    expect(parser.canHandle("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx")).toBe(true);
  });

  it("parserType é docx", () => {
    expect(parser.parserType).toBe("docx");
  });

  it("rejeita buffer sem magic bytes ZIP", async () => {
    const buf  = Buffer.from("not a zip");
    const opts = { importSessionId: 30, sourceFileId: "f30", sourceFileName: "fake.docx", sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("UNSUPPORTED_FORMAT");
  });

  it("capacidade é supported (não mais stub) na B.2.3", () => {
    expect(parser.capabilities.capabilityStatus).toBe("supported");
    expect(parser.capabilities.supportsStructuredExtraction).toBe(true);
    expect(parser.capabilities.parserVersion).not.toContain("stub");
  });

  it("buffer com assinatura ZIP porém sem diretório central é rejeitado (parser real)", async () => {
    const buf  = Buffer.from([0x50, 0x4B, 0x03, 0x04, ...Buffer.from("fake zip content")]);
    const opts = { importSessionId: 31, sourceFileId: "f31", sourceFileName: "doc.docx", sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", organizationId: 1 };
    const result = await parser.parse(buf, opts);
    expect(result.items).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].code).toBe("CORRUPT_FILE");
    expect(result.rawMetadata).not.toMatchObject({ stubMode: true });
  });
});

// ─── ParserRegistry ───────────────────────────────────────────────────────────

describe("ParserRegistry", () => {
  it("registra e recupera parser por tipo", () => {
    const reg = new ParserRegistry();
    reg.register(new CsvParser());
    expect(reg.get("csv")).not.toBeNull();
  });

  it("resolve por mime type", () => {
    const reg = new ParserRegistry();
    reg.register(new CsvParser());
    const p = reg.getForMimeType("text/csv");
    expect(p?.parserType).toBe("csv");
  });

  it("resolve por extensão", () => {
    const reg = new ParserRegistry();
    reg.register(new XlsxParser());
    const p = reg.getForExtension("xlsx");
    expect(p?.parserType).toBe("xlsx");
  });

  it("resolve usa hint quando presente", () => {
    const reg = new ParserRegistry();
    reg.register(new CsvParser());
    reg.register(new XlsxParser());
    const p = reg.resolve("text/csv", "arquivo.xlsx", "xlsx");
    expect(p?.parserType).toBe("xlsx");
  });

  it("resolve fallback por mime quando hint ausente", () => {
    const reg = new ParserRegistry();
    reg.register(new CsvParser());
    const p = reg.resolve("text/csv", "arquivo.csv");
    expect(p?.parserType).toBe("csv");
  });

  it("retorna null para parser não registrado", () => {
    const reg = new ParserRegistry();
    expect(reg.get("pdf")).toBeNull();
  });

  it("list retorna todos os parsers registrados", () => {
    const reg = new ParserRegistry();
    reg.register(new CsvParser()).register(new XlsxParser());
    expect(reg.list()).toHaveLength(2);
  });

  it("has retorna true para parser registrado", () => {
    const reg = new ParserRegistry();
    reg.register(new PdfParser());
    expect(reg.has("pdf")).toBe(true);
  });

  it("has retorna false para parser não registrado", () => {
    const reg = new ParserRegistry();
    expect(reg.has("csv")).toBe(false);
  });
});

// ─── BaseParser — validate ────────────────────────────────────────────────────

describe("BaseParser — validate", () => {
  const parser = new CsvParser();

  it("retorna null para arquivo válido", () => {
    const buf = Buffer.from("data");
    expect(parser.validate(buf, "text/csv")).toBeNull();
  });

  it("retorna erro para arquivo vazio", () => {
    const err = parser.validate(Buffer.alloc(0), "text/csv");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("EMPTY_FILE");
  });

  it("retorna erro para arquivo acima do limite", () => {
    const big = Buffer.alloc(parser.capabilities.maxFileSizeBytes + 1);
    const err = parser.validate(big, "text/csv");
    expect(err).not.toBeNull();
    expect(err!.code).toBe("SIZE_EXCEEDED");
  });
});

// ─── ImportQueueService ───────────────────────────────────────────────────────

describe("importQueueService — enqueueImport", () => {
  it("retorna jobId string", async () => {
    const { enqueueImport, getJobStatus } = await import("../../services/importQueueService");
    const jobId = enqueueImport(999, 1, Buffer.from("data"));
    expect(jobId).toMatch(/^job_999_/);
    const rec = getJobStatus(jobId);
    expect(rec).not.toBeNull();
  });

  it("getQueueDepth retorna número", async () => {
    const { getQueueDepth } = await import("../../services/importQueueService");
    expect(typeof getQueueDepth()).toBe("number");
  });

  it("getDlqDepth retorna número", async () => {
    const { getDlqDepth } = await import("../../services/importQueueService");
    expect(typeof getDlqDepth()).toBe("number");
  });
});
