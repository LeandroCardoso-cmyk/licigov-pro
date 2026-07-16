/**
 * RC-4.2 — Institutional Reasoning Framework
 *
 * Valida a separação Conhecimento → Raciocínio → Resposta: toda Cognitive Task gera um
 * InstitutionalReasoningPlan (12 etapas declarativas), com regras institucionais aplicadas,
 * alternativas registradas, explainability completa, replay determinístico e observabilidade.
 */

import { describe, it, expect } from "vitest";

import {
  STANDARD_REASONING_STEPS, buildReasoningPlan, splitAlternatives,
} from "../../domain/institutionalReasoning";
import {
  INSTITUTIONAL_RULES, ALL_INSTITUTIONAL_RULE_IDS, getRulesForTask,
} from "../../domain/institutionalRules";
import { ALL_COGNITIVE_TASK_IDS, getCognitiveTask, type CognitiveTaskId } from "../../domain/cognitiveTask";
import { executeCognitiveTask, type CognitiveTaskInput } from "../../services/aiExecutionEngine";
import { getCognitiveObservability } from "../../services/cognitive/cognitiveObservabilityService";

const ORG = 11900;
const CORR = "corr-rc42";
const baseInput = (task: CognitiveTaskId, over: Partial<CognitiveTaskInput> = {}): CognitiveTaskInput => ({
  task, tenantId: ORG, userId: "7", correlationId: CORR, query: "estruturar próximo passo", ...over,
});

