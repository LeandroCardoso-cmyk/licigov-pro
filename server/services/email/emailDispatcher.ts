/**
 * PR A.1 — Dispatcher do outbox de e-mail: reivindica linhas pendentes/retryable, renderiza o
 * template certo e envia via o provider ativo (Brevo/console/fake, resolvido de config/email.ts).
 *
 * NUNCA roda ao só importar o módulo — `start()` é explícito, chamado só em `startServer()`
 * (_core/index.ts) e só quando `EMAIL_CONFIG.enabled && !VITEST` (o anti-padrão a evitar é o
 * `setInterval` de nível de módulo em services/rateLimiter.ts:174, que dispara mesmo durante os
 * testes). `stop()` existe para desligamento limpo. `kick()` roda um ciclo imediato fora do
 * intervalo — chamado pelos services logo após `emailOutboxService.enqueueEmail` para reduzir
 * latência de entrega; o intervalo é a rede de segurança caso o kick se perca.
 */

import { EMAIL_CONFIG } from "../../config/email";
import { serviceLogger } from "../observabilityService";
import { claimPendingEmails, markEmailSent, markEmailFailed } from "./emailOutboxService";
import { BrevoTransactionalEmailProvider } from "./brevoProvider";
import { ConsoleEmailProvider } from "./consoleProvider";
import { FakeEmailProvider } from "./fakeProvider";
import type { TransactionalEmailProvider } from "./provider";
import {
  buildInvitationEmail,
  buildInvitationResentEmail,
  buildPasswordResetEmail,
  buildPasswordChangedEmail,
  type EmailContent,
} from "./templates";
import type { OrgRole, EmailOutboxMessage } from "../../../drizzle/schema";

const log = serviceLogger("EmailDispatcher");

// ─── Provider ativo ────────────────────────────────────────────────────────────

let providerInstance: TransactionalEmailProvider | null = null;

function resolveProvider(): TransactionalEmailProvider {
  if (providerInstance) return providerInstance;
  switch (EMAIL_CONFIG.provider) {
    case "brevo":
      providerInstance = new BrevoTransactionalEmailProvider({
        apiKey: EMAIL_CONFIG.brevoApiKey,
        senderEmail: EMAIL_CONFIG.senderEmail,
        senderName: EMAIL_CONFIG.senderName,
      });
      break;
    case "console":
      providerInstance = new ConsoleEmailProvider();
      break;
    case "fake":
    default:
      providerInstance = new FakeEmailProvider();
      break;
  }
  return providerInstance;
}

/** Só para testes: injeta um provider (ex.: FakeEmailProvider com queueOutcome) ou reseta (null). */
export function setDispatcherProviderForTests(provider: TransactionalEmailProvider | null): void {
  providerInstance = provider;
}

// ─── Renderização ──────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * O template é renderizado AGORA, não no enqueue — o payload guarda só os dados brutos
 * (organizationName, inviterName, role, acceptUrl, expiresAt como ISO string...). Isso mantém o
 * outbox enxuto e, como efeito colateral aceitável, uma retentativa após uma correção de texto no
 * template sai com a redação nova.
 */
function renderTemplate(row: Pick<EmailOutboxMessage, "templateKey" | "payload">): EmailContent {
  const p = row.payload as Record<string, unknown>;
  switch (row.templateKey) {
    case "invitation":
      return buildInvitationEmail({
        organizationName: str(p.organizationName),
        inviterName: str(p.inviterName),
        role: p.role as OrgRole,
        acceptUrl: str(p.acceptUrl),
        expiresAt: new Date(str(p.expiresAt)),
        recipientName: optStr(p.recipientName),
      });
    case "invitation_resent":
      return buildInvitationResentEmail({
        organizationName: str(p.organizationName),
        inviterName: str(p.inviterName),
        role: p.role as OrgRole,
        acceptUrl: str(p.acceptUrl),
        expiresAt: new Date(str(p.expiresAt)),
        recipientName: optStr(p.recipientName),
      });
    case "password_reset":
      return buildPasswordResetEmail({
        userName: str(p.userName),
        resetUrl: str(p.resetUrl),
        expiresAt: new Date(str(p.expiresAt)),
      });
    case "password_changed":
      return buildPasswordChangedEmail({
        userName: str(p.userName),
        changedAt: new Date(str(p.changedAt)),
      });
    default:
      throw new Error(`templateKey desconhecido: "${row.templateKey}"`);
  }
}

