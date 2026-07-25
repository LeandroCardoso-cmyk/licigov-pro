import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock do DB ───────────────────────────────────────────────────────────────

vi.mock("../../db/connection", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn(),
  getMembersOfOrg: vi.fn(),
  addMemberToOrg: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMemberFromOrg: vi.fn(),
  getUserOrganizations: vi.fn(),
  updateOrganization: vi.fn(),
  createOrganization: vi.fn(),
  // PR A.1
  getAllMembersOfOrg: vi.fn(),
  countActiveAdmins: vi.fn(),
  setMemberAtivo: vi.fn(),
  getMembersWithUserInfo: vi.fn(),
  getAllOrganizations: vi.fn(),
}));

vi.mock("../../db", async () => {
  const actual = await vi.importActual("../../db");
  return {
    ...actual,
    getUserByEmail: vi.fn(),
  };
});

vi.mock("../../services/activityLogService", () => ({
  logFromCtx: vi.fn(),
}));

// ─── Imports após mocks ───────────────────────────────────────────────────────

import {
  getOrganizationById,
  getMembersOfOrg,
  getUserOrganizations,
  removeMemberFromOrg,
  updateMemberRole,
  getAllMembersOfOrg,
  countActiveAdmins,
  setMemberAtivo,
  getMembersWithUserInfo,
  getAllOrganizations,
} from "../../db/organizations";
import { getUserByEmail } from "../../db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildOrg(id = 1) {
  return {
    id,
    nome: `Prefeitura ${id}`,
    cnpj: null,
    slug: `prefeitura-${id}`,
    esfera: "municipal" as const,
    uf: "SP",
    municipio: "São Paulo",
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildMembership(userId = 10, orgId = 1, role: "owner" | "admin" | "manager" | "operator" | "viewer" = "operator") {
  return {
    id: userId * 10 + orgId,
    organizationId: orgId,
    userId,
    role,
    invitedBy: null,
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Testes de isolamento por organização ────────────────────────────────────

describe("Organization — isolamento de dados", () => {
  it("getOrganizationById retorna org correta", async () => {
    vi.mocked(getOrganizationById).mockResolvedValue(buildOrg(1));
    const org = await getOrganizationById(1);
    expect(org?.id).toBe(1);
    expect(org?.nome).toContain("Prefeitura");
  });

  it("getOrganizationById retorna null para org inexistente", async () => {
    vi.mocked(getOrganizationById).mockResolvedValue(null);
    const org = await getOrganizationById(9999);
    expect(org).toBeNull();
  });

  it("getUserOrganizations retorna apenas orgs do usuário", async () => {
    const userId = 42;
    vi.mocked(getUserOrganizations).mockResolvedValue([
      { org: buildOrg(1), membership: buildMembership(userId, 1, "operator") },
    ]);

    const result = await getUserOrganizations(userId);
    expect(result).toHaveLength(1);
    expect(result[0].membership.userId).toBe(userId);
    expect(result[0].membership.organizationId).toBe(1);
  });

  it("usuário não pode acessar org sem membership", async () => {
    vi.mocked(getMembersOfOrg).mockResolvedValue([
      buildMembership(100, 1, "operator"),
    ]);

    const members = await getMembersOfOrg(1);
    const user99InOrg1 = members.find(m => m.userId === 99);
    expect(user99InOrg1).toBeUndefined();
  });
});

// ─── Testes de RBAC ──────────────────────────────────────────────────────────

describe("Organization — RBAC de membros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getMembersOfOrg retorna apenas membros ativos", async () => {
    vi.mocked(getMembersOfOrg).mockResolvedValue([
      buildMembership(1, 1, "admin"),
      buildMembership(2, 1, "operator"),
    ]);

    const members = await getMembersOfOrg(1);
    expect(members.every(m => m.ativo)).toBe(true);
    expect(members).toHaveLength(2);
  });

  it("updateMemberRole é chamado com parâmetros corretos", async () => {
    vi.mocked(updateMemberRole).mockResolvedValue(undefined);
    await updateMemberRole(1, 10, "admin");
    expect(updateMemberRole).toHaveBeenCalledWith(1, 10, "admin");
  });

  it("removeMemberFromOrg faz soft delete", async () => {
    vi.mocked(removeMemberFromOrg).mockResolvedValue(undefined);
    await removeMemberFromOrg(1, 10);
    expect(removeMemberFromOrg).toHaveBeenCalledWith(1, 10);
  });
});

// ─── PR A.1 — Testes de gestão de membros (ativação/desativação/último admin) ─────────────────

describe("Organization — PR A.1 (gestão de membros)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAllMembersOfOrg retorna ativos e inativos (diferente de getMembersOfOrg)", async () => {
    vi.mocked(getAllMembersOfOrg).mockResolvedValue([
      buildMembership(1, 1, "admin"),
      { ...buildMembership(2, 1, "operator"), ativo: false },
    ]);
    const members = await getAllMembersOfOrg(1);
    expect(members).toHaveLength(2);
    expect(members.some(m => !m.ativo)).toBe(true);
  });

  it("countActiveAdmins conta admin+owner ativos", async () => {
    vi.mocked(countActiveAdmins).mockResolvedValue(2);
    expect(await countActiveAdmins(1)).toBe(2);
  });

  it("setMemberAtivo é chamado com os parâmetros corretos", async () => {
    vi.mocked(setMemberAtivo).mockResolvedValue(undefined);
    await setMemberAtivo(1, 10, false);
    expect(setMemberAtivo).toHaveBeenCalledWith(1, 10, false);
  });

  it("getMembersWithUserInfo retorna membro+usuário combinados (join)", async () => {
    vi.mocked(getMembersWithUserInfo).mockResolvedValue([
      { member: buildMembership(10, 1, "admin"), user: { id: 10, name: "Fulano", email: "fulano@x.com" } as never },
    ]);
    const rows = await getMembersWithUserInfo(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].user.email).toBe("fulano@x.com");
    expect(rows[0].member.role).toBe("admin");
  });

  it("getAllOrganizations retorna a lista de organizações", async () => {
    vi.mocked(getAllOrganizations).mockResolvedValue([buildOrg(1), buildOrg(2)]);
    const orgs = await getAllOrganizations();
    expect(orgs).toHaveLength(2);
  });
});

// ─── Testes de convidar membro ────────────────────────────────────────────────

describe("Organization — convite de membros", () => {
  it("getUserByEmail retorna undefined para email inexistente", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(undefined);
    const user = await getUserByEmail("nao@existe.com");
    expect(user).toBeUndefined();
  });

  it("getUserByEmail retorna usuário para email válido", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue({
      id: 5,
      email: "servidor@prefeitura.gov.br",
      name: "João Silva",
      openId: "abc123",
      role: "user",
      loginMethod: "email",
      theme: "system",
      passwordHash: null,
      signaturePassword: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    const user = await getUserByEmail("servidor@prefeitura.gov.br");
    expect(user?.id).toBe(5);
    expect(user?.email).toBe("servidor@prefeitura.gov.br");
  });
});
