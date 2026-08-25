/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.1 — Gate de EXPORTAÇÃO OFICIAL por status (requireStatus). Render/storage mockados.
 *
 * Prova, determinístico e sem S3:
 *   - requireStatus "emitido" + status "gerado" → FORBIDDEN, sem renderizar/exportar (cenário 10);
 *   - requireStatus "emitido" + status "emitido" → passa o gate e delega ao núcleo de exportação (11);
 *   - sem requireStatus → comportamento inalterado (exporta qualquer status oficial — outros domínios).
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

  it("10) status 'gerado' + requireStatus 'emitido' → FORBIDDEN, sem exportar", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ status: "gerado" }) as any);
    await expect(exportOfficialDocument({
      organizationId: 1, userId: 7, documentId: "off1", format: "pdf", requireStatus: "emitido",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(exportDocument).not.toHaveBeenCalled();
  });

  it("11) status 'emitido' + requireStatus 'emitido' → passa o gate e exporta", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ status: "emitido" }) as any);
    const r = await exportOfficialDocument({
      organizationId: 1, userId: 7, documentId: "off1", format: "pdf", requireStatus: "emitido",
    });
    expect(r.url).toBe("https://s3/signed");
    expect(exportDocument).toHaveBeenCalledTimes(1);
  });

  it("sem requireStatus → exporta qualquer status oficial (outros domínios inalterados)", async () => {
    vi.mocked(getOfficialDocument).mockResolvedValue(mkDoc({ status: "gerado" }) as any);
    const r = await exportOfficialDocument({ organizationId: 1, userId: 7, documentId: "off1", format: "pdf" });
    expect(r.url).toBe("https://s3/signed");
    expect(exportDocument).toHaveBeenCalledTimes(1);
  });
});
