/**
 * PR A.1 — Provider de e-mail para desenvolvimento local: nunca envia nada de verdade, só
 * imprime o e-mail (assunto + corpo texto) no console. O link do convite/redefinição fica
 * disponível ali para o desenvolvedor clicar/copiar manualmente.
 */

import type { TransactionalEmailProvider, EmailSendInput, EmailSendOutcome } from "./provider";

export class ConsoleEmailProvider implements TransactionalEmailProvider {
  readonly name = "console";

  async send(input: EmailSendInput): Promise<EmailSendOutcome> {
    console.info(
      `\n[EMAIL:console] ────────────────────────────────────────\n` +
      `Para:     ${input.to}\n` +
      `Assunto:  ${input.subject}\n` +
      (input.correlationId ? `Correlação: ${input.correlationId}\n` : "") +
      `${input.text}\n` +
      `─────────────────────────────────────────────────────────\n`
    );
    return { ok: true, providerMessageId: null };
  }
}
