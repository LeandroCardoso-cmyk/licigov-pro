/**
 * TENANT (correção) — `editalParameters.get`/`save` devem ser TENANT-SCOPED.
 *
 * Prova que ambos derivam `organizationId` do contexto do servidor e validam que o processo
 * pertence à organização ANTES de qualquer leitura/escrita — fechando o IDOR cross-tenant em que
 * um usuário podia ler/sobrescrever os parâmetros do edital (modalidade/formato/critério/regime)
 * de outra organização, e injetar activity logs em processo alheio, enumerando o `processId`.
 * Invariante multi-tenant do PRODUCT_NORTH_STAR.
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

import { editalParametersRouter } from "../../routers/editalParametersRouter";
import * as db from "../../db";
import { makeContext, mockUser } from "../helpers/fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editalParameters — tenant-scoped", () => {
  it("get: valida que o processo pertence à organização do contexto e só então lê", async () => {
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ id: 77, organizationId: 4242 } as never);
    vi.mocked(db.getEditalParametersByProcess).mockResolvedValue({ processId: 77, modalidade: "pregao" } as never);

    const caller = editalParametersRouter.createCaller(makeContext(mockUser));
    const r = await caller.get({ processId: 77 });

    expect(db.getProcessByIdForOrganization).toHaveBeenCalledWith(77, 4242);
    expect(db.getEditalParametersByProcess).toHaveBeenCalledWith(77);
    expect(r).toMatchObject({ processId: 77 });
  });

  it("get: processo de OUTRA organização → NOT_FOUND e NUNCA lê os parâmetros", async () => {
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(undefined as never);

    const caller = editalParametersRouter.createCaller(makeContext(mockUser));
    await expect(caller.get({ processId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(db.getProcessByIdForOrganization).toHaveBeenCalledWith(999, 4242);
    expect(db.getEditalParametersByProcess).not.toHaveBeenCalled();
  });

  it("save: processo da organização → grava e registra activity log escopado por org", async () => {
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue({ id: 77, organizationId: 4242 } as never);
    vi.mocked(db.upsertEditalParameters).mockResolvedValue(undefined as never);
    vi.mocked(db.createActivityLogForOrganization).mockResolvedValue(undefined as never);

    const caller = editalParametersRouter.createCaller(makeContext(mockUser));
    const r = await caller.save({ processId: 77, modalidade: "pregao", formato: "eletronico" });

    expect(db.getProcessByIdForOrganization).toHaveBeenCalledWith(77, 4242);
    expect(db.upsertEditalParameters).toHaveBeenCalledWith(expect.objectContaining({ processId: 77, modalidade: "pregao" }));
    expect(db.createActivityLogForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 77, userId: mockUser.id }),
      4242,
    );
    expect(r).toEqual({ success: true });
  });

  it("save: processo de OUTRA organização → NOT_FOUND e NUNCA grava nem registra log", async () => {
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(undefined as never);

    const caller = editalParametersRouter.createCaller(makeContext(mockUser));
    await expect(caller.save({ processId: 999, modalidade: "pregao" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(db.upsertEditalParameters).not.toHaveBeenCalled();
    expect(db.createActivityLogForOrganization).not.toHaveBeenCalled();
  });

  it("exige autenticação/tenant (anônimo é rejeitado antes de qualquer acesso a dados)", async () => {
    await expect(editalParametersRouter.createCaller(makeContext(null)).get({ processId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.getProcessByIdForOrganization).not.toHaveBeenCalled();
  });
});
