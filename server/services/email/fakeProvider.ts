/**
 * PR A.1 — Provider de e-mail para teste: nunca faz I/O, guarda tudo que "enviaria" em memória
 * para o teste inspecionar (`sent`), e permite forçar o próximo resultado (`queueOutcome`) para
 * simular falha retryable/permanente sem depender de rede.
 */

import type { TransactionalEmailProvider, EmailSendInput, EmailSendOutcome } from "./provider";

export interface FakeSentEmail extends EmailSendInput {
  sentAt: Date;
}

export class FakeEmailProvider implements TransactionalEmailProvider {
  readonly name = "fake";
  readonly sent: FakeSentEmail[] = [];
  private queuedOutcome: EmailSendOutcome | null = null;

  /** O PRÓXIMO `send()` retorna este resultado em vez do sucesso padrão (uma vez só). */
  queueOutcome(outcome: EmailSendOutcome): void {
    this.queuedOutcome = outcome;
  }

  async send(input: EmailSendInput): Promise<EmailSendOutcome> {
    this.sent.push({ ...input, sentAt: new Date() });
    if (this.queuedOutcome) {
      const outcome = this.queuedOutcome;
      this.queuedOutcome = null;
      return outcome;
    }
    return { ok: true, providerMessageId: `fake-${this.sent.length}` };
  }

  reset(): void {
    this.sent.length = 0;
    this.queuedOutcome = null;
  }
}
