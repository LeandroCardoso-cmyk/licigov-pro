import { describe, it, expect } from "vitest";

// Domain
import {
  createInstitutionalCopilot,
  instantiateFirstGeneration,
  getCopilotDefinition,
  isCapableOf,
  isForbidden,
  ALL_COPILOT_TYPES,
} from "../../domain/institutionalCopilot";
import {
  createCopilotSession,
  canTransition,
  advanceSession,
  isTerminal,
} from "../../domain/copilotSession";
import {
  createCopilotCapability,
  scoreCapabilityMatch,
  matchesCapability,
} from "../../domain/copilotCapability";
import {
  createCopilotRecommendation,
  aggregateRiskLevel,
  MANDATORY_REVIEW_NOTICE,
} from "../../domain/copilotRecommendation";
import {
  createCopilotDecisionTrace,
  appendTraceStep,
  computeReplaySnapshot,
  verifyReplay,
} from "../../domain/copilotDecisionTrace";
import {
  createCopilotPolicy,
  evaluatePolicy,
} from "../../domain/copilotPolicy";
import { COPILOT_PIPELINE, createCopilotPipelineStep } from "../../domain/aiWorkflow";

// Services
import {
  selectCopilot,
  rankCopilots,
  resolveConflicts,
  distributeTasks,
} from "../../services/copilotOrchestratorService";
import { buildCopilotContext, renderContextBlock } from "../../services/copilotContextEngineService";
import { buildRecommendation } from "../../services/copilotRecommendationService";
import { runCopilotReasoning, buildGroundedPrompt } from "../../services/copilotReasoningService";
import { defaultPolicyFor, enforceRecommendationPolicy, isActionAllowed } from "../../services/copilotPolicyService";
import { evaluateRecommendation, applyUserFeedback } from "../../services/copilotEvaluationService";
import { recordMemory, getMemory, summarizeMemory, clearMemory } from "../../services/copilotMemoryService";
import { recordCopilotTrace } from "../../services/copilotObservabilityService";

// Persistence (graceful without DB)
import {
  insertCopilot,
  listCopilots,
  insertCopilotSession,
  getCopilotSession,
  listSessions,
  recordCopilotMetric,
  insertRecommendation,
} from "../../db/copilots";

const ORG_ID = 10200;
const CORR = "corr-4900";

