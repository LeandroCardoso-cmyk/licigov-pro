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

// ─── SEC-AUD-2026-10 — ADMIN_PASSWORD removida ───────────────────────────────
// CONFIG-005 exigia ADMIN_PASSWORD no boot de produção/staging porque o bootstrap antigo criava o
// admin com ela. Desde o PR 0 o boot não cria nem promove ninguém (bootstrap explícito via
// `pnpm admin:bootstrap` com ADMIN_BOOTSTRAP_*), e nenhum código lê mais a variável — exigi-la só
// mantinha um segredo sem consumidor no Railway (exposto no incidente de out/2026). A variável pode
// ser excluída dos ambientes; a senha da conta admin troca-se pelo fluxo de recuperação de senha.

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
