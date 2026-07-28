/**
 * PR B/#188 — Núcleo COMUM de exportação (documentExportService).
 *
 * Verifica: renderização institucional via Document Engine, gravação no Storage,
 * URL assinada com nome de DOWNLOAD determinístico (sem timestamp), chave interna
 * separada, e o formatador de data pt-BR.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/documentEngineService", () => ({
  renderContent: vi.fn().mockResolvedValue(Buffer.from("bin")),
  renderInstitutionalContent: vi.fn().mockResolvedValue(Buffer.from("inst-bin")),
}));
vi.mock("../../storage", () => ({
  assertStorageUsable: vi.fn(),
  storagePut: vi.fn().mockResolvedValue({ key: "k", url: "https://s3/put" }),
  storageSignedUrl: vi.fn().mockResolvedValue({ key: "k", url: "https://s3/signed-url" }),
}));

import { exportDocument, sanitizeExportBaseName, formatBrazilianDateTime } from "../../services/documentExportService";
import { renderInstitutionalContent, renderContent } from "../../services/documentEngineService";
import * as storage from "../../storage";

const META = {
  organizationName: "Org X", documentTitle: "DFD — ...", processNumber: "100/2026",
  object: "Aquisição", statusLabel: "RASCUNHO", isDraft: true, version: 1, exportedAtLabel: "26/07/2026 às 21:45",
};

describe("documentExportService — núcleo comum", () => {
  beforeEach(() => vi.clearAllMocks());

  it("com meta: renderiza INSTITUCIONAL, grava e retorna URL assinada com nome de download determinístico", async () => {
    const r = await exportDocument({
      organizationId: 7, content: "# Doc", baseName: "DFD_100/2026",
      downloadBaseName: "DFD_100-2026_rascunho_v1", format: "docx", scope: "processo", meta: META as any,
    });
    expect(renderInstitutionalContent).toHaveBeenCalledTimes(1);
    expect(renderContent).not.toHaveBeenCalled();
    // Chave interna com timestamp (única) — separada do nome de download.
    const key = vi.mocked(storage.storagePut).mock.calls[0][0];
    expect(key).toMatch(/^exports\/processo\/7\/\d+_DFD_100_2026\.docx$/);
    // Nome de download legível, determinístico, SEM timestamp, extensão correta.
    const [, , downloadName] = vi.mocked(storage.storageSignedUrl).mock.calls[0];
    expect(downloadName).toBe("DFD_100-2026_rascunho_v1.docx");
    expect(downloadName).not.toMatch(/\d{10,}/); // sem timestamp técnico
    expect(r.fileName).toBe("DFD_100-2026_rascunho_v1.docx");
    expect(r.url).toBe("https://s3/signed-url");
  });

  it("sem meta: usa render simples (renderContent)", async () => {
    await exportDocument({ organizationId: 1, content: "x", baseName: "y", format: "pdf" });
    expect(renderContent).toHaveBeenCalledTimes(1);
    expect(renderInstitutionalContent).not.toHaveBeenCalled();
  });

  it("nome de download determinístico para a mesma versão (idempotente na apresentação)", async () => {
    const p = { organizationId: 1, content: "x", baseName: "TR_100/2026", downloadBaseName: "TR_100-2026_aprovado_v2", format: "pdf" as const, meta: META as any };
    await exportDocument(p);
    await exportDocument(p);
    const n1 = vi.mocked(storage.storageSignedUrl).mock.calls[0][2];
    const n2 = vi.mocked(storage.storageSignedUrl).mock.calls[1][2];
    expect(n1).toBe("TR_100-2026_aprovado_v2.pdf");
    expect(n2).toBe(n1); // determinístico
  });

  it("sanitizeExportBaseName remove caminho e caracteres inseguros", () => {
    expect(sanitizeExportBaseName("../../etc/passwd")).not.toContain("/");
    expect(sanitizeExportBaseName("a;b c.pdf")).toMatch(/^[a-zA-Z0-9_\-. ]+$/);
    expect(sanitizeExportBaseName("")).toBe("documento");
  });

  it("formatBrazilianDateTime formata no padrão brasileiro", () => {
    // 2026-07-27T00:45:00Z → em America/Sao_Paulo (UTC-3) = 26/07/2026 21:45
    const s = formatBrazilianDateTime(new Date("2026-07-27T00:45:00.000Z"));
    expect(s).toBe("26/07/2026 às 21:45");
  });
});
