/**
 * PR A.1 — Códigos de erro estáveis do fluxo de acesso institucional (convites, membros,
 * recuperação de senha, onboarding de tenants).
 *
 * Padrão já usado no projeto (ex.: `NO_ORGANIZATION_MEMBERSHIP` em services/tenantService.ts):
 * a const exportada é usada literalmente como `message` do TRPCError. O client mapeia esses
 * códigos para texto amigável (client/src/utils/authErrorMessages.ts, C9) — o valor aqui é um
 * contrato entre servidor e cliente, não deve mudar depois de publicado.
 *
 * Cada código documenta em qual fluxo aparece. Onde a resposta pública precisa ser
 * anti-enumeração (ex.: `password reset request`), o código NÃO é usado na resposta pública —
 * ele existe para o caminho interno/auditoria, nunca vaza para quem não tem direito à informação.
 */

// ─── Convites ───────────────────────────────────────────────────────────────

/** Token de convite não corresponde a nenhum convite conhecido (hash não encontrado). */
export const INVITATION_NOT_FOUND = "INVITATION_NOT_FOUND";
/** Convite existe mas passou de `expiresAt`. */
export const INVITATION_EXPIRED = "INVITATION_EXPIRED";
/** Convite foi cancelado pelo administrador antes do aceite. */
export const INVITATION_CANCELLED = "INVITATION_CANCELLED";
/** Convite já foi aceito anteriormente (replay do link). */
export const INVITATION_ALREADY_ACCEPTED = "INVITATION_ALREADY_ACCEPTED";
/** Aceite por usuário autenticado cujo e-mail de sessão não bate com o e-mail convidado. */
export const INVITATION_EMAIL_MISMATCH = "INVITATION_EMAIL_MISMATCH";

// ─── Membros da organização ─────────────────────────────────────────────────

/** Convite/reativação de membro para um e-mail que já é membro ativo da organização. */
export const MEMBER_ALREADY_EXISTS = "MEMBER_ALREADY_EXISTS";
/** Operação sobre membro (ativar/desativar/alterar papel/remover) referenciando id inexistente. */
export const MEMBER_NOT_FOUND = "MEMBER_NOT_FOUND";
/** Rebaixar/desativar/remover deixaria a organização sem nenhum admin/owner ativo. */
export const LAST_TENANT_ADMIN = "LAST_TENANT_ADMIN";
/** Tentativa de atribuir um papel que o próprio ator não tem autoridade para conceder. */
export const ROLE_ASSIGNMENT_FORBIDDEN = "ROLE_ASSIGNMENT_FORBIDDEN";
/** Ação de gestão de membros fora da organização do ator (isolamento multi-tenant). */
export const TENANT_ACCESS_FORBIDDEN = "TENANT_ACCESS_FORBIDDEN";

// ─── Recuperação de senha ────────────────────────────────────────────────────

/** Token de redefinição não corresponde a nenhum token conhecido. */
export const PASSWORD_RESET_INVALID = "PASSWORD_RESET_INVALID";
/** Token de redefinição existe mas passou de `expiresAt`. */
export const PASSWORD_RESET_EXPIRED = "PASSWORD_RESET_EXPIRED";
/** Token de redefinição já foi usado (uso único — replay do link). */
export const PASSWORD_RESET_CONSUMED = "PASSWORD_RESET_CONSUMED";

// ─── Rate limiting (compartilhado entre convite/reset) ──────────────────────

/** Excesso de tentativas para a operação (ver server/rateLimiter.ts). */
export const RATE_LIMITED = "RATE_LIMITED";

// ─── E-mail ──────────────────────────────────────────────────────────────────

/** O provider de e-mail recusou a entrega (falha permanente, ex.: endereço inválido). */
export const EMAIL_DELIVERY_FAILED = "EMAIL_DELIVERY_FAILED";
/** Configuração de e-mail ausente/incompleta (não deveria ocorrer em runtime — ver config/email.ts). */
export const EMAIL_CONFIGURATION_MISSING = "EMAIL_CONFIGURATION_MISSING";

// ─── Onboarding de tenants ───────────────────────────────────────────────────

/** CNPJ ou slug já pertence a outra organização (conflito real, entrada diferente). */
export const TENANT_ALREADY_EXISTS = "TENANT_ALREADY_EXISTS";
/** Onboarding com dados que colidem parcialmente com um tenant existente (nem replay, nem novo). */
export const ONBOARDING_CONFLICT = "ONBOARDING_CONFLICT";

/** União de todos os códigos — útil para tipar respostas/testes sem repetir a lista. */
export const AUTH_ERROR_CODES = [
  INVITATION_NOT_FOUND,
  INVITATION_EXPIRED,
  INVITATION_CANCELLED,
  INVITATION_ALREADY_ACCEPTED,
  INVITATION_EMAIL_MISMATCH,
  MEMBER_ALREADY_EXISTS,
  MEMBER_NOT_FOUND,
  LAST_TENANT_ADMIN,
  ROLE_ASSIGNMENT_FORBIDDEN,
  TENANT_ACCESS_FORBIDDEN,
  PASSWORD_RESET_INVALID,
  PASSWORD_RESET_EXPIRED,
  PASSWORD_RESET_CONSUMED,
  RATE_LIMITED,
  EMAIL_DELIVERY_FAILED,
  EMAIL_CONFIGURATION_MISSING,
  TENANT_ALREADY_EXISTS,
  ONBOARDING_CONFLICT,
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