// ─── Processamento ──────────────────────────────────────────────────────────────

async function processOne(row: EmailOutboxMessage): Promise<void> {
  let content: EmailContent;
  try {
    content = renderTemplate(row);
  } catch (err) {
    // Erro de template (payload incompatível com o templateKey) nunca se resolve com retry —
    // é sempre permanente. isRetryable:false força markEmailFailed a marcar permanent_failure
    // já na primeira tentativa, independentemente de quantas ainda restariam.
    await markEmailFailed(
      { id: row.id, attempts: row.attempts, maxAttempts: row.maxAttempts },
      { retryable: false, errorCode: "template_render_error", errorMessage: err instanceof Error ? err.message : String(err) }
    );
    log.error("template_render_failed", { id: row.id, templateKey: row.templateKey });
    return;
  }

  const provider = resolveProvider();
  const outcome = await provider.send({
    to: row.recipient,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [row.messageType],
    correlationId: row.correlationId ?? undefined,
  });

  if (outcome.ok) {
    await markEmailSent({ id: row.id, attempts: row.attempts }, provider.name, outcome.providerMessageId);
    log.info("email_sent", { id: row.id, messageType: row.messageType, provider: provider.name });
    return;
  }

  const result = await markEmailFailed({ id: row.id, attempts: row.attempts, maxAttempts: row.maxAttempts }, outcome);
  if (result.permanent) {
    // Auditoria: a própria linha do email_outbox (status=permanent_failure, attempts,
    // lastErrorCode/lastErrorMessage) é o registro — não duplicamos em activity_logs.
    log.error("email_permanent_failure", {
      id: row.id, messageType: row.messageType, errorCode: outcome.errorCode, attempts: result.attempts,
    });
  } else {
    log.warn("email_retry_scheduled", {
      id: row.id, messageType: row.messageType, attempt: result.attempts, nextAttemptAt: result.nextAttemptAt?.toISOString(),
    });
  }
}

let cycleRunning = false;

/** Um ciclo: reivindica um lote e processa cada mensagem sequencialmente. Reentrante-seguro. */
export async function processOnce(): Promise<number> {
  if (cycleRunning) return 0; // evita 2 ciclos concorrentes no mesmo processo (kick + intervalo)
  cycleRunning = true;
  try {
    const claimed = await claimPendingEmails(10);
    for (const row of claimed) {
      await processOne(row);
    }
    return claimed.length;
  } finally {
    cycleRunning = false;
  }
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Liga o dispatcher (idempotente — chamar 2x não duplica o intervalo). */
export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    processOnce().catch(err => log.error("dispatch_cycle_error", { error: err instanceof Error ? err.message : String(err) }));
  }, EMAIL_CONFIG.dispatchIntervalMs);
  log.info("dispatcher_started", { intervalMs: EMAIL_CONFIG.dispatchIntervalMs, provider: EMAIL_CONFIG.provider });
}

/** Desliga o dispatcher (idempotente). */
export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function isRunning(): boolean {
  return intervalHandle !== null;
}

/**
 * Roda um ciclo imediatamente, fora do intervalo. Chamado pelos services logo após
 * `emailOutboxService.enqueueEmail` para reduzir a latência percebida pelo usuário (convite/reset
 * chegam em segundos, não no próximo tick). No-op fora de staging/production com e-mail
 * habilitado — nunca dispara em teste (VITEST) nem quando EMAIL_ENABLED=false.
 */
export function kick(): void {
  if (!EMAIL_CONFIG.enabled || process.env.VITEST === "true") return;
  setImmediate(() => {
    processOnce().catch(err => log.error("dispatch_kick_error", { error: err instanceof Error ? err.message : String(err) }));
  });
}
