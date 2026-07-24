/**
 * PR A.1 — routers/tenantOnboardingRouter.ts. `adminProcedure` exige `users.role === 'admin'`
 * (admin de PLATAFORMA, não papel de organização) — `services/tenantOnboardingService` é
 * mockado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeContext } from "../helpers/fixtures";

vi.mock("../../services/tenantOnboardingService", () => ({ onboardTenant: vi.fn() }));

import { onboardTenant } from "../../services/tenantOnboardingService";
import { tenantOnboardingRouter } from "../../routers/tenantOnboardingRouter";

const onboardTenantMock = vi.mocked(onboardTenant);

const PLATFORM_ADMIN = { id: 1, role: "admin" as const, openId: "admin", name: "Admin", email: "admin@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const NORMAL_USER = { id: 5, role: "user" as const, openId: "u5", name: "Fulano", email: "fulano@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

const VALID_INPUT = {
  nome: "Prefeitura de Moreira Sales", slug: "moreira-sales", esfera: "municipal" as const,
  firstAdminName: "Ana Silva", firstAdminEmail: "ana@moreirasales.pr.gov.br",
};

beforeEach(() => vi.clearAllMocks());

describe("tenantOnboardingRouter · create", () => {
  it("usuário comum (não admin de plataforma) → FORBIDDEN", async () => {
    const caller = tenantOnboardingRouter.createCaller(makeContext(NORMAL_USER as never) as never);
    await expect(caller.create(VALID_INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(onboardTenantMock).not.toHaveBeenCalled();
  });

  it("sem sessão → FORBIDDEN (adminProcedure não distingue 'sem sessão' de 'não-admin')", async () => {
    const caller = tenantOnboardingRouter.createCaller(makeContext(null) as never);
    await expect(caller.create(VALID_INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("slug com maiúsculas/espaços é rejeitado pelo zod", async () => {
    const caller = tenantOnboardingRouter.createCaller(makeContext(PLATFORM_ADMIN as never) as never);
    await expect(caller.create({ ...VALID_INPUT, slug: "Moreira Sales" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(onboardTenantMock).not.toHaveBeenCalled();
  });

  it("admin de plataforma: repassa actorUserId/correlationId e retorna o resumo do service", async () => {
    onboardTenantMock.mockResolvedValue({ organizationId: 700099, organizationName: VALID_INPUT.nome, slug: VALID_INPUT.slug, invitationId: 55, alreadyExisted: false });
    const caller = tenantOnboardingRouter.createCaller(makeContext(PLATFORM_ADMIN as never) as never);
    const result = await caller.create(VALID_INPUT);
    expect(result.organizationId).toBe(700099);
    expect(onboardTenantMock).toHaveBeenCalledWith(expect.objectContaining({ ...VALID_INPUT, actorUserId: 1 }));
  });
});
