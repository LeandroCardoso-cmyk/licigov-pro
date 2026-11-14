/**
 * M8 pós-homologação — PRÉ-FLIGHT do executor oficial ANTES de qualquer escrita.
 *
 * Defeito operacional observado em staging: o executor criou processo/DFD/ETP/TR e só na emissão do TR descobriu que a exceção
 * controlada de valores demonstrativos não estava habilitada (EMISSION_FICTITIOUS_PRICES). A guarda está correta; o defeito era a
 * descoberta tardia. Agora:
 *  1. `organizations.getCurrent` informa, só a manager+ do PRÓPRIO tenant, `priceGovernance.demonstrativePricesAllowed` (mesma decisão
 *     da emissão; sem nova consulta; nunca a lista configurada);
 *  2. o executor recusa no `beforeAll` (identidades iguais, capacidade ausente, limitador de login) com diagnóstico `BLOCKED_*`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { TRPCClientError } from "@trpc/client";
import { makeContext } from "../helpers/fixtures";

const h = vi.hoisted(() => ({ roleByUser: new Map<number, string>(), org: { id: 2, slug: "homologacao-sintetica" as string | null } }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => {
    const role = h.roleByUser.get(userId);
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "sem membership" });
    return { organizationId: h.org.id, membership: { id: userId, organizationId: h.org.id, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } };
  }),
}));
vi.mock("../../db/organizations", async (orig) => ({
  ...(await orig<typeof import("../../db/organizations")>()),
  getOrganizationById: vi.fn(async () => ({ id: h.org.id, nome: "Prefeitura Sintética", slug: h.org.slug, ativo: true })),
}));

import { organizationsRouter } from "../../routers/organizationsRouter";
import { __setHomologationConfigForTests, demonstrativePricesAllowedForOrganization } from "../../services/priceGovernanceService";
import {
  assertDemonstrativePricesEnabled, assertDistinctIdentities, classifyLoginError, redundantReviewMarkers, runHomologationPreflight, sanitizeDiagnostic,
  BLOCKED_DEMONSTRATIVE_PRICES, BLOCKED_SAME_IDENTITY, BLOCKED_LOGIN_RATE_LIMITED, BLOCKED_PREFLIGHT_FAILED, type PreflightRecord,
} from "../../../scripts/homologation-e2e";

const user = (id: number) => ({ id, role: "user" as const, openId: `u${id}`, name: `U${id}`, email: `u${id}@x`, theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });
const current = (id: number) => organizationsRouter.createCaller(makeContext(user(id) as never) as never).getCurrent();

beforeEach(() => { h.roleByUser.clear(); h.org = { id: 2, slug: "homologacao-sintetica" }; });
afterEach(() => __setHomologationConfigForTests(null));

describe("priceGovernance — decisão única (mesma da emissão), fail-closed", () => {
  it("só org listada + slug sintético + ambiente não produtivo; nunca a org 1", () => {
    __setHomologationConfigForTests({ allowedOrgIds: [2], appEnv: "staging" });
    expect(demonstrativePricesAllowedForOrganization({ id: 2, slug: "homologacao-sintetica" })).toBe(true);
    expect(demonstrativePricesAllowedForOrganization({ id: 2, slug: "outro-slug" })).toBe(false);
    expect(demonstrativePricesAllowedForOrganization({ id: 3, slug: "homologacao-sintetica" })).toBe(false);
    expect(demonstrativePricesAllowedForOrganization(null)).toBe(false);
    __setHomologationConfigForTests({ allowedOrgIds: [1], appEnv: "staging" });
    expect(demonstrativePricesAllowedForOrganization({ id: 1, slug: "homologacao-sintetica" })).toBe(false);
    __setHomologationConfigForTests({ allowedOrgIds: [2], appEnv: "production" });
    expect(demonstrativePricesAllowedForOrganization({ id: 2, slug: "homologacao-sintetica" })).toBe(false);
    __setHomologationConfigForTests({ allowedOrgIds: [], appEnv: "staging" });
    expect(demonstrativePricesAllowedForOrganization({ id: 2, slug: "homologacao-sintetica" })).toBe(false);
  });
});

describe("organizations.getCurrent — capacidade do PRÓPRIO tenant, só para manager+", () => {
  it("manager recebe o booleano (true com a exceção habilitada; false sem configuração)", async () => {
    h.roleByUser.set(10, "manager");
    __setHomologationConfigForTests({ allowedOrgIds: [2], appEnv: "staging" });
    expect((await current(10)).priceGovernance).toEqual({ demonstrativePricesAllowed: true });
    __setHomologationConfigForTests({ allowedOrgIds: [], appEnv: "staging" });
    expect((await current(10)).priceGovernance).toEqual({ demonstrativePricesAllowed: false });
  });
  it("a decisão fica no serviço: o router só repassa a projeção (invariante [36] — nenhum router decide/habilita a exceção)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../routers/organizationsRouter.ts", import.meta.url), "utf8");
    expect(src).toContain("priceGovernancePreflight({ id: org.id, slug: org.slug ?? null }, role)");
    expect(src).not.toMatch(/demonstrativePricesAllowed|HOMOLOGATION_DEMONSTRATIVE|homologationDemonstrativeAllowed/);
  });
  it("operator e viewer não recebem o campo (null); a resposta nunca carrega a lista configurada", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [2, 77], appEnv: "staging" });
    h.roleByUser.set(11, "operator");
    h.roleByUser.set(12, "viewer");
    expect((await current(11)).priceGovernance).toBeNull();
    expect((await current(12)).priceGovernance).toBeNull();
    h.roleByUser.set(13, "owner");
    const r = await current(13);
    expect(JSON.stringify(r)).not.toContain("77");
    expect(Object.keys(r).sort()).toEqual(["org", "priceGovernance", "role"]);
  });
});

describe("executor — pré-flight recusa ANTES de qualquer escrita", () => {
  it("capacidade ausente, false ou servidor antigo ⇒ BLOCKED_HOMOLOGATION_DEMONSTRATIVE_PRICES_NOT_ENABLED", () => {
    expect(() => assertDemonstrativePricesEnabled({ priceGovernance: { demonstrativePricesAllowed: true } })).not.toThrow();
    for (const c of [{ priceGovernance: { demonstrativePricesAllowed: false } }, { priceGovernance: null }, {}, null, undefined]) {
      expect(() => assertDemonstrativePricesEnabled(c as never)).toThrow(new RegExp(`^${BLOCKED_DEMONSTRATIVE_PRICES}:`));
    }
  });
  it("duas credenciais do MESMO usuário ⇒ BLOCKED_HOMOLOGATION_SAME_IDENTITY (compara ids, nunca e-mails)", () => {
    expect(() => assertDistinctIdentities({ id: 4 }, { id: 5 })).not.toThrow();
    expect(() => assertDistinctIdentities({ id: 4 }, { id: 4 })).toThrow(new RegExp(`^${BLOCKED_SAME_IDENTITY}:.*id 4`));
  });
  it("login recusado pelo limitador vira bloqueio de ambiente; outros erros passam inalterados", () => {
    const limited = new TRPCClientError("Muitas tentativas de login.", { result: { error: { data: { code: "TOO_MANY_REQUESTS" } } } as never });
    Object.assign(limited, { data: { code: "TOO_MANY_REQUESTS" } });
    expect(classifyLoginError(limited).message).toMatch(new RegExp(`^${BLOCKED_LOGIN_RATE_LIMITED}:`));
    const other = new Error("credenciais inválidas");
    expect(classifyLoginError(other)).toBe(other);
  });
  it("a ordem no executor: o beforeAll delega ao pré-flight oficial antes da primeira escrita da jornada", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../homologation/staging-homologation-e2e.test.ts", import.meta.url), "utf8");
    const before = src.slice(src.indexOf("beforeAll("), src.indexOf("afterAll("));
    expect(before).toContain("await runHomologationPreflight(REPORT,");
    expect(before).not.toMatch(/\.mutate\(/);
    expect(src.indexOf("runHomologationPreflight(REPORT")).toBeLessThan(src.indexOf("procurementProcess.createProcess"));
  });
});

describe("métrica de [REVISAR] redundantes no TR (M8 — evidência do efeito na homologação)", () => {
  it("conta só marcadores que citam um parâmetro confirmado; lacunas legítimas não contam", () => {
    const tr = "Vigência: [REVISAR: prazo de vigência contratual e prorrogação]. PCA: [REVISAR: item do Plano de Contratações Anual]. Local: [REVISAR: Local de execução/entrega].";
    expect(redundantReviewMarkers(tr, ["Vigência contratual", "Local de execução/entrega [TR]", "Prazo de pagamento"])).toEqual([
      "[REVISAR: prazo de vigência contratual e prorrogação]", "[REVISAR: Local de execução/entrega]",
    ]);
    expect(redundantReviewMarkers(tr, [])).toEqual([]);
  });
});

/**
 * P2 (revisão independente do PR #329) — os logins ficavam FORA do try/catch que preenche `REPORT.blocked`: um 429 virava
 * `BLOCKED_HOMOLOGATION_LOGIN_RATE_LIMITED` na exceção, mas o JSON terminava sem o bloqueio. Agora o pré-flight inteiro (destino,
 * exercício, os dois logins, tenant, identidades, exceção demonstrativa) passa por `runPreflight`, com sessões HTTP falsas que
 * contam toda chamada: só `auth.login` é mutation; nenhuma escrita de domínio.
 */
