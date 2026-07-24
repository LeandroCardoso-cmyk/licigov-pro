/**
 * AI-015 — Proibição de fallback implícito para o MockAIProvider fora de desenvolvimento/teste.
 *
 * Defeito original: quando o provider real (Gemini) não podia ser construído (chave ausente/inválida),
 * `selectProvider` caía SILENCIOSAMENTE no mock e a resposta mock era servida como oficial/"Fundamentada".
 *
 * Correção (fail-closed):
 * 1. Em staging/production, o fallback para mock é PROIBIDO — `selectProvider` lança `NoRealAIProviderError`.
 * 2. Sem provider real, a consulta falha de forma controlada e NÃO persiste resposta oficial (status `failed`).
 * 3. Erro de RUNTIME do provider real NÃO cai no mock — propaga.
 * 4. Mock só é permitido em development/test com a flag explícita `AI_ALLOW_MOCK_FALLBACK=true` (default false).
 * 5. Quando o mock é autorizado, `provider=mock`/`usedFallback` são marcados e a resposta NUNCA é "Fundamentada".
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mockFallbackAllowed, resolveAllowMockFallback } from "../../config/ai";
import { selectProvider, setActiveProvider, NoRealAIProviderError } from "../../_core/ai/providerAdapter";
import { executeCognitiveTask } from "../../services/aiExecutionEngine";
import { answerConsultation, getOfficialCorpus, getConsultationForTenant } from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import type { AIProvider, AIGenerateResult } from "../../_core/ai/types";

const MS = MOREIRA_SALES_TENANT_ID;

describe("AI-015 · política de fallback para mock (pura, determinística)", () => {
  it("mock só é permitido em development/test COM a flag explícita — default fail-closed", () => {
    expect(mockFallbackAllowed({ isDevelopment: true, allowMockFlag: true })).toBe(true);
    expect(mockFallbackAllowed({ isDevelopment: true, allowMockFlag: false })).toBe(false); // dev sem flag
    expect(mockFallbackAllowed({ isDevelopment: false, allowMockFlag: true })).toBe(false); // staging/prod: nunca
    expect(mockFallbackAllowed({ isDevelopment: false, allowMockFlag: false })).toBe(false);
  });
  it("a flag AI_ALLOW_MOCK_FALLBACK tem default false e só 'true' habilita", () => {
    expect(resolveAllowMockFallback({})).toBe(false);
    expect(resolveAllowMockFallback({ AI_ALLOW_MOCK_FALLBACK: "false" })).toBe(false);
    expect(resolveAllowMockFallback({ AI_ALLOW_MOCK_FALLBACK: "1" })).toBe(false);
    expect(resolveAllowMockFallback({ AI_ALLOW_MOCK_FALLBACK: "true" })).toBe(true);
    expect(resolveAllowMockFallback({ AI_ALLOW_MOCK_FALLBACK: "TRUE" })).toBe(true);
  });
});

describe("AI-015 · fail-closed em staging/production (sem provider real, mock proibido)", () => {
  const ORIGINAL = { APP_ENV: process.env.APP_ENV, ALLOW: process.env.AI_ALLOW_MOCK_FALLBACK, KEY: process.env.GEMINI_API_KEY, JWT: process.env.JWT_SECRET, ADMIN: process.env.ADMIN_PASSWORD };
  afterEach(() => {
    for (const [k, v] of [["APP_ENV", ORIGINAL.APP_ENV], ["AI_ALLOW_MOCK_FALLBACK", ORIGINAL.ALLOW], ["GEMINI_API_KEY", ORIGINAL.KEY], ["JWT_SECRET", ORIGINAL.JWT], ["ADMIN_PASSWORD", ORIGINAL.ADMIN]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    vi.resetModules();
  });

  async function selectProviderIn(appEnv: string): Promise<{ selectProvider: typeof selectProvider; NoRealAIProviderError: typeof NoRealAIProviderError }> {
    process.env.APP_ENV = appEnv;
    delete process.env.AI_ALLOW_MOCK_FALLBACK; // default false
    delete process.env.GEMINI_API_KEY;         // sem provider real construível
    process.env.JWT_SECRET = "x".repeat(40);   // boot exige JWT_SECRET em staging/production
    process.env.ADMIN_PASSWORD = "admin-super-secret-123"; // boot exige ADMIN_PASSWORD fora de dev
    vi.resetModules();
    return await import("../../_core/ai/providerAdapter");
  }

  it("staging: selectProvider LANÇA NoRealAIProviderError (não serve mock)", async () => {
    const mod = await selectProviderIn("staging");
    expect(() => mod.selectProvider("gemini", "claude")).toThrow(mod.NoRealAIProviderError);
  });

  it("production: selectProvider LANÇA NoRealAIProviderError (não serve mock)", async () => {
    const mod = await selectProviderIn("production");
    expect(() => mod.selectProvider("gemini", "claude")).toThrow(mod.NoRealAIProviderError);
  });

  it("development COM flag: selectProvider resolve para mock (comportamento de dev/teste)", async () => {
    process.env.APP_ENV = "development";
    process.env.AI_ALLOW_MOCK_FALLBACK = "true";
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
    const mod = await import("../../_core/ai/providerAdapter");
    const r = mod.selectProvider("gemini", "claude");
    expect(r.selected).toBe("mock");
    expect(r.usedFallback).toBe(true);
  });

  it("development SEM flag: selectProvider LANÇA (default fail-closed mesmo em dev)", async () => {
    process.env.APP_ENV = "development";
    delete process.env.AI_ALLOW_MOCK_FALLBACK;
    delete process.env.GEMINI_API_KEY;
    vi.resetModules();
    const mod = await import("../../_core/ai/providerAdapter");
    expect(() => mod.selectProvider("gemini", "claude")).toThrow(mod.NoRealAIProviderError);
  });
});

describe("AI-015 · erro de runtime do provider real NÃO cai no mock + ausência de persistência oficial", () => {
  afterEach(() => setActiveProvider(null));

  it("executeCognitiveTask propaga o erro de generate() (não usa mock nem retorna resposta)", async () => {
    const failing: AIProvider = {
      name: "gemini-runtime-fail", generateText: async () => "",
      generate: async (): Promise<AIGenerateResult> => { throw new Error("Gemini 500 runtime error"); },
    };
    setActiveProvider(failing);
    await expect(executeCognitiveTask({
      task: "LEGAL_ANALYSIS", tenantId: 1, userId: "1", correlationId: "ai015-runtime", query: "x",
    })).rejects.toThrow(/runtime error/i);
  });

  it("answerConsultation com erro de runtime → status 'failed', SEM resposta oficial persistida", async () => {
    getOfficialCorpus();
    setConsultationRepository(new InMemoryConsultationRepository());
    const failing: AIProvider = {
      name: "gemini-runtime-fail", generateText: async () => "",
      generate: async (): Promise<AIGenerateResult> => { throw new Error("Gemini indisponível"); },
    };
    setActiveProvider(failing);
    await expect(answerConsultation({
      organizationId: MS, userId: 1, question: "Quando é cabível a dispensa de licitação?", correlationId: "ai015-nopersist",
    })).rejects.toThrow();

    const rec = await getConsultationForTenant(MS, // executionId derivado do correlationId
      (await import("../../domain/institutionalConsultation")).computeExecutionId(MS, "ai015-nopersist"));
    expect(rec).not.toBeNull();
    expect(rec!.status).toBe("failed");            // falha controlada
    expect(rec!.status).not.toBe("completed");     // NUNCA resposta oficial
    expect(rec!.answer ?? "").toBe("");             // nenhum conteúdo de resposta persistido
  });
});

describe("AI-015 · mock autorizado (dev/test) nunca é resposta oficial/'Fundamentada'", () => {
  afterEach(() => setActiveProvider(null));

  it("resposta via mock (fallback autorizado no teste) é marcada e NÃO é 'Fundamentada'", async () => {
    getOfficialCorpus();
    setConsultationRepository(new InMemoryConsultationRepository());
    setActiveProvider(null); // sem provider injetado → cai no mock (dev+flag no ambiente de teste)

    // Pergunta que, pela evidência, seria "fundamentada" — mas o provider é mock.
    const a = await answerConsultation({
      organizationId: MS, userId: 1, question: "Qual artigo da Lei 14.133 trata da contratação direta?", correlationId: "ai015-mock-answer",
    });
    expect(a.evidenceSufficiency).not.toBe("fundamentada");   // nunca oficial via mock
    expect(a.hasSufficientBasis).toBe(true);                  // ainda há base documental (parcial)
    expect(a.observations.some(o => /mock/i.test(o) && /n[ãa]o.*oficial/i.test(o))).toBe(true);
    expect(a.limitations.some(l => /mock/i.test(l))).toBe(true);
  });
});
