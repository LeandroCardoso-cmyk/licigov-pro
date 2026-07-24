/**
 * Configuração de e-mail transacional — convites institucionais, recuperação de senha e
 * notificações do fluxo de acesso. Segue o mesmo padrão de `config/ai.ts` (AI-015): resolução
 * pura/testável a partir do ambiente + validação fail-closed no BOOT, nunca na primeira tentativa
 * de envio.
 *
 * ENV:
 *   EMAIL_PROVIDER = brevo | console | fake
 *     default: "fake" em teste (VITEST=true), "console" em development, "brevo" em staging/production
 *   EMAIL_ENABLED  = true | false   (default: false em dev/teste, true em staging/production)
 *   BREVO_API_KEY / BREVO_SENDER_EMAIL / BREVO_SENDER_NAME
 *   APP_BASE_URL   = origem pública usada nos links dos e-mails (convite, redefinição de senha)
 *   EMAIL_MAX_ATTEMPTS / EMAIL_DISPATCH_INTERVAL_MS
 *
 * Regra fail-closed: em staging/production, "console" e "fake" NUNCA são o provider ativo — o
 * boot lança se EMAIL_PROVIDER resolver para outra coisa que não "brevo", ou se faltar
 * BREVO_API_KEY / BREVO_SENDER_EMAIL / APP_BASE_URL. Um e-mail institucional (convite, redefinição
 * de senha) jamais pode silenciosamente "não sair" por falta de configuração.
 */

import { IS_DEVELOPMENT, IS_STAGING, IS_PRODUCTION } from "./env";

export type EmailProviderName = "brevo" | "console" | "fake";

export interface EmailConfigEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_ENABLED?: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  APP_BASE_URL?: string;
  EMAIL_MAX_ATTEMPTS?: string;
  EMAIL_DISPATCH_INTERVAL_MS?: string;
}

export interface EmailRuntimeContext {
  isDevelopment: boolean;
  isStaging: boolean;
  isProduction: boolean;
  /** process.env.VITEST === "true" — a suíte roda com APP_ENV=development, então isTest tem
   *  precedência sobre isDevelopment na resolução do provider (senão os testes tentariam usar
   *  o ConsoleEmailProvider real). */
  isTest: boolean;
}

export interface EmailConfig {
  provider: EmailProviderName;
  enabled: boolean;
  brevoApiKey: string;
  senderEmail: string;
  senderName: string;
  /** Origem pública (sem barra final) usada para montar links nos e-mails. */
  appBaseUrl: string;
  maxAttempts: number;
  dispatchIntervalMs: number;
}

const DEFAULT_SENDER_NAME = "LiciGov Pro";
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_DISPATCH_INTERVAL_MS = 30_000;
const DEFAULT_APP_BASE_URL_DEV = "http://localhost:3000";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Remove barra final (para concatenar caminhos sem `//`). Puro. */
function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Resolve o provider a partir do ENV; default depende do ambiente. Puro/testável. */
export function resolveEmailProvider(env: EmailConfigEnv, ctx: EmailRuntimeContext): EmailProviderName {
  const raw = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "brevo" || raw === "console" || raw === "fake") return raw;
  if (ctx.isTest) return "fake";
  if (ctx.isDevelopment) return "console";
  return "brevo"; // staging/production
}

/** Resolve se o dispatcher de e-mail deve estar ativo. Puro/testável. */
export function resolveEmailEnabled(env: EmailConfigEnv, ctx: EmailRuntimeContext): boolean {
  const raw = (env.EMAIL_ENABLED ?? "").trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return ctx.isStaging || ctx.isProduction; // default: ligado fora de dev/teste
}

/**
 * Monta e valida a configuração de e-mail. Fail-closed: fora de dev/teste, o provider TEM que
 * ser "brevo" e as credenciais/URL pública são obrigatórias — lança um erro descritivo no boot.
 */
export function resolveEmailConfig(env: EmailConfigEnv, ctx: EmailRuntimeContext): EmailConfig {
  const provider = resolveEmailProvider(env, ctx);
  const enabled = resolveEmailEnabled(env, ctx);

  const appBaseUrlRaw = env.APP_BASE_URL?.trim() || (ctx.isDevelopment && !ctx.isTest ? DEFAULT_APP_BASE_URL_DEV : "");

  const config: EmailConfig = {
    provider,
    enabled,
    brevoApiKey: env.BREVO_API_KEY?.trim() ?? "",
    senderEmail: env.BREVO_SENDER_EMAIL?.trim() ?? "",
    senderName: env.BREVO_SENDER_NAME?.trim() || DEFAULT_SENDER_NAME,
    appBaseUrl: appBaseUrlRaw ? stripTrailingSlash(appBaseUrlRaw) : "",
    maxAttempts: parsePositiveInt(env.EMAIL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
    dispatchIntervalMs: parsePositiveInt(env.EMAIL_DISPATCH_INTERVAL_MS, DEFAULT_DISPATCH_INTERVAL_MS),
  };

  if ((ctx.isStaging || ctx.isProduction) && !ctx.isTest) {
    const missing: string[] = [];
    if (config.provider !== "brevo") missing.push(`EMAIL_PROVIDER deve ser "brevo" em staging/production (atual: "${config.provider}")`);
    if (!config.brevoApiKey) missing.push("BREVO_API_KEY");
    if (!config.senderEmail) missing.push("BREVO_SENDER_EMAIL");
    if (!config.appBaseUrl) missing.push("APP_BASE_URL");
    if (missing.length > 0) {
      throw new Error(
        `[BOOT] Configuração de e-mail institucional incompleta para staging/production:\n` +
        missing.map(m => `  • ${m}`).join("\n")
      );
    }
  }

  return config;
}

const runtimeContext: EmailRuntimeContext = {
  isDevelopment: IS_DEVELOPMENT,
  isStaging: IS_STAGING,
  isProduction: IS_PRODUCTION,
  isTest: process.env.VITEST === "true",
};

export const EMAIL_CONFIG: EmailConfig = resolveEmailConfig(
  {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    EMAIL_ENABLED: process.env.EMAIL_ENABLED,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
    APP_BASE_URL: process.env.APP_BASE_URL,
    EMAIL_MAX_ATTEMPTS: process.env.EMAIL_MAX_ATTEMPTS,
    EMAIL_DISPATCH_INTERVAL_MS: process.env.EMAIL_DISPATCH_INTERVAL_MS,
  },
  runtimeContext
);
