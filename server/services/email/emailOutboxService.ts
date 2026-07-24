/**
 * PR A.1 — Outbox transacional de e-mail. Mesmo espírito de services/outboxService.ts
 * (appendOutboxEvent/claimPendingEvents/markDelivered/markFailed), mas em tabela dedicada
 * (`email_outbox`, não `outbox_events` — enum de status incompatível, sem idempotencyKey, sem
 * consumer próprio) porque o ciclo de vida de um e-mail (pending → processing → sent |
 * retryable_failure → permanent_failure) e os campos (provider, providerMessageId, template)
 * não têm equivalente no outbox genérico de domínio.
 *
 * `enqueueEmail` NÃO importa `emailDispatcher` (evita import circular) — quem enfileira deve
 * chamar `emailDispatcher.kick()` logo em seguida para reduzir a latência de entrega; o
 * intervalo do dispatcher é a rede de segurança caso o kick seja perdido (ex.: processo reiniciou
 * entre o enqueue e o kick).
 */

import { eq, and, or, isNull, lte } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { emailOutbox, type EmailOutboxMessage } from "../../../drizzle/schema";
import { serviceLogger } from "../observabilityService";
import { EMAIL_CONFIG } from "../../config/email";
import { calculateBackoffMs, isRetryable, type RetryPolicy } from "../../config/retryPolicy";

const log = serviceLogger("EmailOutboxService");

export type EmailMessageType = "invitation" | "invitation_resent" | "password_reset" | "password_changed";

export interface EnqueueEmailInput {
  organizationId?: number | null;
  messageType: EmailMessageType;
  recipient: string;
  /** Hoje 1:1 com `messageType` — campo próprio porque o dispatcher só conhece `templateKey`. */
  templateKey: EmailMessageType;
  /** Dados para renderizar o template no MOMENTO DO ENVIO (não no enqueue) — datas como ISO string. */
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId?: string;
}

/**
 * Enfileira um e-mail. Chame dentro da MESMA transação do comando que o origina (convite criado,
 * reset solicitado) passando `txDb` — assim o e-mail só existe se o comando também existir (e
 * vice-versa). `idempotencyKey` é UNIQUE: reenviar o mesmo comando (retry de rede do cliente,
 * replay de request) não duplica o e-mail — o upsert é um no-op de fato (só toca `updatedAt`).
 */
export async function enqueueEmail(input: EnqueueEmailInput, txDb?: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (txDb as any) ?? (await getDb());
  if (!db) {
    log.error("db_unavailable", { messageType: input.messageType, idempotencyKey: input.idempotencyKey });
    return;
  }

  await db
    .insert(emailOutbox)
    .values({
      organizationId: input.organizationId ?? null,
      messageType: input.messageType,
      recipient: input.recipient,
      templateKey: input.templateKey,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      maxAttempts: EMAIL_CONFIG.maxAttempts,
      correlationId: input.correlationId ?? null,
    })
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });

  log.debug("email_enqueued", { messageType: input.messageType, correlationId: input.correlationId });
}

/**
 * Reivindica até `batchSize` mensagens prontas para envio: `pending`, ou `retryable_failure`
 * cujo `nextAttemptAt` já passou. Claim = UPDATE condicional por id+status: cada linha só é
 * processada por UMA instância do dispatcher (múltiplas réplicas no Railway) porque o UPDATE só
 * "pega" a linha se ainda estiver no status esperado (affectedRows === 1) — mais simples que o
 * lease com `lockedUntil` de outboxEvents; aqui o volume é baixo e cada envio é rápido o
 * suficiente para não precisar de expiração de lease.
 */
export async function claimPendingEmails(batchSize = 10): Promise<EmailOutboxMessage[]> {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();
  const candidates = await db
    .select()
    .from(emailOutbox)
    .where(
      or(
        eq(emailOutbox.status, "pending"),
        and(
          eq(emailOutbox.status, "retryable_failure"),
          or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now))
        )
      )
    )
    .limit(batchSize);

  const claimed: EmailOutboxMessage[] = [];
  for (const row of candidates) {
    const result = await db
      .update(emailOutbox)
      .set({ status: "processing" })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, row.status)));
    const affected = (result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
    if (affected === 1) claimed.push({ ...row, status: "processing" });
  }

  if (claimed.length > 0) log.debug("emails_claimed", { count: claimed.length });
  return claimed;
}

/** Marca sucesso. `attempts` reflete quantas tentativas foram efetivamente usadas (>=1). */
export async function markEmailSent(
  row: Pick<EmailOutboxMessage, "id" | "attempts">,
  provider: string,
  providerMessageId: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(emailOutbox)
    .set({
      status: "sent",
      provider,
      providerMessageId,
      sentAt: new Date(),
      attempts: row.attempts + 1,
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    .where(eq(emailOutbox.id, row.id));
}

export interface MarkEmailFailedOutcome {
  permanent: boolean;
  nextAttemptAt: Date | null;
  attempts: number;
}

/**
 * Registra falha. Se o erro é retryable E ainda há tentativas disponíveis (attempts <
 * maxAttempts DA PRÓPRIA LINHA — não de EMAIL_CONFIG, que pode ter mudado desde o enqueue),
 * agenda a próxima tentativa com backoff exponencial (`calculateBackoffMs`, mesma política de
 * `RETRY_POLICIES.OUTBOX`: inicial 1s, x2, teto 60s). Senão, `permanent_failure` — terminal,
 * só reprocessável manualmente (replay documentado no runbook, C11).
 */
export async function markEmailFailed(
  row: Pick<EmailOutboxMessage, "id" | "attempts" | "maxAttempts">,
  outcome: { retryable: boolean; errorCode: string; errorMessage: string }
): Promise<MarkEmailFailedOutcome> {
  const db = await getDb();
  if (!db) return { permanent: true, nextAttemptAt: null, attempts: row.attempts + 1 };

  const attempts = row.attempts + 1;
  const policy: RetryPolicy = {
    maxAttempts: row.maxAttempts,
    initialDelayMs: 1_000,
    backoffMultiplier: 2,
    maxDelayMs: 60_000,
    softTimeoutMs: 30_000,
    hardTimeoutMs: 120_000,
  };
  const permanent = !outcome.retryable || !isRetryable(policy, attempts);
  const errorMessage = outcome.errorMessage.slice(0, 500);

  if (permanent) {
    await db
      .update(emailOutbox)
      .set({
        status: "permanent_failure",
        attempts,
        failedAt: new Date(),
        lastErrorCode: outcome.errorCode,
        lastErrorMessage: errorMessage,
      })
      .where(eq(emailOutbox.id, row.id));
    return { permanent: true, nextAttemptAt: null, attempts };
  }

  const nextAttemptAt = new Date(Date.now() + calculateBackoffMs(policy, attempts));
  await db
    .update(emailOutbox)
    .set({
      status: "retryable_failure",
      attempts,
      nextAttemptAt,
      lastErrorCode: outcome.errorCode,
      lastErrorMessage: errorMessage,
    })
    .where(eq(emailOutbox.id, row.id));
  return { permanent: false, nextAttemptAt, attempts };
}
