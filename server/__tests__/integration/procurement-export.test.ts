/**
 * PR B — Adapter de exportação do Processo Licitatório (procurementProcess.exportDocument).
 * Mapeia (processId, kind) → conteúdo canônico e delega ao núcleo comum.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn().mockResolvedValue({ id: 1, nome: "Prefeitura de Moreira Sales" }),
}));
vi.mock("../../services/documentExportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/documentExportService")>();
  return {
    ...actual, // mantém formatBrazilianDateTime real
    exportDocument: vi.fn().mockResolvedValue({
      key: "exports/processo/1/1_ETP.pdf", url: "https://s3/signed", format: "pdf",
      mimeType: "application/pdf", fileName: "ETP_100-2026_rascunho_v1.pdf",
    }),
  };
});
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { exportDocument as exportCore } from "../../services/documentExportService";
import { makeContext, mockUser } from "../helpers/fixtures";

const PID = "proc-x";
const proc = { id: PID, organizationId: 1, processNumber: "100/2026", object: "Aquisição" };

describe("procurementProcess.exportDocument (adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue(proc as any);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(
      { id: "d1", kind: "etp", title: "ETP — X", content: "# ETP\nconteúdo", status: "rascunho", updatedAt: "2026-07-26T00:00:00.000Z" } as any,
    );
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as any);
  });

  it("exporta o documento canônico chamando o núcleo comum e retorna a URL", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const r = await caller.exportDocument({ processId: PID, kind: "etp", format: "pdf" });

    expect(r.url).toBe("https://s3/signed");
    expect(r.fileName).toBe("ETP_100-2026_rascunho_v1.pdf");
    // Delegou ao núcleo comum com o conteúdo do documento + metadados institucionais.
    const arg = vi.mocked(exportCore).mock.calls[0][0];
    expect(arg.content).toContain("conteúdo"); // conteúdo persistido, fiel
    expect(arg.baseName).toBe("ETP_100/2026");
    expect(arg.downloadBaseName).toBe("ETP_100-2026_rascunho_v1"); // determinístico, sem timestamp
    expect(arg.organizationId).toBe(1);
    expect(arg.meta?.statusLabel).toBe("RASCUNHO");
    expect(arg.meta?.isDraft).toBe(true);
    expect(arg.meta?.processNumber).toBe("100/2026");
    expect(arg.meta?.organizationName).toBe("Prefeitura de Moreira Sales");
    expect(arg.meta?.documentTitle).toContain("Estudo Técnico Preliminar");
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1); // auditoria
  });

  it("documento inexistente ou vazio → NOT_FOUND, sem chamar o núcleo", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.exportDocument({ processId: PID, kind: "tr", format: "docx" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportCore).not.toHaveBeenCalled();
  });

  it("cross-tenant / processo inexistente → NOT_FOUND, sem exportar", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.exportDocument({ processId: "outro", kind: "etp", format: "pdf" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(exportCore).not.toHaveBeenCalled();
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).exportDocument({ processId: PID, kind: "etp", format: "pdf" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
