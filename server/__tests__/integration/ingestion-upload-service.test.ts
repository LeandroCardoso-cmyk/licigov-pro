/**
 * PR B.2.1 — Testes unitários do serviço de upload da ingestão canônica.
 * Cobre: sniffing por magic bytes, validação de conteúdo (não só extensão), MIME divergente,
 * tamanho excedido, arquivo inválido/vazio, checksum divergente, proteção contra path traversal,
 * chave de storage gerada pelo servidor (nome não controlado pelo cliente).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  sniffContent,
  validateUploadContent,
  sanitizeFileName,
  buildIngestionStorageKey,
  isAllowedMime,
} from "../../services/ingestionUploadService";
import { MAX_FILE_SIZE_BYTES } from "../../domain/importTypes";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_PDF  = "application/pdf";
const MIME_CSV  = "text/csv";

const pdfBuf = () => Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n", "latin1");
const zipBuf = () => Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const oleBuf = () => Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const csvBuf = () => Buffer.from("fornecedor,item,unidade,valor\nACME,Caneta,UN,1.50\n", "utf-8");

describe("sniffContent — magic bytes", () => {
  it("detecta PDF", () => expect(sniffContent(pdfBuf())).toBe("pdf"));
  it("detecta ZIP/OOXML (xlsx/docx)", () => expect(sniffContent(zipBuf())).toBe("zip"));
  it("detecta OLE/CFB (xls legado)", () => expect(sniffContent(oleBuf())).toBe("ole"));
  it("detecta texto (csv)", () => expect(sniffContent(csvBuf())).toBe("text"));
  it("retorna unknown para binário com NUL não reconhecido", () => {
    expect(sniffContent(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]))).toBe("unknown");
  });
});

describe("validateUploadContent — validação estrita", () => {
  it("aceita XLSX declarado com bytes ZIP e retorna checksum/size/parser", () => {
    const buf = zipBuf();
    const r = validateUploadContent({ buffer: buf, declaredMime: MIME_XLSX, fileName: "planilha.xlsx" });
    expect(r.parserType).toBe("xlsx");
    expect(r.category).toBe("zip");
    expect(r.size).toBe(buf.length);
    expect(r.checksum).toBe(createHash("sha256").update(buf).digest("hex"));
  });

  it("aceita CSV declarado com bytes de texto", () => {
    const r = validateUploadContent({ buffer: csvBuf(), declaredMime: MIME_CSV, fileName: "precos.csv" });
    expect(r.parserType).toBe("csv");
    expect(r.category).toBe("text");
  });

  it("REJEITA conteúdo divergente do tipo declarado (xlsx declarado, bytes PDF)", () => {
    expect(() => validateUploadContent({ buffer: pdfBuf(), declaredMime: MIME_XLSX, fileName: "planilha.xlsx" }))
      .toThrowError(/não corresponde ao tipo declarado/i);
  });

  it("REJEITA arquivo vazio", () => {
    expect(() => validateUploadContent({ buffer: Buffer.alloc(0), declaredMime: MIME_CSV, fileName: "x.csv" }))
      .toThrowError(/vazio/i);
  });

  it("REJEITA formato não suportado", () => {
    expect(() => validateUploadContent({ buffer: csvBuf(), declaredMime: "application/x-msdownload", fileName: "x.exe" }))
      .toThrowError(/não suportado/i);
  });

  it("REJEITA checksum divergente do arquivo enviado", () => {
    expect(() => validateUploadContent({
      buffer: csvBuf(), declaredMime: MIME_CSV, fileName: "x.csv",
      declaredChecksum: "0".repeat(64),
    })).toThrowError(/checksum divergente/i);
  });

  it("REJEITA tamanho divergente do declarado", () => {
    expect(() => validateUploadContent({
      buffer: csvBuf(), declaredMime: MIME_CSV, fileName: "x.csv", expectedSize: 999999,
    })).toThrowError(/tamanho divergente/i);
  });

  it("REJEITA arquivo acima do teto de tamanho", () => {
    // Buffer levemente acima do limite, preenchido com bytes de texto (evita custo de 50MB real+1).
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 0x61);
    expect(() => validateUploadContent({ buffer: big, declaredMime: MIME_CSV, fileName: "x.csv" }))
      .toThrowError(/excede/i);
  });
});

describe("sanitizeFileName — proteção contra path traversal", () => {
  it("descarta caminho relativo e barras", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
  });
  it("restringe charset e colapsa separadores", () => {
    expect(sanitizeFileName("relatório final (v2).xlsx")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
  it("nunca retorna vazio", () => {
    expect(sanitizeFileName("")).toBe("arquivo");
    expect(sanitizeFileName("///")).toBe("arquivo");
  });
});

describe("buildIngestionStorageKey — chave gerada pelo servidor", () => {
  it("prefixa por org e data, nome não controlado pelo cliente", () => {
    const key = buildIngestionStorageKey(42, "../../evil.csv", new Date(Date.UTC(2026, 7, 4)));
    expect(key.startsWith("imports/42/20260804/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key.endsWith("evil.csv")).toBe(true); // basename sanitizado, sem o caminho malicioso
  });
  it("gera chaves distintas para o mesmo nome (uuid)", () => {
    const now = new Date(Date.UTC(2026, 7, 4));
    const a = buildIngestionStorageKey(1, "f.csv", now);
    const b = buildIngestionStorageKey(1, "f.csv", now);
    expect(a).not.toBe(b);
  });
});

describe("isAllowedMime", () => {
  it("aceita mimes suportados", () => {
    expect(isAllowedMime(MIME_XLSX)).toBe(true);
    expect(isAllowedMime(MIME_PDF)).toBe(true);
  });
  it("rejeita mimes não suportados", () => {
    expect(isAllowedMime("application/x-msdownload")).toBe(false);
  });
});
