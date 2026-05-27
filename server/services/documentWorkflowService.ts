/**
 * Sprint 2 — Document Workflow Service.
 *
 * State machine oficial do workflow documental.
 * Valida transições, papéis e gera audit trail completo.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents } from "../../drizzle/schema";
import { appendOutboxEvent } from "./outboxService";
import { logActivity } from "./activityLogService";
import { addTimelineEvent } from "./documentTimelineService";
import { createVersion } from "./documentVersionService";
import { serviceLogger } from "./observabilityService";
import {
  isValidTransition,
  WORKFLOW_ROLE_REQUIREMENTS,
} from "../domain/documentTypes";
import {
  DOCUMENT_EVENT_TYPES,
  type WorkflowAlteradoPayload,
} from "../domain/documentEvents";
import { createDomainEvent } from "../domain/events";
import type { DocumentStatusValue } from "../domain/documentTypes";
import type { TrpcAuditCtx } from "./activityLogService";
import type { OrgRole } from "../../drizzle/schema";

const log = serviceLogger("DocumentWorkflowService");

const ORG_ROLE_WEIGHT: Record<OrgRole, number> = {
  viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5,
};

function hasMinRole(ctx: TrpcAuditCtx, minRole: OrgRole): boolean {
  const actorRole = ctx.orgMembership?.role ?? "viewer";
  return (ORG_ROLE_WEIGHT[actorRole] ?? 0) >= ORG_ROLE_WEIGHT[minRole];
}

async function getDocumentOrThrow(documentId: number, orgId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  }
  return { db, doc: rows[0] };
}

async function applyTransition(
  documentId:  number,
  toState:     DocumentStatusValue,
  reason:      string | null,
  ctx:         TrpcAuditCtx,
  extras?:     Partial<typeof documents.$inferInsert>,
): Promise<typeof documents.$inferSelect> {
  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const { db, doc } = await getDocumentOrThrow(documentId, orgId);
  const fromState = doc.documentStatus as DocumentStatusValue;

  if (!isValidTransition(fromState, toState)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Transição inválida: ${fromState} → ${toState}.`,
    });
  }

  const requiredRole = WORKFLOW_ROLE_REQUIREMENTS[toState] as OrgRole | undefined;
  if (requiredRole && !hasMinRole(ctx, requiredRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Papel insuficiente para esta transição. Requer: ${requiredRole}.`,
    });
  }

  await db.update(documents).set({
    documentStatus: toState,
    version:        doc.version + 1,
    updatedBy:      ctx.user.id,
    ...(toState === "approved" ? { approvedBy: ctx.user.id } : {}),
    ...(toState === "archived" ? { archivedAt: new Date() } : {}),
    ...extras,
  }).where(eq(documents.id, documentId));

  // Snapshot de versão para workflow transitions
  const newVersion = await createVersion({
    documentId,
    organizationId:  orgId,
    contentSnapshot: doc.content,
    changeReason:    reason ?? `Workflow: ${fromState} → ${toState}`,
    sourceContext:   "workflow",
    workflowSnapshot: { fromState, toState, reason: reason ?? undefined, timestamp: new Date().toISOString() },
    correlationId:   ctx.correlationId,
    requestId:       ctx.requestId,
  }, ctx);

  // Timeline
  await addTimelineEvent({
    organizationId: orgId,
    documentId,
    eventType:      "workflow_alterado",
    ctx,
    versionId:      newVersion.id,
    fromState,
    toState,
    details:        reason ? { reason } : undefined,
  });

  // Outbox event
  const eventPayload: WorkflowAlteradoPayload = {
    documentId,
    processId:  doc.processId,
    fromState,
    toState,
    reason,
    actorId:    ctx.user.id,
  };

  await appendOutboxEvent({
    organizationId: orgId,
    eventType:      DOCUMENT_EVENT_TYPES.WORKFLOW_ALTERADO,
    aggregateType:  "Document",
    aggregateId:    String(documentId),
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    actorId:        ctx.user.id,
    actorName:      ctx.user.name ?? undefined,
    payload:        eventPayload,
  });

  // Activity log
  await logActivity({
    organizationId: orgId,
    processId:      doc.processId,
    userId:         ctx.user.id,
    actorName:      ctx.user.name      ?? undefined,
    actorEmail:     ctx.user.email     ?? undefined,
    actorRole:      ctx.orgMembership?.role ?? undefined,
    orgName:        ctx.orgName        ?? undefined,
    sourceContext:  "api",
    action:         `workflow_${toState}`,
    entityType:     "document",
    entityId:       documentId,
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    details:        { fromState, toState, reason },
  });

  log.info("workflow_transition", { documentId, fromState, toState, organizationId: orgId });

  const updated = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return updated[0];
}

// ─── Public transition functions ──────────────────────────────────────────────

/** Submete para revisão: draft → in_review */
export async function submitForReview(
  documentId: number,
  notes:      string | null,
  ctx:        TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  return applyTransition(documentId, "in_review", notes, ctx);
}

/** Aprova o documento: in_review → approved */
export async function approveDocumento(
  documentId: number,
  notes:      string | null,
  ctx:        TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  return applyTransition(documentId, "approved", notes, ctx);
}

/** Rejeita o documento: in_review → rejected */
export async function rejectDocumento(
  documentId: number,
  reason:     string,
  ctx:        TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  return applyTransition(documentId, "rejected", reason, ctx);
}

/** Retorna ao rascunho: rejected → draft */
export async function returnToDraft(
  documentId: number,
  reason:     string | null,
  ctx:        TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  return applyTransition(documentId, "draft", reason, ctx);
}

/** Arquiva o documento (terminal): qualquer estado → archived */
export async function archiveDocumento(
  documentId: number,
  reason:     string | null,
  ctx:        TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  return applyTransition(documentId, "archived", reason, ctx);
}
