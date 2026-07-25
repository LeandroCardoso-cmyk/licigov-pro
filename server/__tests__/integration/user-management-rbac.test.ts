/**
 * PR A.1 (homologação — Seção 8) — Matriz RBAC da gestão de usuários no BACKEND.
 *
 * Prova, para CADA papel organizacional (owner/admin/manager/operator/viewer), o que é permitido e
 * o que retorna FORBIDDEN em TODAS as procedures de gestão (listar membros/convites, criar/reenviar/
 * cancelar convite, alterar papel, ativar/desativar/remover). A autorização é do backend
 * (orgRoleProcedure("admin")) — o frontend nunca é considerado proteção. Serviços de domínio são
 * mockados (já testados isoladamente); o foco é o gate de papel + isolamento de tenant.
 *
 * Regra vigente: gestão de usuários exige papel mínimo `admin` → apenas `admin` e `owner`.
 * `manager`, `operator` e `viewer` recebem FORBIDDEN.
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
vi.mock("../../db/organizations", () => ({
  getOrganizationById: vi.fn().mockResolvedValue({ id: 700001, nome: "Org" }),
  getMembersOfOrg: vi.fn().mockResolvedValue([]),
  getAllMembersOfOrg: vi.fn().mockResolvedValue([]),
  getMembersWithUserInfo: vi.fn().mockResolvedValue([]),
  getAllOrganizations: vi.fn().mockResolvedValue([]),
  addMemberToOrg: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMemberFromOrg: vi.fn(),
  getUserOrganizations: vi.fn(),
  updateOrganization: vi.fn(),
  createOrganization: vi.fn(),
  countActiveAdmins: vi.fn().mockResolvedValue(5),
  setMemberAtivo: vi.fn(),
}));
vi.mock("../../db", () => ({ getUserByEmail: vi.fn() }));
vi.mock("../../services/activityLogService", () => ({ logFromCtx: vi.fn() }));
vi.mock("../../services/invitationService", () => ({
  createInvitation: vi.fn().mockResolvedValue({ id: 1, status: "pending", expiresAt: new Date() }),
  listInvitations: vi.fn().mockResolvedValue([]),
  resendInvitation: vi.fn().mockResolvedValue({ id: 1, status: "pending", expiresAt: new Date() }),
  cancelInvitation: vi.fn().mockResolvedValue(undefined),
  validateInvitationToken: vi.fn(),
  acceptInvitation: vi.fn(),
  acceptExistingInvitation: vi.fn(),
}));

import { resolveTenantForUser } from "../../services/tenantService";
import { getAllMembersOfOrg } from "../../db/organizations";
import { organizationsRouter } from "../../routers/organizationsRouter";
import { invitationsRouter } from "../../routers/invitationsRouter";

const resolveTenantMock = vi.mocked(resolveTenantForUser);
const getAllMembersMock = vi.mocked(getAllMembersOfOrg);

type OrgRole = "owner" | "admin" | "manager" | "operator" | "viewer";
const NORMAL_USER = { id: 5, role: "user" as const, openId: "u5", name: "Fulano", email: "fulano@x.com", theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

function membership(role: OrgRole) {
  return { id: 1, organizationId: 700001, userId: 5, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() };
}
function orgCaller(role: OrgRole) {
  resolveTenantMock.mockResolvedValue({ organizationId: 700001, membership: membership(role) } as never);
  return organizationsRouter.createCaller(makeContext(NORMAL_USER as never) as never);
}
function invCaller(role: OrgRole) {
  resolveTenantMock.mockResolvedValue({ organizationId: 700001, membership: membership(role) } as never);
  return invitationsRouter.createCaller(makeContext(NORMAL_USER as never) as never);
}

const ADMIN_ROLES: OrgRole[] = ["owner", "admin"];
const NON_ADMIN_ROLES: OrgRole[] = ["manager", "operator", "viewer"];

beforeEach(() => {
  vi.clearAllMocks();
  getAllMembersMock.mockResolvedValue([{ userId: 99, organizationId: 700001, role: "operator", ativo: true } as never]);
});

// Cada entrada: nome + invocação da procedure via caller do papel.
const ORG_ACTIONS: Array<{ name: string; run: (role: OrgRole) => Promise<unknown> }> = [
  { name: "listAllMembersWithUsers", run: (r) => orgCaller(r).listAllMembersWithUsers() },
  { name: "listAllMembers", run: (r) => orgCaller(r).listAllMembers() },
  { name: "updateMemberRole", run: (r) => orgCaller(r).updateMemberRole({ userId: 99, role: "viewer" }) },
  { name: "deactivateMember", run: (r) => orgCaller(r).deactivateMember({ userId: 99 }) },
  { name: "activateMember", run: (r) => orgCaller(r).activateMember({ userId: 99 }) },
  { name: "removeMember", run: (r) => orgCaller(r).removeMember({ userId: 99 }) },
];
const INV_ACTIONS: Array<{ name: string; run: (role: OrgRole) => Promise<unknown> }> = [
  { name: "invitations.list", run: (r) => invCaller(r).list() },
  { name: "invitations.create", run: (r) => invCaller(r).create({ email: "x@y.com", role: "operator" }) },
  { name: "invitations.resend", run: (r) => invCaller(r).resend({ invitationId: 1 }) },
  { name: "invitations.cancel", run: (r) => invCaller(r).cancel({ invitationId: 1 }) },
];
const ALL_ACTIONS = [...ORG_ACTIONS, ...INV_ACTIONS];

describe("RBAC · papéis SEM permissão administrativa → FORBIDDEN em toda procedure de gestão", () => {
  for (const role of NON_ADMIN_ROLES) {
    for (const action of ALL_ACTIONS) {
      it(`${role} NÃO pode ${action.name}`, async () => {
        await expect(action.run(role)).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    }
  }
});

describe("RBAC · admin e owner PODEM executar a gestão de usuários", () => {
  for (const role of ADMIN_ROLES) {
    for (const action of ALL_ACTIONS) {
      it(`${role} pode ${action.name} (não recebe FORBIDDEN por papel)`, async () => {
        // Não deve lançar FORBIDDEN. (Pode resolver ok ou lançar erro de negócio de outra
        // natureza, mas nunca o gate de papel.)
        try {
          await action.run(role);
        } catch (err) {
          expect((err as { code?: string }).code).not.toBe("FORBIDDEN");
        }
      });
    }
  }
});

describe("RBAC · sem sessão → UNAUTHORIZED (nunca alcança a procedure)", () => {
  it("listAllMembersWithUsers sem usuário autenticado", async () => {
    const caller = organizationsRouter.createCaller(makeContext(null) as never);
    await expect(caller.listAllMembersWithUsers()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("invitations.create sem usuário autenticado", async () => {
    const caller = invitationsRouter.createCaller(makeContext(null) as never);
    await expect(caller.create({ email: "x@y.com", role: "operator" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
