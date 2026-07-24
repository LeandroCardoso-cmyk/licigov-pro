/**
 * PR A.1 — services/email/brevoProvider.ts. `fetch` é mockado (vi.stubGlobal) — nenhum acesso
 * de rede real. Cobre: sucesso, timeout, 429 (retryable), 400 (permanente), 500 (retryable),
 * e a garantia de que a API key NUNCA aparece na mensagem de erro retornada.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { BrevoTransactionalEmailProvider } from "../../services/email/brevoProvider";

const CONFIG = { apiKey: "sk-super-secret-key-12345", senderEmail: "no-reply@licigovpro.com.br", senderName: "LiciGov Pro" };
const INPUT = { to: "destinatario@x.com", subject: "Assunto", html: "<p>corpo</p>", text: "corpo" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrevoTransactionalEmailProvider · sucesso", () => {
  it("201 com messageId → ok:true, providerMessageId propagado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: "<abc@brevo>" }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new BrevoTransactionalEmailProvider(CONFIG);
    const outcome = await provider.send(INPUT);

    expect(outcome).toEqual({ ok: true, providerMessageId: "<abc@brevo>" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe(CONFIG.apiKey);
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ email: CONFIG.senderEmail, name: CONFIG.senderName });
    expect(body.to).toEqual([{ email: INPUT.to }]);
  });

  it("200 sem messageId no corpo → ok:true, providerMessageId null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome).toEqual({ ok: true, providerMessageId: null });
  });
});

describe("BrevoTransactionalEmailProvider · falhas retryable", () => {
  it("429 (rate limit) → retryable:true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { message: "Rate limit exceeded" })));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(true);
      expect(outcome.errorCode).toMatch(/429/);
    }
  });

  it("500 (erro do servidor) → retryable:true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { message: "Internal error" })));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.retryable).toBe(true);
  });

  it("timeout (AbortError) → retryable:true, sem lançar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      })
    ));
    vi.useFakeTimers();
    try {
      const promise = new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
      await vi.advanceTimersByTimeAsync(15_001);
      const outcome = await promise;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.retryable).toBe(true);
        expect(outcome.errorCode).toBe("brevo_timeout");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("erro de rede (fetch rejeita) → retryable:true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(true);
      expect(outcome.errorCode).toBe("brevo_network_error");
    }
  });
});

describe("BrevoTransactionalEmailProvider · falha permanente", () => {
  it("400 (payload rejeitado) → retryable:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { message: "invalid email", code: "invalid_parameter" })));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.retryable).toBe(false);
      expect(outcome.errorCode).toBe("brevo_invalid_parameter");
    }
  });

  it("401 (chave inválida) → retryable:false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { message: "Unauthorized" })));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.retryable).toBe(false);
  });
});

describe("BrevoTransactionalEmailProvider · a API key nunca vaza na mensagem de erro", () => {
  it("mensagem de erro do provider que ecoasse a key é redigida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse(400, { message: `Bad request with api-key=${CONFIG.apiKey} rejected` })
    ));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errorMessage).not.toContain(CONFIG.apiKey);
      expect(outcome.errorMessage).toContain("[REDACTED]");
    }
  });

  it("erro de rede que ecoasse a key na mensagem também é redigido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`connect failed for key ${CONFIG.apiKey}`)));
    const outcome = await new BrevoTransactionalEmailProvider(CONFIG).send(INPUT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errorMessage).not.toContain(CONFIG.apiKey);
  });
});
