/**
 * Sprint 5.0 — Workspace Governance Router (operational).
 *
 * Governança, auditoria e supervisão do Workspace: participantes, configuração,
 * exportações, replay determinístico, validação e arquivamento. tenantProcedure.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { router, tenantProcedure } from "../_core/trpc";
import { addParticipant, transitionStatus } from "../domain/cognitiveWorkspace";
import { recordEvent } from "../services/workspaceTimelineService";
import {
  getWorkspace,
  updateWorkspace,
  listTimeline as getTimelineRepo,
  listDecisions,
  listRisks,
  listWorkspaceTasks,
} from "../db/workspace";

async function requireWorkspace(id: string, orgId: number) {
  const ws = await getWorkspace(id, orgId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace não encontrado nesta organização." });
  return ws;
}

/** Snapshot determinístico da timeline persistida (para replay/auditoria). */
function replaySnapshotFromTimeline(entries: Array<{ order: number; eventType: string; actor: string; refId: string }>): string {
  const canonical = entries.map(e => `${e.order}:${e.eventType}:${e.actor}:${e.refId}`);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

export const workspaceGovernanceRouter = router({
  assignParticipants: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), userIds: z.array(z.number()).min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      let ws = await requireWorkspace(input.workspaceId, orgId);
      for (const uid of input.userIds) ws = addParticipant(ws, uid);
      await updateWorkspace(ws);
      await recordEvent({
        organizationId: orgId, workspaceId: ws.id, eventType: "change",
        actor: String(ctx.user.id), summary: `Participantes atribuídos: ${input.userIds.join(", ")}.`,
        refId: ws.id, correlationId: ctx.correlationId,
      });
      return { workspace: ws };
    }),

  configureWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), title: z.string().min(1).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWorkspace(input.workspaceId, orgId);
      const updated = { ...ws, title: input.title ?? ws.title, updatedAt: new Date().toISOString() };
      await updateWorkspace(updated);
      return { workspace: updated };
    }),

  exportAudit: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await requireWorkspace(input.workspaceId, orgId);
      const [timeline, decisions, risks, tasks] = await Promise.all([
        getTimelineRepo(input.workspaceId, orgId),
        listDecisions(input.workspaceId, orgId),
        listRisks(input.workspaceId, orgId),
        listWorkspaceTasks(input.workspaceId, orgId),
      ]);
      return { audit: { workspace, timeline, decisions, risks, tasks, exportedBy: ctx.user.id } };
    }),

  exportTimeline: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const timeline = await getTimelineRepo(input.workspaceId, orgId);
      return { timeline, snapshot: replaySnapshotFromTimeline(timeline) };
    }),

  exportWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await requireWorkspace(input.workspaceId, orgId);
      const [timeline, decisions, risks, tasks] = await Promise.all([
        getTimelineRepo(input.workspaceId, orgId),
        listDecisions(input.workspaceId, orgId),
        listRisks(input.workspaceId, orgId),
        listWorkspaceTasks(input.workspaceId, orgId),
      ]);
      return { format: "json" as const, export: { workspace, timeline, decisions, risks, tasks } };
    }),

  replayWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const timeline = await getTimelineRepo(input.workspaceId, orgId);
      // A timeline é append-only e ordenada; a ordem deve ser sequencial (0..n-1).
      const sequential = timeline.every((e, i) => e.order === i);
      return {
        replayable: sequential,
        snapshot: replaySnapshotFromTimeline(timeline),
        eventCount: timeline.length,
      };
    }),

  validateWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWorkspace(input.workspaceId, orgId);
      const violations: string[] = [];
      if (ws.owner <= 0) violations.push("Workspace sem owner válido.");
      if (!ws.participants.includes(ws.owner)) violations.push("Owner não consta na lista de participantes.");
      if (ws.organizationId !== orgId) violations.push("Inconsistência de tenant.");
      return { valid: violations.length === 0, violations };
    }),

  archiveWorkspace: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      let ws = await requireWorkspace(input.workspaceId, orgId);
      ws = transitionStatus(ws, "archived");
      await updateWorkspace(ws);
      await recordEvent({
        organizationId: orgId, workspaceId: ws.id, eventType: "change",
        actor: String(ctx.user.id), summary: "Workspace arquivado.", refId: ws.id,
        correlationId: ctx.correlationId,
      });
      return { success: true, workspaceId: ws.id, status: "archived" as const };
    }),
});
