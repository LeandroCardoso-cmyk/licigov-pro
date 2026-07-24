/**
 * PR A.1 — services/email/emailDispatcher.ts. `emailOutboxService` é mockado (claim/mark) — o
 * foco aqui é a orquestração: renderização do template certo por `templateKey`, chamada ao
 * provider ativo, decisão sent/retry/permanent, guarda de reentrância, e o ciclo de vida
 * start()/stop()/isRunning()/kick() (que NUNCA deve rodar sozinho — anti-padrão do setInterval de
 * nível de módulo em rateLimiter.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmailOutboxMessage } from "../../../drizzle/schema";

vi.mock("../../config/email", () => ({
  EMAIL_CONFIG: {
    provider: "fake", enabled: true, brevoApiKey: "", senderEmail: "no-reply@x.com",
    senderName: "LiciGov Pro", appBaseUrl: "http://localhost:3000", maxAttempts: 5, dispatchIntervalMs: 30_000,
  },
}));

vi.mock("../../services/email/emailOutboxService", () => ({
  claimPendingEmails: vi.fn(),
  markEmailSent: vi.fn(),
  markEmailFailed: vi.fn(),
}));

import { claimPendingEmails, markEmailSent, markEmailFailed } from "../../services/email/emailOutboxService";
import * as dispatcher from "../../services/email/emailDispatcher";
import { FakeEmailProvider } from "../../services/email/fakeProvider";

const claimMock = vi.mocked(claimPendingEmails);
const sentMock = vi.mocked(markEmailSent);
const failedMock = vi.mocked(markEmailFailed);

function makeRow(overrides: Partial<EmailOutboxMessage> = {}): EmailOutboxMessage {
  return {
    id: 1, organizationId: 700001, messageType: "invitation", recipient: "dest@x.com",
    templateKey: "invitation", payload: {
      organizationName: "Prefeitura X", inviterName: "Maria", role: "operator",
      acceptUrl: "https://x.com/convite?token=abc", expiresAt: "2026-08-01T12:00:00.000Z",
    }, idempotencyKey: "k1", status: "processing", provider: null, providerMessageId: null,
    attempts: 0, maxAttempts: 5, nextAttemptAt: null, sentAt: null, failedAt: null,
    lastErrorCode: null, lastErrorMessage: null, correlationId: "corr-1",
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as EmailOutboxMessage;
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatcher.setDispatcherProviderForTests(null);
  dispatcher.stop();
});
afterEach(() => {
  dispatcher.stop();
  dispatcher.setDispatcherProviderForTests(null);
  vi.useRealTimers();
});

describe("emailDispatcher · processOnce — envio bem-sucedido", () => {
  it("renderiza o template de convite, envia via provider, e chama markEmailSent", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow()]);

    const n = await dispatcher.processOnce();

    expect(n).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe("dest@x.com");
    expect(fake.sent[0].subject).toContain("Prefeitura X");
    expect(fake.sent[0].html).toContain("https://x.com/convite?token=abc");
    expect(sentMock).toHaveBeenCalledWith({ id: 1, attempts: 0 }, "fake", expect.any(String));
    expect(failedMock).not.toHaveBeenCalled();
  });

  it("templateKey password_reset renderiza o template de redefinição", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([
      makeRow({
        templateKey: "password_reset", messageType: "password_reset",
        payload: { userName: "João", resetUrl: "https://x.com/redefinir?token=xyz", expiresAt: "2026-08-01T12:00:00.000Z" },
      }),
    ]);

    await dispatcher.processOnce();
    expect(fake.sent[0].subject.toLowerCase()).toMatch(/redefinição de senha/);
    expect(fake.sent[0].html).toContain("https://x.com/redefinir?token=xyz");
  });

  it("templateKey password_changed renderiza a confirmação (sem link de ação)", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([
      makeRow({ templateKey: "password_changed", messageType: "password_changed", payload: { userName: "João", changedAt: "2026-08-01T12:00:00.000Z" } }),
    ]);
    await dispatcher.processOnce();
    expect(fake.sent[0].subject.toLowerCase()).toMatch(/senha foi alterada/);
  });

  it("templateKey invitation_resent marca o reenvio no assunto", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow({ templateKey: "invitation_resent", messageType: "invitation_resent" })]);
    await dispatcher.processOnce();
    expect(fake.sent[0].subject.toLowerCase()).toMatch(/reenvio/);
  });

  it("processa múltiplas linhas reivindicadas em sequência", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow({ id: 1 }), makeRow({ id: 2, recipient: "outro@x.com" })]);
    const n = await dispatcher.processOnce();
    expect(n).toBe(2);
    expect(fake.sent).toHaveLength(2);
    expect(sentMock).toHaveBeenCalledTimes(2);
  });
});

describe("emailDispatcher · processOnce — falha do provider", () => {
  it("outcome retryable → markEmailFailed com o outcome propagado, markEmailSent NÃO chamado", async () => {
    const fake = new FakeEmailProvider();
    fake.queueOutcome({ ok: false, retryable: true, errorCode: "brevo_http_500", errorMessage: "erro temporário" });
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow()]);
    failedMock.mockResolvedValueOnce({ permanent: false, nextAttemptAt: new Date(), attempts: 1 });

    await dispatcher.processOnce();

    expect(failedMock).toHaveBeenCalledWith(
      { id: 1, attempts: 0, maxAttempts: 5 },
      { ok: false, retryable: true, errorCode: "brevo_http_500", errorMessage: "erro temporário" }
    );
    expect(sentMock).not.toHaveBeenCalled();
  });

  it("outcome não-retryable → markEmailFailed idem, sem lançar", async () => {
    const fake = new FakeEmailProvider();
    fake.queueOutcome({ ok: false, retryable: false, errorCode: "brevo_invalid_parameter", errorMessage: "endereço inválido" });
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow()]);
    failedMock.mockResolvedValueOnce({ permanent: true, nextAttemptAt: null, attempts: 1 });

    await expect(dispatcher.processOnce()).resolves.toBe(1);
    expect(failedMock).toHaveBeenCalledTimes(1);
  });
});

describe("emailDispatcher · processOnce — templateKey desconhecido", () => {
  it("erro de renderização é SEMPRE permanente (retryable:false) e o provider nunca é chamado", async () => {
    const fake = new FakeEmailProvider();
    dispatcher.setDispatcherProviderForTests(fake);
    claimMock.mockResolvedValueOnce([makeRow({ templateKey: "nao_existe" as never })]);
    failedMock.mockResolvedValueOnce({ permanent: true, nextAttemptAt: null, attempts: 1 });

    await dispatcher.processOnce();

    expect(fake.sent).toHaveLength(0); // provider.send nunca chamado
    expect(failedMock).toHaveBeenCalledWith(
      { id: 1, attempts: 0, maxAttempts: 5 },
      expect.objectContaining({ retryable: false, errorCode: "template_render_error" })
    );
  });
});

describe("emailDispatcher · reentrância", () => {
  it("uma segunda chamada de processOnce() enquanto a primeira está em voo retorna 0 (guarda de reentrância)", async () => {
    let resolveClaim!: (rows: EmailOutboxMessage[]) => void;
    claimMock.mockReturnValueOnce(new Promise(resolve => { resolveClaim = resolve; }));
    dispatcher.setDispatcherProviderForTests(new FakeEmailProvider());

    const first = dispatcher.processOnce();
    const second = dispatcher.processOnce(); // dispara enquanto `first` ainda aguarda o claim

    resolveClaim([]);
    const [n1, n2] = await Promise.all([first, second]);

    expect(n2).toBe(0);
    expect(n1).toBe(0);
    expect(claimMock).toHaveBeenCalledTimes(1); // a segunda chamada nem tentou reivindicar
  });
});

describe("emailDispatcher · ciclo de vida start/stop/isRunning", () => {
  it("start() liga o intervalo; chamar de novo é idempotente (não duplica o timer)", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(global, "setInterval");
    expect(dispatcher.isRunning()).toBe(false);
    dispatcher.start();
    expect(dispatcher.isRunning()).toBe(true);
    dispatcher.start(); // idempotente
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stop() desliga o intervalo; chamar de novo (já parado) é idempotente", () => {
    vi.useFakeTimers();
    dispatcher.start();
    dispatcher.stop();
    expect(dispatcher.isRunning()).toBe(false);
    expect(() => dispatcher.stop()).not.toThrow();
  });

  it("o intervalo dispara processOnce (via claimPendingEmails) periodicamente", async () => {
    vi.useFakeTimers();
    claimMock.mockResolvedValue([]);
    dispatcher.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(claimMock).toHaveBeenCalled();
  });
});

describe("emailDispatcher · kick()", () => {
  it("nunca dispara processOnce durante a suíte de testes (VITEST=true é sempre respeitado)", async () => {
    expect(process.env.VITEST).toBe("true");
    dispatcher.kick();
    await new Promise(resolve => setImmediate(resolve));
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("fora de VITEST e com EMAIL_CONFIG.enabled, kick() agenda um ciclo via setImmediate", async () => {
    const original = process.env.VITEST;
    delete process.env.VITEST;
    try {
      claimMock.mockResolvedValue([]);
      dispatcher.kick();
      await new Promise(resolve => setImmediate(resolve));
      expect(claimMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env.VITEST = original;
    }
  });
});
