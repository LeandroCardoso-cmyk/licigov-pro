/**
 * V1 PRE-PILOT CLOSURE — PR 0 (Security Emergency Closure) — smoke contra MySQL REAL.
 * Só roda com DATABASE_URL definido.
 *
 * Comprova COMPORTAMENTO (não só ausência de código) das correções de segurança:
 *  - commercial.create: funciona anonimamente, termina em "pending" (nunca fabrica
 *    "documents_sent"), rejeita CNPJ inválido, rejeita honeypot, aplica rate limit;
 *  - commercial.generateDocuments: não existe mais como procedure chamável;
 *  - collaboration.listMembers/checkPermission: cross-tenant e não-membro → NOT_FOUND;
 *    membro autorizado da própria organização enxerga a lista (mentions preservadas);
 *  - templates.getById: dono vê; outro usuário → NOT_FOUND;
 *  - platform admin: X-Organization-Id ausente/inválido/zero/negativo/inexistente →
 *    recusado; organização válida → funciona; acesso cross-tenant é auditado;
 *  - scripts/bootstrap-admin.ts: fail-closed sem confirmação/credenciais; idempotente
 *    (criar → já-admin; promover usuário existente).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { resetRateLimit } from "../../services/rateLimiter";
import { main as bootstrapAdmin, ConfigError } from "../../../scripts/bootstrap-admin";

const DB = process.env.DATABASE_URL;
const ORG_A = 950101;
const ORG_B = 950102;
const NONEXISTENT_ORG = 950199;

describe.skipIf(!DB)("PR 0 (Security Emergency Closure) — MySQL real", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();

  let userA: number;
  let userB: number;
  let userC: number; // membro da ORG_A, sem nenhum vínculo com processA (nem owner, nem membro)
  let adminUserId: number;
  let processA: number;
  let templateA: number;
  let templateB: number;
  let planSlug: string;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    planSlug = `pr0-plan-${stamp}`;
    await conn.execute(
      `INSERT INTO subscription_plans (name, slug, price) VALUES (?, ?, 1000)`,
      [`Plano PR0 ${stamp}`, planSlug]
    );

    // Organizações reais — necessárias para o novo resolveTenant do admin de
    // plataforma, que valida a organização contra a tabela `organizations` (fail-closed).
    await conn.execute(
      `INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`,
      [ORG_A, `Org A PR0 ${stamp}`, `org-a-pr0-${stamp}`]
    );
    await conn.execute(
      `INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`,
      [ORG_B, `Org B PR0 ${stamp}`, `org-b-pr0-${stamp}`]
    );

    async function insertUser(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`pr0-${tag}-${stamp}`, `Usuário ${tag}`, `pr0-${tag}-${stamp}@teste.local`, role]
      );
      return r.insertId;
    }
    userA = await insertUser("a");
    userB = await insertUser("b");
    userC = await insertUser("c");
    adminUserId = await insertUser("admin", "admin");

    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`,
      [ORG_A, userA]
    );
    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`,
      [ORG_B, userB]
    );
    // userC: membro da ORG_A (tenant resolve normalmente), mas sem NENHUM vínculo com
    // processA — nem owner, nem process_members. Distingue "sem acesso ao processo"
    // (mesmo tenant, sem autorização) de "cross-tenant" (tenant errado).
    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'viewer', 1)`,
      [ORG_A, userC]
    );

    async function insertProcess(org: number, owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo PR0', 'Objeto', ?, 'em_dfd')`,
        [org, owner]
      );
      return r.insertId;
    }
    processA = await insertProcess(ORG_A, userA);
    // Processo real na org B — garante que o cross-tenant abaixo não passa trivialmente
    // só porque a org B não tem processo algum.
    await insertProcess(ORG_B, userB);

    await conn.execute(
      `INSERT INTO stage_assignments (processId, docType, assignedUserId, assignedBy) VALUES (?, 'dfd', ?, ?)`,
      [processA, userA, userA]
    );

    async function insertTemplate(owner: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO document_templates (userId, name, type, content) VALUES (?, 'Template PR0', 'etp', 'conteúdo')`,
        [owner]
      );
      return r.insertId;
    }
    templateA = await insertTemplate(userA);
    templateB = await insertTemplate(userB);
  });

  afterAll(async () => {
    if (conn) {
      const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
      await del(`DELETE FROM stage_assignments WHERE processId = ?`, [processA]);
      await del(`DELETE FROM document_templates WHERE id IN (?, ?)`, [templateA, templateB]);
      await del(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`, [userA, userB, userC, adminUserId]);
      await del(`DELETE FROM proposal_requests WHERE planSlug = ?`, [planSlug]);
      await del(`DELETE FROM subscription_plans WHERE slug = ?`, [planSlug]);
      await del(`DELETE FROM audit_logs WHERE adminId = ?`, [adminUserId]);
      await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
      await conn.end();
    }
  });

  async function makeCaller(
    userId: number | null,
    role: "user" | "admin" = "user",
    headers: Record<string, string> = {},
    ip = "127.0.0.1"
  ) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: userId === null ? null : { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers, ip },
      res: {},
      correlationId: `test-pr0-${userId ?? "anon"}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  function validCommercialInput(overrides: Record<string, unknown> = {}) {
    return {
      orgaoNome: "Prefeitura de Teste",
      orgaoCnpj: "11222333000181", // CNPJ válido (dígitos verificadores corretos)
      orgaoEndereco: "Rua Teste, 123",
      orgaoCidade: "Cidade Teste",
      orgaoEstado: "SP",
      orgaoCep: "01310100",
      responsavelNome: "Responsável Teste",
      responsavelEmail: `resp-${stamp}-${Math.random()}@teste.local`,
      responsavelTelefone: "11999998888",
      planSlug,
      ...overrides,
    };
  }

  // ── commercial.create ────────────────────────────────────────────────────────
  describe("commercial.create", () => {
    it("funciona anonimamente e termina em pending (nunca documents_sent)", async () => {
      const ip = `10.0.1.${Date.now() % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      const result = await caller.commercial.create(validCommercialInput());
      expect(result.proposalId).toBeGreaterThan(0);

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT status FROM proposal_requests WHERE id = ?`,
        [result.proposalId]
      );
      expect(rows[0].status).toBe("pending");
    }, 30000);

    it("rejeita CNPJ inválido (dígitos verificadores incorretos)", async () => {
      const ip = `10.0.2.${Date.now() % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      await expect(
        caller.commercial.create(validCommercialInput({ orgaoCnpj: "11111111111111" }))
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }, 30000);

    it("rejeita honeypot preenchido", async () => {
      const ip = `10.0.3.${Date.now() % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      await expect(
        caller.commercial.create(validCommercialInput({ website: "http://spambot.example" }))
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }, 30000);

    it("aplica rate limit (máx. 5 por 15min por IP)", async () => {
      const ip = `10.0.4.${Date.now() % 250}`;
      resetRateLimit(`ip:${ip}`, "commercial");
      const caller = await makeCaller(null, "user", {}, ip);
      for (let i = 0; i < 5; i++) {
        await caller.commercial.create(validCommercialInput());
      }
      await expect(caller.commercial.create(validCommercialInput())).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    }, 30000);

    it("generateDocuments não existe mais como procedure", async () => {
      const caller = await makeCaller(null);
      const commercial = caller.commercial as unknown as {
        generateDocuments: (input: unknown) => Promise<unknown>;
      };
      await expect(commercial.generateDocuments({ proposalId: 1 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30000);
  });

  // ── collaboration ────────────────────────────────────────────────────────────
  describe("collaboration.listMembers / checkPermission", () => {
    it("owner da organização A vê membros do processo A", async () => {
      const caller = await makeCaller(userA, "user", { "x-organization-id": String(ORG_A) });
      const members = await caller.collaboration.listMembers({ processId: processA });
      expect(Array.isArray(members)).toBe(true);
    }, 30000);

    it("usuário da organização B NÃO acessa processo da organização A (NOT_FOUND)", async () => {
      const caller = await makeCaller(userB, "user", { "x-organization-id": String(ORG_B) });
      await expect(caller.collaboration.listMembers({ processId: processA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const perm = await caller.collaboration.checkPermission({ processId: processA });
      expect(perm.permission).toBeNull();
      expect(perm.isOwner).toBe(false);
    }, 30000);

    it("checkPermission do owner retorna isOwner=true dentro do próprio tenant", async () => {
      const caller = await makeCaller(userA, "user", { "x-organization-id": String(ORG_A) });
      const perm = await caller.collaboration.checkPermission({ processId: processA });
      expect(perm.isOwner).toBe(true);
      expect(perm.permission).toBe("owner");
    }, 30000);
  });

  // ── collaboration.getStageAssignments (correção final) ─────────────────────────
  describe("collaboration.getStageAssignments", () => {
    it("usuário autorizado (owner) → funciona e retorna a atribuição real", async () => {
      const caller = await makeCaller(userA, "user", { "x-organization-id": String(ORG_A) });
      const assignments = await caller.collaboration.getStageAssignments({ processId: processA });
      expect(assignments).toHaveLength(1);
      expect(assignments[0].docType).toBe("dfd");
      expect(assignments[0].assignedUserId).toBe(userA);
    }, 30000);

    it("cross-tenant (usuário da ORG_B) → NOT_FOUND", async () => {
      const caller = await makeCaller(userB, "user", { "x-organization-id": String(ORG_B) });
      await expect(caller.collaboration.getStageAssignments({ processId: processA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30000);

    it("mesma organização, sem acesso ao processo (nem owner, nem membro) → NOT_FOUND", async () => {
      const caller = await makeCaller(userC, "user", { "x-organization-id": String(ORG_A) });
      await expect(caller.collaboration.getStageAssignments({ processId: processA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30000);
  });

  // ── templates ─────────────────────────────────────────────────────────────────
  describe("templates.getById", () => {
    it("dono acessa o próprio template", async () => {
      const caller = await makeCaller(userA);
      const template = await caller.templates.getById({ id: templateA });
      expect(template.id).toBe(templateA);
    }, 30000);

    it("outro usuário NÃO acessa template alheio (NOT_FOUND)", async () => {
      const caller = await makeCaller(userB);
      await expect(caller.templates.getById({ id: templateA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30000);
  });

  // ── platform admin: tenant explícito e validado ─────────────────────────────
  describe("platform admin — resolução de tenant fail-closed", () => {
    it("sem X-Organization-Id → BAD_REQUEST (nunca cai em org 1)", async () => {
      const caller = await makeCaller(adminUserId, "admin", {});
      await expect(caller.collaboration.listMembers({ processId: processA })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }, 30000);

    it.each(["abc", "0", "-1", "1.5", "1e3"])("X-Organization-Id inválido (%s) → BAD_REQUEST", async (value) => {
      const caller = await makeCaller(adminUserId, "admin", { "x-organization-id": value });
      await expect(caller.collaboration.listMembers({ processId: processA })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }, 30000);

    it("organização inexistente → NOT_FOUND", async () => {
      const caller = await makeCaller(adminUserId, "admin", { "x-organization-id": String(NONEXISTENT_ORG) });
      await expect(caller.collaboration.listMembers({ processId: processA })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }, 30000);

    it("organização válida → acesso cross-tenant funciona e é auditado", async () => {
      const caller = await makeCaller(adminUserId, "admin", { "x-organization-id": String(ORG_A) });
      const members = await caller.collaboration.listMembers({ processId: processA });
      expect(Array.isArray(members)).toBe(true);

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT details FROM audit_logs WHERE adminId = ? AND action = 'other' ORDER BY id DESC LIMIT 1`,
        [adminUserId]
      );
      expect(rows.length).toBeGreaterThan(0);
      const details = JSON.parse(rows[0].details as string);
      expect(details.event).toBe("platform_admin_tenant_access");
      expect(details.organizationId).toBe(ORG_A);
    }, 30000);
  });

  // ── scripts/bootstrap-admin.ts ────────────────────────────────────────────────
  describe("scripts/bootstrap-admin.ts", () => {
    const ORIGINAL_ENV = {
      CONFIRM: process.env.ADMIN_BOOTSTRAP_CONFIRM,
      EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL,
      PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      NAME: process.env.ADMIN_BOOTSTRAP_NAME,
    };
    let bootstrapEmail: string;

    afterAll(async () => {
      process.env.ADMIN_BOOTSTRAP_CONFIRM = ORIGINAL_ENV.CONFIRM;
      process.env.ADMIN_BOOTSTRAP_EMAIL = ORIGINAL_ENV.EMAIL;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = ORIGINAL_ENV.PASSWORD;
      process.env.ADMIN_BOOTSTRAP_NAME = ORIGINAL_ENV.NAME;
      await conn.execute(`DELETE FROM users WHERE email = ?`, [bootstrapEmail]).catch(() => {});
    });

    it("recusa sem ADMIN_BOOTSTRAP_CONFIRM=yes", async () => {
      delete process.env.ADMIN_BOOTSTRAP_CONFIRM;
      process.env.ADMIN_BOOTSTRAP_EMAIL = `bootstrap-${stamp}@teste.local`;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "Senha-Forte-Teste-123!";
      await expect(bootstrapAdmin()).rejects.toBeInstanceOf(ConfigError);
    });

    it("recusa sem ADMIN_BOOTSTRAP_EMAIL (sem default hardcoded)", async () => {
      process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
      delete process.env.ADMIN_BOOTSTRAP_EMAIL;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "Senha-Forte-Teste-123!";
      await expect(bootstrapAdmin()).rejects.toBeInstanceOf(ConfigError);
    });

    it("recusa senha curta", async () => {
      process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
      process.env.ADMIN_BOOTSTRAP_EMAIL = `bootstrap-${stamp}@teste.local`;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "curta";
      await expect(bootstrapAdmin()).rejects.toBeInstanceOf(ConfigError);
    });

    it("recusa senha com 8+ caracteres mas sem complexidade (não basta comprimento)", async () => {
      process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
      process.env.ADMIN_BOOTSTRAP_EMAIL = `bootstrap-${stamp}@teste.local`;
      // 12 caracteres, só minúsculas — passaria no antigo `length >= 8`, mas
      // `validatePasswordStrength` exige maiúscula/número/caractere especial também.
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "abcdefghijkl";
      await expect(bootstrapAdmin()).rejects.toBeInstanceOf(ConfigError);
    });

    it("cria o admin, e reexecutar é idempotente (não duplica nem rebaixa)", async () => {
      bootstrapEmail = `bootstrap-${stamp}@teste.local`;
      process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
      process.env.ADMIN_BOOTSTRAP_EMAIL = bootstrapEmail;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "Senha-Forte-Teste-123!";

      const first = await bootstrapAdmin();
      expect(first.outcome).toBe("created");

      const second = await bootstrapAdmin();
      expect(second.outcome).toBe("already_admin");
      expect(second.userId).toBe(first.userId);

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM users WHERE email = ?`,
        [bootstrapEmail]
      );
      expect((rows[0] as { cnt: number }).cnt).toBe(1);
    }, 30000);

    it("promove usuário existente não-admin (sem duplicar)", async () => {
      const existingEmail = `bootstrap-promote-${stamp}@teste.local`;
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`,
        [`bootstrap-promote-${stamp}`, "Usuário a promover", existingEmail]
      );

      process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
      process.env.ADMIN_BOOTSTRAP_EMAIL = existingEmail;
      process.env.ADMIN_BOOTSTRAP_PASSWORD = "Senha-Forte-Teste-123!";

      const result = await bootstrapAdmin();
      expect(result.outcome).toBe("promoted");
      expect(result.userId).toBe(r.insertId);

      const [rows] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT role FROM users WHERE id = ?`,
        [r.insertId]
      );
      expect(rows[0].role).toBe("admin");

      await conn.execute(`DELETE FROM users WHERE id = ?`, [r.insertId]);
    }, 30000);
  });
});
