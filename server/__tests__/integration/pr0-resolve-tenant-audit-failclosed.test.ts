/**
 * V1 PRE-PILOT CLOSURE — PR 0 (correção final) — `resolveTenant` (server/_core/trpc.ts):
 * a auditoria do acesso cross-tenant do admin de plataforma é FAIL-CLOSED. Antes, uma
 * falha ao gravar `audit_logs` era só um `console.warn` — a requisição prosseguia mesmo
 * sem rastro de auditoria. Corrigido: se `db.createAuditLog` falhar, o erro propaga e a
 * operação (mutation/query) NUNCA chega a executar.
 *
 * Mocka o barrel `../../db` (mesmo padrão de organizations-router-membership.test.ts) —
 * não requer MySQL real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db", () => ({
  getOrganizationById: vi.fn(),
  createAuditLog: vi.fn(),
  getProcessByIdForOrganization: vi.fn(),
  getProcessMember: vi.fn(),
  getProcessMembers: vi.fn(),
}));

import * as db from "../../db";
import { collaborationRouter } from "../../routers/collaborationRouter";

const getOrganizationByIdMock = vi.mocked(db.getOrganizationById);
const createAuditLogMock = vi.mocked(db.createAuditLog);
const getProcessByIdForOrganizationMock = vi.mocked(db.getProcessByIdForOrganization);

const VALID_ORG = {
  id: 1, nome: "Org Teste", slug: "org-teste", cnpj: null, esfera: "municipal",
  uf: "SP", municipio: "SP", ativo: true, createdAt: new Date(), updatedAt: new Date(),
};

function adminCaller(headers: Record<string, string> = {}) {
  return collaborationRouter.createCaller({
    user: { id: 1, role: "admin", name: "Admin", email: "admin@x.com" },
    req: { headers, ip: "127.0.0.1" },
    res: {},
    correlationId: "test-audit-failclosed",
  } as unknown as Parameters<typeof collaborationRouter.createCaller>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PR 0 (correção final) — resolveTenant: auditoria cross-tenant fail-closed", () => {
  it("falha ao gravar audit_logs bloqueia o acesso cross-tenant do admin — a operação NUNCA prossegue", async () => {
    getOrganizationByIdMock.mockResolvedValue(VALID_ORG as never);
    createAuditLogMock.mockRejectedValue(new Error("audit_logs indisponível"));

    const caller = adminCaller({ "x-organization-id": "1" });
    await expect(caller.listMembers({ processId: 1 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });

    // A lógica de negócio (resolução do processo) nunca foi alcançada — `next()`
    // nunca foi chamado pelo middleware.
    expect(getProcessByIdForOrganizationMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: audit persiste normalmente e a operação prossegue", async () => {
    getOrganizationByIdMock.mockResolvedValue(VALID_ORG as never);
    createAuditLogMock.mockResolvedValue(undefined as never);
    getProcessByIdForOrganizationMock.mockResolvedValue(null as never);

    const caller = adminCaller({ "x-organization-id": "1" });
    await expect(caller.listMembers({ processId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getProcessByIdForOrganizationMock).toHaveBeenCalledWith(1, 1);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
  });
});
