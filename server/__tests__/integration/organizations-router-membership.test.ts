/**
 * PR A.1 — organizationsRouter.ts: listAllMembers/activateMember/deactivateMember (novos) e a
 * proteção "último admin" aplicada a updateMemberRole/removeMember/deactivateMember. `db/organizations`
 * é mockado (já testado isoladamente); foco no CONTRATO do router — quem pode fazer o quê, e a
 * proteção contra deixar a organização sem nenhum admin/owner ativo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeContext } from "../helpers/fixtures";

vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn(),
  getMembersOfOrg: vi.fn(),
  getAllMembersOfOrg: vi.fn(),
  addMemberToOrg: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMemberFromOrg: vi.fn(),
  getUserOrganizations: vi.fn(),
  updateOrganization: vi.fn(),
  createOrganization: vi.fn(),
  countActiveAdmins: vi.fn(),
  setMemberAtivo: vi.fn(),
  getMembersWithUserInfo: vi.fn(),
  getAllOrganizations: vi.fn(),
}));
vi.mock("../../db", () => ({ getUserByEmail: vi.fn() }));
vi.mock("../../services/activityLogService", () => ({ logFromCtx: vi.fn() }));

import {
  getAllMembersOfOrg,
  updateMemberRole as updateMemberRoleDb,
  removeMemberFromOrg,
  countActiveAdmins,
  setMemberAtivo,
  getMembersWithUserInfo,
  getAllOrganizations,
} from "../../db/organizations";
import { organizationsRouter } from "../../routers/organizationsRouter";

const getAllMembersOfOrgMock = vi.mocked(getAllMembersOfOrg);
const updateMemberRoleDbMock = vi.mocked(updateMemberRoleDb);
const removeMemberFromOrgMock = vi.mocked(removeMemberFromOrg);
const countActiveAdminsMock = vi.mocked(countActiveAdmins);
const setMemberAtivoMock = vi.mocked(setMemberAtivo);
const getMembersWithUserInfoMock = vi.mocked(getMembersWithUserInfo);
const getAllOrganizationsMock = vi.mocked(getAllOrganizations);

// Admin de plataforma → bypass sintético do tenantProcedure (owner, organizationId do header).
const ADMIN_USER = { id: 1, role: "admin" as const, openId: "admin", name: "Admin", email: "admin@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

function member(userId: number, role: "owner" | "admin" | "manager" | "operator" | "viewer", ativo = true) {
  return { id: userId, organizationId: 1, userId, role, invitedBy: null, ativo, createdAt: new Date(), updatedAt: new Date() };
}

function caller() {
  const ctx = makeContext(ADMIN_USER as never);
  return organizationsRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("organizationsRouter · listAllMembers", () => {
  it("retorna todos os membros (ativos e inativos)", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "admin"), member(11, "operator", false)]);
    const result = await caller().listAllMembers();
    expect(result).toHaveLength(2);
  });
});

describe("organizationsRouter · updateMemberRole — proteção de último admin", () => {
  it("rebaixar o ÚNICO admin ativo (countActiveAdmins=1) → CONFLICT/LAST_TENANT_ADMIN", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([]);
    const { getMembersOfOrg } = await import("../../db/organizations");
    vi.mocked(getMembersOfOrg).mockResolvedValue([member(10, "admin")]);
    countActiveAdminsMock.mockResolvedValue(1);

    await expect(caller().updateMemberRole({ userId: 10, role: "operator" })).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
    expect(updateMemberRoleDbMock).not.toHaveBeenCalled();
  });

  it("rebaixar um admin quando HÁ outro admin/owner ativo (countActiveAdmins=2) → permitido", async () => {
    const { getMembersOfOrg } = await import("../../db/organizations");
    vi.mocked(getMembersOfOrg).mockResolvedValue([member(10, "admin")]);
    countActiveAdminsMock.mockResolvedValue(2);

    await expect(caller().updateMemberRole({ userId: 10, role: "operator" })).resolves.toEqual({ success: true });
    expect(updateMemberRoleDbMock).toHaveBeenCalledWith(1, 10, "operator");
  });

  it("promover (não rebaixar) nunca aciona a checagem de último admin", async () => {
    const { getMembersOfOrg } = await import("../../db/organizations");
    vi.mocked(getMembersOfOrg).mockResolvedValue([member(10, "operator")]);
    await caller().updateMemberRole({ userId: 10, role: "admin" });
    expect(countActiveAdminsMock).not.toHaveBeenCalled();
  });
});

describe("organizationsRouter · removeMember — proteção de último admin", () => {
  it("remover o ÚNICO admin ativo → LAST_TENANT_ADMIN", async () => {
    const { getMembersOfOrg } = await import("../../db/organizations");
    vi.mocked(getMembersOfOrg).mockResolvedValue([member(10, "admin")]);
    countActiveAdminsMock.mockResolvedValue(1);
    await expect(caller().removeMember({ userId: 10 })).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
    expect(removeMemberFromOrgMock).not.toHaveBeenCalled();
  });

  it("remover um operator nunca aciona a checagem (não é admin)", async () => {
    const { getMembersOfOrg } = await import("../../db/organizations");
    vi.mocked(getMembersOfOrg).mockResolvedValue([member(10, "operator")]);
    await caller().removeMember({ userId: 10 });
    expect(countActiveAdminsMock).not.toHaveBeenCalled();
    expect(removeMemberFromOrgMock).toHaveBeenCalledWith(1, 10);
  });
});

describe("organizationsRouter · deactivateMember", () => {
  it("não pode desativar a si mesmo", async () => {
    await expect(caller().deactivateMember({ userId: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("membro não encontrado → NOT_FOUND/MEMBER_NOT_FOUND", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([]);
    await expect(caller().deactivateMember({ userId: 99 })).rejects.toMatchObject({ message: "MEMBER_NOT_FOUND" });
  });

  it("owner não pode ser desativado", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "owner")]);
    await expect(caller().deactivateMember({ userId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("já inativo → idempotente, retorna sucesso sem tocar o banco de novo", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "operator", false)]);
    const result = await caller().deactivateMember({ userId: 10 });
    expect(result).toEqual({ success: true });
    expect(setMemberAtivoMock).not.toHaveBeenCalled();
  });

  it("último admin ativo → LAST_TENANT_ADMIN, não desativa", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "admin", true)]);
    countActiveAdminsMock.mockResolvedValue(1);
    await expect(caller().deactivateMember({ userId: 10 })).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
    expect(setMemberAtivoMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: desativa e audita", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "operator", true)]);
    const result = await caller().deactivateMember({ userId: 10 });
    expect(result).toEqual({ success: true });
    expect(setMemberAtivoMock).toHaveBeenCalledWith(1, 10, false);
  });
});

describe("organizationsRouter · activateMember", () => {
  it("membro não encontrado → NOT_FOUND", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([]);
    await expect(caller().activateMember({ userId: 99 })).rejects.toMatchObject({ message: "MEMBER_NOT_FOUND" });
  });

  it("já ativo → idempotente", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "operator", true)]);
    const result = await caller().activateMember({ userId: 10 });
    expect(result).toEqual({ success: true });
    expect(setMemberAtivoMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: reativa um membro desativado", async () => {
    getAllMembersOfOrgMock.mockResolvedValue([member(10, "operator", false)]);
    const result = await caller().activateMember({ userId: 10 });
    expect(result).toEqual({ success: true });
    expect(setMemberAtivoMock).toHaveBeenCalledWith(1, 10, true);
  });
});

describe("organizationsRouter · listAllMembersWithUsers", () => {
  it("retorna membros com dados do usuário SANITIZADOS (nunca passwordHash)", async () => {
    getMembersWithUserInfoMock.mockResolvedValue([
      {
        member: member(10, "admin"),
        user: {
          id: 10, openId: "o10", name: "Fulano", email: "fulano@x.com", role: "user", theme: "light",
          loginMethod: "email", passwordHash: "$2b$12$secreto", signaturePassword: null, tokenVersion: 0,
          createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
        } as never,
      },
    ]);
    const result = await caller().listAllMembersWithUsers();
    expect(result).toHaveLength(1);
    expect(result[0].user).not.toHaveProperty("passwordHash");
    expect(result[0].user.email).toBe("fulano@x.com");
    expect(result[0].role).toBe("admin");
  });
});

describe("organizationsRouter · adminList", () => {
  it("retorna todas as organizações (admin de plataforma)", async () => {
    getAllOrganizationsMock.mockResolvedValue([
      { id: 1, nome: "Org 1", cnpj: null, slug: "org-1", esfera: "municipal", uf: "SP", municipio: "SP", ativo: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const result = await caller().adminList();
    expect(result).toHaveLength(1);
  });

  it("usuário comum (não admin de plataforma) → FORBIDDEN", async () => {
    const ctx = makeContext({ id: 5, role: "user" as const, openId: "u5", name: "Fulano", email: "fulano@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as never);
    const normalCaller = organizationsRouter.createCaller(ctx as never);
    await expect(normalCaller.adminList()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
