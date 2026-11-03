/**
 * SEC-AUD-2026-10 — ADMIN_PASSWORD não tem consumidor (o boot não cria/promove admin desde o PR 0).
 * O boot de produção/staging não pode mais exigi-la; JWT_SECRET continua obrigatório (fail-closed).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const KEYS = ["APP_ENV", "JWT_SECRET", "ADMIN_PASSWORD"] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
  vi.resetModules();
});

async function loadAuthConfig(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return import("../../config/auth");
}

describe("config/auth — ADMIN_PASSWORD deixou de ser exigida", () => {
  for (const appEnv of ["production", "staging"]) {
    it(`${appEnv}: boot sem ADMIN_PASSWORD não falha`, async () => {
      const auth = await loadAuthConfig({ APP_ENV: appEnv, JWT_SECRET: "x".repeat(48) });
      expect(auth.AUTH_CONFIG.jwtSecret).toHaveLength(48);
      expect("ADMIN_PASSWORD" in auth).toBe(false);
    });

    it(`${appEnv}: JWT_SECRET ausente continua derrubando o boot`, async () => {
      await expect(loadAuthConfig({ APP_ENV: appEnv })).rejects.toThrow(/JWT_SECRET é obrigatório/);
    });
  }
});
