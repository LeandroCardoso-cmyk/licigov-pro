/**
 * PR A.1 — routers/invitationsRouter.ts. `services/invitationService` é mockado (já testado
 * isoladamente) — foco no CONTRATO: gate de papel (admin) em create/list/resend/cancel via
 * orgRoleProcedure, validação zod, `accept` cria sessão (cookie), `acceptExisting` exige e-mail
 * na sessão.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeContext } from "../helpers/fixtures";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../services/rateLimiter", async () => {
  const trpc = await import("../../_core/trpc");
  return { rateLimitMiddleware: (_type: string) => trpc.middleware(({ next }: { next: () => unknown }) => next()) };
});
vi.mock("../../_core/sdk", () => ({ sdk: { signSession: vi.fn().mockResolvedValue("fake-jwt") } }));
vi.mock("../../_core/cookies", () => ({ getSessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true, path: "/" }) }));
vi.mock("../../services/invitationService", () => ({
  createInvitation: vi.fn(),
  listInvitations: vi.fn(),
  resendInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  validateInvitationToken: vi.fn(),
  acceptInvitation: vi.fn(),
  acceptExistingInvitation: vi.fn(),
}));

import { resolveTenantForUser } from "../../services/tenantService";
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  cancelInvitation,
  validateInvitationToken,
  acceptInvitation,
  acceptExistingInvitation,
} from "../../services/invitationService";
import { invitationsRouter } from "../../routers/invitationsRouter";

const resolveTenantMock = vi.mocked(resolveTenantForUser);
const createInvitationMock = vi.mocked(createInvitation);
const listInvitationsMock = vi.mocked(listInvitations);
const resendInvitationMock = vi.mocked(resendInvitation);
const cancelInvitationMock = vi.mocked(cancelInvitation);
const validateTokenMock = vi.mocked(validateInvitationToken);
const acceptInvitationMock = vi.mocked(acceptInvitation);
const acceptExistingMock = vi.mocked(acceptExistingInvitation);

const NORMAL_USER = { id: 5, role: "user" as const, openId: "u5", name: "Fulano", email: "fulano@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

function membership(role: "owner" | "admin" | "manager" | "operator" | "viewer") {
  return { id: 1, organizationId: 700001, userId: 5, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() };
}

function callerAs(role: "owner" | "admin" | "manager" | "operator" | "viewer") {
  resolveTenantMock.mockResolvedValue({ organizationId: 700001, membership: membership(role) } as never);
  return invitationsRouter.createCaller(makeContext(NORMAL_USER as never) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("invitationsRouter · gate de papel (admin) em create/list/resend/cancel", () => {
  it("viewer NÃO pode criar convite", async () => {
    await expect(callerAs("viewer").create({ email: "x@y.com", role: "operator" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("admin PODE criar convite", async () => {
    createInvitationMock.mockResolvedValue({ id: 1, status: "pending", expiresAt: new Date() } as never);
    await expect(callerAs("admin").create({ email: "x@y.com", role: "operator" })).resolves.toMatchObject({ id: 1 });
    expect(createInvitationMock).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 700001, email: "x@y.com", role: "operator" }));
  });

  it("manager NÃO pode listar convites (exige admin)", async () => {
    await expect(callerAs("manager").list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner PODE listar convites", async () => {
    listInvitationsMock.mockResolvedValue([]);
    await expect(callerAs("owner").list()).resolves.toEqual([]);
  });

  it("role='owner' é rejeitado no input do create (owner só via onboarding de tenant)", async () => {
    await expect(callerAs("admin").create({ email: "x@y.com", role: "owner" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it("resend e cancel também exigem admin", async () => {
    await expect(callerAs("operator").resend({ invitationId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerAs("operator").cancel({ invitationId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resendInvitationMock).not.toHaveBeenCalled();
    expect(cancelInvitationMock).not.toHaveBeenCalled();
  });
});

describe("invitationsRouter · validateToken (público)", () => {
  it("não exige autenticação nem papel — repassa o resultado do service", async () => {
    validateTokenMock.mockResolvedValue({ valid: true, organizationName: "X", role: "operator", emailNormalized: "a@b.com" });
    const caller = invitationsRouter.createCaller(makeContext(null) as never);
    const result = await caller.validateToken({ token: "a".repeat(43) });
    expect(result.valid).toBe(true);
  });
});

describe("invitationsRouter · accept (conta nova)", () => {
  it("cria sessão (cookie) após aceitar, retorna organizationId", async () => {
    acceptInvitationMock.mockResolvedValue({ userId: 10, openId: "oid-novo", name: "Novo", organizationId: 700001 });
    const caller = invitationsRouter.createCaller(makeContext(null) as never);
    const result = await caller.accept({ token: "a".repeat(43), name: "Novo Usuário", password: "senhaForte123" });
    expect(result).toEqual({ success: true, organizationId: 700001 });
    expect(acceptInvitationMock).toHaveBeenCalledWith(expect.objectContaining({ token: "a".repeat(43), name: "Novo Usuário" }));
  });

  it("nome curto demais é rejeitado pelo zod antes do service", async () => {
    const caller = invitationsRouter.createCaller(makeContext(null) as never);
    await expect(caller.accept({ token: "a".repeat(43), name: "A", password: "senhaForte123" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
  });
});

describe("invitationsRouter · acceptExisting (protegido)", () => {
  it("exige sessão autenticada", async () => {
    const caller = invitationsRouter.createCaller(makeContext(null) as never);
    await expect(caller.acceptExisting({ token: "a".repeat(43) })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("usuário sem e-mail cadastrado → BAD_REQUEST", async () => {
    const userNoEmail = { ...NORMAL_USER, email: null };
    const caller = invitationsRouter.createCaller(makeContext(userNoEmail as never) as never);
    await expect(caller.acceptExisting({ token: "a".repeat(43) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("caminho feliz: repassa userId/userEmail da sessão ao service", async () => {
    acceptExistingMock.mockResolvedValue({ organizationId: 700001 });
    const caller = invitationsRouter.createCaller(makeContext(NORMAL_USER as never) as never);
    const result = await caller.acceptExisting({ token: "a".repeat(43) });
    expect(result).toEqual({ success: true, organizationId: 700001 });
    expect(acceptExistingMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 5, userEmail: "fulano@x.com" }));
  });
});
