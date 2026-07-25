/**
 * PR A.1 — services/email/consoleProvider.ts e fakeProvider.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsoleEmailProvider } from "../../services/email/consoleProvider";
import { FakeEmailProvider } from "../../services/email/fakeProvider";

const INPUT = { to: "x@y.com", subject: "Assunto", html: "<p>c</p>", text: "c", correlationId: "corr-1" };

describe("ConsoleEmailProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nunca falha, retorna ok:true sem providerMessageId, e imprime no console", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const outcome = await new ConsoleEmailProvider().send(INPUT);
    expect(outcome).toEqual({ ok: true, providerMessageId: null });
    expect(spy).toHaveBeenCalledTimes(1);
    const printed = spy.mock.calls[0][0] as string;
    expect(printed).toContain(INPUT.to);
    expect(printed).toContain(INPUT.subject);
    expect(printed).toContain(INPUT.correlationId);
  });
});

describe("FakeEmailProvider", () => {
  it("registra cada send() em `sent`, com sentAt", async () => {
    const provider = new FakeEmailProvider();
    await provider.send(INPUT);
    await provider.send({ ...INPUT, to: "outro@y.com" });
    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0].to).toBe("x@y.com");
    expect(provider.sent[1].to).toBe("outro@y.com");
    expect(provider.sent[0].sentAt).toBeInstanceOf(Date);
  });

  it("sucesso padrão gera providerMessageId incremental determinístico", async () => {
    const provider = new FakeEmailProvider();
    const a = await provider.send(INPUT);
    const b = await provider.send(INPUT);
    expect(a).toEqual({ ok: true, providerMessageId: "fake-1" });
    expect(b).toEqual({ ok: true, providerMessageId: "fake-2" });
  });

  it("queueOutcome força o resultado do PRÓXIMO send() apenas uma vez", async () => {
    const provider = new FakeEmailProvider();
    provider.queueOutcome({ ok: false, retryable: true, errorCode: "simulated", errorMessage: "falha simulada" });
    const first = await provider.send(INPUT);
    const second = await provider.send(INPUT);
    expect(first).toEqual({ ok: false, retryable: true, errorCode: "simulated", errorMessage: "falha simulada" });
    expect(second).toEqual({ ok: true, providerMessageId: "fake-2" }); // voltou ao padrão
  });

  it("reset() limpa `sent` e qualquer outcome enfileirado", async () => {
    const provider = new FakeEmailProvider();
    await provider.send(INPUT);
    provider.queueOutcome({ ok: false, retryable: false, errorCode: "x", errorMessage: "x" });
    provider.reset();
    expect(provider.sent).toHaveLength(0);
    const outcome = await provider.send(INPUT);
    expect(outcome).toEqual({ ok: true, providerMessageId: "fake-1" }); // não usou o outcome enfileirado antes do reset
  });
});
