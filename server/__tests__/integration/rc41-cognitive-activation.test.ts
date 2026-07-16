/**
 * RC-4.1 — Cognitive Activation
 *
 * Garante que toda a cognição do produto passa pelo AIExecutionEngine
 * (executeCognitiveTask), que executeAITask não tem callers oficiais, que invokeLLM
 * está restrito ao legado allowlistado, e que os copilotos passam pelo Engine usando
 * o Mock Provider — preservando Replay Safety, Explainability e validação.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  INVOKE_LLM_LEGACY_ALLOWLIST, EXECUTE_AI_TASK_ALLOWLIST, BUSINESS_DOMAIN_SERVICES, isAllowed,
} from "../../kernel/architecture/legacyBoundaries";
import { runCopilotReasoning } from "../../services/copilotReasoningService";
import { ALL_COPILOT_TYPES, type CopilotType } from "../../domain/institutionalCopilot";

// ─── Varredura de fonte ───────────────────────────────────────────────────────
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}
const SERVER_TS = walk("server").filter(f => !f.includes("__tests__") && !f.endsWith(".test.ts"));
const read = (f: string) => fs.readFileSync(f, "utf-8");

const ORG = 11800;

describe("RC-4.1 — Cognitive Activation", () => {

  // ─── Fronteira: executeAITask aposentado ────────────────────────────────────
  describe("executeAITask aposentado (sem callers oficiais)", () => {
    it("nenhum arquivo de produção chama executeAITask fora da allowlist", () => {
      const callers = SERVER_TS.filter(f => /executeAITask\(/.test(read(f)));
      const offenders = callers.filter(f => !isAllowed(f, EXECUTE_AI_TASK_ALLOWLIST));
      expect(offenders, `chamam executeAITask fora da allowlist: ${offenders.join(", ")}`).toEqual([]);
    });

    it("o CopilotReasoning roteia por executeCognitiveTask (não executeAITask)", () => {
      const src = read("server/services/copilotReasoningService.ts");
      expect(src).toContain("executeCognitiveTask");
      expect(src).not.toContain("executeAITask");
    });
  });

  // ─── Fronteira: invokeLLM restrito ao legado ────────────────────────────────
  describe("invokeLLM restrito ao legado allowlistado", () => {
    it("nenhum componente fora da allowlist chama invokeLLM", () => {
      const callers = SERVER_TS.filter(f => /invokeLLM\(/.test(read(f)) && !f.endsWith("_core/llm.ts"));
      const offenders = callers.filter(f => !isAllowed(f, INVOKE_LLM_LEGACY_ALLOWLIST));
      expect(offenders, `chamam invokeLLM fora do legado: ${offenders.join(", ")}`).toEqual([]);
    });

    it("todos os callers legados de invokeLLM carregam a classificação LEGADO", () => {
      for (const f of INVOKE_LLM_LEGACY_ALLOWLIST) {
        expect(read(f), `${f} sem classificação legado`).toMatch(/LEGAD|LEGACY|legado|EXEMPLO/);
      }
    });

    it("nenhum Business Domain oficial usa invokeLLM/executeAITask/generateText", () => {
      for (const svc of BUSINESS_DOMAIN_SERVICES) {
        const src = read(svc);
        expect(src, `${svc} → invokeLLM`).not.toContain("invokeLLM(");
        expect(src, `${svc} → executeAITask`).not.toContain("executeAITask(");
        expect(src, `${svc} → generateText`).not.toMatch(/\bgenerateText\(/);
      }
    });
  });

  // ─── Copilots passam pelo Engine (Mock Provider) ────────────────────────────
  describe("Copilots passam pelo AIExecutionEngine com Mock Provider", () => {
    it("todos os 8 copilotos mapeiam para uma Cognitive Task", () => {
      const src = read("server/services/copilotReasoningService.ts");
      for (const c of ALL_COPILOT_TYPES) expect(src).toContain(`${c}:`);
    });

    it("runCopilotReasoning (default, sem invoke) roteia pelo Engine e produz reasoning (Mock ativo)", async () => {
      for (const c of ["juridico", "planejamento", "contratos", "controle_interno"] as CopilotType[]) {
        const res = await runCopilotReasoning({
          organizationId: ORG, copilotType: c, sessionId: "s1", reasoningId: "r1",
          query: "estruturar próximo passo", correlationId: `corr-rc41-${c}`,
        });
        // Mock Provider produz conteúdo determinístico → não é grounding-only.
        expect(res.groundingOnly).toBe(false);
        expect(res.recommendation).toBeDefined();
        expect(res.trace.steps.length).toBeGreaterThan(0);
      }
    });

    it("o ponto de injeção invoke continua funcionando (legado/testes): '' → grounding-only", async () => {
      const res = await runCopilotReasoning({
        organizationId: ORG, copilotType: "juridico", sessionId: "s1", reasoningId: "r1",
        query: "x", correlationId: "corr-rc41-inj", invoke: async () => "",
      });
      expect(res.groundingOnly).toBe(true);
    });
  });

  // ─── Replay Safety + Mock Provider ──────────────────────────────────────────
  describe("Replay Safety com Mock Provider", () => {
    it("mesma execução lógica → mesmo resultado (determinístico via Mock)", async () => {
      const call = () => runCopilotReasoning({
        organizationId: ORG, copilotType: "planejamento", sessionId: "s1", reasoningId: "r1",
        query: "mesma pergunta", correlationId: "corr-rc41-replay",
      });
      const a = await call();
      const b = await call();
      expect(a.recommendation.id).toBe(b.recommendation.id);
      expect(a.groundingOnly).toBe(b.groundingOnly);
    });
  });
});
