/**
 * PR A.1 — Provider de e-mail transacional via Brevo (https://www.brevo.com), API REST
 * `POST /v3/smtp/email`. Único provider autorizado a enviar e-mail real em staging/production
 * (config/email.ts é fail-closed contra qualquer outro).
 *
 * Classificação de falha (usada pelo dispatcher para decidir retry vs. permanent_failure):
 *   - timeout / erro de rede           → retryable
 *   - HTTP 429 (rate limit) ou 5xx     → retryable
 *   - qualquer outro HTTP 4xx          → permanente (endereço inválido, payload rejeitado, etc.)
 */

import type { TransactionalEmailProvider, EmailSendInput, EmailSendOutcome } from "./provider";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 15_000;

export interface BrevoProviderConfig {
  apiKey: string;
  senderEmail: string;
  senderName: string;
}

/** Nunca deixar a API key vazar em uma mensagem de erro persistida/logada. */
function redactApiKey(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}

export class BrevoTransactionalEmailProvider implements TransactionalEmailProvider {
  readonly name = "brevo";

  constructor(private readonly config: BrevoProviderConfig) {}

  async send(input: EmailSendInput): Promise<EmailSendOutcome> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "api-key": this.config.apiKey,
        },
        body: JSON.stringify({
          sender: { email: this.config.senderEmail, name: this.config.senderName },
          to: [{ email: input.to }],
          subject: input.subject,
          htmlContent: input.html,
          textContent: input.text,
          tags: input.tags,
        }),
        signal: controller.signal,
      });

      const bodyText = await res.text();
      let parsed: { messageId?: string; message?: string; code?: string } | null = null;
      try {
        parsed = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        // resposta não-JSON — segue com parsed = null, usa o corpo cru na mensagem de erro.
      }

      if (res.ok) {
        return { ok: true, providerMessageId: parsed?.messageId ?? null };
      }

      const retryable = res.status === 429 || res.status >= 500;
      return {
        ok: false,
        retryable,
        errorCode: parsed?.code ? `brevo_${parsed.code}` : `brevo_http_${res.status}`,
        errorMessage: redactApiKey(parsed?.message ?? (bodyText || `HTTP ${res.status}`), this.config.apiKey).slice(0, 500),
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const rawMessage = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        retryable: true, // timeout e erro de rede sempre valem nova tentativa
        errorCode: isAbort ? "brevo_timeout" : "brevo_network_error",
        errorMessage: isAbort
          ? `Timeout após ${REQUEST_TIMEOUT_MS}ms`
          : redactApiKey(rawMessage, this.config.apiKey).slice(0, 500),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
