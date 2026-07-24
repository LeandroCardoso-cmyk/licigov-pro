/**
 * PR A.1 — Configuração de e-mail transacional (config/email.ts).
 *
 * Regra fail-closed: fora de dev/teste, o provider tem que ser "brevo" e as credenciais/URL
 * pública (BREVO_API_KEY, BREVO_SENDER_EMAIL, APP_BASE_URL) são obrigatórias — o boot lança em
 * vez de deixar convites/recuperação de senha "silenciosamente" sem sair. Mesmo padrão do AI-015
 * (config/ai.ts): resolução pura testável + módulo que valida no import (boot).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  resolveEmailProvider,
  resolveEmailEnabled,
  resolveEmailConfig,
  type EmailRuntimeContext,
} from "../../config/email";

const DEV: EmailRuntimeContext = { isDevelopment: true, isStaging: false, isProduction: false, isTest: false };
const TEST: EmailRuntimeContext = { isDevelopment: true, isStaging: false, isProduction: false, isTest: true };
const STAGING: EmailRuntimeContext = { isDevelopment: false, isStaging: true, isProduction: false, isTest: false };
const PROD: EmailRuntimeContext = { isDevelopment: false, isStaging: false, isProduction: true, isTest: false };

describe("config/email · resolveEmailProvider (pura)", () => {
  it("teste (VITEST=true) → fake, mesmo com APP_ENV=development", () => {
    expect(resolveEmailProvider({}, TEST)).toBe("fake");
  });
  it("development (sem VITEST) → console", () => {
    expect(resolveEmailProvider({}, DEV)).toBe("console");
  });
  it("staging/production → brevo", () => {
    expect(resolveEmailProvider({}, STAGING)).toBe("brevo");
    expect(resolveEmailProvider({}, PROD)).toBe("brevo");
  });
  it("EMAIL_PROVIDER explícito tem precedência sobre o default do ambiente", () => {
    expect(resolveEmailProvider({ EMAIL_PROVIDER: "console" }, PROD)).toBe("console");
    expect(resolveEmailProvider({ EMAIL_PROVIDER: "BREVO" }, DEV)).toBe("brevo"); // case-insensitive
  });
  it("valor inválido cai no default do ambiente (não lança na resolução pura)", () => {
    expect(resolveEmailProvider({ EMAIL_PROVIDER: "sendgrid" }, DEV)).toBe("console");
  });
});

describe("config/email · resolveEmailEnabled (pura)", () => {
  it("default: false em dev/teste, true em staging/production", () => {
    expect(resolveEmailEnabled({}, DEV)).toBe(false);
    expect(resolveEmailEnabled({}, TEST)).toBe(false);
    expect(resolveEmailEnabled({}, STAGING)).toBe(true);
    expect(resolveEmailEnabled({}, PROD)).toBe(true);
  });
  it("EMAIL_ENABLED explícito sobrescreve o default", () => {
    expect(resolveEmailEnabled({ EMAIL_ENABLED: "true" }, DEV)).toBe(true);
    expect(resolveEmailEnabled({ EMAIL_ENABLED: "false" }, PROD)).toBe(false);
  });
});

describe("config/email · resolveEmailConfig (pura) — fail-closed staging/production", () => {
  it("staging sem BREVO_API_KEY/BREVO_SENDER_EMAIL/APP_BASE_URL → lança, listando o que falta", () => {
    expect(() => resolveEmailConfig({}, STAGING)).toThrow(/BREVO_API_KEY/);
    expect(() => resolveEmailConfig({}, STAGING)).toThrow(/BREVO_SENDER_EMAIL/);
    expect(() => resolveEmailConfig({}, STAGING)).toThrow(/APP_BASE_URL/);
  });
  it("production sem as mesmas variáveis → lança", () => {
    expect(() => resolveEmailConfig({}, PROD)).toThrow(/BREVO_API_KEY/);
  });
  it("staging com EMAIL_PROVIDER=console (ou fake) → lança mesmo com as demais variáveis presentes", () => {
    expect(() =>
      resolveEmailConfig(
        { EMAIL_PROVIDER: "console", BREVO_API_KEY: "k", BREVO_SENDER_EMAIL: "no-reply@x.com", APP_BASE_URL: "https://x.com" },
        STAGING
      )
    ).toThrow(/deve ser "brevo"/);
  });
  it("staging com todas as variáveis presentes → resolve sem lançar", () => {
    const cfg = resolveEmailConfig(
      { BREVO_API_KEY: "k", BREVO_SENDER_EMAIL: "no-reply@x.com", APP_BASE_URL: "https://staging.x.com/" },
      STAGING
    );
    expect(cfg.provider).toBe("brevo");
    expect(cfg.brevoApiKey).toBe("k");
    expect(cfg.senderEmail).toBe("no-reply@x.com");
    expect(cfg.appBaseUrl).toBe("https://staging.x.com"); // barra final removida
  });
  it("development sem nada → resolve com defaults (console, appBaseUrl localhost), não lança", () => {
    const cfg = resolveEmailConfig({}, DEV);
    expect(cfg.provider).toBe("console");
    expect(cfg.appBaseUrl).toBe("http://localhost:3000");
    expect(cfg.enabled).toBe(false);
  });
  it("isTest=true (mesmo com isStaging/isProduction) → provider fake e validação fail-closed pulada, nunca lança", () => {
    const cfg = resolveEmailConfig({}, { ...STAGING, isTest: true });
    expect(cfg.provider).toBe("fake"); // isTest tem precedência sobre o default de staging/production
    expect(() => resolveEmailConfig({}, { ...PROD, isTest: true })).not.toThrow();
  });
  it("senderName tem default 'LiciGov Pro'; maxAttempts/dispatchIntervalMs têm defaults numéricos válidos", () => {
    const cfg = resolveEmailConfig({}, TEST);
    expect(cfg.senderName).toBe("LiciGov Pro");
    expect(cfg.maxAttempts).toBe(5);
    expect(cfg.dispatchIntervalMs).toBe(30_000);
  });
  it("EMAIL_MAX_ATTEMPTS/EMAIL_DISPATCH_INTERVAL_MS inválidos caem no default (nunca NaN/0/negativo)", () => {
    const cfg = resolveEmailConfig({ EMAIL_MAX_ATTEMPTS: "abc", EMAIL_DISPATCH_INTERVAL_MS: "-5" }, TEST);
    expect(cfg.maxAttempts).toBe(5);
    expect(cfg.dispatchIntervalMs).toBe(30_000);
  });
});

describe("config/email · EMAIL_CONFIG (módulo) — fail-closed real no import/boot", () => {
  const ORIGINAL = {
    APP_ENV: process.env.APP_ENV,
    VITEST: process.env.VITEST,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("import em staging sem BREVO_*/APP_BASE_URL e SEM VITEST → lança no import (boot)", async () => {
    process.env.APP_ENV = "staging";
    delete process.env.VITEST; // simula boot real (fora do runner de teste)
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.APP_BASE_URL;
    process.env.JWT_SECRET = "x".repeat(40);
    process.env.ADMIN_PASSWORD = "admin-super-secret-123";
    vi.resetModules();
    await expect(import("../../config/email")).rejects.toThrow(/BREVO_API_KEY/);
  });

  it("import em staging com tudo presente e SEM VITEST → resolve normalmente", async () => {
    process.env.APP_ENV = "staging";
    delete process.env.VITEST;
    process.env.BREVO_API_KEY = "k";
    process.env.BREVO_SENDER_EMAIL = "no-reply@licigovpro.com.br";
    process.env.APP_BASE_URL = "https://staging.licigovpro.com.br";
    process.env.JWT_SECRET = "x".repeat(40);
    process.env.ADMIN_PASSWORD = "admin-super-secret-123";
    vi.resetModules();
    const mod = await import("../../config/email");
    expect(mod.EMAIL_CONFIG.provider).toBe("brevo");
    expect(mod.EMAIL_CONFIG.enabled).toBe(true);
  });
});
