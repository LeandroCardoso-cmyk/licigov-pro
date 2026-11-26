/**
 * LICIGOV-LAUNCH-READY — Lane B — smoke contra MySQL REAL (descartável). Só roda com DATABASE_URL definido.
 *
 * SEC-04 — licenciamento de módulos: mutações (`activateModule`/`deactivateModule`) só para administrador de plataforma
 *          com tenant EXPLÍCITO; viewer/operator/manager/admin/owner do órgão → FORBIDDEN sem efeito no banco; sem
 *          membership → FORBIDDEN; tenant trocado via header por usuário comum → não licencia o outro órgão; leituras
 *          continuam no escopo do próprio tenant.
 * COM-01 — solicitação comercial idempotente: reenvio da mesma solicitação pendente (CNPJ em outra grafia + e-mail em
 *          outra caixa) não cria nova linha; e-mail diferente cria; concorrente lógico por órgão preservado.
 * PRD-04 — `auth.registrationStatus` reflete a configuração fail-closed (default: desabilitado).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { resetRateLimit } from "../../services/rateLimiter";

const DB = process.env.DATABASE_URL;
const ORG_A = 996301;
const ORG_B = 996302;
const CODE = "gestao_departamento";

describe.skipIf(!DB)("LAUNCH-READY Lane B — MySQL real", { timeout: 30000 }, () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const users: Record<string, number> = {};
  let planSlug: string;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    planSlug = `lrb-plan-${stamp}`;
    await conn.execute(`INSERT INTO subscription_plans (name, slug, price) VALUES (?, ?, 1000)`, [`Plano LRB ${stamp}`, planSlug]);
    for (const [id, tag] of [[ORG_A, "a"], [ORG_B, "b"]] as const) {
      await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [id, `Org sintética LRB ${tag} ${stamp}`, `lrb-${tag}-${stamp}`]);
    }
    const insertUser = async (tag: string, role: "user" | "admin" = "user") => {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`lrb-${tag}-${stamp}`, `Usuário ${tag}`, `lrb-${tag}-${stamp}@teste.local`, role],
      );
      users[tag] = r.insertId;
    };
    for (const role of ["viewer", "operator", "manager", "admin", "owner"]) {
      await insertUser(role);
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, users[role], role]);
    }
    await insertUser("nomember");
    await insertUser("ownerB");
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, users.ownerB]);
    await insertUser("platform", "admin");
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (q: string, p: unknown[]) => { await conn.execute(q, p).catch(() => {}); };
    await del(`DELETE FROM licensed_modules WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM proposal_requests WHERE planSlug = ?`, [planSlug]);
    await del(`DELETE FROM subscription_plans WHERE slug = ?`, [planSlug]);
    await del(`DELETE FROM audit_logs WHERE adminId = ?`, [users.platform]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    const ids = Object.values(users);
    if (ids.length) await del(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function makeCaller(userId: number | null, role: "user" | "admin" = "user", headers: Record<string, string> = {}, ip = "127.0.0.1") {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: userId === null ? null : { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers, ip },
      res: {},
      correlationId: `test-lrb-${userId ?? "anon"}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  async function licenseRows(org: number): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM licensed_modules WHERE organization_id = ?`, [org]);
    return Number(rows[0].n);
  }

  describe("SEC-04 — licenciamento de módulos", () => {
    it.each(["viewer", "operator", "manager", "admin", "owner"])("membro '%s' do órgão NÃO ativa nem desativa módulo (FORBIDDEN, sem escrita)", async (role) => {
      const caller = await makeCaller(users[role]);
      await expect(caller.moduleLicensing.activateModule({ code: CODE, plan: "enterprise" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.moduleLicensing.deactivateModule({ code: CODE })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await licenseRows(ORG_A)).toBe(0);
    });

    it("usuário sem membership → FORBIDDEN", async () => {
      const caller = await makeCaller(users.nomember);
      await expect(caller.moduleLicensing.activateModule({ code: CODE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("tenant trocado: owner do órgão A pedindo o órgão B por header não licencia B", async () => {
      const caller = await makeCaller(users.owner, "user", { "x-organization-id": String(ORG_B) });
      await expect(caller.moduleLicensing.activateModule({ code: CODE })).rejects.toBeTruthy();
      expect(await licenseRows(ORG_B)).toBe(0);
    });

    it("admin de plataforma sem tenant explícito → recusado (sem default silencioso)", async () => {
      const caller = await makeCaller(users.platform, "admin");
      await expect(caller.moduleLicensing.activateModule({ code: CODE })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("admin de plataforma com tenant explícito ativa/desativa só o órgão alvo; leitura do órgão vê o resultado", async () => {
      const caller = await makeCaller(users.platform, "admin", { "x-organization-id": String(ORG_A) });
      const res = await caller.moduleLicensing.activateModule({ code: CODE, plan: "basic" });
      expect(res.module.organizationId).toBe(ORG_A);
      expect(await licenseRows(ORG_A)).toBe(1);
      expect(await licenseRows(ORG_B)).toBe(0);

      const viewer = await makeCaller(users.viewer);
      const list = await viewer.moduleLicensing.listModules();
      expect(list.modules.map((m) => m.businessDomainCode)).toContain(CODE);
      const otherOrg = await (await makeCaller(users.ownerB)).moduleLicensing.listModules();
      expect(otherOrg.modules).toHaveLength(0);

      await caller.moduleLicensing.deactivateModule({ code: CODE });
      const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT active FROM licensed_modules WHERE organization_id = ?`, [ORG_A]);
      expect(Number(rows[0].active)).toBe(0);

      // Reativação atualiza a MESMA linha (antes: nova linha com id aleatório; leitura podia pegar a desativada).
      const again = await caller.moduleLicensing.activateModule({ code: CODE, plan: "professional" });
      expect(again.module.id).toBe(res.module.id);
      expect(await licenseRows(ORG_A)).toBe(1);
      const validation = await viewer.moduleLicensing.validateLicense({ code: CODE });
      expect(validation.active).toBe(true);
    });
  });

  describe("COM-01 — solicitação comercial idempotente", () => {
    const input = (overrides: Record<string, unknown> = {}) => ({
      orgaoNome: "Órgão Sintético LRB",
      orgaoCnpj: "11222333000181",
      orgaoEndereco: "Rua Teste, 1",
      orgaoCidade: "Cidade Teste",
      orgaoEstado: "SP",
      orgaoCep: "01310100",
      responsavelNome: "Responsável Teste",
      responsavelEmail: `lrb-resp-${stamp}@teste.local`,
      responsavelTelefone: "11999998888",
      planSlug,
      ...overrides,
    });

    it("reenvio (CNPJ mascarado + e-mail em caixa alta) reaproveita a solicitação pendente; outro e-mail cria nova", async () => {
      const ip = `10.9.1.${stamp % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      const first = await caller.commercial.create(input());
      const again = await caller.commercial.create(input({
        orgaoCnpj: "11.222.333/0001-81",
        responsavelEmail: `LRB-RESP-${stamp}@TESTE.LOCAL`,
      }));
      expect(again.proposalId).toBe(first.proposalId);
      const updated = await caller.commercial.create(input({ observacoes: "Complemento do reenvio" }));
      expect(updated.proposalId).toBe(first.proposalId);
      const [obs] = await conn.execute<mysql.RowDataPacket[]>(`SELECT observacoes FROM proposal_requests WHERE id = ?`, [first.proposalId]);
      expect(obs[0].observacoes).toBe("Complemento do reenvio");
      const other = await caller.commercial.create(input({ responsavelEmail: `lrb-outro-${stamp}@teste.local` }));
      expect(other.proposalId).not.toBe(first.proposalId);

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n, MIN(status) AS s FROM proposal_requests WHERE planSlug = ?`, [planSlug]);
      expect(Number(rows[0].n)).toBe(2);
      expect(rows[0].s).toBe("pending");
    }, 30000);

    it("solicitação já tratada (não pendente) não é reaproveitada", async () => {
      const ip = `10.9.2.${stamp % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      const email = `lrb-cancel-${stamp}@teste.local`;
      const first = await caller.commercial.create(input({ responsavelEmail: email }));
      await conn.execute(`UPDATE proposal_requests SET status = 'cancelled' WHERE id = ?`, [first.proposalId]);
      const second = await caller.commercial.create(input({ responsavelEmail: email }));
      expect(second.proposalId).not.toBe(first.proposalId);
    }, 30000);
  });

  describe("PRD-04 — disponibilidade do cadastro público", () => {
    it("registrationStatus é público e fail-closed por padrão", async () => {
      const caller = await makeCaller(null);
      await expect(caller.auth.registrationStatus()).resolves.toEqual({ publicRegistrationEnabled: false });
    });
  });
});
