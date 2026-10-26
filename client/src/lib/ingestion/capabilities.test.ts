/**
 * PR B.2.2 — Testes puros da lógica de capacidades (sem DOM).
 * Cobre: accept do seletor, validação de arquivo (vazio, acima do limite, MIME/formato não
 * suportado, formato stub rejeitado, formato real aceito), rótulos e formatação de tamanho.
 */
import { describe, it, expect } from "vitest";
import {
  acceptAttr, supportedFormatsLabel, formatBytes, validateFile, unavailableNotices,
  type IngestionCapabilities,
} from "./capabilities";

const CAPS: IngestionCapabilities = {
  enabled: true,
  maxFileSizeBytes: 50 * 1024 * 1024,
  formats: [
    { key: "csv",  label: "CSV",          extensions: [".csv", ".txt"], mimeTypes: ["text/csv", "text/plain"], supported: true },
    { key: "xlsx", label: "Excel (XLSX)", extensions: [".xlsx"],        mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], supported: true },
    { key: "pdf",  label: "PDF",          extensions: [".pdf"],         mimeTypes: ["application/pdf"], supported: false },
  ],
  supportedFormats: [
    { key: "csv",  label: "CSV",          extensions: [".csv", ".txt"], mimeTypes: ["text/csv", "text/plain"], supported: true },
    { key: "xlsx", label: "Excel (XLSX)", extensions: [".xlsx"],        mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], supported: true },
  ],
};

describe("acceptAttr / labels / formatBytes", () => {
  it("accept inclui apenas extensões e mimes dos formatos suportados (sem PDF stub)", () => {
    const accept = acceptAttr(CAPS);
    expect(accept).toContain(".csv");
    expect(accept).toContain(".xlsx");
    expect(accept).toContain("text/csv");
    expect(accept).not.toContain(".pdf");
    expect(accept).not.toContain("application/pdf");
  });
  it("supportedFormatsLabel lista os rótulos suportados", () => {
    expect(supportedFormatsLabel(CAPS)).toBe("CSV, Excel (XLSX)");
  });
  it("formatBytes formata MB/KB/B", () => {
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});

describe("validateFile", () => {
  it("rejeita arquivo vazio", () => {
    expect(validateFile({ name: "a.csv", size: 0, type: "text/csv" }, CAPS)).toEqual({ ok: false, code: "EMPTY", message: expect.any(String) });
  });
  it("rejeita arquivo acima do limite", () => {
    const r = validateFile({ name: "a.csv", size: CAPS.maxFileSizeBytes + 1, type: "text/csv" }, CAPS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TOO_LARGE");
  });
  it("rejeita formato stub (PDF) com mensagem de indisponibilidade", () => {
    const r = validateFile({ name: "doc.pdf", size: 100, type: "application/pdf" }, CAPS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STUB_FORMAT");
  });
  it("rejeita formato totalmente desconhecido", () => {
    const r = validateFile({ name: "x.bin", size: 100, type: "application/octet-stream" }, CAPS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNSUPPORTED");
  });
  it("aceita CSV real por extensão", () => {
    const r = validateFile({ name: "cotacao.csv", size: 100, type: "" }, CAPS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.format.key).toBe("csv");
  });
  it("aceita XLSX real por MIME", () => {
    const r = validateFile({ name: "planilha.xlsx", size: 100, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, CAPS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.format.key).toBe("xlsx");
  });
});

describe("SEC-AUD-07 — .xls suspenso", () => {
  const MSG = "O formato .xls está temporariamente indisponível. Abra o arquivo no Excel ou LibreOffice, salve como .xlsx e envie novamente.";
  const XLS = { key: "xls", label: "Excel (XLS)", extensions: [".xls"], mimeTypes: ["application/vnd.ms-excel"], supported: false, unavailableMessage: MSG };
  const XLSX_F = { key: "xlsx", label: "Excel (XLSX)", extensions: [".xlsx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], supported: true };
  const caps = { enabled: true, maxFileSizeBytes: 50 * 1024 * 1024, formats: [XLSX_F, XLS], supportedFormats: [XLSX_F] };

  it("o seletor não oferece .xls e o rótulo não cita XLS", () => {
    expect(acceptAttr(caps)).not.toContain(".xls,");
    expect(acceptAttr(caps).split(",")).not.toContain(".xls");
    expect(supportedFormatsLabel(caps)).toBe("Excel (XLSX)");
  });

  it("arquivo .xls (por extensão ou MIME) recebe exatamente a orientação de conversão antes do envio", () => {
    for (const f of [{ name: "precos.xls", size: 10, type: "" }, { name: "precos", size: 10, type: "application/vnd.ms-excel" }]) {
      const r = validateFile(f, caps);
      expect(r).toEqual({ ok: false, code: "STUB_FORMAT", message: MSG });
    }
  });

  it("a orientação aparece como aviso na área de envio", () => {
    expect(unavailableNotices(caps)).toEqual([MSG]);
  });
});
