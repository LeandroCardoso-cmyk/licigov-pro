/**
 * Sprint 5.0 — Workspace Router (operational).
 *
 * Ambiente operacional do Departamento de Licitações. Coordena workspace, tarefas,
 * copilotos (multi-copilot orchestrator), decisões, timeline e métricas.
 * tenantProcedure, IDs determinísticos, persistência real, auditabilidade total.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  createCognitiveWorkspace,
  transitionStatus,
  advanceStage,
  activateCopilot,
  type WorkspaceStatus,
} from "../domain/cognitiveWorkspace";
import { ALL_COPILOT_TYPES, type CopilotType } from "../domain/institutionalCopilot";
import { createTask } from "../services/workspaceTaskService";
import { registerDecision } from "../services/workspaceDecisionService";
import { recordEvent } from "../services/workspaceTimelineService";
import { recordTaskCompletion, recordApproval, computeFlowSummary } from "../services/workspaceObservabilityService";
import { orchestrateMultiCopilot } from "../services/workspaceOrchestratorService";
import {
  insertWorkspace,
  getWorkspace,
  updateWorkspace,
  listWorkspaces,
  listWorkspaceTasks,
  updateWorkspaceTaskStatus,
  listTimeline as getTimelineRepo,
  listDecisions,
  updateDecisionStatus,
  listRisks,
} from "../db/workspace";

const COPILOT_TYPES = ALL_COPILOT_TYPES as [CopilotType, ...CopilotType[]];
const WORKSPACE_TYPES = ["licitacao", "contratacao_direta", "contrato", "parecer", "generico"] as const;
const TASK_TYPES = ["elaborar_documento", "revisar_documento", "pesquisar_precos", "fundamentar_juridico", "analisar_risco", "aprovar", "consolidar", "generico"] as const;

async function requireWorkspace(id: string, orgId: number) {
  const ws = await getWorkspace(id, orgId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace não encontrado nesta organização." });
  return ws;
}

export const workspaceRouter = router({
  createWorkspace: tenantProcedure
    .input(z.object({
      processId: z.string().min(1),
      workspaceType: z.enum(WORKSPACE_TYPES),
      title: z.string().min(1),
      participants: z.array(z.number()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = createCognitiveWorkspace({
        organizationId: orgId,
        processId: input.processId,
        workspaceType: input.workspaceType,
        title: input.title,
        owner: ctx.user.id,
        participants: input.participants ?? [ctx.user.id],
        correlationId: ctx.correlationId,
      });
      await insertWorkspace(ws);
      await recordEvent({
        organizationId: orgId, workspaceId: ws.id, eventType: "workspace_created",
        actor: String(ctx.user.id), summary: `Workspace "${ws.title}" criado.`, refId: ws.id,
        correlationId: ctx.correlationId,
      });
      return { workspace: ws };
    }),

  loadWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await getWorkspace(input.workspaceId, orgId);
      if (!workspace) return { workspace: null, tasks: [], timeline: [], decisions: [], risks: [] };
      const [tasks, timeline, decisions, risks] = await Promise.all([
        listWorkspaceTasks(input.workspaceId, orgId),
        getTimelineRepo(input.workspaceId, orgId),
        listDecisions(input.workspaceId, orgId),
        listRisks(input.workspaceId, orgId),
      ]);
      return { workspace, tasks, timeline, decisions, risks };
    }),

  updateWorkspace: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      status: z.enum(["draft", "active", "in_review", "awaiting_approval", "completed", "archived"]).optional(),
      advanceStage: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      let ws = await requireWorkspace(input.workspaceId, orgId);
      if (input.status) ws = transitionStatus(ws, input.status as WorkspaceStatus);
      if (input.advanceStage) ws = advanceStage(ws);
      await updateWorkspace(ws);
      await recordEvent({
        organizationId: orgId, workspaceId: ws.id, eventType: "change",
        actor: String(ctx.user.id), summary: `Workspace atualizado: status=${ws.status}, etapa=${ws.currentStage}.`,
        refId: ws.id, correlationId: ctx.correlationId,
      });
      return { workspace: ws };
    }),

  assignCopilot: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), copilotType: z.enum(COPILOT_TYPES) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      let ws = await requireWorkspace(input.workspaceId, orgId);
      ws = activateCopilot(ws, input.copilotType);
      await updateWorkspace(ws);
      await recordEvent({
        organizationId: orgId, workspaceId: ws.id, eventType: "copilot_activated",
        actor: String(ctx.user.id), summary: `Copiloto ${input.copilotType} ativado.`, refId: input.copilotType,
        correlationId: ctx.correlationId,
      });
      return { workspace: ws };
    }),

  orchestrate: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      request: z.string().min(1),
      copilotTypes: z.array(z.enum(COPILOT_TYPES)).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const result = await orchestrateMultiCopilot({
        organizationId: orgId, request: input.request,
        copilotTypes: input.copilotTypes, correlationId: ctx.correlationId,
      });
      await recordEvent({
        organizationId: orgId, workspaceId: input.workspaceId, eventType: "recommendation",
        actor: "multi_copilot",
        summary: `Recomendação consolidada de ${result.selectedCopilots.length} copiloto(s).`,
        refId: input.workspaceId, correlationId: ctx.correlationId,
      });
      return result;
    }),

  createTask: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      taskType: z.enum(TASK_TYPES),
      title: z.string().min(1),
      assignedCopilot: z.enum(COPILOT_TYPES).optional(),
      assignedUser: z.number().optional(),
      priority: z.enum(["baixa", "media", "alta", "urgente"]).optional(),
      dependencies: z.array(z.string()).optional(),
      approvalRequired: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const task = await createTask({ ...input, organizationId: orgId, correlationId: ctx.correlationId });
      await recordEvent({
        organizationId: orgId, workspaceId: input.workspaceId, eventType: "task_created",
        actor: String(ctx.user.id), summary: `Tarefa "${task.title}" criada.`, refId: task.id,
        correlationId: ctx.correlationId,
      });
      return { task };
    }),

  concludeTask: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), taskId: z.string().min(1), taskType: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      await updateWorkspaceTaskStatus(input.taskId, orgId, "done", new Date().toISOString());
      await recordEvent({
        organizationId: orgId, workspaceId: input.workspaceId, eventType: "task_completed",
        actor: String(ctx.user.id), summary: `Tarefa ${input.taskId} concluída.`, refId: input.taskId,
        correlationId: ctx.correlationId,
      });
      await recordTaskCompletion({ organizationId: orgId, workspaceId: input.workspaceId, correlationId: ctx.correlationId, taskType: input.taskType ?? "generico" });
      return { success: true, taskId: input.taskId, status: "done" as const };
    }),

  createDecision: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      title: z.string().min(1),
      decision: z.string().min(1),
      justification: z.string().min(1),
      evidenceIds: z.array(z.string()).optional(),
      involvedCopilots: z.array(z.enum(COPILOT_TYPES)).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const decision = await registerDecision({
        ...input, organizationId: orgId, responsibleUser: ctx.user.id, correlationId: ctx.correlationId,
      });
      await recordEvent({
        organizationId: orgId, workspaceId: input.workspaceId, eventType: "decision",
        actor: String(ctx.user.id), summary: `Decisão registrada: ${decision.title}.`, refId: decision.id,
        correlationId: ctx.correlationId,
      });
      return { decision };
    }),

  approveDecision: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), decisionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      await updateDecisionStatus(input.decisionId, orgId, "aprovada", "aprovada");
      await recordEvent({
        organizationId: orgId, workspaceId: input.workspaceId, eventType: "approval",
        actor: String(ctx.user.id), summary: `Decisão ${input.decisionId} aprovada.`, refId: input.decisionId,
        correlationId: ctx.correlationId,
      });
      await recordApproval({ organizationId: orgId, workspaceId: input.workspaceId, correlationId: ctx.correlationId });
      return { success: true, decisionId: input.decisionId, status: "aprovada" as const };
    }),

  getTimeline: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const timeline = await getTimelineRepo(input.workspaceId, orgId);
      return { timeline, total: timeline.length };
    }),

  getMetrics: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const tasks = await listWorkspaceTasks(input.workspaceId, orgId);
      const flow = computeFlowSummary(tasks.map(t => t.status));
      return { taskCount: tasks.length, flow };
    }),

  listWorkspaces: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspaces = await listWorkspaces(orgId, input.limit ?? 50);
      return { workspaces, total: workspaces.length };
    }),
});
