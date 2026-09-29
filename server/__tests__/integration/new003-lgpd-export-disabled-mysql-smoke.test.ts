/**
 * NEW-003 (P1 SECURITY) — `lgpd.exportMyData` desativado — smoke contra MySQL REAL.
 * Só roda com DATABASE_URL definido.
 *
 * Cenário do defeito (reproduzido na triagem pós-turno, main 5cd9d50/5924b4a): titular com `passwordHash`
 * e `signaturePassword` bcrypt e `tokenVersion=7`, membership ATIVA na Org A e DESATIVADA (servidor
 * desligado) na Org B, um processo legado próprio em cada órgão e, na Org B, um documento de OUTRO autor
 * com `s3Key`/`fileUrl`. O caminho antigo devolvia a linha completa de `users` e o documento da Org B.
 *
 * Contrato verificado:
 *  - todo ator (sem órgão, viewer, operator, manager, owner, admin de plataforma, membership ativa ou
 *    inativa, usuário de outro órgão) recebe FORBIDDEN com LGPD_EXPORT_DISABLED — mensagem idêntica;
 *  - ZERO leitura de banco após o guard: `Com_select` global inalterado durante as chamadas;
 *  - ZERO leak: nem a resposta via createCaller nem o corpo HTTP (fetch adapter + superjson) contêm
 *    chaves proibidas, hash bcrypt, e-mail, conteúdo ou referências de storage dos fixtures;
 *  - nenhuma linha é alterada (contagens e colunas sensíveis idênticas antes/depois);
 *  - retry: chamadas repetidas produzem a mesma recusa.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { LGPD_EXPORT_DISABLED, LGPD_EXPORT_DISABLED_MESSAGE, LGPD_EXPORT_FORBIDDEN_KEYS } from "../../services/lgpdExportGuard";

const DB = process.env.DATABASE_URL;
const ORG_A = 960301;
const ORG_B = 960302;
// Hashes em FORMATO bcrypt (fictícios): o teste procura o marcador no fio, nunca imprime valores.
const PW_HASH = "$2b$10$N003passwordHashNotRealAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SIG_HASH = "$2b$10$N003signaturePwNotRealBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const FORBIDDEN_RE = new RegExp(LGPD_EXPORT_FORBIDDEN_KEYS.join("|"));
const BCRYPT_RE = /\$2[aby]\$\d{2}\$/;

describe.skipIf(!DB)("NEW-003 — lgpd.exportMyData desativado (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const email = (tag: string) => `n003-${tag}-${stamp}@teste.local`;
  const ids: Record<string, number> = {};
  const procs: number[] = [];
  const docs: number[] = [];

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A N003 ${stamp}`, `org-a-n003-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B N003 ${stamp}`, `org-b-n003-${stamp}`]);
    async function user(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role, passwordHash, signaturePassword, tokenVersion) VALUES (?, ?, ?, ?, ?, ?, 7)`,
        [`n003-open-${tag}-${stamp}`, `N003 ${tag}`, email(tag), role, PW_HASH, SIG_HASH]);
      return (ids[tag] = r.insertId);
    }
    async function member(org: number, userId: number, role: string, ativo = 1) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, ?)`, [org, userId, role, ativo]);
    }
    await user("holder"); await user("viewer"); await user("operator"); await user("manager");
    await user("owner"); await user("platform-admin", "admin"); await user("no-org"); await user("other-b"); await user("author-b");
    await member(ORG_A, ids.holder, "operator", 1);
    await member(ORG_B, ids.holder, "operator", 0); // servidor DESLIGADO da Org B
    await member(ORG_A, ids.viewer, "viewer"); await member(ORG_A, ids.operator, "operator");
    await member(ORG_A, ids.manager, "manager"); await member(ORG_A, ids.owner, "owner");
    await member(ORG_B, ids["other-b"], "operator"); await member(ORG_B, ids["author-b"], "operator");
    for (const org of [ORG_A, ORG_B]) {
      const [pr] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto N003', ?, 'em_dfd')`,
        [org, `Processo N003 ${org} ${stamp}`, ids.holder]);
      procs.push(pr.insertId);
      const author = org === ORG_B ? ids["author-b"] : ids.holder;
      const [dr] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO documents (organizationId, processId, type, title, content, createdBy, s3Key, fileUrl) VALUES (?, ?, 'dfd', 'DFD N003', ?, ?, ?, ?)`,
        [org, pr.insertId, `CONTEUDO INSTITUCIONAL N003 ${org}`, author, `n003/${org}/secret-key`, `https://internal.example/n003/${org}`]);
      docs.push(dr.insertId);
    }
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const users = Object.values(ids);
    const inU = users.map(() => "?").join(",") || "NULL";
    const inP = procs.map(() => "?").join(",") || "NULL";
    await del(`DELETE FROM documents WHERE processId IN (${inP})`, procs);
    await del(`DELETE FROM processes WHERE id IN (${inP})`, procs);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (${inU})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  type OrgRole = "viewer" | "operator" | "manager" | "owner" | null;
  function ctxFor(tag: string, role: "user" | "admin", org: number | null, orgRole: OrgRole, active = true, correlationId = `n003-${tag}`) {
    const id = ids[tag];
    return {
      user: { id, role, name: `N003 ${tag}`, email: email(tag) },
      req: { headers: org ? { "x-organization-id": String(org) } : {}, ip: "127.0.0.1" },
      res: {},
      correlationId,
      requestId: `req-${correlationId}`,
      organizationId: org,
      orgMembership: org && orgRole
        ? { id: 1, organizationId: org, userId: id, role: orgRole, invitedBy: null, ativo: active, createdAt: new Date(), updatedAt: new Date() }
        : null,
    };
  }
  const ACTORS = [
    { label: "titular (membership ativa Org A)", tag: "holder", role: "user" as const, org: ORG_A, orgRole: "operator" as const },
    { label: "titular pela Org B (membership INATIVA)", tag: "holder", role: "user" as const, org: ORG_B, orgRole: "operator" as const, active: false },
    { label: "viewer", tag: "viewer", role: "user" as const, org: ORG_A, orgRole: "viewer" as const },
    { label: "operator", tag: "operator", role: "user" as const, org: ORG_A, orgRole: "operator" as const },
    { label: "manager", tag: "manager", role: "user" as const, org: ORG_A, orgRole: "manager" as const },
    { label: "owner", tag: "owner", role: "user" as const, org: ORG_A, orgRole: "owner" as const },
    { label: "admin de plataforma", tag: "platform-admin", role: "admin" as const, org: null, orgRole: null },
    { label: "usuário autenticado sem órgão", tag: "no-org", role: "user" as const, org: null, orgRole: null },
    { label: "usuário de outro órgão (Org B)", tag: "other-b", role: "user" as const, org: ORG_B, orgRole: "operator" as const },
  ];

  async function appRouterCaller(ctx: ReturnType<typeof ctxFor>) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller(ctx as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const comSelect = async () => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SHOW GLOBAL STATUS LIKE 'Com_select'");
    return Number((rows[0] as { Value: string }).Value);
  };
  async function sensitiveSnapshot() {
    const users = Object.values(ids);
    const [u] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, passwordHash, signaturePassword, tokenVersion, openId FROM users WHERE id IN (${users.map(() => "?").join(",")}) ORDER BY id`, users);
    const [d] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, content, s3Key, fileUrl FROM documents WHERE id IN (${docs.map(() => "?").join(",")}) ORDER BY id`, docs);
    return JSON.stringify({ u, d });
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { const r = await fn(); return { code: "RESOLVED", message: JSON.stringify(r ?? null) }; } catch (e) {
      const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message };
    }
  };

  it("fixtures reais contêm os segredos e o documento cross-tenant (o cenário do defeito existe)", async () => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT passwordHash, signaturePassword, tokenVersion FROM users WHERE id = ?`, [ids.holder]);
    expect(BCRYPT_RE.test(String((rows[0] as { passwordHash: string }).passwordHash))).toBe(true);
    expect(BCRYPT_RE.test(String((rows[0] as { signaturePassword: string }).signaturePassword))).toBe(true);
    const [m] = await conn.execute<mysql.RowDataPacket[]>(`SELECT ativo FROM organization_members WHERE organizationId = ? AND userId = ?`, [ORG_B, ids.holder]);
    expect(Number((m[0] as { ativo: number }).ativo)).toBe(0);
  });

  for (const a of ACTORS) {
    it(`${a.label} ⇒ FORBIDDEN LGPD_EXPORT_DISABLED, zero leitura e zero leak`, async () => {
      const before = await sensitiveSnapshot();
      const c = await appRouterCaller(ctxFor(a.tag, a.role, a.org, a.orgRole, a.active ?? true));
      const s0 = await comSelect();
      const err = await errOf(() => c.lgpd.exportMyData());
      const s1 = await comSelect();
      expect(err).toEqual({ code: "FORBIDDEN", message: LGPD_EXPORT_DISABLED_MESSAGE });
      expect(err.message).toContain(LGPD_EXPORT_DISABLED);
      expect(s1 - s0, "nenhum SELECT no banco durante a chamada").toBe(0);
      const blob = JSON.stringify(err);
      expect(blob).not.toMatch(FORBIDDEN_RE);
      expect(blob).not.toMatch(BCRYPT_RE);
      expect(blob).not.toContain("CONTEUDO INSTITUCIONAL");
      expect(await sensitiveSnapshot()).toBe(before);
    }, 30_000);
  }

  it("fio HTTP real (fetch adapter + superjson + appRouter): 403 sem segredo, conteúdo ou storage ref", async () => {
    const { appRouter } = await import("../../routers");
    const s0 = await comSelect();
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/lgpd.exportMyData", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: null }),
      }),
      router: appRouter,
      createContext: () => ctxFor("holder", "user", ORG_B, "operator", false, "n003-wire") as never,
      onError: () => {},
    });
    const body = await res.text();
    const s1 = await comSelect();
    expect(res.status).toBe(403);
    expect(body).toContain(LGPD_EXPORT_DISABLED);
    expect(body).not.toMatch(FORBIDDEN_RE);
    expect(body).not.toMatch(BCRYPT_RE);
    expect(body).not.toContain("CONTEUDO INSTITUCIONAL");
    expect(body).not.toContain("secret-key");
    expect(body).not.toContain(email("holder"));
    expect(s1 - s0).toBe(0);
  }, 30_000);

  it("retry: 5 chamadas seguidas do mesmo titular ⇒ mesma recusa, nada muda", async () => {
    const before = await sensitiveSnapshot();
    const c = await appRouterCaller(ctxFor("holder", "user", ORG_A, "operator"));
    const errs = [];
    for (let i = 0; i < 5; i++) errs.push(await errOf(() => c.lgpd.exportMyData()));
    expect(new Set(errs.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(errs[0].code).toBe("FORBIDDEN");
    expect(await sensitiveSnapshot()).toBe(before);
  }, 30_000);
});
