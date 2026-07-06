import { describe, it, expect } from "vitest";

// Domain
import {
  createCognitiveWorkspace,
  canTransitionStatus,
  transitionStatus,
  advanceStage,
  addParticipant,
  activateCopilot,
  isArchived,
} from "../../domain/cognitiveWorkspace";
import {
  createWorkspaceTask,
  canTransitionTask,
  transitionTask,
  isReady,
  prioritizeTasks,
  readyQueue,
} from "../../domain/workspaceTask";
import {
  createTimelineEntry,
  appendTimeline,
  timelineSnapshot,
} from "../../domain/workspaceTimeline";
import { createWorkspaceContext, contextDensity } from "../../domain/workspaceContext";
import {
  createWorkspaceDecision,
  isValidDecision,
  approveDecision,
  rejectDecision,
} from "../../domain/workspaceDecision";
import {
  createWorkspaceRisk,
  riskExposure,
  correlateRisks,
  mitigateRisk,
  aggregateWorkspaceRisk,
} from "../../domain/workspaceRisk";
import { WORKSPACE_PIPELINE, createWorkspaceFlowStep } from "../../domain/aiWorkflow";

// Services
import { orchestrateMultiCopilot } from "../../services/workspaceOrchestratorService";
import { buildWorkspaceContext } from "../../services/workspaceContextService";
import { createTask, completeTask, computeReadyQueue } from "../../services/workspaceTaskService";
import { recordEvent, getTimeline } from "../../services/workspaceTimelineService";
import { registerDecision } from "../../services/workspaceDecisionService";
import { identifyRisk, analyzeRisks } from "../../services/workspaceRiskService";
import { createComment, postComment, delegateTask } from "../../services/workspaceCollaborationService";
import { computeFlowSummary, recordProductivity } from "../../services/workspaceObservabilityService";

// Persistence (graceful without DB)
import {
  insertWorkspace,
  getWorkspace,
  listWorkspaces,
  listWorkspaceTasks,
  listTimeline,
  recordWorkspaceMetric,
} from "../../db/workspace";

const ORG_ID = 10300;
const CORR = "corr-5000";
const WID = "ws-test-1";

