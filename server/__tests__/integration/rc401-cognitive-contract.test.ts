/**
 * RC-4.0.1 — Cognitive Contract Consolidation
 *
 * Consolida o contrato cognitivo: CognitiveResponse genérico (structuredData opcional),
 * Replay Hash semântico (só execução lógica, nunca output/tempo/tokens), validação
 * obrigatória (nenhuma resposta inválida sai do Engine) e Explainability obrigatória.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

import {
  createCognitiveResponse, validateCognitiveResponse, COGNITIVE_RESPONSE_CONTRACT_VERSION,
  type CognitiveResponse,
} from "../../domain/cognitiveResponse";
import { officialReplayHash, type CognitiveRequest, type CognitiveGroundingUsage } from "../../domain/aiExecutionContext";
import { ALL_COGNITIVE_TASK_IDS, getCognitiveTask, type CognitiveTaskId } from "../../domain/cognitiveTask";
import { executeCognitiveTask, type CognitiveTaskInput } from "../../services/aiExecutionEngine";
import { getCognitiveObservability } from "../../services/cognitive/cognitiveObservabilityService";

const ORG = 11700;
const CORR = "corr-rc401";

const baseInput = (task: CognitiveTaskId, over: Partial<CognitiveTaskInput> = {}): CognitiveTaskInput => ({
  task, tenantId: ORG, userId: "9", correlationId: CORR, query: "objetivo", ...over,
});

/** Resposta textual válida mínima (para testes de contrato/validação). */
const textResponse = (over: Partial<CognitiveResponse> = {}): CognitiveResponse => createCognitiveResponse({
  task: "GENERATE_DOCUMENT", responseType: "text", content: "conteúdo", reasoning: "porque sim", confidence: 0.7,
  sources: [], laws: [], jurisprudence: [], documentsUsed: [], recommendations: [], alternatives: [], risks: [], limitations: ["nenhuma"],
  explainability: { whyAnswered: "porque", documentsUsed: [], lawsUsed: [], discardedRecommendations: [], confidence: 0.7, limitations: ["nenhuma"] },
  tokens: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 0, provider: "mock", model: "m", replayHash: "a".repeat(32),
  ...over,
});

