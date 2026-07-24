/**
 * PR A.1 — Tradução dos códigos de erro estáveis de server/domain/authErrors.ts para texto
 * pt-BR amigável. Os códigos são duplicados aqui de propósito (não importar server/ no client —
 * quebraria o boundary de bundling) — são um CONTRATO entre servidor e cliente, documentado no
 * próprio authErrors.ts. Mensagens não mapeadas (ex.: validação zod) já chegam prontas em pt-BR
 * do backend e passam direto.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVITATION_NOT_FOUND: "Este link de convite não é válido.",
  INVITATION_EXPIRED: "Este convite expirou. Peça para um administrador da organização enviar um novo.",
  INVITATION_CANCELLED: "Este convite foi cancelado pela organização.",
  INVITATION_ALREADY_ACCEPTED: "Este convite já foi aceito. Se você já tem conta, faça login.",
  INVITATION_EMAIL_MISMATCH: "Este convite foi enviado para outro e-mail. Entre com a conta correta ou peça um novo convite.",
  MEMBER_ALREADY_EXISTS: "Este e-mail já é membro desta organização.",
  MEMBER_NOT_FOUND: "Membro não encontrado.",
  LAST_TENANT_ADMIN: "Não é possível remover o último administrador ativo da organização.",
  ROLE_ASSIGNMENT_FORBIDDEN: "Você não tem permissão para atribuir este papel.",
  TENANT_ACCESS_FORBIDDEN: "Você não tem acesso a esta organização.",
  PASSWORD_RESET_INVALID: "Este link de redefinição de senha não é válido.",
  PASSWORD_RESET_EXPIRED: "Este link expirou. Solicite uma nova redefinição de senha.",
  PASSWORD_RESET_CONSUMED: "Este link já foi usado. Solicite uma nova redefinição de senha.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  EMAIL_DELIVERY_FAILED: "Não foi possível enviar o e-mail. Tente novamente mais tarde.",
  EMAIL_CONFIGURATION_MISSING: "Serviço de e-mail temporariamente indisponível.",
  TENANT_ALREADY_EXISTS: "Já existe uma organização com estes dados.",
  ONBOARDING_CONFLICT: "Conflito ao processar o onboarding desta organização.",
};

const DEFAULT_MESSAGE = "Ocorreu um erro inesperado. Tente novamente.";

/** Traduz `error.message` de um TRPCError para texto amigável. Nunca lança. */
export function translateAuthError(message: string | undefined | null): string {
  if (!message) return DEFAULT_MESSAGE;
  return AUTH_ERROR_MESSAGES[message] ?? message;
}