describe("executor — pré-flight estruturado: todo bloqueio (inclusive login 429) vai para o relatório JSON", () => {
  const PASSWORDS = { a: "Senha-Sintetica-A#2026", b: "Senha-Sintetica-B#2026" };
  const EMAILS = { a: "homolog.a@example.test", b: "homolog.b@example.test" };
  const env = (over: Record<string, string | undefined> = {}) => ({
    HOMOLOG_EXERCICIO: "2026", HOMOLOG_EMAIL: EMAILS.a, HOMOLOG_PASSWORD: PASSWORDS.a, HOMOLOG_EMAIL_2: EMAILS.b, HOMOLOG_PASSWORD_2: PASSWORDS.b, ...over,
  });
  const limited = () => { const e = new TRPCClientError(`Muitas tentativas de login para ${EMAILS.a}.`); Object.assign(e, { data: { code: "TOO_MANY_REQUESTS" } }); return e; };
  const unauthorized = () => { const e = new TRPCClientError(`E-mail ou senha inválidos (password=${PASSWORDS.a}).`); Object.assign(e, { data: { code: "UNAUTHORIZED" } }); return e; };
  type Fake = { calls: string[]; writes: string[] };
  function fakeSession(o: { userId: number; login?: () => Error | null; allowed?: boolean }, log: Fake) {
    const state = { cookie: "", orgId: null as number | null, lastCorrelationId: null as string | null };
    let n = 0;
    const hit = (name: string, write = false) => { log.calls.push(name); if (write) log.writes.push(name); state.lastCorrelationId = `homolog-test-${o.userId}-${++n}`; };
    const api = {
      auth: {
        login: { mutate: async () => { hit("auth.login"); const err = o.login?.(); if (err) throw err; state.cookie = "app_session_id=SEGREDO-DO-COOKIE"; return { success: true }; } },
        me: { query: async () => { hit("auth.me"); return { id: o.userId, role: "user", name: `Sintético ${o.userId}` }; } },
      },
      organizations: {
        listMine: { query: async () => { hit("organizations.listMine"); return [{ org: { id: 2, slug: "homologacao-sintetica" } }]; } },
        getCurrent: { query: async () => { hit("organizations.getCurrent"); return { org: { id: 2, slug: "homologacao-sintetica" }, role: "manager", priceGovernance: { demonstrativePricesAllowed: o.allowed ?? true } }; } },
      },
      procurementProcess: { createProcess: { mutate: async () => { hit("procurementProcess.createProcess", true); return {}; } } },
    };
    return { api, state } as never;
  }
  async function run(p: { env?: Record<string, string | undefined>; a?: Parameters<typeof fakeSession>[0]; b?: Parameters<typeof fakeSession>[0] } = {}) {
    const log: Fake = { calls: [], writes: [] };
    const report: { blocked?: string; preflight?: PreflightRecord } = {};
    const author = fakeSession(p.a ?? { userId: 41 }, log);
    const issuer = fakeSession(p.b ?? { userId: 42 }, log);
    const outcome = await runHomologationPreflight(report, { run: "RUNX", baseUrl: "https://licigov-pro-staging.up.railway.app", env: p.env ?? env(), author, issuer })
      .then((r) => ({ ok: true as const, r }), (e: Error) => ({ ok: false as const, e }));
    return { log, report, outcome, json: JSON.stringify(report) };
  }
  const noSecrets = (json: string) => {
    for (const secret of [...Object.values(PASSWORDS), ...Object.values(EMAILS), "SEGREDO-DO-COOKIE", "app_session_id"]) expect(json).not.toContain(secret);
  };

  it("1º login recebe 429 ⇒ BLOCKED_HOMOLOGATION_LOGIN_RATE_LIMITED no JSON (etapa login_author), execução falha, 2º login nem tentado", async () => {
    const { report, outcome, log, json } = await run({ a: { userId: 41, login: limited } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.e.message).toMatch(new RegExp(`^${BLOCKED_LOGIN_RATE_LIMITED}:`));
    expect(report.blocked).toBe(BLOCKED_LOGIN_RATE_LIMITED);
    expect(report.preflight).toMatchObject({
      status: "BLOCKED", stage: "login_author", code: BLOCKED_LOGIN_RATE_LIMITED, cause: "TOO_MANY_REQUESTS", environment: "staging", run: "RUNX",
      writesPerformed: 0, correlationId: "homolog-test-41-1", guidance: expect.stringMatching(/aguarde a janela/i),
    });
    expect(report.preflight?.tenantId).toBeUndefined(); // tenant ainda não validado
    expect(log.calls).toEqual(["auth.login"]);
    expect(log.writes).toEqual([]);
    noSecrets(json);
  });
  it("2º login recebe 429 ⇒ bloqueio na etapa login_issuer, com o tenant já validado", async () => {
    const { report, outcome, log, json } = await run({ b: { userId: 42, login: limited } });
    expect(outcome.ok).toBe(false);
    expect(report).toMatchObject({ blocked: BLOCKED_LOGIN_RATE_LIMITED, preflight: { status: "BLOCKED", stage: "login_issuer", tenantId: 2, correlationId: "homolog-test-42-1", writesPerformed: 0 } });
    expect(log.writes).toEqual([]);
    noSecrets(json);
  });
  it("1º login falha por outro erro (credencial inválida) ⇒ BLOCKED_HOMOLOGATION_PREFLIGHT_FAILED, causa UNAUTHORIZED, sem segredo no detalhe", async () => {
    const { report, outcome, json } = await run({ a: { userId: 41, login: unauthorized } });
    expect(outcome.ok).toBe(false);
    expect(report).toMatchObject({ blocked: BLOCKED_PREFLIGHT_FAILED, preflight: { status: "BLOCKED", stage: "login_author", cause: "UNAUTHORIZED", code: BLOCKED_PREFLIGHT_FAILED } });
    expect(report.preflight?.detail).toContain("[REDACTED]");
    noSecrets(json);
  });
  it("credenciais ausentes ⇒ bloqueio estruturado (nunca PASS)", async () => {
    const { report, outcome } = await run({ env: env({ HOMOLOG_PASSWORD_2: undefined }) });
    expect(outcome.ok).toBe(false);
    expect(report).toMatchObject({ blocked: BLOCKED_PREFLIGHT_FAILED, preflight: { stage: "login_issuer", status: "BLOCKED" } });
  });
  it("identidades iguais ⇒ BLOCKED_HOMOLOGATION_SAME_IDENTITY (etapa distinct_identities)", async () => {
    const { report, log, json } = await run({ a: { userId: 41 }, b: { userId: 41 } });
    expect(report).toMatchObject({ blocked: BLOCKED_SAME_IDENTITY, preflight: { stage: "distinct_identities", code: BLOCKED_SAME_IDENTITY, tenantId: 2, writesPerformed: 0 } });
    expect(log.writes).toEqual([]);
    noSecrets(json);
  });
  it("exceção demonstrativa desabilitada ⇒ BLOCKED_HOMOLOGATION_DEMONSTRATIVE_PRICES_NOT_ENABLED (etapa demonstrative_prices)", async () => {
    const { report, log } = await run({ b: { userId: 42, allowed: false } });
    expect(report).toMatchObject({ blocked: BLOCKED_DEMONSTRATIVE_PRICES, preflight: { stage: "demonstrative_prices", code: BLOCKED_DEMONSTRATIVE_PRICES, correlationId: "homolog-test-42-4" } });
    expect(log.writes).toEqual([]);
  });
  it("destino não autorizado / exercício ausente ⇒ bloqueio antes de qualquer chamada HTTP", async () => {
    const log: Fake = { calls: [], writes: [] };
    const report: { blocked?: string; preflight?: PreflightRecord } = {};
    await expect(runHomologationPreflight(report, { run: "R", baseUrl: "https://licigov.example.com", env: env(), author: fakeSession({ userId: 1 }, log), issuer: fakeSession({ userId: 2 }, log) })).rejects.toThrow(/Destino recusado/);
    expect(report.preflight).toMatchObject({ status: "BLOCKED", stage: "target", environment: "unknown" });
    const r2 = await run({ env: env({ HOMOLOG_EXERCICIO: undefined }) });
    expect(r2.report.preflight).toMatchObject({ status: "BLOCKED", stage: "exercicio" });
    expect([...log.calls, ...r2.log.calls]).toEqual([]);
  });
  it("pré-flight integralmente aprovado ⇒ PASSED, sem `blocked`, só leituras + login (nenhuma escrita)", async () => {
    const { report, outcome, log, json } = await run();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.r).toMatchObject({ exercicio: 2026, a: { me: { id: 41 } }, b: { me: { id: 42 } } });
    expect(report.blocked).toBeUndefined();
    expect(report.preflight).toMatchObject({ status: "PASSED", stage: "completed", tenantId: 2, writesPerformed: 0, environment: "staging" });
    expect(new Set(log.calls)).toEqual(new Set(["auth.login", "auth.me", "organizations.listMine", "organizations.getCurrent"]));
    expect(log.writes).toEqual([]);
    noSecrets(json);
  });
  it("sanitizeDiagnostic remove segredos conhecidos, e-mails, JWT, Bearer e cookies", () => {
    const out = sanitizeDiagnostic("x a@b.co Bearer abc.def eyJhbGciOi.eyJzdWIi.sig cookie=app_session_id=zzz minhaSenha", ["minhaSenha"]);
    expect(out).not.toMatch(/a@b\.co|abc\.def|eyJhbGciOi|zzz|minhaSenha/);
  });
});
