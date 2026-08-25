/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.1 — Gate de EXPORTAÇÃO OFICIAL DERIVADO NO SERVIDOR pelo businessDomain (não confia no cliente).
 * Render/storage mockados. Prova, determinístico e sem S3:
 *   - processo_licitatorio + status "gerado" → FORBIDDEN, sem renderizar/exportar, MESMO em chamada
 *     direta ao endpoint (sem qualquer parâmetro do cliente) — cenário 10;
 *   - processo_licitatorio + status "emitido" → passa o gate e delega ao núcleo de exportação (11);
 *   - outros domínios (contratos) → exportam qualquer status oficial (comportamento inalterado).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/documentEngineService", () => ({ getOfficialDocument: vi.fn() }));
vi.mock("../../services/documentExportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/documentExportService")>();
  return {
    ...actual,
    exportDocument: vi.fn().mockResolvedValue({
      key: "k", url: "https://s3/signed", format: "pdf", mimeType: "application/pdf", fileName: "ETP_v2.pdf",
    }),
  };
});
vi.mock("../../db/organizations", () => ({ getOrganizationById: vi.fn().mockResolvedValue({ id: 1, nome: "Org" }) }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { getOfficialDocument } from "../../services/documentEngineService";
import { exportDocument } from "../../services/documentExportService";

function mkDoc(over: Record<string, unknown> = {}) {
  return {
    id: "off1", tenantId: 1, businessDomain: "processo_licitatorio", documentType: "etp",
    origin: "proc-1", title: "ETP — X", version: 2, status: "emitido",
    template: "t", content: "# ETP\nconteúdo", metadata: {},
    author: "7", lineageId: "lin1", correlationId: "c", replayHash: "h", storageKey: "", mimeType: "", size: 0, hash: "",
    createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z", ...over,
  };
}

describe("C.4B.1 — gate de export oficial (requireStatus)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("10) processo_licitatorio + 'gerado' → FORBIDDEN mesmo em chamada direta (sem params do cliente)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "processo_licitatorio", status: "gerado" }) as any);
    await expect(exportOfficialDocument({
      organizationId: 1, userId: 7, documentId: "off1", format: "pdf",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(exportDocument).not.toHaveBeenCalled();
  });

  it("11) processo_licitatorio + 'emitido' → passa o gate e exporta", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "processo_licitatorio", status: "emitido" }) as any);
    const r = await exportOfficialDocument({ organizationId: 1, userId: 7, documentId: "off1", format: "pdf" });
    expect(r.url).toBe("https://s3/signed");
    expect(exportDocument).toHaveBeenCalledTimes(1);
  });

  it("outros domínios (contratos) → exportam qualquer status oficial (inalterado)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ businessDomain: "contratos", status: "gerado" }) as any);
    const r = await exportOfficialDocument({ organizationId: 1, userId: 7, documentId: "off1", format: "pdf" });
    expect(r.url).toBe("https://s3/signed");
    expect(exportDocument).toHaveBeenCalledTimes(1);
  });
});