describe("RC-4.2 — Institutional Reasoning Framework", () => {

  // ─── Part 1 — Reasoning Steps declarativas ──────────────────────────────────
  describe("Institutional Reasoning Steps", () => {
    it("as 12 etapas oficiais são declarativas e ordenadas", () => {
      expect(STANDARD_REASONING_STEPS).toHaveLength(12);
      STANDARD_REASONING_STEPS.forEach((s, i) => {
        expect(s.order).toBe(i + 1);
        expect(s.name.length).toBeGreaterThan(0);
      });
      expect(STANDARD_REASONING_STEPS[0].id).toBe("entender_solicitacao");
      expect(STANDARD_REASONING_STEPS[11].id).toBe("gerar_structured_response");
    });
  });

  // ─── Part 3 — Institutional Rules declarativas ──────────────────────────────
  describe("Institutional Rules (declarativas)", () => {
    it("regras têm enunciado curto, categoria e escopo (estrutura, não conteúdo jurídico)", () => {
      for (const id of ALL_INSTITUTIONAL_RULE_IDS) {
        const r = INSTITUTIONAL_RULES[id];
        for (const f of ["id", "statement", "category", "appliesToDomains", "appliesToTasks"]) {
          expect(r, `${id}.${f}`).toHaveProperty(f);
        }
        expect(r.statement.length).toBeLessThan(80); // curto/declarativo
      }
      expect(INSTITUTIONAL_RULES.tr_obrigatorio.statement).toBe("TR obrigatório");
    });

    it("getRulesForTask é determinístico e filtra por tarefa/domínio", () => {
      const a = getRulesForTask("LEGAL_REASONING", "parecer_juridico").map(r => r.id);
      const b = getRulesForTask("LEGAL_REASONING", "parecer_juridico").map(r => r.id);
      expect(a).toEqual(b);
      expect(a).toContain("parecer_obrigatorio");
    });
  });

  // ─── Part 2 — Reasoning Plan ────────────────────────────────────────────────
  describe("InstitutionalReasoningPlan", () => {
    it("contém objetivo/contexto/etapas/leis/documentos/restrições/riscos/alternativas/regras", () => {
      const plan = buildReasoningPlan({ task: "PROCUREMENT_REASONING", objective: "obj", correlationId: CORR, businessDomain: "processo_licitatorio", stage: "etp" });
      for (const f of ["objective", "context", "steps", "laws", "documents", "constraints", "risks", "alternatives", "rules", "replayHash"]) {
        expect(plan, f).toHaveProperty(f);
      }
      expect(plan.steps).toHaveLength(12);
      expect(plan.alternatives.length).toBeGreaterThan(0);
      expect(plan.rules).toContain("tr_obrigatorio");
    });

    it("é reproduzível: mesmos insumos lógicos → mesmo replayHash", () => {
      const p = () => buildReasoningPlan({ task: "RISK_ANALYSIS", objective: "obj", correlationId: CORR, businessDomain: "contratos" });
      expect(p().replayHash).toBe(p().replayHash);
      expect(p().replayHash).toHaveLength(32);
    });

    it("splitAlternatives separa recomendada e descartadas com motivo", () => {
      const plan = buildReasoningPlan({ task: "CONTRACT_REASONING", objective: "obj", correlationId: CORR, businessDomain: "contratos" });
      const alt = splitAlternatives(plan);
      expect(alt.recommended.length).toBeGreaterThan(0);
      expect(alt.discarded.length).toBeGreaterThan(0);
      for (const d of alt.discarded) expect(d.reason.length).toBeGreaterThan(0);
    });
  });

  // ─── Part 4 — Reasoning Pipeline (Engine) ───────────────────────────────────
  describe("Reasoning Pipeline no AIExecutionEngine", () => {
    it("toda Task gera ReasoningPlan; nenhuma resposta sem plano", async () => {
      for (const id of ALL_COGNITIVE_TASK_IDS) {
        const domain = getCognitiveTask(id).allowedBusinessDomains[0];
        const exec = await executeCognitiveTask(baseInput(id, { businessDomain: domain }));
        expect(exec.reasoningPlan, `${id} sem plano`).toBeDefined();
        expect(exec.reasoningPlan.steps).toHaveLength(12);
        expect(exec.reasoningPlan.task).toBe(id);
      }
    });

    it("o pipeline inclui institutional_rules e reasoning_plan antes do provider", async () => {
      const exec = await executeCognitiveTask(baseInput("GENERATE_DOCUMENT", { businessDomain: "processo_licitatorio" }));
      const stages = exec.stages.map(s => s.stage);
      expect(stages).toContain("institutional_rules");
      expect(stages).toContain("reasoning_plan");
      expect(stages.indexOf("reasoning_plan")).toBeLessThan(stages.indexOf("provider"));
    });

    it("raciocina institucionalmente ANTES da resposta (plan antes do llm)", async () => {
      const exec = await executeCognitiveTask(baseInput("COMPLIANCE_CHECK", { businessDomain: "contratos" }));
      const stages = exec.stages.map(s => s.stage);
      expect(stages.indexOf("reasoning_plan")).toBeLessThan(stages.indexOf("llm"));
    });
  });

  // ─── Part 5 — Explainability expandida ──────────────────────────────────────
  describe("Explainability com raciocínio institucional", () => {
    it("registra regras aplicadas, alternativas consideradas e descartadas (com motivo)", async () => {
      const exec = await executeCognitiveTask(baseInput("PROCUREMENT_REASONING", { businessDomain: "processo_licitatorio", lawRefs: ["Lei 14.133 art. 18"] }));
      const ex = exec.response.explainability;
      expect(ex.rulesApplied).toEqual(exec.reasoningPlan.rules);
      expect(ex.alternativesConsidered!.length).toBeGreaterThan(0);
      expect(ex.discardedAlternatives!.length).toBeGreaterThan(0);
      for (const d of ex.discardedAlternatives!) expect(d.reason.length).toBeGreaterThan(0);
      expect(ex.whyAnswered).toContain(exec.reasoningPlan.id);
    });
  });

  // ─── Part 8 — Observabilidade ───────────────────────────────────────────────
  describe("Observabilidade do raciocínio (recuperável por correlationId)", () => {
    it("registra plano, regras aplicadas, caminhos alternativos/descartados e fontes", async () => {
      await executeCognitiveTask(baseInput("RISK_ANALYSIS", { businessDomain: "contratos", correlationId: "corr-rc42-obs" }));
      const obs = getCognitiveObservability("corr-rc42-obs");
      expect(obs).not.toBeNull();
      expect(obs!.reasoningPlanId.length).toBeGreaterThan(0);
      expect(obs!.reasoningPlanHash).toHaveLength(32);
      expect(Array.isArray(obs!.appliedRules)).toBe(true);
      expect(obs!.alternativePaths.length).toBeGreaterThan(0);
      expect(obs!.discardedPaths.length).toBeGreaterThan(0);
      expect(typeof obs!.groundingUsed).toBe("boolean");
    });
  });

  // ─── Replay determinístico end-to-end ───────────────────────────────────────
  describe("Replay determinístico", () => {
    it("mesma execução lógica → mesmo plano e mesmo replayHash de resposta", async () => {
      const a = await executeCognitiveTask(baseInput("CONTRACT_REASONING", { businessDomain: "contratos" }));
      const b = await executeCognitiveTask(baseInput("CONTRACT_REASONING", { businessDomain: "contratos" }));
      expect(a.reasoningPlan.replayHash).toBe(b.reasoningPlan.replayHash);
      expect(a.response.replayHash).toBe(b.response.replayHash);
    });
  });
});
