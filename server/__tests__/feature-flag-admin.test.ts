/**
 * C.3A-OPS — Testes unit (sem DB) do controle institucional de feature flags.
 *
 * Cobre o que independe de banco: allowlist de flags governáveis, obrigatoriedade de reason/idempotencyKey,
 * validação de expiry, guarda de ambiente (ESCRITA em produção só para PRODUCTION_GOVERNABLE_TENANT_FLAGS,
 * por tenant), RBAC do router (admin de plataforma, organizationId obrigatório) e leitura fail-closed sem DB.
 * O comportamento end-to-end (UPSERT, auditoria atômica, replay, cache, multi-tenant) é coberto contra
 * MySQL real em `integration/feature-flag-admin-mysql-smoke.test.ts` (CI).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isGovernableFlag,
  isProductionGovernableFlag,
  GOVERNABLE_TENANT_FLAGS,
  PRODUCTION_GOVERNABLE_TENANT_FLAGS,
  PRODUCTION_REASON_MIN_LENGTH,
  resolveTenantFlag,
  setTenantFlag,
  tenantFlagWritePolicy,
} from "../services/featureFlagAdminService";
import { FF_DIRECT_CONTRACT_SHADOW } from "../services/directContractShadowService";
import { CANONICAL_INGESTION_FLAG } from "../services/ingestionUploadService";
import { featureFlagAdminRouter } from "../routers/featureFlagAdminRouter";

const baseWrite = {
  organizationId: 4242,
  flagName: FF_DIRECT_CONTRACT_SHADOW,
  enabled: true,
  reason: "homologação staging",
  idempotencyKey: "ff-unit-key-1",
  actorUserId: 7,
  correlationId: "corr-ff-unit",
};

describe("C.3A-OPS — allowlist de flags governáveis", () => {
  it("a flag da C.3A é governável; nomes arbitrários não", () => {
    expect(isGovernableFlag(FF_DIRECT_CONTRACT_SHADOW)).toBe(true);
    expect(GOVERNABLE_TENANT_FLAGS).toContain(FF_DIRECT_CONTRACT_SHADOW);
    expect(isGovernableFlag("FF_QUALQUER_COISA")).toBe(false);
  });

  it("resolveTenantFlag recusa flag fora do allowlist (BAD_REQUEST)", async () => {
    await expect(resolveTenantFlag("FF_INEXISTENTE", 1)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("setTenantFlag recusa flag fora do allowlist (BAD_REQUEST)", async () => {
    await expect(setTenantFlag({ ...baseWrite, flagName: "FF_INEXISTENTE" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("C.3A-OPS — validações de escrita (sem DB)", () => {
  it("reason vazia é recusada", async () => {
    await expect(setTenantFlag({ ...baseWrite, reason: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("idempotencyKey vazia é recusada", async () => {
    await expect(setTenantFlag({ ...baseWrite, idempotencyKey: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("expiresAt no passado é recusada", async () => {
    await expect(setTenantFlag({ ...baseWrite, expiresAt: new Date(Date.now() - 60_000) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("C.3A-OPS — leitura fail-closed sem DB", () => {
  it("resolveTenantFlag sem DATABASE_URL → efetivo false, origem default", async () => {
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, 999);
    // Sem DATABASE_URL configurado no ambiente de teste unit, getDb() é null.
    if (!process.env.DATABASE_URL) {
      expect(view.effectiveValue).toBe(false);
      expect(view.origin).toBe("default");
      expect(view.override).toBeNull();
    } else {
      // Com DB presente, a leitura é válida (não deve lançar) — smoke cobre os valores.
      expect(["tenant", "global", "default"]).toContain(view.origin);
    }
  });

  it("C.3A-OPS.1: getTenantFlag retorna environment + writeAllowed (fonte canônica do backend)", async () => {
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, 999);
    expect(["development", "staging", "production"]).toContain(view.environment);
    expect(typeof view.writeAllowed).toBe("boolean");
    // writeAllowed espelha !IS_PRODUCTION — no ambiente de teste (development), escrita é permitida.
    expect(view.writeAllowed).toBe(view.environment !== "production");
  });
});

describe("C.3A-OPS — guarda de ambiente (ESCRITA bloqueada em produção)", () => {
  afterEach(() => {
    vi.doUnmock("../config/env");
    vi.resetModules();
  });

  it("em produção, setTenantFlag falha ANTES de qualquer efeito (FORBIDDEN)", async () => {
    vi.resetModules();
    // Sobrescreve APENAS IS_PRODUCTION (fonte canônica) mantendo o restante do módulo real —
    // não força o boot de produção (que tem outras guardas de env não-relacionadas a esta feature).
    vi.doMock("../config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../config/env")>();
      return { ...actual, IS_PRODUCTION: true };
    });
    const svc = await import("../services/featureFlagAdminService");
    let thrown: unknown;
    try {
      await svc.setTenantFlag(baseWrite);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TRPCError);
    expect((thrown as TRPCError).code).toBe("FORBIDDEN");
  });
});

// ─── Produção governada por tenant: FF_CANONICAL_INGESTION ──────────────────────────────────────────
const PROD_REASON = "Piloto Moreira Sales — importação de PDF da Pesquisa de Preços";

describe("Política de escrita por ambiente (pura, centralizada)", () => {
  it("produção: só o subconjunto explícito; staging/dev: allowlist geral (L — sem regressão)", () => {
    expect(PRODUCTION_GOVERNABLE_TENANT_FLAGS).toEqual([CANONICAL_INGESTION_FLAG]);
    for (const f of PRODUCTION_GOVERNABLE_TENANT_FLAGS) expect(GOVERNABLE_TENANT_FLAGS).toContain(f);
    expect(tenantFlagWritePolicy(CANONICAL_INGESTION_FLAG, true)).toBe("allowed"); // A
    expect(tenantFlagWritePolicy(FF_DIRECT_CONTRACT_SHADOW, true)).toBe("forbidden_in_production"); // C
    expect(tenantFlagWritePolicy("FF_QUALQUER_COISA", true)).toBe("forbidden_in_production"); // B
    expect(tenantFlagWritePolicy(CANONICAL_INGESTION_FLAG, false)).toBe("allowed");
    expect(tenantFlagWritePolicy(FF_DIRECT_CONTRACT_SHADOW, false)).toBe("allowed"); // L
    expect(tenantFlagWritePolicy("FF_QUALQUER_COISA", false)).toBe("not_governable");
  });

  it("match EXATO — sem wildcard, prefixo, sufixo ou variação de caixa/espaço", () => {
    for (const f of [`${CANONICAL_INGESTION_FLAG}_X`, "FF_CANONICAL", "ff_canonical_ingestion", ` ${CANONICAL_INGESTION_FLAG}`, "*", "FF_*"]) {
      expect(isProductionGovernableFlag(f)).toBe(false);
      expect(tenantFlagWritePolicy(f, true)).toBe("forbidden_in_production");
    }
  });

  it("FF_CANONICAL_INGESTION é governável (leitura administrativa não é mais recusada) — G", async () => {
    expect(isGovernableFlag(CANONICAL_INGESTION_FLAG)).toBe(true);
    const view = await resolveTenantFlag(CANONICAL_INGESTION_FLAG, 999);
    expect(view.flagName).toBe(CANONICAL_INGESTION_FLAG);
    if (!process.env.DATABASE_URL) expect([view.effectiveValue, view.origin]).toEqual([false, "default"]);
  });

  it("fora de produção a reason curta continua aceita (sem regressão): passa das validações e só para no tenant", async () => {
    await expect(setTenantFlag({ ...baseWrite, flagName: CANONICAL_INGESTION_FLAG, reason: "x" })).rejects.not.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("Produção (IS_PRODUCTION=true): FF_CANONICAL_INGESTION tenant-scoped; demais bloqueadas", () => {
  afterEach(() => {
    vi.doUnmock("../config/env");
    vi.resetModules();
  });
  async function prodService() {
    vi.resetModules();
    vi.doMock("../config/env", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../config/env")>();
      return { ...actual, IS_PRODUCTION: true };
    });
    return import("../services/featureFlagAdminService");
  }

  it("A: FF_CANONICAL_INGESTION passa pela guarda de ambiente (segue p/ validações do tenant, não FORBIDDEN)", async () => {
    const svc = await prodService();
    const err = await svc.setTenantFlag({ ...baseWrite, flagName: CANONICAL_INGESTION_FLAG, reason: PROD_REASON }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    // Sem DB no unit, para em "organização não encontrada" — ou seja, a guarda de produção deixou passar.
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  it("B/C: flag arbitrária e FF_DIRECT_CONTRACT_SHADOW continuam FORBIDDEN em produção", async () => {
    const svc = await prodService();
    await expect(svc.setTenantFlag({ ...baseWrite, flagName: "FF_QUALQUER_COISA", reason: PROD_REASON })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.setTenantFlag({ ...baseWrite, reason: PROD_REASON })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.setTenantFlag({ ...baseWrite, flagName: CANONICAL_INGESTION_FLAG.toLowerCase(), reason: PROD_REASON })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("em produção, reason abaixo do mínimo é recusada (BAD_REQUEST) antes de qualquer efeito", async () => {
    const svc = await prodService();
    const short = "x".repeat(PRODUCTION_REASON_MIN_LENGTH - 1);
    await expect(svc.setTenantFlag({ ...baseWrite, flagName: CANONICAL_INGESTION_FLAG, reason: `  ${short}  ` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("writeAllowed reflete a política: true só para FF_CANONICAL_INGESTION em produção", async () => {
    const svc = await prodService();
    expect((await svc.resolveTenantFlag(CANONICAL_INGESTION_FLAG, 999)).writeAllowed).toBe(true);
    expect((await svc.resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, 999)).writeAllowed).toBe(false);
  });
});

describe("Router featureFlagAdmin — RBAC, tenant obrigatório, sem superfície global", () => {
  const ctxFor = (role: string) => ({ user: { id: 7, role, name: "T", email: "t@x" }, req: { headers: {} }, res: {}, correlationId: "corr-ff-router" }) as never;

  it("não-admin (inclusive owner/manager de org) → FORBIDDEN em leitura e escrita", async () => {
    for (const role of ["user", "owner", "manager"]) {
      const caller = featureFlagAdminRouter.createCaller(ctxFor(role));
      await expect(caller.getTenantFlag({ organizationId: 1, flagName: CANONICAL_INGESTION_FLAG })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.setTenantFlag({ organizationId: 1, flagName: CANONICAL_INGESTION_FLAG, enabled: true, reason: PROD_REASON, idempotencyKey: "k" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("E: organizationId é obrigatório e positivo (sem tenant inferido/global)", async () => {
    const caller = featureFlagAdminRouter.createCaller(ctxFor("admin"));
    for (const bad of [undefined, null, 0, -1, 1.5]) {
      await expect(caller.setTenantFlag({ organizationId: bad as never, flagName: CANONICAL_INGESTION_FLAG, enabled: true, reason: PROD_REASON, idempotencyKey: "k" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.getTenantFlag({ organizationId: bad as never, flagName: CANONICAL_INGESTION_FLAG })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("admin lê FF_CANONICAL_INGESTION pelo router (G)", async () => {
    const view = await featureFlagAdminRouter.createCaller(ctxFor("admin")).getTenantFlag({ organizationId: 999, flagName: CANONICAL_INGESTION_FLAG });
    expect(view.flagName).toBe(CANONICAL_INGESTION_FLAG);
    expect(view.organizationId).toBe(999);
  });

  it("D: nenhuma mutation global — o router só expõe getTenantFlag/setTenantFlag e o serviço nunca escreve em feature_flags", () => {
    expect(Object.keys(featureFlagAdminRouter._def.procedures).sort()).toEqual(["getTenantFlag", "setTenantFlag"]);
    const src = readFileSync(path.join(process.cwd(), "server/services/featureFlagAdminService.ts"), "utf8");
    expect(src).not.toMatch(/\.(insert|update|delete)\(\s*featureFlags\s*\)/);
    expect(src).toMatch(/\.insert\(\s*tenantFeatureFlags\s*\)/);
  });
});