describe("Sprint 5.0 — Cognitive Procurement Workspace", () => {

  // ─── Domain: cognitiveWorkspace ────────────────────────────────────────────

  describe("cognitiveWorkspace", () => {
    const mk = () => createCognitiveWorkspace({
      organizationId: ORG_ID, processId: "2024/0001", workspaceType: "licitacao",
      title: "Aquisição de material", owner: 7, correlationId: CORR,
    });

    it("cria workspace com id determinístico e status draft", () => {
      const a = mk();
      const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("draft");
      expect(a.currentStage).toBe("planejamento");
      expect(a.participants).toContain(7);
    });

    it("multi-tenant: org diferente → id diferente", () => {
      const a = mk();
      const b = createCognitiveWorkspace({ organizationId: 99999, processId: "2024/0001", workspaceType: "licitacao", title: "x", owner: 7, correlationId: CORR });
      expect(a.id).not.toBe(b.id);
    });

    it("canTransitionStatus valida transições", () => {
      expect(canTransitionStatus("draft", "active")).toBe(true);
      expect(canTransitionStatus("draft", "completed")).toBe(false);
      expect(canTransitionStatus("awaiting_approval", "completed")).toBe(true);
    });

    it("transitionStatus lança em transição inválida", () => {
      expect(() => transitionStatus(mk(), "completed")).toThrow();
    });

    it("advanceStage avança na ordem", () => {
      const ws = advanceStage(mk());
      expect(ws.currentStage).toBe("elaboracao");
    });

    it("addParticipant adiciona sem duplicar", () => {
      const ws = addParticipant(addParticipant(mk(), 9), 9);
      expect(ws.participants.filter(p => p === 9)).toHaveLength(1);
    });

    it("activateCopilot registra copiloto ativo", () => {
      const ws = activateCopilot(mk(), "juridico");
      expect(ws.activeCopilots).toContain("juridico");
    });

    it("isArchived detecta arquivamento", () => {
      const ws = transitionStatus(mk(), "archived");
      expect(isArchived(ws)).toBe(true);
    });
  });

  // ─── Domain: workspaceTask ─────────────────────────────────────────────────

  describe("workspaceTask", () => {
    const mk = (title: string, deps: string[] = []) => createWorkspaceTask({
      workspaceId: WID, organizationId: ORG_ID, taskType: "elaborar_documento",
      title, dependencies: deps, correlationId: CORR,
    });

    it("cria tarefa com id determinístico, status pending", () => {
      const a = mk("Elaborar TR");
      const b = mk("Elaborar TR");
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("pending");
    });

    it("canTransitionTask valida transições", () => {
      expect(canTransitionTask("pending", "in_progress")).toBe(true);
      expect(canTransitionTask("done", "in_progress")).toBe(false);
    });

    it("transitionTask lança em transição inválida", () => {
      const t = mk("t");
      expect(() => transitionTask(t, "done")).toThrow();
    });

    it("isReady respeita dependências", () => {
      const dep = mk("dep");
      const t = mk("t2", [dep.id]);
      expect(isReady(t, new Set())).toBe(false);
      expect(isReady(t, new Set([dep.id]))).toBe(true);
    });

    it("prioritizeTasks ordena por prioridade", () => {
      const low = createWorkspaceTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "generico", title: "low", priority: "baixa", correlationId: CORR });
      const high = createWorkspaceTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "generico", title: "high", priority: "urgente", correlationId: CORR });
      const sorted = prioritizeTasks([low, high]);
      expect(sorted[0].priority).toBe("urgente");
    });

    it("readyQueue retorna apenas prontas, priorizadas", () => {
      const dep = mk("dep");
      const blocked = mk("blocked", [dep.id]);
      const queue = readyQueue([dep, blocked]);
      expect(queue.map(t => t.id)).toContain(dep.id);
      expect(queue.map(t => t.id)).not.toContain(blocked.id);
    });
  });

  // ─── Domain: workspaceTimeline ─────────────────────────────────────────────

  describe("workspaceTimeline", () => {
    it("appendTimeline calcula ordem sequencial", () => {
      let entries = appendTimeline([], { workspaceId: WID, organizationId: ORG_ID, eventType: "workspace_created", actor: "u1", summary: "a", correlationId: CORR });
      entries = appendTimeline(entries, { workspaceId: WID, organizationId: ORG_ID, eventType: "task_created", actor: "u1", summary: "b", correlationId: CORR });
      expect(entries).toHaveLength(2);
      expect(entries[0].order).toBe(0);
      expect(entries[1].order).toBe(1);
    });

    it("timelineSnapshot é determinístico", () => {
      const e = [createTimelineEntry({ workspaceId: WID, organizationId: ORG_ID, order: 0, eventType: "decision", actor: "u1", summary: "s", correlationId: CORR })];
      expect(timelineSnapshot(e)).toBe(timelineSnapshot(e));
      expect(timelineSnapshot(e).length).toBeGreaterThan(0);
    });
  });

  // ─── Domain: workspaceContext ──────────────────────────────────────────────

  describe("workspaceContext", () => {
    it("contextDensity reflete sinais presentes", () => {
      const empty = createWorkspaceContext({ workspaceId: WID, organizationId: ORG_ID, correlationId: CORR });
      expect(contextDensity(empty)).toBe(0);
      const full = createWorkspaceContext({
        workspaceId: WID, organizationId: ORG_ID, correlationId: CORR,
        documents: [{ id: "d1", title: "TR", kind: "tr" }],
        graphNodeIds: ["n1"], evidences: [{ id: "e1", content: "x", source: "rag", relevance: 0.8 }],
        memorySummary: "mem",
      });
      expect(contextDensity(full)).toBe(1);
    });
  });

  // ─── Domain: workspaceDecision ─────────────────────────────────────────────

  describe("workspaceDecision", () => {
    const mk = () => createWorkspaceDecision({
      workspaceId: WID, organizationId: ORG_ID, title: "Homologar item",
      decision: "Prosseguir", justification: "Fundamentado no ETP", responsibleUser: 7, correlationId: CORR,
    });

    it("cria decisão humana registrada", () => {
      const d = mk();
      expect(d.status).toBe("registrada");
      expect(d.responsibleUser).toBe(7);
    });

    it("isValidDecision exige justificativa e conteúdo", () => {
      expect(isValidDecision(mk())).toBe(true);
      const invalid = createWorkspaceDecision({ workspaceId: WID, organizationId: ORG_ID, title: "x", decision: "", justification: "", responsibleUser: 7, correlationId: CORR });
      expect(isValidDecision(invalid)).toBe(false);
    });

    it("approveDecision e rejectDecision atualizam status", () => {
      expect(approveDecision(mk()).status).toBe("aprovada");
      const r = rejectDecision(mk(), "sem cobertura");
      expect(r.status).toBe("rejeitada");
      expect(r.justification).toContain("sem cobertura");
    });
  });

  // ─── Domain: workspaceRisk ─────────────────────────────────────────────────

  describe("workspaceRisk", () => {
    const mk = (cat: "juridico" | "tecnico" = "juridico", sev: "medio" | "alto" = "medio") =>
      createWorkspaceRisk({ workspaceId: WID, organizationId: ORG_ID, category: cat, description: `risco ${cat}`, severity: sev, likelihood: 0.5, correlationId: CORR });

    it("riskExposure combina severidade e probabilidade", () => {
      const r = mk("juridico", "alto");
      expect(riskExposure(r)).toBeCloseTo((3 / 4) * 0.5);
    });

    it("correlateRisks agrupa por categoria", () => {
      const a = createWorkspaceRisk({ workspaceId: WID, organizationId: ORG_ID, category: "juridico", description: "a", correlationId: CORR });
      const b = createWorkspaceRisk({ workspaceId: WID, organizationId: ORG_ID, category: "juridico", description: "b", correlationId: CORR });
      const c = createWorkspaceRisk({ workspaceId: WID, organizationId: ORG_ID, category: "tecnico", description: "c", correlationId: CORR });
      const corr = correlateRisks([a, b, c]);
      expect(corr.get(a.id)).toContain(b.id);
      expect(corr.get(a.id)).not.toContain(c.id);
    });

    it("mitigateRisk muda status", () => {
      expect(mitigateRisk(mk(), "plano").status).toBe("mitigado");
    });

    it("aggregateWorkspaceRisk retorna o maior", () => {
      expect(aggregateWorkspaceRisk([mk("juridico", "medio"), mk("tecnico", "alto")])).toBe("alto");
    });
  });

  // ─── Workflow expansion ────────────────────────────────────────────────────

  describe("aiWorkflow — workspace pipeline", () => {
    it("WORKSPACE_PIPELINE contém etapas do workspace", () => {
      expect(WORKSPACE_PIPELINE).toContain("workspace_lifecycle");
      expect(WORKSPACE_PIPELINE).toContain("multi_agent_coordination");
      expect(WORKSPACE_PIPELINE).toContain("approval_flow");
    });

    it("createWorkspaceFlowStep gera id determinístico", () => {
      const a = createWorkspaceFlowStep({ workspaceId: WID, organizationId: ORG_ID, stepType: "decision_flow", order: 4, correlationId: CORR });
      const b = createWorkspaceFlowStep({ workspaceId: WID, organizationId: ORG_ID, stepType: "decision_flow", order: 4, correlationId: CORR });
      expect(a.id).toBe(b.id);
    });
  });

  // ─── Service: Multi-Copilot Orchestrator ───────────────────────────────────

  describe("workspaceOrchestratorService (Multi-Copilot)", () => {
    it("orchestrateMultiCopilot coordena copilotos e consolida", async () => {
      const result = await orchestrateMultiCopilot({
        organizationId: ORG_ID,
        request: "elaborar termo de referência com fundamentação jurídica e pesquisa de preços",
        correlationId: CORR,
        invoke: async () => "",
      });
      expect(result.selectedCopilots.length).toBeGreaterThanOrEqual(2);
      expect(result.perCopilot.length).toBe(result.selectedCopilots.length);
      expect(result.consolidated.requiresHumanReview).toBe(true);
      expect(result.consolidated.participatingCopilots.length).toBeGreaterThanOrEqual(2);
    });

    it("orchestrateMultiCopilot respeita copilotos explícitos", async () => {
      const result = await orchestrateMultiCopilot({
        organizationId: ORG_ID, request: "qualquer coisa",
        copilotTypes: ["juridico", "planejamento"], correlationId: CORR, invoke: async () => "",
      });
      expect(new Set(result.selectedCopilots)).toEqual(new Set(["juridico", "planejamento"]));
    });

    it("orchestrateMultiCopilot é determinístico (mesma entrada → mesma consolidação)", async () => {
      const a = await orchestrateMultiCopilot({ organizationId: ORG_ID, request: "pregão", copilotTypes: ["pregoeiro", "juridico"], correlationId: CORR, invoke: async () => "" });
      const b = await orchestrateMultiCopilot({ organizationId: ORG_ID, request: "pregão", copilotTypes: ["pregoeiro", "juridico"], correlationId: CORR, invoke: async () => "" });
      expect(a.perCopilot.map(p => p.copilotType)).toEqual(b.perCopilot.map(p => p.copilotType));
      expect(a.consolidated.confidence).toBe(b.consolidated.confidence);
    });

    it("consolidação une base legal e sugestões dos copilotos", async () => {
      const result = await orchestrateMultiCopilot({ organizationId: ORG_ID, request: "fundamentação legal", copilotTypes: ["juridico", "agente_contratacao"], correlationId: CORR, invoke: async () => "" });
      expect(result.consolidated.legalBasis.length).toBeGreaterThan(0);
      expect(result.consolidated.suggestions.length).toBeGreaterThan(0);
    });
  });

  // ─── Service: context ──────────────────────────────────────────────────────

  describe("workspaceContextService", () => {
    it("buildWorkspaceContext agrega RAG + KG (seed)", async () => {
      const ctx = await buildWorkspaceContext({ organizationId: ORG_ID, workspaceId: WID, query: "contratação pública", correlationId: CORR });
      expect(ctx.evidences.length).toBeGreaterThan(0);
      expect(ctx.workspaceId).toBe(WID);
    });
  });

  // ─── Service: task ─────────────────────────────────────────────────────────

  describe("workspaceTaskService", () => {
    it("createTask retorna tarefa (persistência graceful)", async () => {
      const task = await createTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "elaborar_documento", title: "Elaborar TR", correlationId: CORR });
      expect(task.status).toBe("pending");
    });

    it("completeTask leva a done", async () => {
      const task = await createTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "generico", title: "t", correlationId: CORR });
      const done = await completeTask(task);
      expect(done.status).toBe("done");
    });

    it("computeReadyQueue prioriza prontas", async () => {
      const a = await createTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "generico", title: "a", priority: "alta", correlationId: CORR });
      const b = await createTask({ workspaceId: WID, organizationId: ORG_ID, taskType: "generico", title: "b", priority: "baixa", correlationId: CORR });
      const queue = computeReadyQueue([b, a]);
      expect(queue[0].priority).toBe("alta");
    });
  });

  // ─── Service: timeline / decision / risk / collaboration / observability ───

  describe("workspace services", () => {
    it("recordEvent + getTimeline degradam sem DB", async () => {
      const entry = await recordEvent({ organizationId: ORG_ID, workspaceId: WID, eventType: "change", actor: "u1", summary: "x", correlationId: CORR });
      expect(entry.eventType).toBe("change");
      await expect(getTimeline(WID, ORG_ID)).resolves.toEqual([]);
    });

    it("registerDecision valida e retorna decisão", async () => {
      const d = await registerDecision({ workspaceId: WID, organizationId: ORG_ID, title: "t", decision: "prosseguir", justification: "fundamentado", responsibleUser: 7, correlationId: CORR });
      expect(d.status).toBe("registrada");
    });

    it("registerDecision rejeita decisão sem justificativa", async () => {
      await expect(registerDecision({ workspaceId: WID, organizationId: ORG_ID, title: "t", decision: "", justification: "", responsibleUser: 7, correlationId: CORR })).rejects.toThrow();
    });

    it("identifyRisk + analyzeRisks", async () => {
      const r1 = await identifyRisk({ workspaceId: WID, organizationId: ORG_ID, category: "juridico", description: "a", severity: "alto", correlationId: CORR });
      const r2 = await identifyRisk({ workspaceId: WID, organizationId: ORG_ID, category: "juridico", description: "b", severity: "medio", correlationId: CORR });
      const analysis = analyzeRisks([r1, r2]);
      expect(analysis.aggregate).toBe("alto");
      expect(analysis.exposures).toHaveLength(2);
    });

    it("createComment/postComment/delegateTask", async () => {
      const c = createComment({ workspaceId: WID, organizationId: ORG_ID, authorId: 7, body: "comentário", correlationId: CORR });
      expect(c.body).toBe("comentário");
      await expect(postComment({ workspaceId: WID, organizationId: ORG_ID, authorId: 7, body: "x", correlationId: CORR })).resolves.toBeTruthy();
      await expect(delegateTask({ workspaceId: WID, organizationId: ORG_ID, fromUser: 7, toUser: 9, taskId: "t1", correlationId: CORR })).resolves.toMatchObject({ toUser: 9 });
    });

    it("computeFlowSummary identifica gargalo", () => {
      const flow = computeFlowSummary(["blocked", "blocked", "in_progress", "done"]);
      expect(flow.blocked).toBe(2);
      expect(flow.bottleneck).toBe("blocked");
    });

    it("recordProductivity é no-op sem DB", async () => {
      await expect(recordProductivity({ organizationId: ORG_ID, workspaceId: WID, correlationId: CORR, metricName: "m", value: 1 })).resolves.toBeUndefined();
    });
  });

  // ─── Persistence: graceful degradation ─────────────────────────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    it("insertWorkspace null / getWorkspace null / listWorkspaces []", async () => {
      const ws = createCognitiveWorkspace({ organizationId: ORG_ID, processId: "p", workspaceType: "generico", title: "t", owner: 1, correlationId: CORR });
      await expect(insertWorkspace(ws)).resolves.toBeNull();
      await expect(getWorkspace(ws.id, ORG_ID)).resolves.toBeNull();
      await expect(listWorkspaces(ORG_ID)).resolves.toEqual([]);
    });

    it("listWorkspaceTasks / listTimeline retornam [] sem DB", async () => {
      await expect(listWorkspaceTasks(WID, ORG_ID)).resolves.toEqual([]);
      await expect(listTimeline(WID, ORG_ID)).resolves.toEqual([]);
    });

    it("recordWorkspaceMetric no-op sem DB", async () => {
      await expect(recordWorkspaceMetric({ organizationId: ORG_ID, workspaceId: WID, correlationId: CORR, metricName: "m", metricValue: 1 })).resolves.toBeUndefined();
    });
  });
});