describe("Sprint 4.9 — Institutional Cognitive Copilots", () => {

  // ─── Domain: institutionalCopilot ──────────────────────────────────────────

  describe("institutionalCopilot", () => {
    it("existem 8 copilotos na primeira geração", () => {
      expect(ALL_COPILOT_TYPES).toHaveLength(8);
    });

    it("createInstitutionalCopilot gera id determinístico", () => {
      const a = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "juridico" });
      const b = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "juridico" });
      expect(a.id).toBe(b.id);
      expect(a.id).toMatch(/^[a-f0-9]{20}$/);
    });

    it("multi-tenant: org diferente → id diferente", () => {
      const a = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "juridico" });
      const b = createInstitutionalCopilot({ organizationId: 99999, copilotType: "juridico" });
      expect(a.id).not.toBe(b.id);
    });

    it("copiloto carrega nome, domínio e capacidades da definição", () => {
      const c = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "tr_intelligence" });
      expect(c.name).toContain("TR Intelligence");
      expect(c.domain).toBe("termo_referencia");
      expect(c.capabilities.length).toBeGreaterThan(0);
    });

    it("juridico jamais pode emitir parecer definitivo (governança)", () => {
      const c = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "juridico" });
      expect(isForbidden(c, "emitir_parecer_definitivo")).toBe(true);
      expect(isForbidden(c, "decidir_questao_juridica")).toBe(true);
    });

    it("todos os copilotos proíbem tomar_decisao_final", () => {
      for (const t of ALL_COPILOT_TYPES) {
        const c = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: t });
        expect(isForbidden(c, "tomar_decisao_final")).toBe(true);
      }
    });

    it("isCapableOf reflete as capacidades", () => {
      const c = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "pregoeiro" });
      expect(isCapableOf(c, "orientar_disputa")).toBe(true);
      expect(isCapableOf(c, "capacidade_inexistente")).toBe(false);
    });

    it("instantiateFirstGeneration cria os 8 copilotos", () => {
      const all = instantiateFirstGeneration(ORG_ID, CORR);
      expect(all).toHaveLength(8);
      expect(new Set(all.map(c => c.copilotType)).size).toBe(8);
    });

    it("getCopilotDefinition retorna definição correta", () => {
      expect(getCopilotDefinition("controle_interno").domain).toBe("controle_interno");
    });
  });

  // ─── Domain: copilotSession ────────────────────────────────────────────────

  describe("copilotSession", () => {
    const mk = () => createCopilotSession({
      organizationId: ORG_ID, workflowId: "wf1", copilotId: "cop1", copilotType: "juridico",
      userId: 7, query: "fundamentação da dispensa", correlationId: CORR,
    });

    it("cria sessão com contextId/reasoningId determinísticos", () => {
      const a = mk();
      const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.contextId).toMatch(/^[a-f0-9]{20}$/);
      expect(a.reasoningId).toMatch(/^[a-f0-9]{20}$/);
      expect(a.status).toBe("open");
    });

    it("canTransition valida transições", () => {
      expect(canTransition("open", "reasoning")).toBe(true);
      expect(canTransition("open", "approved")).toBe(false);
      expect(canTransition("recommended", "awaiting_approval")).toBe(true);
    });

    it("advanceSession avança status válido", () => {
      const s = advanceSession(mk(), "reasoning");
      expect(s.status).toBe("reasoning");
    });

    it("advanceSession lança em transição inválida", () => {
      expect(() => advanceSession(mk(), "approved")).toThrow();
    });

    it("isTerminal detecta estados finais", () => {
      const closed = advanceSession(mk(), "closed");
      expect(isTerminal(closed)).toBe(true);
    });
  });

  // ─── Domain: copilotCapability ─────────────────────────────────────────────

  describe("copilotCapability", () => {
    it("cria capacidade com id determinístico", () => {
      const a = createCopilotCapability({ organizationId: ORG_ID, copilotType: "planejamento", name: "montar_etp", kind: "estruturar", keywords: ["etp", "estudo técnico"] });
      const b = createCopilotCapability({ organizationId: ORG_ID, copilotType: "planejamento", name: "montar_etp", kind: "estruturar" });
      expect(a.id).toBe(b.id);
    });

    it("scoreCapabilityMatch pontua por keywords", () => {
      const cap = createCopilotCapability({ organizationId: ORG_ID, copilotType: "planejamento", name: "etp", kind: "estruturar", keywords: ["etp", "estudo técnico"] });
      expect(scoreCapabilityMatch(cap, "preciso montar o etp")).toBeGreaterThan(0);
      expect(scoreCapabilityMatch(cap, "assunto irrelevante")).toBe(0);
    });

    it("matchesCapability booleano", () => {
      const cap = createCopilotCapability({ organizationId: ORG_ID, copilotType: "planejamento", name: "etp", kind: "estruturar", keywords: ["etp"] });
      expect(matchesCapability(cap, "gerar etp")).toBe(true);
      expect(matchesCapability(cap, "outra coisa")).toBe(false);
    });
  });

  // ─── Domain: copilotRecommendation ─────────────────────────────────────────

  describe("copilotRecommendation", () => {
    it("toda recomendação exige revisão humana", () => {
      const rec = createCopilotRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", kind: "orientacao", summary: "x" });
      expect(rec.requiresHumanReview).toBe(true);
      expect(rec.reviewNotice).toBe(MANDATORY_REVIEW_NOTICE);
    });

    it("id determinístico", () => {
      const a = createCopilotRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", kind: "orientacao", summary: "abc" });
      const b = createCopilotRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", kind: "orientacao", summary: "abc" });
      expect(a.id).toBe(b.id);
    });

    it("aggregateRiskLevel retorna o maior risco", () => {
      const rec = createCopilotRecommendation({
        organizationId: ORG_ID, sessionId: "s1", copilotType: "pregoeiro", kind: "alerta_risco", summary: "x",
        risks: [
          { description: "a", severity: "baixo", mitigation: "m" },
          { description: "b", severity: "alto", mitigation: "m" },
        ],
      });
      expect(aggregateRiskLevel(rec)).toBe("alto");
    });

    it("aggregateRiskLevel nenhum quando sem riscos", () => {
      const rec = createCopilotRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "pregoeiro", kind: "orientacao", summary: "x" });
      expect(aggregateRiskLevel(rec)).toBe("nenhum");
    });
  });

  // ─── Domain: copilotDecisionTrace ──────────────────────────────────────────

  describe("copilotDecisionTrace", () => {
    it("cria trace com snapshot determinístico", () => {
      const a = createCopilotDecisionTrace({ organizationId: ORG_ID, sessionId: "s1", reasoningId: "r1", correlationId: CORR });
      const b = createCopilotDecisionTrace({ organizationId: ORG_ID, sessionId: "s1", reasoningId: "r1", correlationId: CORR });
      expect(a.replaySnapshot).toBe(b.replaySnapshot);
      expect(a.replaySnapshot.length).toBeGreaterThan(0);
    });

    it("appendTraceStep adiciona etapa ordenada e atualiza snapshot", () => {
      let t = createCopilotDecisionTrace({ organizationId: ORG_ID, sessionId: "s1", reasoningId: "r1", correlationId: CORR });
      const snap0 = t.replaySnapshot;
      t = appendTraceStep(t, { type: "reasoning", summary: "passo", inputRef: "a", outputRef: "b", evidenceCount: 2 });
      expect(t.steps).toHaveLength(1);
      expect(t.steps[0].order).toBe(0);
      expect(t.replaySnapshot).not.toBe(snap0);
    });

    it("verifyReplay confirma snapshot", () => {
      let t = createCopilotDecisionTrace({ organizationId: ORG_ID, sessionId: "s1", reasoningId: "r1", correlationId: CORR });
      t = appendTraceStep(t, { type: "recommendation", summary: "s", inputRef: "a", outputRef: "b", evidenceCount: 0 });
      expect(verifyReplay(t, computeReplaySnapshot(t))).toBe(true);
    });
  });

  // ─── Domain: copilotPolicy ─────────────────────────────────────────────────

  describe("copilotPolicy", () => {
    const policy = createCopilotPolicy({
      organizationId: ORG_ID, copilotType: "juridico", name: "p",
      allowedActions: ["emit_recommendation", "fundamentar_legalmente"],
      forbiddenActions: ["emitir_parecer_definitivo"],
    });

    it("bloqueia ação proibida", () => {
      const r = evaluatePolicy(policy, { action: "emitir_parecer_definitivo", confidence: 1, riskLevel: "nenhum" });
      expect(r.allowed).toBe(false);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    });

    it("permite ação autorizada", () => {
      const r = evaluatePolicy(policy, { action: "emit_recommendation", confidence: 1, riskLevel: "baixo" });
      expect(r.allowed).toBe(true);
    });

    it("risco alto exige aprovação", () => {
      const r = evaluatePolicy(policy, { action: "emit_recommendation", confidence: 1, riskLevel: "alto" });
      expect(r.requiresApproval).toBe(true);
    });

    it("confiança baixa exige aprovação", () => {
      const r = evaluatePolicy(policy, { action: "emit_recommendation", confidence: 0.1, riskLevel: "baixo" });
      expect(r.requiresApproval).toBe(true);
    });
  });

  // ─── Workflow expansion ────────────────────────────────────────────────────

  describe("aiWorkflow — copilot pipeline", () => {
    it("COPILOT_PIPELINE contém as etapas do copiloto", () => {
      expect(COPILOT_PIPELINE).toContain("copilot_selection");
      expect(COPILOT_PIPELINE).toContain("copilot_reasoning");
      expect(COPILOT_PIPELINE).toContain("copilot_explainability");
    });

    it("createCopilotPipelineStep gera id determinístico", () => {
      const a = createCopilotPipelineStep({ workflowId: "wf1", organizationId: ORG_ID, copilotId: "c1", stepType: "copilot_reasoning", order: 4, correlationId: CORR });
      const b = createCopilotPipelineStep({ workflowId: "wf1", organizationId: ORG_ID, copilotId: "c1", stepType: "copilot_reasoning", order: 4, correlationId: CORR });
      expect(a.id).toBe(b.id);
    });
  });

  // ─── Service: orchestrator ─────────────────────────────────────────────────

  describe("copilotOrchestratorService", () => {
    it("seleciona pregoeiro para consulta de pregão", () => {
      expect(selectCopilot("condução da sessão de pregão eletrônico").copilotType).toBe("pregoeiro");
    });

    it("seleciona planejamento para DFD/ETP", () => {
      expect(selectCopilot("elaborar o etp e o dfd do planejamento").copilotType).toBe("planejamento");
    });

    it("seleciona tr_intelligence para termo de referência", () => {
      expect(selectCopilot("especificação do termo de referência com catmat").copilotType).toBe("tr_intelligence");
    });

    it("seleciona juridico para fundamentação legal", () => {
      expect(selectCopilot("preciso de fundamentação legal e jurisprudência").copilotType).toBe("juridico");
    });

    it("fallback: agente_contratacao quando nada específico", () => {
      expect(selectCopilot("olá, bom dia").copilotType).toBe("agente_contratacao");
    });

    it("rankCopilots retorna lista ordenada", () => {
      const ranked = rankCopilots("pregão e termo de referência", 3);
      expect(ranked.length).toBeGreaterThanOrEqual(1);
    });

    it("resolveConflicts escolhe o de maior score", () => {
      const { winner } = resolveConflicts([
        { copilotType: "juridico", score: 0.2, rationale: "" },
        { copilotType: "pregoeiro", score: 0.5, rationale: "" },
      ]);
      expect(winner.copilotType).toBe("pregoeiro");
    });

    it("distributeTasks divide consulta composta", () => {
      const tasks = distributeTasks("elaborar termo de referência; conduzir o pregão");
      expect(tasks.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Service: context engine (usa RAG seed + KG graceful) ──────────────────

  describe("copilotContextEngineService", () => {
    it("buildCopilotContext monta contexto fundamentado (RAG seed)", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "contratação pública", correlationId: CORR });
      expect(ctx.evidences.length).toBeGreaterThan(0);
      expect(ctx.legalRefs.length).toBeGreaterThan(0);
      expect(ctx.copilotType).toBe("juridico");
    });

    it("contexto é determinístico (mesma consulta → mesmo id)", async () => {
      const a = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "x", correlationId: CORR });
      const b = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "x", correlationId: CORR });
      expect(a.id).toBe(b.id);
    });

    it("renderContextBlock produz bloco textual (nunca prompt cru)", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "licitação", correlationId: CORR });
      const block = renderContextBlock(ctx);
      expect(block).toContain("Contexto institucional");
      expect(block).toContain("Base legal");
    });
  });

  // ─── Service: recommendation ───────────────────────────────────────────────

  describe("copilotRecommendationService", () => {
    it("buildRecommendation gera recomendação fundamentada", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "tr_intelligence", query: "especificação de material", correlationId: CORR });
      const rec = buildRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "tr_intelligence", context: ctx, correlationId: CORR });
      expect(rec.requiresHumanReview).toBe(true);
      expect(rec.legalBasis.length).toBeGreaterThan(0);
      expect(rec.risks.length).toBeGreaterThanOrEqual(1);
      expect(rec.confidence).toBeGreaterThan(0);
    });
  });

  // ─── Service: reasoning (pipeline oficial, grounding-only sem provider) ─────

  describe("copilotReasoningService", () => {
    it("runCopilotReasoning opera grounding-only sem provider (invoke vazio)", async () => {
      const result = await runCopilotReasoning({
        organizationId: ORG_ID, copilotType: "juridico", sessionId: "s1", reasoningId: "r1",
        query: "fundamentação da contratação", correlationId: CORR,
        invoke: async () => "",
      });
      expect(result.groundingOnly).toBe(true);
      expect(result.recommendation.requiresHumanReview).toBe(true);
      expect(result.trace.steps.length).toBeGreaterThanOrEqual(5);
    });

    it("runCopilotReasoning usa texto do provider quando disponível", async () => {
      const result = await runCopilotReasoning({
        organizationId: ORG_ID, copilotType: "juridico", sessionId: "s2", reasoningId: "r2",
        query: "fundamentação", correlationId: CORR,
        invoke: async () => "Orientação fundamentada simulada.",
      });
      expect(result.groundingOnly).toBe(false);
      expect(result.recommendation.summary).toContain("simulada");
    });

    it("degrada quando invoke lança (grounding-only)", async () => {
      const result = await runCopilotReasoning({
        organizationId: ORG_ID, copilotType: "juridico", sessionId: "s3", reasoningId: "r3",
        query: "x", correlationId: CORR,
        invoke: async () => { throw new Error("provider down"); },
      });
      expect(result.groundingOnly).toBe(true);
    });

    it("buildGroundedPrompt nunca é cru (inclui papel + contexto + revisão)", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "pregoeiro", query: "pregão", correlationId: CORR });
      const prompt = buildGroundedPrompt("pregoeiro", ctx);
      expect(prompt).toContain("Pregoeiro Copilot");
      expect(prompt).toContain("NÃO toma decisões");
      expect(prompt).toContain("revisad");
    });

    it("trace registra a cadeia de reasoning para explainability", async () => {
      const result = await runCopilotReasoning({
        organizationId: ORG_ID, copilotType: "planejamento", sessionId: "s4", reasoningId: "r4",
        query: "etp", correlationId: CORR, invoke: async () => "",
      });
      const types = result.trace.steps.map(s => s.type);
      expect(types).toContain("copilot_selection");
      expect(types).toContain("context_assembly");
      expect(types).toContain("recommendation");
      expect(types).toContain("explainability");
    });
  });

  // ─── Service: policy ───────────────────────────────────────────────────────

  describe("copilotPolicyService", () => {
    it("defaultPolicyFor herda ações proibidas da definição", () => {
      const p = defaultPolicyFor(ORG_ID, "juridico");
      expect(p.forbiddenActions).toContain("emitir_parecer_definitivo");
    });

    it("enforceRecommendationPolicy exige aprovação em risco alto", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "pregoeiro", query: "pregão", correlationId: CORR });
      const rec = buildRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "pregoeiro", context: ctx, correlationId: CORR });
      const p = defaultPolicyFor(ORG_ID, "pregoeiro");
      const evalr = enforceRecommendationPolicy(p, rec);
      expect(evalr.requiresApproval).toBe(true); // política sempre exige revisão humana
    });

    it("isActionAllowed bloqueia parecer definitivo do jurídico", () => {
      expect(isActionAllowed(ORG_ID, "juridico", "emitir_parecer_definitivo")).toBe(false);
      expect(isActionAllowed(ORG_ID, "juridico", "emit_recommendation")).toBe(true);
    });
  });

  // ─── Service: evaluation ───────────────────────────────────────────────────

  describe("copilotEvaluationService", () => {
    it("evaluateRecommendation classifica verdict", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "licitação", correlationId: CORR });
      const rec = buildRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", context: ctx, correlationId: CORR });
      const p = defaultPolicyFor(ORG_ID, "juridico");
      const ev = evaluateRecommendation(rec, enforceRecommendationPolicy(p, rec));
      expect(["aprovavel", "revisar", "insuficiente"]).toContain(ev.verdict);
      expect(ev.groundingCoverage).toBeGreaterThan(0);
    });

    it("applyUserFeedback ajusta qualidade", async () => {
      const ctx = await buildCopilotContext({ organizationId: ORG_ID, copilotType: "juridico", query: "x", correlationId: CORR });
      const rec = buildRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", context: ctx, correlationId: CORR });
      const p = defaultPolicyFor(ORG_ID, "juridico");
      const ev = evaluateRecommendation(rec, enforceRecommendationPolicy(p, rec));
      const better = applyUserFeedback(ev, "util");
      const worse = applyUserFeedback(ev, "inutil");
      expect(better.qualityScore).toBeGreaterThanOrEqual(ev.qualityScore);
      expect(worse.qualityScore).toBeLessThanOrEqual(ev.qualityScore);
    });
  });

  // ─── Service: memory (multi-tenant) ────────────────────────────────────────

  describe("copilotMemoryService", () => {
    it("registra e recupera memória por copiloto", () => {
      clearMemory(ORG_ID, "contratos");
      recordMemory({ organizationId: ORG_ID, copilotType: "contratos", query: "aditivo", recommendationSummary: "orientação", correlationId: "m1" });
      const mem = getMemory(ORG_ID, "contratos");
      expect(mem.length).toBe(1);
      expect(mem[0].query).toBe("aditivo");
    });

    it("memória é isolada por organização", () => {
      clearMemory(ORG_ID, "contratos");
      clearMemory(88888, "contratos");
      recordMemory({ organizationId: ORG_ID, copilotType: "contratos", query: "a", recommendationSummary: "s", correlationId: "m2" });
      expect(getMemory(88888, "contratos")).toHaveLength(0);
    });

    it("summarizeMemory produz resumo textual", () => {
      clearMemory(ORG_ID, "pesquisa_precos");
      recordMemory({ organizationId: ORG_ID, copilotType: "pesquisa_precos", query: "cotação", recommendationSummary: "usar 3 fontes", correlationId: "m3" });
      expect(summarizeMemory(ORG_ID, "pesquisa_precos")).toContain("cotação");
    });
  });

  // ─── Service: observability ────────────────────────────────────────────────

  describe("copilotObservabilityService", () => {
    it("recordCopilotTrace não lança", () => {
      expect(() => recordCopilotTrace({
        correlationId: CORR, organizationId: ORG_ID, copilotType: "juridico",
        sessionId: "s1", reasoningId: "r1", durationMs: 0, evidenceCount: 3,
        groundingOnly: true, replaySnapshot: "snap", recordedAt: "2026-01-01T00:00:00.000Z",
      })).not.toThrow();
    });
  });

  // ─── Persistence: graceful degradation (sem DB no teste) ───────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    it("insertCopilot retorna null sem DB", async () => {
      const c = createInstitutionalCopilot({ organizationId: ORG_ID, copilotType: "juridico" });
      await expect(insertCopilot(c)).resolves.toBeNull();
    });

    it("listCopilots retorna [] sem DB", async () => {
      await expect(listCopilots(ORG_ID)).resolves.toEqual([]);
    });

    it("insertCopilotSession / getCopilotSession degradam", async () => {
      const s = createCopilotSession({ organizationId: ORG_ID, workflowId: "wf", copilotId: "c", copilotType: "juridico", userId: 1, query: "q", correlationId: CORR });
      await expect(insertCopilotSession(s)).resolves.toBeNull();
      await expect(getCopilotSession(s.id, ORG_ID)).resolves.toBeNull();
    });

    it("listSessions retorna [] sem DB", async () => {
      await expect(listSessions(ORG_ID)).resolves.toEqual([]);
    });

    it("recordCopilotMetric é no-op sem DB", async () => {
      await expect(recordCopilotMetric({ organizationId: ORG_ID, correlationId: CORR, copilotType: "juridico", metricName: "m", metricValue: 1 })).resolves.toBeUndefined();
    });

    it("insertRecommendation degrada sem lançar", async () => {
      const rec = createCopilotRecommendation({ organizationId: ORG_ID, sessionId: "s1", copilotType: "juridico", kind: "orientacao", summary: "x" });
      await expect(insertRecommendation(rec)).resolves.toBeNull();
    });
  });
});
