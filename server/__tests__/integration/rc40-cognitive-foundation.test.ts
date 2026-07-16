/**
 * RC-4.0 — Cognitive Foundation
 *
 * Valida a fundação cognitiva: Cognitive Tasks, AI Execution Context, Cognitive
 * Pipeline, Cognitive Response, Grounding declarado, Observabilidade, Prompt Builders
 * tipados e Explainability obrigatória. Sem LLM real, sem prompts jurídicos.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

import {
  COGNITIVE_TASKS, ALL_COGNITIVE_TASK_IDS, getCognitiveTask, isBusinessDomainAllowed,
  type CognitiveTaskId,
} from "../../domain/cognitiveTask";
import { validateCognitiveResponse } from "../../domain/cognitiveResponse";
import { getPromptBuilder, COGNITIVE_PROMPT_BUILDERS } from "../../services/cognitive/promptBuilders";
import { getCognitiveObservability } from "../../services/cognitive/cognitiveObservabilityService";
import { executeCognitiveTask, type CognitiveTaskInput } from "../../services/aiExecutionEngine";

const ORG = 11600;
const USER = "42";
const CORR = "corr-rc40";

const baseInput = (task: CognitiveTaskId, over: Partial<CognitiveTaskInput> = {}): CognitiveTaskInput => ({
  task, tenantId: ORG, userId: USER, correlationId: CORR, query: "Estruturar próximo passo do processo.", ...over,
});

describe("RC-4.0 — Cognitive Foundation", () => {

  // ─── Cognitive Tasks (Part 1) ───────────────────────────────────────────────
  describe("Cognitive Tasks", () => {
    it("registra as 13 tarefas cognitivas oficiais", () => {
      expect(ALL_COGNITIVE_TASK_IDS).toHaveLength(13);
      for (const id of ["GENERATE_DOCUMENT", "LEGAL_ANALYSIS", "CATMAT_MATCHING", "WORKFLOW_RECOMMENDATION"] as CognitiveTaskId[]) {
        expect(COGNITIVE_TASKS[id]).toBeDefined();
      }
    });

    it("toda Task possui Policy completa e Explainability obrigatória", () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const t = getCognitiveTask(id);
        for (const f of ["preferredProvider", "fallbackProvider", "model", "temperature", "maxContext", "maxCost", "requiresExplainability"]) {
          expect(t.policy, `${id}.policy.${f}`).toHaveProperty(f);
        }
        expect(t.requiresExplainability).toBe(true);
        expect(t.allowedBusinessDomains.length).toBeGreaterThan(0);
      }
    });

    it("toda Task declara grounding explicitamente (nada implícito)", () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const g = getCognitiveTask(id).grounding;
        for (const f of ["usesGrounding", "usesRAG", "usesKnowledgeGraph", "usesLegislation", "usesDocuments", "usesInstitutionalContext"]) {
          expect(typeof (g as any)[f], `${id}.grounding.${f}`).toBe("boolean");
        }
      }
    });

    it("autorização de domínio: LEGAL_ANALYSIS só para parecer_juridico", () => {
      expect(isBusinessDomainAllowed("LEGAL_ANALYSIS", "parecer_juridico")).toBe(true);
      expect(isBusinessDomainAllowed("LEGAL_ANALYSIS", "contratos")).toBe(false);
    });
  });

  // ─── Prompt Builders (Part 7) ───────────────────────────────────────────────
  describe("Prompt Builders tipados", () => {
    it("toda Task possui um Prompt Builder e produz system+user estruturais", () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const built = getPromptBuilder(id).build({ query: "objetivo x" });
        expect(built.task).toBe(id);
        expect(built.system.length).toBeGreaterThan(0);
        expect(built.user).toContain("[OBJETIVO]");
      }
      expect(Object.keys(COGNITIVE_PROMPT_BUILDERS)).toHaveLength(13);
    });

    it("o engine usa o Prompt Builder (nunca concatena prompt manualmente)", () => {
      const src = fs.readFileSync("server/services/aiExecutionEngine.ts", "utf-8");
      expect(src).toContain("getPromptBuilder");
    });
  });

  // ─── Cognitive Pipeline (Part 3) ────────────────────────────────────────────
  describe("Cognitive Pipeline", () => {
    it("executa as 13 etapas na ordem oficial", async () => {
      const exec = await executeCognitiveTask(baseInput("PROCUREMENT_REASONING", { businessDomain: "processo_licitatorio" }));
      // RC-4.2 — pipeline expandido com institutional_rules + reasoning_plan.
      const order = ["task", "policy", "grounding", "knowledge_graph", "rag", "institutional_rules", "reasoning_plan", "copilot", "prompt", "provider", "llm", "structured_output", "reasoning", "explainability", "result"];
      expect(exec.stages.map(s => s.stage)).toEqual(order);
    });

    it("é replay-safe: mesmos insumos → mesmo replayHash", async () => {
      const a = await executeCognitiveTask(baseInput("RISK_ANALYSIS", { businessDomain: "contratos" }));
      const b = await executeCognitiveTask(baseInput("RISK_ANALYSIS", { businessDomain: "contratos" }));
      expect(a.response.replayHash).toBe(b.response.replayHash);
      expect(a.context.replayHash).toBe(b.context.replayHash);
    });

    it("nega execução de domínio não autorizado", async () => {
      await expect(executeCognitiveTask(baseInput("LEGAL_ANALYSIS", { businessDomain: "contratos" })))
        .rejects.toThrow(/não autorizado/);
    });

    it("Grounding aplicado quando a tarefa o declara", async () => {
      const exec = await executeCognitiveTask(baseInput("GENERATE_DOCUMENT", { businessDomain: "processo_licitatorio" }));
      expect(getCognitiveTask("GENERATE_DOCUMENT").grounding.usesGrounding).toBe(true);
      expect(exec.context.grounding.groundingApplied).toBe(true);
      expect(exec.stages.find(s => s.stage === "grounding")?.status).toBe("applied");
    });
  });

  // ─── Cognitive Response (Part 4) + Explainability (Part 8) ───────────────────
  describe("Cognitive Response e Explainability", () => {
    it("toda resposta é Structured Output válido, com reasoning, confidence, replayHash e explainability", async () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const domain = getCognitiveTask(id).allowedBusinessDomains[0];
        const exec = await executeCognitiveTask(baseInput(id, { businessDomain: domain }));
        const r = exec.response;
        expect(exec.validation.valid, `${id}: ${exec.validation.errors.join(",")}`).toBe(true);
        expect(r.content.length).toBeGreaterThan(0);
        expect(r.reasoning.length).toBeGreaterThan(0);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
        expect(r.replayHash).toHaveLength(32);
        expect(r.explainability.whyAnswered.length).toBeGreaterThan(0);
        expect(r.requiresHumanReview).toBe(true);
      }
    });

    it("nenhum copiloto devolve texto solto: validação rejeita resposta sem conteúdo/reasoning", () => {
      const loose = {
        task: "GENERATE_DOCUMENT" as CognitiveTaskId, content: "", reasoning: "", confidence: 2,
        sources: [], laws: [], jurisprudence: [], documentsUsed: [], recommendations: [], alternatives: [],
        risks: [], limitations: [], explainability: { whyAnswered: "", documentsUsed: [], lawsUsed: [], discardedRecommendations: [], confidence: 2, limitations: [] },
        tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, latencyMs: 0, provider: "mock", model: "m", replayHash: "x", requiresHumanReview: true as const,
      };
      const v = validateCognitiveResponse(loose);
      expect(v.valid).toBe(false);
      expect(v.errors.length).toBeGreaterThan(0);
    });
  });

  // ─── AI Execution Context (Part 2) ──────────────────────────────────────────
  describe("AI Execution Context", () => {
    it("acompanha a execução com tenant, task, provider, tokens, confidence, reasoning e correlationId", async () => {
      const exec = await executeCognitiveTask(baseInput("CONTRACT_REASONING", { businessDomain: "contratos", processId: "p1", stage: "execucao" }));
      const c = exec.context;
      expect(c.request.tenantId).toBe(ORG);
      expect(c.request.task).toBe("CONTRACT_REASONING");
      expect(c.request.correlationId).toBe(CORR);
      expect(c.outcome.provider.length).toBeGreaterThan(0);
      expect(c.outcome.reasoning.length).toBeGreaterThan(0);
      expect(c.outcome.confidence).toBeGreaterThanOrEqual(0);
      expect(c.grounding.copilot).toBe(getCognitiveTask("CONTRACT_REASONING").recommendedCopilot);
    });
  });

  // ─── Cognitive Observability (Part 6) ───────────────────────────────────────
  describe("Cognitive Observability", () => {
    it("registra execução/reasoning/provider/grounding/RAG/KG/latência/tokens/validação", async () => {
      const exec = await executeCognitiveTask(baseInput("COMPLIANCE_CHECK", { businessDomain: "contratos", correlationId: "corr-obs-rc40" }));
      const obs = getCognitiveObservability("corr-obs-rc40");
      expect(obs).not.toBeNull();
      expect(obs!.executionLog.length).toBeGreaterThan(0);
      expect(obs!.reasoningLog.length).toBeGreaterThan(0);
      expect(obs!.providerLog).toContain("provider=");
      expect(obs!.groundingLog).toContain("grounding=");
      expect(obs!.ragLog).toContain("rag=");
      expect(obs!.knowledgeGraphLog).toContain("kg=");
      expect(obs!.structuredOutputValid).toBe(true);
      expect(obs!.tokenUsage).toBeDefined();
      expect(exec.observability.correlationId).toBe("corr-obs-rc40");
    });
  });

  // ─── Provider pela Policy (Part 2/3) ────────────────────────────────────────
  describe("Provider escolhido pela Policy", () => {
    it("o provider vem da política da tarefa (preferido gemini; sem chave → fallback mock)", async () => {
      const exec = await executeCognitiveTask(baseInput("ITEM_REASONING", { businessDomain: "processo_licitatorio" }));
      expect(getCognitiveTask("ITEM_REASONING").policy.preferredProvider).toBe("gemini");
      // Sem GEMINI_API_KEY na suíte → cadeia de fallback resolve para mock.
      expect(exec.response.provider).toBe("mock");
    });
  });
});
