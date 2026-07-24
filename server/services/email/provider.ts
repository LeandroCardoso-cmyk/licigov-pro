/**
 * PR A.1 — Contrato comum de provider de e-mail transacional. Implementações:
 * `brevoProvider.ts` (staging/production), `consoleProvider.ts` (development),
 * `fakeProvider.ts` (teste, inspecionável). A seleção de qual implementação instanciar
 * mora em `emailOutboxService`/`emailDispatcher` (C5), a partir de `config/email.ts`.
 */

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Rótulos livres para o painel do provider (ex.: "invitation", "password-reset"). */
  tags?: string[];
  correlationId?: string;
}

export type EmailSendOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: boolean; errorCode: string; errorMessage: string };

export interface TransactionalEmailProvider {
  readonly name: string;
  send(input: EmailSendInput): Promise<EmailSendOutcome>;
}
