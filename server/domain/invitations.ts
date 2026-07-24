/**
 * PR A.1 — Convite institucional: único caminho de entrada de um servidor no sistema (não há
 * cadastro público). Máquina de estados + regras puras — sem I/O, sem banco, testável de forma
 * determinística. Mesmo estilo de `domain/importReviewState.ts`.
 */

import type { OrgRole } from "../../drizzle/schema";

// ─── Estado ───────────────────────────────────────────────────────────────────

export type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled" | "superseded";

/** Papel padrão de um convite quando o criador não especifica outro. */
export const DEFAULT_INVITATION_ROLE: OrgRole = "operator";

/** Validade do convite — 7 dias corridos a partir da criação (constante de domínio, não ENV). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function computeInvitationExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITATION_TTL_MS);
}

/** trim + lowercase — a chave de unicidade (`activeKey`) e a comparação de e-mail dependem disto. */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInvitationExpiredByTime(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * Estado EFETIVO do convite — considera a expiração por tempo mesmo quando o registro no banco
 * ainda está `pending` (a linha só vira `expired` de fato quando algo escreve nela; até lá, a
 * leitura já deve tratá-la como expirada). Os demais estados são terminais e não mudam com o tempo.
 */
export function effectiveInvitationStatus(status: InvitationStatus, expiresAt: Date, now: Date): InvitationStatus {
  if (status === "pending" && isInvitationExpiredByTime(expiresAt, now)) return "expired";
  return status;
}

// ─── Transições ─────────────────────────────────────────────────────────────

const INVITATION_TRANSITIONS: Record<InvitationStatus, InvitationStatus[]> = {
  pending:    ["accepted", "cancelled", "expired", "superseded"],
  accepted:   [], // terminal — o convite virou membership; reenviar não reabre
  expired:    [], // terminal — um convite NOVO é emitido (supersede), este não reabre
  cancelled:  [], // terminal
  superseded: [], // terminal — substituído por um convite mais novo ao mesmo org+e-mail
};

export function isValidInvitationTransition(from: InvitationStatus, to: InvitationStatus): boolean {
  return INVITATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalInvitationStatus(status: InvitationStatus): boolean {
  return INVITATION_TRANSITIONS[status].length === 0;
}

// ─── activeKey ──────────────────────────────────────────────────────────────

/**
 * `activeKey` implementa, no nível do banco (UNIQUE nullable), a regra "no máximo um convite
 * pendente por (organização, e-mail)": vale `"{organizationId}:{emailNormalized}"` só quando o
 * convite está `pending`; NULL em qualquer outro estado (MySQL permite múltiplos NULL sob UNIQUE).
 * Substituir um convite pendente por um novo é, portanto: supersede do antigo (activeKey→NULL) +
 * insert do novo — na mesma transação, para nunca haver 2 pendentes ao mesmo tempo nem 0.
 */
export function computeInvitationActiveKey(
  organizationId: number,
  emailNormalized: string,
  status: InvitationStatus
): string | null {
  return status === "pending" ? `${organizationId}:${emailNormalized}` : null;
}

// ─── Elegibilidade de reenvio / cancelamento ─────────────────────────────────

export function canResendInvitation(status: InvitationStatus, expiresAt: Date, now: Date): boolean {
  return effectiveInvitationStatus(status, expiresAt, now) === "pending";
}

export function canCancelInvitation(status: InvitationStatus): boolean {
  // Cancelar um convite já expirado (por tempo, mas ainda "pending" no banco) é permitido e
  // idempotente — evita que o operador fique bloqueado à espera de um job de expiração.
  return status === "pending";
}

export interface ResendMetadata {
  resendCount: number;
  lastSentAt: Date;
}

export function bumpResendMetadata(current: { resendCount: number }, now: Date): ResendMetadata {
  return { resendCount: current.resendCount + 1, lastSentAt: now };
}

// ─── Elegibilidade de aceite ──────────────────────────────────────────────────

export type InvitationAcceptRejectionReason =
  | "NOT_FOUND"
  | "EXPIRED"
  | "CANCELLED"
  | "ALREADY_ACCEPTED"
  | "EMAIL_MISMATCH";

export interface InvitationAcceptEligibility {
  eligible: boolean;
  reason?: InvitationAcceptRejectionReason;
}

export interface InvitationAcceptCheckInput {
  invitation: { status: InvitationStatus; expiresAt: Date; emailNormalized: string } | null;
  now: Date;
  /**
   * E-mail de quem está aceitando, quando já existe uma sessão autenticada (fluxo
   * `acceptExisting`). Omitido no fluxo de conta nova — lá o e-mail do convite É o e-mail da
   * conta criada, não há o que comparar.
   */
  acceptingEmail?: string;
}

/**
 * Única fonte de verdade para "este convite pode ser aceito agora?" — usada tanto por
 * `validateToken` (pré-visualização pública, sem side-effect) quanto por `accept`/`acceptExisting`
 * (que além de checar, também transiciona o estado). `cancelled` e `superseded` retornam o mesmo
 * motivo (`CANCELLED`) porque, do ponto de vista de quem recebeu o link antigo, o efeito é
 * idêntico — o link não vale mais porque a organização agiu sobre o convite.
 */
export function checkInvitationAcceptEligibility(input: InvitationAcceptCheckInput): InvitationAcceptEligibility {
  const { invitation, now, acceptingEmail } = input;
  if (!invitation) return { eligible: false, reason: "NOT_FOUND" };

  const effective = effectiveInvitationStatus(invitation.status, invitation.expiresAt, now);
  if (effective === "expired") return { eligible: false, reason: "EXPIRED" };
  if (effective === "cancelled" || effective === "superseded") return { eligible: false, reason: "CANCELLED" };
  if (effective === "accepted") return { eligible: false, reason: "ALREADY_ACCEPTED" };

  if (acceptingEmail && normalizeInvitationEmail(acceptingEmail) !== invitation.emailNormalized) {
    return { eligible: false, reason: "EMAIL_MISMATCH" };
  }

  return { eligible: true };
}
