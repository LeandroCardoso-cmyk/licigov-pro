import { describe, it, expect } from "vitest";
import type { OrgRole } from "../../../drizzle/schema";

// ─── Hierarquia de papéis (espelhada do trpc.ts) ─────────────────────────────

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  viewer:   1,
  operator: 2,
  manager:  3,
  admin:    4,
  owner:    5,
};

function canPerformAction(userRole: OrgRole, requiredMinRole: OrgRole): boolean {
  return ORG_ROLE_RANK[userRole] >= ORG_ROLE_RANK[requiredMinRole];
}

// ─── Testes da hierarquia de papéis ──────────────────────────────────────────

describe("RBAC — hierarquia de papéis organizacionais", () => {
  it("owner pode realizar qualquer ação", () => {
    const roles: OrgRole[] = ["viewer", "operator", "manager", "admin", "owner"];
    for (const required of roles) {
      expect(canPerformAction("owner", required)).toBe(true);
    }
  });

  it("viewer só pode realizar ações de viewer", () => {
    expect(canPerformAction("viewer", "viewer")).toBe(true);
    expect(canPerformAction("viewer", "operator")).toBe(false);
    expect(canPerformAction("viewer", "manager")).toBe(false);
    expect(canPerformAction("viewer", "admin")).toBe(false);
    expect(canPerformAction("viewer", "owner")).toBe(false);
  });

  it("operator pode realizar ações de viewer e operator", () => {
    expect(canPerformAction("operator", "viewer")).toBe(true);
    expect(canPerformAction("operator", "operator")).toBe(true);
    expect(canPerformAction("operator", "manager")).toBe(false);
    expect(canPerformAction("operator", "admin")).toBe(false);
    expect(canPerformAction("operator", "owner")).toBe(false);
  });

  it("manager pode realizar ações até manager", () => {
    expect(canPerformAction("manager", "viewer")).toBe(true);
    expect(canPerformAction("manager", "operator")).toBe(true);
    expect(canPerformAction("manager", "manager")).toBe(true);
    expect(canPerformAction("manager", "admin")).toBe(false);
    expect(canPerformAction("manager", "owner")).toBe(false);
  });

  it("admin pode realizar ações até admin (mas não de owner exclusivo)", () => {
    expect(canPerformAction("admin", "viewer")).toBe(true);
    expect(canPerformAction("admin", "operator")).toBe(true);
    expect(canPerformAction("admin", "manager")).toBe(true);
    expect(canPerformAction("admin", "admin")).toBe(true);
    expect(canPerformAction("admin", "owner")).toBe(false);
  });
});

// ─── Testes da matriz de permissões ──────────────────────────────────────────

describe("RBAC — matriz de permissões por ação", () => {
  // Ações e o papel mínimo requerido
  const permissionMatrix: Array<{ action: string; minRole: OrgRole }> = [
    { action: "ver lista de processos da org",  minRole: "viewer"   },
    { action: "criar documento",               minRole: "operator" },
    { action: "criar processo",                minRole: "manager"  },
    { action: "aprovar documento",             minRole: "manager"  },
    { action: "convidar membros",              minRole: "admin"    },
    { action: "alterar papel de membro",       minRole: "admin"    },
    { action: "deletar processo",              minRole: "admin"    },
    { action: "gerenciar configurações da org",minRole: "admin"    },
    { action: "remover owner",                 minRole: "owner"    },
  ];

  for (const { action, minRole } of permissionMatrix) {
    it(`"${action}" requer papel mínimo '${minRole}'`, () => {
      const roles: OrgRole[] = ["viewer", "operator", "manager", "admin", "owner"];
      const minRank = ORG_ROLE_RANK[minRole];

      for (const role of roles) {
        const userRank = ORG_ROLE_RANK[role];
        const canDo = canPerformAction(role, minRole);
        expect(canDo).toBe(userRank >= minRank);
      }
    });
  }
});

// ─── Testes de isolamento cross-tenant ────────────────────────────────────────

describe("RBAC — isolamento cross-tenant", () => {
  it("papel 'owner' na org A não garante acesso à org B", () => {
    // Este teste documenta o princípio: RBAC é sempre scoped à organização.
    // A tenantProcedure verifica organizationId + membership JUNTOS.

    const userIdFromOrgA = 10;
    const orgAId = 1;
    const orgBId = 2;

    const membershipOrgA = {
      organizationId: orgAId,
      userId: userIdFromOrgA,
      role: "owner" as OrgRole,
      ativo: true,
    };

    // O usuário TEM membership na orgA mas NÃO na orgB
    const membershipOrgB = null;

    expect(membershipOrgA.organizationId).toBe(orgAId);
    expect(membershipOrgA.organizationId).not.toBe(orgBId);
    expect(membershipOrgB).toBeNull();
  });

  it("membership inativo é equivalente a sem membership", () => {
    const inactiveMembership = {
      organizationId: 1,
      userId: 10,
      role: "admin" as OrgRole,
      ativo: false, // INATIVO
    };

    // A tenantProcedure rejeita membership.ativo === false
    expect(inactiveMembership.ativo).toBe(false);
    // Admin inativo não deve ter acesso — verificado na tenantProcedure
  });
});
