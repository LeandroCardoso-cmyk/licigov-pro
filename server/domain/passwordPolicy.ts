/**
 * PR A.1 — Política de senha compartilhada entre os fluxos de acesso institucional
 * (redefinição de senha e aceite de convite com criação de conta).
 *
 * ORIGEM DO MÍNIMO DE 8 (homologação, Seção 8): o piso de 8 caracteres NÃO foi criado nesta PR —
 * é a regra PREEXISTENTE do sistema, aplicada em `authRouter.register` desde antes desta PR
 * (`z.string().min(8).max(128)`, presente na base `main` 695e2dc). Este módulo deliberadamente
 * PRESERVA esse piso para manter a política de senha consistente em TODOS os fluxos (register,
 * reset, aceite de convite) — elevar só os fluxos novos para 12 criaria a inconsistência de um
 * usuário poder registrar com 8 mas ser obrigado a 12 ao redefinir. Alterar o piso global é uma
 * decisão de produto separada (fora do escopo desta PR, que não deve mudar o comportamento
 * preexistente do register).
 *
 * REGRA NOVA desta PR (que o register não tinha): a senha não pode ser igual ao e-mail
 * normalizado (checagem `PASSWORD_EQUALS_EMAIL` abaixo). Passphrases são permitidas — não há
 * regra de composição (maiúscula/número/especial). Hash continua bcrypt `SALT_ROUNDS=12`
 * (services/passwordSecurity.ts). `validatePasswordStrength` (scoring 0-5) existe no código mas
 * não é aplicada por nenhum fluxo — composição não adotada; este módulo não a usa.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyViolationCode =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_EQUALS_EMAIL";

export interface PasswordPolicyResult {
  valid: boolean;
  code?: PasswordPolicyViolationCode;
  message?: string;
}

/** trim + lowercase — mesma normalização usada para `emailNormalized` em convites/usuários. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Valida uma senha em texto claro contra a política institucional. Pura — não faz hash, não
 * consulta banco. `context.email`, quando informado, habilita a checagem senha≠e-mail.
 */
export function validatePassword(password: string, context: { email?: string } = {}): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      code: "PASSWORD_TOO_SHORT",
      message: `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      valid: false,
      code: "PASSWORD_TOO_LONG",
      message: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    };
  }
  if (context.email && password.trim().toLowerCase() === normalizeEmail(context.email)) {
    return {
      valid: false,
      code: "PASSWORD_EQUALS_EMAIL",
      message: "A senha não pode ser igual ao e-mail.",
    };
  }
  return { valid: true };
}
