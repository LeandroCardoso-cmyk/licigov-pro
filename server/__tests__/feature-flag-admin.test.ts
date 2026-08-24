/**
 * C.3A-OPS — Testes unit (sem DB) do controle institucional de feature flags.
 *
 * Cobre o que independe de banco: allowlist de flags governáveis, obrigatoriedade de reason/idempotencyKey,
 * validação de expiry, guarda de ambiente (ESCRITA bloqueada em produção) e leitura fail-closed sem DB.
 * O comportamento end-to-end (UPSERT, auditoria atômica, replay, cache, multi-tenant) é coberto contra
 * MySQL real em `integration/feature-flag-admin-mysql-smoke.test.ts` (CI).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  isGovernableFlag,
  GOVERNABLE_TENANT_FLAGS,
  resolveTenantFlag,
  setTenantFlag,
} from "../services/featureFlagAdminService";
import { FF_DIRECT_CONTRACT_SHADOW } from "../services/directContractShadowService";

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
