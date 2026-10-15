/**
 * Executor de homologação — usuário com ACESSO A MÚLTIPLAS ORGANIZAÇÕES (falha real no staging: "Você tem acesso a
 * múltiplas organizações. Informe X-Organization-Id." já em `organizations.listMine`, antes de qualquer jornada).
 *
 *  - servidor (regra inalterada): sem cabeçalho ⇒ BAD_REQUEST; com o tenant sintético no cabeçalho ⇒ listMine/getCurrent
 *    resolvem; cabeçalho de organização sem associação ⇒ FORBIDDEN (isolamento preservado);
 *  - executor: `HOMOLOG_ORGANIZATION_ID` faz a sessão enviar `X-Organization-Id` desde a 1ª chamada tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import superjson from "superjson";
import { runMigrations } from "../../bootstrap";
import { homologSession, parseOrganizationId } from "../../../scripts/homologation-e2e";

const DB = process.env.DATABASE_URL;
const ORG_SYN = 996501;   // tenant sintético da homologação
const ORG_OTHER = 996502; // outra organização sintética do mesmo usuário
const ORG_FOREIGN = 996503;
const RUN = Date.now().toString(36);
let conn: mysql.Connection;
let user = 0;

async function caller(org?: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: user, role: "user", name: "Homologação multi-org", email: `mo-${RUN}@teste.local` },
    req: { headers: org ? { "x-organization-id": String(org) } : {}, ip: "127.0.0.1" }, res: {},
    correlationId: `corr-mo-${RUN}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const codeOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { const err = e as { code?: string; message?: string }; return { code: err.code, message: String(err.message) }; }
};

describe.skipIf(!DB)("homologação — usuário com múltiplas organizações (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const [id, slug] of [[ORG_SYN, `homologacao-sintetica-mo-${RUN}`], [ORG_OTHER, `mo-outra-${RUN}`], [ORG_FOREIGN, `mo-alheia-${RUN}`]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE slug = VALUES(slug), ativo = 1", [id, `Sintética ${id}`, slug]);
    }
    const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`mo-${RUN}`, "Homologação multi-org", `mo-${RUN}@teste.local`]);
    user = r.insertId;
    for (const org of [ORG_SYN, ORG_OTHER]) await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'manager', 1)", [org, user]);
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM organization_members WHERE userId = ?", [user]).catch(() => {});
    await conn.execute("DELETE FROM users WHERE id = ?", [user]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?, ?)", [ORG_SYN, ORG_OTHER, ORG_FOREIGN]).catch(() => {});
    await conn.end();
  });

  it("servidor: sem X-Organization-Id ⇒ BAD_REQUEST (a causa da falha); com o tenant sintético ⇒ resolve; organização alheia ⇒ FORBIDDEN", async () => {
    const none = await codeOf((await caller()).organizations.listMine());
    expect(none).toMatchObject({ code: "BAD_REQUEST" });
    expect(none!.message).toMatch(/múltiplas organizações/);
    const mine = await (await caller(ORG_SYN)).organizations.listMine();
    expect(mine.map((m) => m.org.id).sort()).toEqual([ORG_SYN, ORG_OTHER].sort());
    const current = await (await caller(ORG_SYN)).organizations.getCurrent();
    expect(current).toMatchObject({ org: { id: ORG_SYN }, role: "manager" });
    expect(await codeOf((await caller(ORG_FOREIGN)).organizations.listMine())).toMatchObject({ code: "FORBIDDEN" });
  }, 60_000);

  it("executor: HOMOLOG_ORGANIZATION_ID faz a sessão enviar X-Organization-Id já na 1ª chamada tenant-scoped", async () => {
    const seen: Array<string | null> = [];
    const fetchStub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-organization-id"));
      return new Response(JSON.stringify({ result: { data: superjson.serialize([]) } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const s = homologSession("http://127.0.0.1:1");
      const pinned = parseOrganizationId(String(ORG_SYN));
      if (pinned) s.state.orgId = pinned;
      await s.api.organizations.listMine.query();
      expect(seen).toEqual([String(ORG_SYN)]);
      const unpinned = homologSession("http://127.0.0.1:1");
      await unpinned.api.organizations.listMine.query();
      expect(seen[1]).toBeNull(); // sem a variável, nada é presumido
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
