/**
 * RC-SEC-PR-A (RBAC-004) — Matriz de autorização do onboarding
 * (`grantDepartmentPermission`) contra MySQL REAL. Só roda com DATABASE_URL.
 *
 * Cobre negativos (anônimo, operador, viewer, auto-concessão, escopo global por
 * admin de órgão, alvo de outro tenant, alvo inexistente) e positivos (admin de
 * órgão concede na própria org; admin de plataforma concede escopo global).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 951001;
const ORG_B = 951002;

describe.skipIf(!DB)("RC-SEC-PR-A — RBAC de onboarding.grantDepartmentPermission (MySQL real)", () => {
  let conn: mysql.Connection;
  let adminA: number;    // membership role 'admin' na org A (não é admin de plataforma)
  let operatorA: number; // membership role 'operator' na org A
  let viewerA: number;   // membership role 'viewer' na org A
  let targetA: number;   // membership 'operator' na org A (alvo válido)
  let memberB: number;   // membership na org B
  let platformAdmin: number; // users.role = 'admin'
  let noMember: number;  // sem membership

  const grantInput = {
    userId: 0,
    department: "licitacoes",
    resource: "processo" as const,
    actions: ["read"] as const,
    scope: "department" as const,
  };

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const stamp = Date.now();
    async function insertUser(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`rbac-${tag}-${stamp}`, `Usuário ${tag}`, `rbac-${tag}-${stamp}@teste.local`, role],
      );
      return r.insertId;
    }
    adminA = await insertUser("admina");
    operatorA = await insertUser("opa");
    viewerA = await insertUser("viewa");
    targetA = await insertUser("targeta");
    memberB = await insertUser("memberb");
    platformAdmin = await insertUser("platform", "admin");
    noMember = await insertUser("nomember");

    const member = async (org: number, uid: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, uid, role]);
    await member(ORG_A, adminA, "admin");
    await member(ORG_A, operatorA, "operator");
    await member(ORG_A, viewerA, "viewer");
    await member(ORG_A, targetA, "operator");
    await member(ORG_B, memberB, "owner");
    await member(ORG_A, platformAdmin, "operator"); // admin de plataforma opera via header
  });

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id IN (?, ?, ?, ?, ?, ?, ?)`,
        [adminA, operatorA, viewerA, targetA, memberB, platformAdmin, noMember]).catch(() => {});
      await conn.end();
    }
  });

  async function caller(userId: number | null, role: "user" | "admin" = "user", headers: Record<string, string> = {}) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: userId == null ? null : { id: userId, role, name: `U${userId}`, email: `u${userId}@teste.local` } as any,
      req: { headers } as any,
      res: {} as any,
      correlationId: "test-rbac",
    } as any);
  }
  const grant = (extra: Partial<typeof grantInput> = {}) => ({ ...grantInput, ...extra });

  // ── Negativos ────────────────────────────────────────────────────────────────
  it("1. anônimo → UNAUTHORIZED", async () => {
    const c = await caller(null);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: targetA }))).rejects.toThrow();
  }, 30000);

  it("2-3. operador e viewer → FORBIDDEN (exige papel admin na org)", async () => {
    const op = await caller(operatorA);
    const vw = await caller(viewerA);
    await expect(op.onboarding.grantDepartmentPermission(grant({ userId: targetA }))).rejects.toThrow(/papel|admin|requer/i);
    await expect(vw.onboarding.grantDepartmentPermission(grant({ userId: targetA }))).rejects.toThrow(/papel|admin|requer/i);
  }, 30000);

  it("4. auto-concessão → FORBIDDEN", async () => {
    const c = await caller(adminA);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: adminA }))).rejects.toThrow(/si próprio|si mesmo|próprio/i);
  }, 30000);

  it("5. admin de órgão concedendo escopo global → FORBIDDEN", async () => {
    const c = await caller(adminA);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: targetA, scope: "global" as any }))).rejects.toThrow(/global|plataforma/i);
  }, 30000);

  it("6. admin de A concedendo a usuário de B → NOT_FOUND (alvo fora do tenant)", async () => {
    const c = await caller(adminA);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: memberB }))).rejects.toThrow(/não encontrad/i);
  }, 30000);

  it("7. admin de A concedendo a usuário sem membership / inexistente → NOT_FOUND", async () => {
    const c = await caller(adminA);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: noMember }))).rejects.toThrow(/não encontrad/i);
    await expect(c.onboarding.grantDepartmentPermission(grant({ userId: 999999999 }))).rejects.toThrow(/não encontrad/i);
  }, 30000);

  // ── Positivos ────────────────────────────────────────────────────────────────
  it("8. admin de órgão concede permissão institucional na própria org → sucesso", async () => {
    const c = await caller(adminA);
    const res: any = await c.onboarding.grantDepartmentPermission(grant({ userId: targetA }));
    expect(res).toBeTruthy();
  }, 30000);

  it("9. admin de plataforma concede escopo global → sucesso", async () => {
    // Admin de plataforma opera escopado via header X-Organization-Id.
    const c = await caller(platformAdmin, "admin", { "x-organization-id": String(ORG_A) });
    const res: any = await c.onboarding.grantDepartmentPermission(grant({ userId: targetA, scope: "global" as any }));
    expect(res).toBeTruthy();
  }, 30000);
});
