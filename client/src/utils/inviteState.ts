/**
 * PR A.1 — Máquina de decisão da tela de aceite de convite (AceitarConvite.tsx). Puro — recebe o
 * estado já resolvido da query de validação do token + o e-mail do usuário atual (ou null se não
 * autenticado) e decide qual bloco de UI mostrar. Extraído do componente para ser testável sem
 * jsdom/testing-library (padrão do projeto — ver darkmode-tokens.test.ts).
 */

export type InviteView =
  | { kind: "loading" }
  | { kind: "invalid"; reason?: string }
  | { kind: "create_account" }
  | { kind: "accept_as_current_user" }
  | { kind: "email_mismatch"; invitedEmail: string; currentEmail: string };

export interface InviteTokenQueryResult {
  valid: boolean;
  reason?: string;
  emailNormalized?: string;
}

export interface ResolveInviteViewInput {
  isLoading: boolean;
  data: InviteTokenQueryResult | undefined;
  /** E-mail do usuário autenticado (trim aplicado internamente); null quando não há sessão. */
  currentUserEmail: string | null;
}

/** trim + lowercase — mesma normalização usada no backend (domain/invitations.ts). */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveInviteView(input: ResolveInviteViewInput): InviteView {
  if (input.isLoading || !input.data) return { kind: "loading" };

  if (!input.data.valid) return { kind: "invalid", reason: input.data.reason };

  if (input.currentUserEmail === null) return { kind: "create_account" };

  const invitedEmail = input.data.emailNormalized ? normalize(input.data.emailNormalized) : "";
  const currentEmail = normalize(input.currentUserEmail);

  if (invitedEmail && invitedEmail !== currentEmail) {
    return { kind: "email_mismatch", invitedEmail, currentEmail };
  }

  return { kind: "accept_as_current_user" };
}
