/**
 * PR B.1 — documentEngine.exportInstitutional: tenant-scoped, delega ao adapter
 * comum; a flag `inline` (impressão) vira disposition "inline".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/officialDocumentExportAdapter", () => ({
  exportOfficialDocument: vi.fn().mockResolvedValue({ url: "https://s3/signed", format: "pdf", fileName: "CONTRATO_012-2026_gerado_v3.pdf" }),
}));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({ sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) } }));

import { documentEngineRouter } from "../../routers/documentEngineRouter";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";
import { makeContext, mockUser } from "../helpers/fixtures";

describe("PR B.1 · documentEngine.exportInstitutional", () => {
  beforeEach(() => vi.clearAllMocks());

  it("baixar: delega ao adapter com disposition attachment (default)", async () => {
    const caller = documentEngineRouter.createCaller(makeContext(mockUser));
    const r = await caller.exportInstitutional({ documentId: "doc1", format: "pdf" });
    expect(r.url).toBe("https://s3/signed");
    expect(exportOfficialDocument).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 1, documentId: "doc1", format: "pdf", disposition: "attachment",
    }));
  });

  it("imprimir: inline=true → disposition inline", async () => {
    const caller = documentEngineRouter.createCaller(makeContext(mockUser));
    await caller.exportInstitutional({ documentId: "doc1", format: "pdf", inline: true });
    expect(vi.mocked(exportOfficialDocument).mock.calls[0][0].disposition).toBe("inline");
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      documentEngineRouter.createCaller(makeContext(null)).exportInstitutional({ documentId: "doc1", format: "pdf" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(exportOfficialDocument).not.toHaveBeenCalled();
  });
});
