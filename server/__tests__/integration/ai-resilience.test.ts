import { describe, it, expect, vi, afterEach } from "vitest";
import { isTransientAiError, resilientAiCall } from "../../_core/ai/aiResilience";
import { TimeoutError } from "../../_core/resilience";
import { NoRealAIProviderError } from "../../_core/ai/providerAdapter";
import { ProviderNotImplemented, ProviderUnavailable } from "../../_core/ai/placeholderProviders";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isTransientAiError — classificação transitório × determinístico", () => {
  it("timeout é transitório", () => {
    expect(isTransientAiError(new TimeoutError(1000, "op"))).toBe(true);
  });

  it("rate limit / 429 / 5xx / rede são transitórios", () => {
    expect(isTransientAiError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isTransientAiError(new Error("RESOURCE_EXHAUSTED: quota"))).toBe(true);
    expect(isTransientAiError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientAiError(new Error("model is overloaded"))).toBe(true);
    expect(isTransientAiError(new Error("ECONNRESET"))).toBe(true);
    expect(isTransientAiError({ status: 500, message: "internal" })).toBe(true);
  });

  it("entrada inválida / auth / política são determinísticos (sem retry)", () => {
    expect(isTransientAiError(new Error("400 INVALID_ARGUMENT"))).toBe(false);
    expect(isTransientAiError(new Error("401 unauthenticated"))).toBe(false);
    expect(isTransientAiError(new Error("403 PERMISSION_DENIED"))).toBe(false);
    expect(isTransientAiError(new Error("API key not valid"))).toBe(false);
  });

  it("erros de provider indisponível/não-implementado e fail-closed AI-015 são determinísticos", () => {
    expect(isTransientAiError(new NoRealAIProviderError("sem provider"))).toBe(false);
    expect(isTransientAiError(new ProviderNotImplemented("claude"))).toBe(false);
    expect(isTransientAiError(new ProviderUnavailable("gemini"))).toBe(false);
  });

  it("erro desconhecido é tratado como determinístico (fail-fast)", () => {
    expect(isTransientAiError(new Error("algo estranho e inesperado"))).toBe(false);
  });
});

describe("resilientAiCall — retry controlado", () => {
  it("re-tenta erro transitório e converge para sucesso", async () => {
    const gen = vi.fn()
      .mockRejectedValueOnce(new Error("503 unavailable"))
      .mockResolvedValueOnce({ text: "ok" });
    const result = await resilientAiCall(() => gen(), {
      provider: "gemini", model: "gemini-flash-latest", operation: "op", correlationId: "corr-1",
    });
    expect(result).toEqual({ text: "ok" });
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("NÃO re-tenta erro determinístico (uma única chamada)", async () => {
    const gen = vi.fn().mockRejectedValue(new Error("400 INVALID_ARGUMENT"));
    await expect(resilientAiCall(() => gen(), { provider: "gemini", model: "m", operation: "op" }))
      .rejects.toThrow("INVALID_ARGUMENT");
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("não re-tenta ausência de provider real (fail-closed AI-015 propaga imediatamente)", async () => {
    const gen = vi.fn().mockRejectedValue(new NoRealAIProviderError("sem provider real"));
    await expect(resilientAiCall(() => gen(), { provider: "gemini", model: "m", operation: "op" }))
      .rejects.toBeInstanceOf(NoRealAIProviderError);
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

describe("resilientAiCall — replay safety (sem retry concorrente / chamada tardia descartada)", () => {
  it("re-tentativas são SEQUENCIAIS (nunca há duas chamadas em voo)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const gen = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => { const t = setTimeout(r, 5); (t as { unref?: () => void }).unref?.(); });
      inFlight--;
      calls++;
      if (calls < 2) throw new Error("503 unavailable"); // transitório → força 1 retry
      return { text: "ok" };
    };
    const result = await resilientAiCall(() => gen(), { provider: "gemini", model: "m", operation: "seq" });
    expect(result).toEqual({ text: "ok" });
    expect(maxInFlight).toBe(1); // nunca duas chamadas simultâneas
  });

  it("chamada tardia de uma tentativa que estourou timeout é DESCARTADA (não vira resultado)", async () => {
    vi.resetModules();
    vi.stubEnv("AI_TIMEOUT_MS", "20");
    vi.stubEnv("AI_MAX_ATTEMPTS", "2");
    const { resilientAiCall: call } = await import("../../_core/ai/aiResilience");

    let attempt = 0;
    const gen = () => {
      attempt++;
      if (attempt === 1) {
        // pendura além do timeout e "resolve" tarde — esse valor NÃO pode virar o resultado
        return new Promise((resolve) => {
          const t = setTimeout(() => resolve({ text: "tardio-1" }), 500);
          (t as { unref?: () => void }).unref?.();
        });
      }
      return Promise.resolve({ text: "attempt-2" });
    };

    const result = await call(() => gen(), { provider: "gemini", model: "m", operation: "late" });
    expect(result).toEqual({ text: "attempt-2" }); // vence a 2ª tentativa; a tardia é ignorada
  });
});

describe("resilientAiCall — timeout real + AbortController (AI-014)", () => {
  it("estoura TimeoutError e aciona o abort quando o provider pendura", async () => {
    vi.resetModules();
    vi.stubEnv("AI_TIMEOUT_MS", "20");
    vi.stubEnv("AI_MAX_ATTEMPTS", "1"); // sem retry: falha rápida
    const { resilientAiCall: call } = await import("../../_core/ai/aiResilience");
    const { TimeoutError: TE } = await import("../../_core/resilience");

    let aborted = false;
    const hang = (signal: AbortSignal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      const t = setTimeout(() => resolve({ text: "tarde demais" }), 500);
      (t as { unref?: () => void }).unref?.();
    });

    await expect(call(hang, { provider: "gemini", model: "m", operation: "hang", correlationId: "c" }))
      .rejects.toBeInstanceOf(TE);
    expect(aborted).toBe(true);
  });
});
