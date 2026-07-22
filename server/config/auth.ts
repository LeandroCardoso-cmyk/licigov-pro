/**
 * RC-3.5 — Configuração de autenticação (JWT obrigatório).
 *
 * O segredo JWT NUNCA pode ser vazio: eliminado o antigo fallback de string vazia.
 * Em produção/staging, a ausência de JWT_SECRET FALHA na inicialização — o
 * sistema jamais inicia com segredo vazio. Em desenvolvimento/testes, usa um
 * fallback determinístico explícito (nunca vazio) para não travar a suíte.
 */
import { APP_ENV } from "./env";

/** Fallback determinístico SOMENTE para desenvolvimento/testes — nunca em produção. */
const DEV_ONLY_SECRET =
  "licigov-development-only-insecure-jwt-secret-change-me";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  // Nunca iniciar com segredo vazio em produção/staging → falha na inicialização.
  if (APP_ENV === "production" || APP_ENV === "staging") {
    throw new Error(
      `[BOOT][${APP_ENV}] JWT_SECRET é obrigatório: o sistema não pode iniciar sem um segredo JWT configurado.`
    );
  }

  // development/test: fallback explícito (nunca vazio).
  return DEV_ONLY_SECRET;
}

const JWT_SECRET = resolveJwtSecret();

// ─── RC-SEC-PR-A (SEC-022) — TTL de sessão configurável e seguro ─────────────
// Removido o default de 1 ano. Produção usa 24h por padrão; qualquer ambiente
// pode ajustar via SESSION_TTL_HOURS. Refresh token completo fica para PR futura.
const DEFAULT_SESSION_TTL_HOURS = 24;

function resolveSessionTtlHours(): number {
  const raw = process.env.SESSION_TTL_HOURS?.trim();
  if (!raw) return DEFAULT_SESSION_TTL_HOURS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 30) {
    throw new Error(
      `[BOOT][${APP_ENV}] SESSION_TTL_HOURS inválido: "${raw}". Use um número de horas entre 1 e 720.`
    );
  }
  return parsed;
}

export const SESSION_TTL_HOURS = resolveSessionTtlHours();
export const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

// ─── RC-SEC-PR-A (CONFIG-005) — Senha administrativa sem default em produção ──
// Em produção/staging, ADMIN_PASSWORD é OBRIGATÓRIA: o boot falha se ausente.
// Nenhum valor default (ex.: "Admin@123") é utilizável em produção. Em
// desenvolvimento/testes usa-se um valor explícito de fixture (nunca produção).
const DEV_ONLY_ADMIN_PASSWORD = "dev-only-admin-change-me";

function resolveAdminPassword(): string {
  const pwd = process.env.ADMIN_PASSWORD;
  if (pwd && pwd.length >= 8) return pwd;

  if (APP_ENV === "production" || APP_ENV === "staging") {
    throw new Error(
      `[BOOT][${APP_ENV}] ADMIN_PASSWORD é obrigatória (mínimo 8 caracteres): ` +
        `o sistema não inicia com senha administrativa default em produção.`
    );
  }
  return DEV_ONLY_ADMIN_PASSWORD;
}

export const ADMIN_PASSWORD = resolveAdminPassword();

// ─── RC-SEC-PR-A (SEC-017) — Registro público fail-closed ────────────────────
// Registro público desabilitado por padrão. Só é permitido quando
// ALLOW_PUBLIC_REGISTRATION=true (default seguro = false). Mesmo habilitado,
// o novo usuário NUNCA recebe membership automático em nenhuma organização.
export const ALLOW_PUBLIC_REGISTRATION =
  process.env.ALLOW_PUBLIC_REGISTRATION?.trim().toLowerCase() === "true";

export const AUTH_CONFIG = {
  jwtSecret: JWT_SECRET,
  cookieSecret: JWT_SECRET,
  sessionTtlMs: SESSION_TTL_MS,
  allowPublicRegistration: ALLOW_PUBLIC_REGISTRATION,
};
