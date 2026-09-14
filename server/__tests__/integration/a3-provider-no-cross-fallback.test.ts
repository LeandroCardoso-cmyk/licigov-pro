/**
 * A3 (hardening) — SEM fallback automático cross-provider.
 *
 * Prova o contrato explícito adotado no hardening da A3.1:
 *   1. TODAS as políticas (AI + Cognitive) declaram `fallbackProvider = null` — nenhuma
 *      declara Claude/OpenAI como fallback automático.
 *   2. `selectProvider` só considera um fallback real quando a política o declara
 *      explicitamente (`!= null`); com `null` a falha do preferido NUNCA troca de provider
 *      real por conta própria — cai no mock (dev/test autorizado) ou falha fail-closed.
 *   3. O provider preferido implementado é usado sem fallback.
 *   4. O modelo Gemini permanece pinado (`gemini-3.8-flash`) — não muda com esta mudança.
 *
 * Nota: um erro de RUNTIME do provider real (`generate()` falhando) não é tratado por
 * `selectProvider` (propaga ao chamador) — portanto também não troca de provider.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { AI_EXECUTION_POLICIES } from "../../_core/ai/executionPolicy";
import { COGNITIVE_TASKS } from "../../domain/cognitiveTask";
import { CANONICAL_GEMINI_MODEL } from "../../config/ai";
import { selectProvider } from "../../_core/ai/providerAdapter";

describe("A3 · contrato de políticas — nenhum fallback cross-provider declarado", () => {
  it("toda AI Execution Policy declara fallbackProvider = null", () => {
    for (const p of Object.values(AI_EXECUTION_POLICIES)) {
      expect(p.fallbackProvider, `${p.task} não deveria ter fallback cross-provider`).toBeNull();
    }
  });

  it("toda Cognitive Task declara fallbackProvider = null", () => {
    for (const t of Object.values(COGNITIVE_TASKS)) {
      expect(t.policy.fallbackProvider, `${t.id} não deveria ter fallback cross-provider`).toBeNull();
    }
  });

  it("o modelo Gemini permanece pinado (gemini-3.8-flash)", () => {
    expect(CANONICAL_GEMINI_MODEL).toBe("gemini-3.8-flash");
  });
});

describe("A3 · selectProvider — sem troca automática de provider", () => {
  it("preferido implementado é usado sem fallback (fallback ignorado)", () => {
    const r = selectProvider("mock", "openai"); // mock é implementado
    expect(r.selected).toBe("mock");
    expect(r.usedFallback).toBe(false);
  });

  it("fallback = null (default) não ativa branch cross-provider — assinatura aceita omissão", () => {
    const r = selectProvider("mock"); // sem segundo argumento
    expect(r.selected).toBe("mock");
    expect(r.usedFallback).toBe(false);
  });
});

describe("A3 · selectProvider — preferido real indisponível NÃO cai em outro provider real", () => {
  const ORIGINAL = { APP_ENV: process.env.APP_ENV, ALLOW: process.env.AI_ALLOW_MOCK_FALLBACK, KEY: process.env.GEMINI_API_KEY };
  afterEach(() => {
    for (const [k, v] of [["APP_ENV", ORIGINAL.APP_ENV], ["AI_ALLOW_MOCK_FALLBACK", ORIGINAL.ALLOW], ["GEMINI_API_KEY", ORIGINAL.KEY]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("dev COM flag, sem Gemini construível e fallback=null → mock (nunca claude/openai)", async () => {
    process.env.APP_ENV = "development";
    process.env.AI_ALLOW_MOCK_FALLBACK = "true";
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
    const mod = await import("../../_core/ai/providerAdapter");
    const r = mod.selectProvider("gemini", null);
    expect(r.selected).toBe("mock"); // caiu no mock autorizado, jamais em outro provider REAL
    expect(r.selected).not.toBe("claude");
    expect(r.selected).not.toBe("openai");
  });

  it("staging, sem Gemini e fallback=null → fail-closed (NoRealAIProviderError), nunca outro provider", async () => {
    process.env.APP_ENV = "staging";
    delete process.env.AI_ALLOW_MOCK_FALLBACK;
    delete process.env.GEMINI_API_KEY;
    process.env.JWT_SECRET = "x".repeat(40);
    process.env.ADMIN_PASSWORD = "admin-super-secret-123";
    vi.resetModules();
    const mod = await import("../../_core/ai/providerAdapter");
    expect(() => mod.selectProvider("gemini", null)).toThrow(mod.NoRealAIProviderError);
  });
});
