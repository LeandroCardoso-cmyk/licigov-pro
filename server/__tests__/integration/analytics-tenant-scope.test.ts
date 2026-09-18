/**
 * TENANT-006 (correção) — `analytics.getOverview` deve ser TENANT-SCOPED.
 *
 * Prova que o overview institucional deriva `organizationId` do contexto do servidor e agrega
 * SOMENTE dados da organização — nunca as funções GLOBAIS (getProcessCountByStatus/getAllUsers/…),
 * que vazariam processos/documentos/usuários de todos os tenants. Invariante multi-tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 4242,
    membership: { id: 1, organizationId: 4242, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 4242, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../db");

import { analyticsRouter } from "../../routers/analyticsRouter";
import * as db from "../../db";
import { makeContext, mockUser } from "../helpers/fixtures";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getProcessCountByStatusForOrg).mockResolvedValue([{ status: "em_dfd", count: 3 }] as never);
  vi.mocked(db.getDocumentCountByMonthForOrg).mockResolvedValue([{ month: "2026-09", count: 2 }] as never);
  vi.mocked(db.getMostActiveMembersForOrg).mockResolvedValue([{ userId: 1, userName: "A", userEmail: "a@x", activityCount: 5 }] as never);
  vi.mocked(db.getMembersOfOrg).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
});

describe("analytics.getOverview — tenant-scoped", () => {
  it("agrega SOMENTE pela organização do contexto e NUNCA usa as funções globais", async () => {
    const caller = analyticsRouter.createCaller(makeContext(mockUser));
    const r = await caller.getOverview();

    // Deriva a organização do contexto (4242) — nunca aceita do cliente.
    expect(db.getProcessCountByStatusForOrg).toHaveBeenCalledWith(4242);
    expect(db.getDocumentCountByMonthForOrg).toHaveBeenCalledWith(4242, 6);
    expect(db.getMostActiveMembersForOrg).toHaveBeenCalledWith(4242, 10);
    expect(db.getMembersOfOrg).toHaveBeenCalledWith(4242);

    // As funções GLOBAIS (vazamento cross-tenant) NÃO podem ser chamadas.
    expect(db.getProcessCountByStatus).not.toHaveBeenCalled();
    expect(db.getDocumentCountByMonth).not.toHaveBeenCalled();
    expect(db.getMostActiveMembers).not.toHaveBeenCalled();
    expect(db.getAllUsers).not.toHaveBeenCalled();

    // Contrato de saída preservado; totalUsers = membros ATIVOS da organização.
    expect(r.totalUsers).toBe(2);
    expect(r.totalProcesses).toBe(3);
    expect(r.processesByStatus).toEqual([{ status: "em_dfd", count: 3 }]);
  });

  it("exige autenticação/tenant (usuário anônimo é rejeitado antes de qualquer agregação)", async () => {
    await expect(analyticsRouter.createCaller(makeContext(null)).getOverview()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.getProcessCountByStatusForOrg).not.toHaveBeenCalled();
  });
});