describe("RC-4.0.1 — Cognitive Contract Consolidation", () => {

  // ─── Part 1/5 — CognitiveResponse genérico ──────────────────────────────────
  describe("CognitiveResponse genérico (Structured Response Contract)", () => {
    it("compatível com respostas textuais (structuredData ausente)", () => {
      const r = textResponse();
      expect(validateCognitiveResponse(r).valid).toBe(true);
      expect(r.contractVersion).toBe(COGNITIVE_RESPONSE_CONTRACT_VERSION);
      expect(r.structuredData).toBeUndefined();
    });

    it("aceita structuredData como OBJETO", () => {
      const r = textResponse({ responseType: "object", structuredData: { itemId: 1, catmat: "1234", score: 0.9 } });
      expect(validateCognitiveResponse(r).valid).toBe(true);
      expect((r.structuredData as any).catmat).toBe("1234");
    });

    it("aceita structuredData como LISTA / matriz / matching", () => {
      const r = textResponse({ responseType: "matching", content: "", structuredData: [{ a: 1 }, { a: 2 }] });
      expect(validateCognitiveResponse(r).valid).toBe(true); // payload via structuredData, content vazio OK
      expect(Array.isArray(r.structuredData)).toBe(true);
    });

    it("aceita structuredData NULO (resposta textual pura)", () => {
      const r = textResponse({ structuredData: null });
      expect(validateCognitiveResponse(r).valid).toBe(true); // payload via content
    });

    it("rejeita quando NÃO há payload (content vazio E structuredData nulo)", () => {
      const r = textResponse({ content: "", structuredData: null });
      const v = validateCognitiveResponse(r);
      expect(v.valid).toBe(false);
      expect(v.errors.join()).toMatch(/payload/);
    });
  });

  // ─── Part 4 — Explainability Contract ───────────────────────────────────────
  describe("Explainability obrigatória", () => {
    it("falha explicitamente sem reasoning / sources / limitations / replayHash / requiresHumanReview", () => {
      expect(validateCognitiveResponse(textResponse({ reasoning: "" })).valid).toBe(false);
      expect(validateCognitiveResponse(textResponse({ sources: undefined as any })).valid).toBe(false);
      expect(validateCognitiveResponse(textResponse({ limitations: undefined as any })).valid).toBe(false);
      expect(validateCognitiveResponse(textResponse({ replayHash: "curto" })).valid).toBe(false);
      // requiresHumanReview é forçado pela factory; burlar via spread para exercitar a validação.
      expect(validateCognitiveResponse({ ...textResponse(), requiresHumanReview: false as any }).valid).toBe(false);
      expect(validateCognitiveResponse(textResponse({ confidence: 5 })).valid).toBe(false);
    });
  });

  // ─── Part 2 — Replay Hash semântico ─────────────────────────────────────────
  describe("Replay Hash representa apenas a execução lógica", () => {
    const req: CognitiveRequest = { tenantId: ORG, userId: "9", task: "RISK_ANALYSIS", prompt: "P", correlationId: CORR, businessDomain: "contratos" };
    const grounding: Pick<CognitiveGroundingUsage, "groundingApplied" | "ragApplied" | "knowledgeGraphApplied"> = { groundingApplied: true, ragApplied: true, knowledgeGraphApplied: true };

    it("officialReplayHash não recebe conteúdo/tempo/tokens (só insumos lógicos)", () => {
      const h1 = officialReplayHash({ request: req, provider: "mock", model: "m", grounding });
      const h2 = officialReplayHash({ request: req, provider: "mock", model: "m", grounding });
      expect(h1).toBe(h2);
      expect(h1).toHaveLength(32);
    });

    it("muda quando o insumo lógico muda (prompt/provider/modelo/grounding)", () => {
      const base = officialReplayHash({ request: req, provider: "mock", model: "m", grounding });
      expect(officialReplayHash({ request: { ...req, prompt: "OUTRO" }, provider: "mock", model: "m", grounding })).not.toBe(base);
      expect(officialReplayHash({ request: req, provider: "gemini", model: "m", grounding })).not.toBe(base);
      expect(officialReplayHash({ request: req, provider: "mock", model: "m", grounding: { ...grounding, ragApplied: false } })).not.toBe(base);
    });

    it("no Engine: mesmo insumo lógico → mesmo replayHash, ainda que o payload difira", async () => {
      const a = await executeCognitiveTask(baseInput("RISK_ANALYSIS", { businessDomain: "contratos" }));
      const b = await executeCognitiveTask(baseInput("RISK_ANALYSIS", { businessDomain: "contratos", structuredData: { extra: [1, 2, 3] }, responseType: "object" }));
      expect(a.response.replayHash).toBe(b.response.replayHash); // output diferente, hash lógico igual
      expect(a.response.replayHash).toBe(a.context.replayHash);   // resposta e contexto compartilham o hash oficial
    });
  });

  // ─── Part 3 — Validação obrigatória ─────────────────────────────────────────
  describe("Validação obrigatória (nenhuma resposta inválida sai do Engine)", () => {
    it("toda tarefa produz resposta validada (valid=true)", async () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const domain = getCognitiveTask(id).allowedBusinessDomains[0];
        const exec = await executeCognitiveTask(baseInput(id, { businessDomain: domain }));
        expect(exec.validation.valid, `${id}`).toBe(true);
      }
    });

    it("o Engine lança InvalidCognitiveResponse para resposta inválida", () => {
      const src = fs.readFileSync("server/services/aiExecutionEngine.ts", "utf-8");
      expect(src).toContain("if (!validation.valid) throw new InvalidCognitiveResponse");
    });
  });

  // ─── Part 6 — Observabilidade do contrato ───────────────────────────────────
  describe("Observabilidade registra tipo/payload/tamanho/hash/versão/validação", () => {
    it("registra responseType, structuredData, contractVersion e resultado da validação", async () => {
      await executeCognitiveTask(baseInput("CATMAT_MATCHING", { businessDomain: "processo_licitatorio", correlationId: "corr-obs-rc401", responseType: "matching", structuredData: [{ code: "x" }] }));
      const obs = getCognitiveObservability("corr-obs-rc401");
      expect(obs).not.toBeNull();
      expect(obs!.responseType).toBe("matching");
      expect(obs!.structuredDataPresent).toBe(true);
      expect(obs!.structuredDataSize).toBeGreaterThan(0);
      expect(obs!.responseShapeHash.length).toBeGreaterThan(0);
      expect(obs!.contractVersion).toBe(COGNITIVE_RESPONSE_CONTRACT_VERSION);
      expect(obs!.structuredOutputValid).toBe(true);
    });
  });
});
