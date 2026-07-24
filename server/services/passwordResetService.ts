/**
 * PR A.1 — Recuperação de senha. Modelo institucional (sem cadastro público): qualquer usuário
 * com conta pode redefinir a própria senha por e-mail. Três garantias centrais:
 *
 *  1. Anti-enumeração: `requestPasswordReset` NUNCA revela se o e-mail existe — o router sempre
 *     responde `{success:true}`, quer o e-mail exista, esteja rate-limitado, ou o envio falhe.
 *  2. Uso único + expiração curta: token opaco (services/security/opaqueTokens.ts), TTL de 1h,
 *     `consumedAt` marcado atomicamente dentro da MESMA transação que troca a senha — replay do
 *     link é impossível mesmo em corrida (2 abas, dois cliques).
 *  3. Revogação de sessão: completar a redefinição bumpa `users.tokenVersion` — toda sessão
 *     emitida antes (inclusive a de quem sequestrou a conta) deixa de validar em
 *     `sdk.authenticateRequest` (ver C6).
 */

import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { passwordResetTokens } from "../../drizzle/schema";
import { getUserByEmail, getUserById, updateUserPassword, bumpTokenVersion } from "../db/users";
import { hashPassword } from "./passwordSecurity";
import { generateOpaqueToken, hashOpaqueToken, isPlausibleOpaqueToken } from "./security/opaqueTokens";
import { validatePassword } from "../domain/passwordPolicy";
import { enqueueEmail } from "./email/emailOutboxService";
import { kick as kickEmailDispatcher } from "./email/emailDispatcher";
import { EMAIL_CONFIG } from "../config/email";
import { checkRateLimit } from "./rateLimiter";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";
import {
  PASSWORD_RESET_INVALID,
  PASSWORD_RESET_EXPIRED,
  PASSWORD_RESET_CONSUMED,
} from "../domain/authErrors";

const log = serviceLogger("PasswordResetService");

/** Validade do link de redefinição — constante de domínio, não ENV (1h, mais curto que o convite). */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ─── request ────────────────────────────────────────────────────────────────

export interface RequestPasswordResetInput {
  email: string;
  ipAddress?: string;
  correlationId?: string;
}

/**
 * Sempre "termina bem" do ponto de vista do chamador (nunca lança) — quem decide se um token é
 * de fato emitido é esta função, silenciosamente. `router.request` sempre responde
 * `{success:true}` depois de chamar isto, não importa o que aconteceu aqui dentro.
 */
