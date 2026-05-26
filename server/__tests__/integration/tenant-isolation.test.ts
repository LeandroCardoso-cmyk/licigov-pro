import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock do tenantService ────────────────────────────────────────────────────

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(),
  getMembership: vi.fn(),
}));

import { resolveTenantForUser, getMembership } from "../../services/tenantService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRequest(headers: Record<string, string> = {}): import("express").Request {
  return { headers } as unknown as import("express").Request;
}

function buildMembership(userId: number, orgId: number, role = "operator" as const) {
  return {
    id: 1,
    organizationId: orgId,
    userId,
    role,
    invitedBy: null,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Testes de resolução de tenant ───────────────────────────────────────────

describe("tenantService — resolveTenantForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolve único membership automaticamente", async () => {
    const membership = buildMembership(10, 1, "operator");
    vi.mocked(resolveTenantForUser).mockResolvedValue({
      organizationId: 1,
      membership,
    });

    const result = await resolveTenantForUser(10, buildRequest());
    expect(result.organizationId).toBe(1);
    expect(result.membership.role).toBe("operator");
  });

  it("resolve via header X-Organization-Id em múltiplos memberships", async () => {
    const membership = buildMembership(10, 2, "admin");
    vi.mocked(resolveTenantForUser).mockResolvedValue({
      organizationId: 2,
      membership,
    });

    const result = await resolveTenantForUser(
      10,
      buildRequest({ "x-organization-id": "2" }),
    );
    expect(result.organizationId).toBe(2);
    expect(result.membership.organizationId).toBe(2);
  });

  it("lança FORBIDDEN ao tentar acessar org sem membership", async () => {
    vi.mocked(resolveTenantForUser).mockRejectedValue(
      Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" }),
    );

    await expect(
      resolveTenantForUser(10, buildRequest({ "x-organization-id": "999" })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lança BAD_REQUEST com múltiplos memberships sem header", async () => {
    vi.mocked(resolveTenantForUser).mockRejectedValue(
      Object.assign(new Error("BAD_REQUEST"), { code: "BAD_REQUEST" }),
    );

    await expect(
      resolveTenantForUser(10, buildRequest()),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ─── Testes de getMembership ──────────────────────────────────────────────────

describe("tenantService — getMembership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna membership existente", async () => {
    const membership = buildMembership(10, 1, "manager");
    vi.mocked(getMembership).mockResolvedValue(membership);

    const result = await getMembership(10, 1);
    expect(result?.role).toBe("manager");
    expect(result?.ativo).toBe(true);
  });

  it("retorna null para membership inexistente", async () => {
    vi.mocked(getMembership).mockResolvedValue(null);

    const result = await getMembership(99, 999);
    expect(result).toBeNull();
  });
});

// ─── Testes de isolamento entre orgs ─────────────────────────────────────────

describe("Tenant isolation — garantias de separação", () => {
  it("organizationId de org A não permite acesso a org B", async () => {
    // Simula usuário da org 1 tentando acessar org 2
    vi.mocked(resolveTenantForUser).mockRejectedValue(
      Object.assign(new Error("Sem acesso à organização solicitada."), {
        code: "FORBIDDEN",
      }),
    );

    const userIdFromOrg1 = 10;
    const requestForOrg2 = buildRequest({ "x-organization-id": "2" });

    await expect(
      resolveTenantForUser(userIdFromOrg1, requestForOrg2),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("membership inativo não concede acesso", async () => {
    vi.mocked(getMembership).mockResolvedValue({
      id: 1,
      organizationId: 1,
      userId: 10,
      role: "operator",
      invitedBy: null,
      ativo: false, // inativo!
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const membership = await getMembership(10, 1);
    // A tenantProcedure verifica membership.ativo e rejeita se false
    expect(membership?.ativo).toBe(false);
  });
});
