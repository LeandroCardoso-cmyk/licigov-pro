/**
 * V1 PRE-PILOT CLOSURE — PHASE A2 — MODEL CONTRACT HARDENING.
 *
 * Elimina aliases móveis (`*-latest`), preview e experimental do contrato institucional do provider:
 * toda execução cognitiva nova usa uma versão ESPECÍFICA e auditável do Gemini (determinismo/replay —
 * o modelo entra no replayHash). Em staging/produção o boot é FAIL-CLOSED contra aliases; dev/test
 * permanece permissivo (fixtures/mocks). NUNCA há troca automática/silenciosa de modelo.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAiRuntime,
  validateAiRuntime,
  isUnstableModelId,
  CANONICAL_GEMINI_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
} from "../../config/ai";
import { AI_EXECUTION_POLICIES } from "../../_core/ai/executionPolicy";

describe("A2 model contract — modelo canônico pinado (sem alias móvel)", () => {
  it("o modelo canônico do Gemini é uma versão específica, não um alias", () => {
    expect(CANONICAL_GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(isUnstableModelId(CANONICAL_GEMINI_MODEL)).toBe(false);
    expect(CANONICAL_GEMINI_MODEL).not.toMatch(/-latest$/i);
  });

  it("o default do Gemini é o canônico pinado", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER.gemini).toBe(CANONICAL_GEMINI_MODEL);
    expect(resolveAiRuntime({})).toEqual({ provider: "gemini", model: CANONICAL_GEMINI_MODEL });
  });

  it("todas as políticas cognitivas Gemini usam o modelo pinado (nenhum alias `*-latest`)", () => {
    for (const [task, policy] of Object.entries(AI_EXECUTION_POLICIES)) {
      if (policy.preferredProvider !== "gemini") continue;
      if (policy.model.startsWith("text-embedding-")) continue; // embedding pinado à parte
      expect(isUnstableModelId(policy.model), `policy ${task} usa modelo instável: ${policy.model}`).toBe(false);
      expect(policy.model, `policy ${task}`).toBe(CANONICAL_GEMINI_MODEL);
    }
  });
});

describe("A2 model contract — isUnstableModelId", () => {
  it("classifica aliases móveis como instáveis", () => {
    expect(isUnstableModelId("gemini-flash-latest")).toBe(true);
    expect(isUnstableModelId("gemini-pro-latest")).toBe(true);
    expect(isUnstableModelId("GEMINI-FLASH-LATEST")).toBe(true); // case-insensitive
  });

  it("classifica preview e experimental como instáveis", () => {
    expect(isUnstableModelId("gemini-2.5-flash-preview-05-20")).toBe(true);
    expect(isUnstableModelId("gemini-2.5-flash-preview")).toBe(true);
    expect(isUnstableModelId("gemini-2.0-flash-exp")).toBe(true);
    expect(isUnstableModelId("gemini-flash-experimental")).toBe(true);
  });

  it("NÃO classifica versões específicas pinadas como instáveis", () => {
    expect(isUnstableModelId("gemini-3.8-flash")).toBe(false);
    expect(isUnstableModelId("gemini-2.5-flash")).toBe(false);
    expect(isUnstableModelId("gemini-2.5-pro")).toBe(false);
    expect(isUnstableModelId("text-embedding-004")).toBe(false);
  });
});

describe("A2 model contract — validateAiRuntime fail-closed (staging/produção)", () => {
  const pinned = { provider: "gemini" as const, model: CANONICAL_GEMINI_MODEL };

  it("staging/produção (requirePinnedModel) ACEITA a versão pinada", () => {
    expect(() => validateAiRuntime(pinned, { requirePinnedModel: true })).not.toThrow();
  });

  it("staging/produção REJEITA o alias móvel gemini-flash-latest (fail-closed)", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-flash-latest" }, { requirePinnedModel: true }))
      .toThrow(/alias MÓVEL\/instável|não é permitido/i);
  });

  it("staging/produção REJEITA preview e experimental", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-2.5-flash-preview-05-20" }, { requirePinnedModel: true }))
      .toThrow(/instável/i);
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-2.0-flash-exp" }, { requirePinnedModel: true }))
      .toThrow(); // exp cai em DESCONTINUADO (denylist) OU instável — de qualquer forma, fail-closed
  });

  it("dev/test (requirePinnedModel=false, default) PERMITE o alias — fixtures/mocks", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-flash-latest" })).not.toThrow();
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-flash-latest" }, { requirePinnedModel: false })).not.toThrow();
  });

  it("NÃO troca modelo silenciosamente: a validação LANÇA (sem fallback) — o chamador aplica o fail-closed", () => {
    // validateAiRuntime é void e NUNCA retorna um segundo modelo: ou passa, ou lança.
    let threw = false;
    try {
      validateAiRuntime({ provider: "gemini", model: "gemini-flash-latest" }, { requirePinnedModel: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("mantém as guardas anteriores: vazio, descontinuado, formato incompatível", () => {
    expect(() => validateAiRuntime({ provider: "gemini", model: "" }, { requirePinnedModel: true })).toThrow(/vazio/);
    expect(() => validateAiRuntime({ provider: "gemini", model: "gemini-2.0-flash-exp" }, { requirePinnedModel: true })).toThrow(/DESCONTINUADO/);
    expect(() => validateAiRuntime({ provider: "gemini", model: "claude-sonnet-4-5" }, { requirePinnedModel: true })).toThrow(/formato esperado/);
  });
});