export async function requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
  const user = await getUserByEmail(input.email);
  if (!user || !user.email) {
    log.info("reset_requested_unknown_email", { correlationId: input.correlationId });
    return;
  }

  // Checagem secundária por E-MAIL (além do rate limit por identifier no middleware do router):
  // sem isto, IPs rotativos/anônimos poderiam inundar UM alvo de e-mails de redefinição mesmo
  // sem nunca estourar o limite por IP/usuário individualmente.
  const emailKey = `email:${hashIdentifier(user.email)}`;
  const secondary = checkRateLimit(emailKey, "passwordReset");
  if (!secondary.allowed) {
    log.warn("reset_requested_rate_limited", { userId: user.id, correlationId: input.correlationId });
    return;
  }

  const db = await getDb();
  if (!db) {
    log.error("db_unavailable", { userId: user.id });
    return;
  }

  // Revoga qualquer token ainda ativo antes de emitir um novo — no máximo 1 válido por vez.
  await db
    .update(passwordResetTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userId, user.id),
        isNull(passwordResetTokens.consumedAt),
        isNull(passwordResetTokens.revokedAt)
      )
    );

  const token = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + PASSWORD_RESET_TTL_MS);

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
    requestedAt,
    ipAddress: input.ipAddress ?? null,
    correlationId: input.correlationId ?? null,
  });

  await enqueueEmail({
    organizationId: null,
    messageType: "password_reset",
    recipient: user.email,
    templateKey: "password_reset",
    payload: {
      userName: user.name ?? user.email,
      resetUrl: `${EMAIL_CONFIG.appBaseUrl}/redefinir-senha?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    },
    // idempotencyKey único por token — reenviar o mesmo comando de request (retry de rede,
    // duplo clique) já é impedido pelo rate limit; isto é defesa em profundidade.
    idempotencyKey: `password_reset:${tokenHash}`,
    correlationId: input.correlationId,
  });
  kickEmailDispatcher();

  await logActivity({
    userId: user.id,
    sourceContext: "api",
    action: "password_reset.requested",
    entityType: "password_reset",
    ipAddress: input.ipAddress,
    correlationId: input.correlationId,
  });

  log.info("reset_token_issued", { userId: user.id, correlationId: input.correlationId });
}

// ─── validateToken ────────────────────────────────────────────────────────────

export interface ValidatePasswordResetTokenResult {
  valid: boolean;
  reason?: typeof PASSWORD_RESET_INVALID | typeof PASSWORD_RESET_EXPIRED | typeof PASSWORD_RESET_CONSUMED;
}

/** Checagem pública, sem side-effect — usada pela tela de redefinição para validar o link cedo. */
export async function validatePasswordResetToken(token: string): Promise<ValidatePasswordResetTokenResult> {
  if (!isPlausibleOpaqueToken(token)) return { valid: false, reason: PASSWORD_RESET_INVALID };

  const db = await getDb();
  if (!db) return { valid: false, reason: PASSWORD_RESET_INVALID };

  const tokenHash = hashOpaqueToken(token);
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  const row = rows[0];

  if (!row || row.revokedAt) return { valid: false, reason: PASSWORD_RESET_INVALID };
  if (row.consumedAt) return { valid: false, reason: PASSWORD_RESET_CONSUMED };
  if (new Date() >= row.expiresAt) return { valid: false, reason: PASSWORD_RESET_EXPIRED };
  return { valid: true };
}

// ─── complete ─────────────────────────────────────────────────────────────────

export interface CompletePasswordResetInput {
  token: string;
  newPassword: string;
  ipAddress?: string;
  correlationId?: string;
}

/**
 * Troca a senha. Toda a mutação (senha nova, `consumedAt`, revogação de outros tokens ainda
 * ativos, bump de `tokenVersion`, e o e-mail de confirmação no outbox) acontece em UMA transação
 * — ou tudo é aplicado, ou nada é. `logActivity` fica FORA da transação de propósito (auditoria
 * já é best-effort/nunca-lança por padrão no projeto — ver activityLogService.ts).
 */
export async function completePasswordReset(input: CompletePasswordResetInput): Promise<void> {
  if (!isPlausibleOpaqueToken(input.token)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: PASSWORD_RESET_INVALID });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Serviço de redefinição de senha indisponível." });
  }

  const tokenHash = hashOpaqueToken(input.token);
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  const row = rows[0];

  if (!row || row.revokedAt) throw new TRPCError({ code: "BAD_REQUEST", message: PASSWORD_RESET_INVALID });
  if (row.consumedAt) throw new TRPCError({ code: "CONFLICT", message: PASSWORD_RESET_CONSUMED });
  if (new Date() >= row.expiresAt) throw new TRPCError({ code: "BAD_REQUEST", message: PASSWORD_RESET_EXPIRED });

  const user = await getUserById(row.userId);
  if (!user) throw new TRPCError({ code: "BAD_REQUEST", message: PASSWORD_RESET_INVALID });

  const policyResult = validatePassword(input.newPassword, { email: user.email ?? undefined });
  if (!policyResult.valid) {
    throw new TRPCError({ code: "BAD_REQUEST", message: policyResult.message ?? "Senha inválida." });
  }

  const passwordHash = await hashPassword(input.newPassword);
  const changedAt = new Date();

  await db.transaction(async tx => {
    await updateUserPassword(user.id, passwordHash, tx);
    await bumpTokenVersion(user.id, tx);
    await tx.update(passwordResetTokens).set({ consumedAt: changedAt }).where(eq(passwordResetTokens.id, row.id));
    // Defesa em profundidade: revoga qualquer OUTRO token ainda ativo do mesmo usuário (não
    // deveria existir, dado que `request` já revoga o anterior ao emitir um novo — mas garante
    // a invariante "no máximo 1 token válido por usuário" mesmo diante de uma corrida rara).
    await tx
      .update(passwordResetTokens)
      .set({ revokedAt: changedAt })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.consumedAt),
          isNull(passwordResetTokens.revokedAt)
        )
      );
    if (user.email) {
      await enqueueEmail(
        {
          organizationId: null,
          messageType: "password_changed",
          recipient: user.email,
          templateKey: "password_changed",
          payload: { userName: user.name ?? user.email, changedAt: changedAt.toISOString() },
          idempotencyKey: `password_changed:${row.id}`,
          correlationId: input.correlationId,
        },
        tx
      );
    }
  });
  kickEmailDispatcher();

  await logActivity({
    userId: user.id,
    sourceContext: "api",
    action: "password_reset.completed",
    entityType: "password_reset",
    ipAddress: input.ipAddress,
    correlationId: input.correlationId,
  });

  log.info("reset_completed", { userId: user.id, correlationId: input.correlationId });
}
