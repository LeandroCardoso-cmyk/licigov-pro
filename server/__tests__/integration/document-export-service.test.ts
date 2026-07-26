/**
 * PR B — Núcleo COMUM de exportação (documentExportService).
 *
 * Verifica que o pipeline transversal renderiza (DOCX/PDF) via o conversor oficial,
 * grava no Storage Service e devolve URL assinada — sem acoplamento de módulo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/documentEngineService", () => ({
  renderContent: vi.fn().mockResolvedValue(Buffer.from("bin")),
}));
vi.mock("../../storage", () => ({
  assertStorageUsable: vi.fn(),
  storagePut: vi.fn().mockResolvedValue({ key: "k", url: "https://s3/put" }),
  storageSignedUrl: vi.fn().mockResolvedValue({ key: "k", url: "https://s3/signed-url" }),
}));

import { exportDocument, sanitizeExportBaseName } from "../../services/documentExportService";
import { renderContent } from "../../services/documentEngineService";
import * as storage from "../../storage";

describe("documentExportService — núcleo comum", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DOCX: renderiza via Document Engine, grava no storage e retorna URL assinada", async () => {
    const r = await exportDocument({ organizationId: 7, content: "# Doc", baseName: "DFD_100/2026", format: "docx", scope: "processo" });
    expect(renderContent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderContent).mock.calls[0][0].format).toBe("docx");
    expect(storage.storagePut).toHaveBeenCalledTimes(1);
    const [key, , mime] = vi.mocked(storage.storagePut).mock.calls[0];
    expect(key).toMatch(/^exports\/processo\/7\/\d+_DFD_100_2026\.docx$/); // nome sanitizado, tenant na chave
    expect(mime).toContain("wordprocessingml");
    expect(r.url).toBe("https://s3/signed-url");
    expect(r.fileName).toBe("DFD_100_2026.docx");
    expect(r.format).toBe("docx");
  });

  it("PDF: renderiza em pdf e retorna mime pdf", async () => {
    const r = await exportDocument({ organizationId: 7, content: "# Doc", baseName: "ETP", format: "pdf" });
    expect(vi.mocked(renderContent).mock.calls[0][0].format).toBe("pdf");
    expect(r.mimeType).toBe("application/pdf");
    expect(r.fileName).toBe("ETP.pdf");
  });

  it("exige storage utilizável (assertStorageUsable)", async () => {
    await exportDocument({ organizationId: 1, content: "x", baseName: "y", format: "pdf" });
    expect(storage.assertStorageUsable).toHaveBeenCalled();
  });

  it("sanitizeExportBaseName remove caminho e caracteres inseguros", () => {
    expect(sanitizeExportBaseName("../../etc/passwd")).not.toContain("/");
    expect(sanitizeExportBaseName("a;b c.pdf")).toMatch(/^[a-zA-Z0-9_\-. ]+$/);
    expect(sanitizeExportBaseName("")).toBe("documento");
  });
});
