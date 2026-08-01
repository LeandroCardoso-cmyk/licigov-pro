import { describe, it, expect, vi } from "vitest";
import { withTimeout, withRetry, TimeoutError } from "../../_core/resilience";
import type { RetryPolicy } from "../../config/retryPolicy";

const FAST_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1,
  backoffMultiplier: 2,
  maxDelayMs: 4,
  softTimeoutMs: 10,
  hardTimeoutMs: 50,
};

describe("resilience — withTimeout", () => {
  it("resolve quando fn termina antes do timeout", async () => {
    const value = await withTimeout(async () => 42, 1_000, "ok");
    expect(value).toBe(42);
  });

  it("rejeita com TimeoutError quando fn excede o timeout", async () => {
    const hang = () => new Promise<number>((resolve) => {
      const t = setTimeout(() => resolve(1), 500);
      (t as { unref?: () => void }).unref?.();
    });
    await expect(withTimeout(hang, 20, "hang")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("aciona o AbortSignal ao estourar o timeout (cancelamento cooperativo)", async () => {
    let aborted = false;
    const fn = (signal: AbortSignal) => new Promise<number>((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve(0); }, { once: true });
    });
    await expect(withTimeout(fn, 15, "abort")).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });
});

describe("resilience — withRetry", () => {
  it("re-tenta erro transitório e converge para sucesso", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient-1"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { policy: FAST_POLICY, isTransient: () => true });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respeita maxAttempts e propaga o último erro", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { policy: FAST_POLICY, isTransient: () => true }))
      .rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(FAST_POLICY.maxAttempts);
  });

  it("NÃO re-tenta erro determinístico (falha imediata, uma única chamada)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("invalid-input"));
    await expect(withRetry(fn, { policy: FAST_POLICY, isTransient: () => false }))
      .rejects.toThrow("invalid-input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("emite onRetry a cada re-tentativa", async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("t"))
      .mockResolvedValueOnce("ok");
    await withRetry(fn, { policy: FAST_POLICY, isTransient: () => true, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1 });
  });
});
