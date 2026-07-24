/**
 * RC-PR-B-001 — Resolução de APP_ENV a partir do ambiente.
 *
 * `resolveAppEnv` lê `process.env.APP_ENV` (com precedência sobre NODE_ENV). O boot
 * mostrava "production" em staging porque o script npm `start` fixava
 * `APP_ENV=production` inline (sobrescrevendo a variável do Railway). Corrigido o
 * script; aqui garantimos que a RESOLUÇÃO em si respeita a variável do ambiente.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV };

afterEach(() => {
  if (ORIGINAL.APP_ENV === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = ORIGINAL.APP_ENV;
  if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = ORIGINAL.NODE_ENV;
  vi.resetModules();
});

async function loadEnv(env: Record<string, string | undefined>) {
  // Atribuir `undefined` gravaria a string "undefined" — usar delete para desfazer.
  if (env.APP_ENV === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = env.APP_ENV;
  if (env.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.NODE_ENV;
  vi.resetModules();
  return await import("../../config/env");
}

describe("RC-PR-B-001 · resolução de APP_ENV", () => {
  it("APP_ENV=staging → 'staging' e IS_STAGING", async () => {
    const mod = await loadEnv({ APP_ENV: "staging", NODE_ENV: "production" });
    expect(mod.APP_ENV).toBe("staging");
    expect(mod.IS_STAGING).toBe(true);
    expect(mod.IS_PRODUCTION).toBe(false);
    expect(mod.ENV_TAG).toBe("[staging]");
  });

  it("APP_ENV tem precedência sobre NODE_ENV", async () => {
    const mod = await loadEnv({ APP_ENV: "staging", NODE_ENV: "production" });
    expect(mod.APP_ENV).toBe("staging");
  });

  it("APP_ENV=production → 'production' e IS_PRODUCTION", async () => {
    const mod = await loadEnv({ APP_ENV: "production", NODE_ENV: undefined });
    expect(mod.APP_ENV).toBe("production");
    expect(mod.IS_PRODUCTION).toBe(true);
  });

  it("sem APP_ENV, cai em NODE_ENV; sem ambos, 'development'", async () => {
    const a = await loadEnv({ APP_ENV: undefined, NODE_ENV: "staging" });
    expect(a.APP_ENV).toBe("staging");
    const b = await loadEnv({ APP_ENV: undefined, NODE_ENV: undefined });
    expect(b.APP_ENV).toBe("development");
  });
});
