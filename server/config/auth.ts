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

export const AUTH_CONFIG = {
  jwtSecret: JWT_SECRET,
  cookieSecret: JWT_SECRET,
};
