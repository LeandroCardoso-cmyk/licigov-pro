/**
 * PR A.1 (homologação — Seção 3/8) — helper central de permissões organizacionais (frontend).
 * Deve espelhar o RBAC do backend: gestão de usuários exige papel mínimo `admin`.
 */

import { describe, it, expect } from "vitest";
import { ORG_ROLE_RANK, hasOrgRole, canManageOrgUsers, type OrgRole } from "./orgPermissions";

describe("orgPermissions · ranking", () => {
  it("espelha o ORG_ROLE_RANK do backend (viewer<operator<manager<admin<owner)", () => {
    expect(ORG_ROLE_RANK).toEqual({ viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 });
  });

  it("hasOrgRole compara por rank; null/undefined nunca tem papel", () => {
    expect(hasOrgRole("owner", "admin")).toBe(true);
    expect(hasOrgRole("admin", "admin")).toBe(true);
    expect(hasOrgRole("manager", "admin")).toBe(false);
    expect(hasOrgRole(null, "viewer")).toBe(false);
    expect(hasOrgRole(undefined, "viewer")).toBe(false);
  });
});

describe("orgPermissions · canManageOrgUsers (só admin e owner)", () => {
  const cases: Array<[OrgRole | null, boolean]> = [
    ["owner", true],
    ["admin", true],
    ["manager", false],
    ["operator", false],
    ["viewer", false],
    [null, false],
  ];
  for (const [role, expected] of cases) {
    it(`${role ?? "sem papel"} → ${expected}`, () => {
      expect(canManageOrgUsers(role)).toBe(expected);
    });
  }
});
