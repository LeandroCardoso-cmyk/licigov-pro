import { getDb } from "../db/connection";
import { activityLogs } from "../../drizzle/schema";

export type ActivityLogPayload = {
  organizationId?: number;
  processId: number;
  userId: number;
  actorName?: string;
  action: string;
  entityType?: string;
  entityId?: number;
  correlationId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

/**
 * Registra uma entrada estruturada no activity_log.
 * Falhas silenciosas: auditoria nunca pode quebrar o fluxo principal.
 */
export async function logActivity(payload: ActivityLogPayload): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(activityLogs).values({
      organizationId: payload.organizationId ?? null,
      processId: payload.processId,
      userId: payload.userId,
      actorName: payload.actorName ?? null,
      action: payload.action,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      correlationId: payload.correlationId ?? null,
      requestId: payload.requestId ?? null,
      details: payload.details ? JSON.stringify(payload.details) : null,
    });
  } catch (err) {
    // Auditoria falha silenciosamente — nunca propagar erro
    console.error("[ActivityLog] Falha ao registrar atividade:", err);
  }
}

/**
 * Versão conveniente que extrai contexto do tRPC context.
 */
export type TrpcAuditCtx = {
  organizationId: number | null;
  user: { id: number; name?: string | null };
  correlationId: string;
  requestId: string;
};

export async function logFromCtx(
  ctx: TrpcAuditCtx,
  processId: number,
  action: string,
  extras?: {
    entityType?: string;
    entityId?: number;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await logActivity({
    organizationId: ctx.organizationId ?? undefined,
    processId,
    userId: ctx.user.id,
    actorName: ctx.user.name ?? undefined,
    action,
    entityType: extras?.entityType,
    entityId: extras?.entityId,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    details: extras?.details,
  });
}
