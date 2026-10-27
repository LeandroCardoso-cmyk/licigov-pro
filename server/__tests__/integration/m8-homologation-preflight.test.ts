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
  assertDemonstrativePricesEnabled, assertDistinctIdentities, classifyLoginError,
  BLOCKED_DEMONSTRATIVE_PRICES, BLOCKED_SAME_IDENTITY, BLOCKED_LOGIN_RATE_LIMITED,
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
  it("a ordem no executor: identidades e capacidade são conferidas no beforeAll, antes da primeira escrita da jornada", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../homologation/staging-homologation-e2e.test.ts", import.meta.url), "utf8");
    const before = src.slice(src.indexOf("beforeAll("), src.indexOf("afterAll("));
    expect(before).toContain("assertDistinctIdentities(a.me, b.me)");
    expect(before).toContain("assertDemonstrativePricesEnabled(b.current)");
    expect(before).not.toMatch(/\.mutate\(\{\s*processNumber/);
    expect(src.indexOf("assertDemonstrativePricesEnabled(b.current)")).toBeLessThan(src.indexOf("procurementProcess.createProcess"));
  });
});
