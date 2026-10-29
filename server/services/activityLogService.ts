import { getDb } from "../db/connection";
import { activityLogs } from "../../drizzle/schema";
import type { OrgRole } from "../../drizzle/schema";

export type ActivityLogPayload = {
  organizationId?: number;
  processId?: number;
  userId: number;
  // Sprint 1.5 — snapshots imutáveis
  actorName?: string;
  actorEmail?: string;
  actorRole?: string;
  orgName?: string;
  sourceContext?: "api" | "job" | "system" | "test" | "webhook";
  ipAddress?: string;
  action: string;
  entityType?: string;
  entityId?: number;
  correlationId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

/**
 * Registra entrada estruturada no activity_log.
 * Falha silenciosa: auditoria nunca pode quebrar o fluxo principal.
 */
export async function logActivity(payload: ActivityLogPayload): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(activityLogs).values({
      organizationId: payload.organizationId ?? null,
      processId: payload.processId ?? null,
      userId: payload.userId,
      actorName: payload.actorName ?? null,
      actorEmail: payload.actorEmail ?? null,
      actorRole: payload.actorRole ?? null,
      orgName: payload.orgName ?? null,
      sourceContext: payload.sourceContext ?? "api",
      ipAddress: payload.ipAddress ?? null,
      action: payload.action,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      correlationId: payload.correlationId ?? null,
      requestId: payload.requestId ?? null,
      details: payload.details ? JSON.stringify(payload.details) : null,
    });
  } catch (err) {
    console.error("[ActivityLog] Falha ao registrar atividade:", err);
  }
}

/** SECURITY-02 — rótulo do acesso técnico de plataforma no activity log (não é papel do órgão). */
export const PLATFORM_ADMIN_ACTOR_ROLE = "platform_admin";

export type TrpcAuditCtx = {
  organizationId: number | null;
  user: { id: number; name?: string | null; email?: string | null };
  correlationId: string;
  requestId: string;
  orgMembership?: { role: OrgRole } | null;
  /** SECURITY-02 — acesso técnico do admin de plataforma (projeção sintética): nunca registrar como papel do órgão. */
  platformAdminAccess?: boolean;
  orgName?: string | null;
  req?: { ip?: string; socket?: { remoteAddress?: string } };
};

/**
 * Versão conveniente que extrai contexto do tRPC context.
 * Captura snapshots automáticos de actorEmail, actorRole e orgName.
 */
export async function logFromCtx(
  ctx: TrpcAuditCtx,
  processIdOrNull: number | null,
  action: string,
  extras?: {
    entityType?: string;
    entityId?: number;
    details?: Record<string, unknown>;
    sourceContext?: "api" | "job" | "system" | "test" | "webhook";
  },
): Promise<void> {
  const ip =
    (ctx.req as { ip?: string } | undefined)?.ip ??
    (ctx.req as { socket?: { remoteAddress?: string } } | undefined)?.socket?.remoteAddress ??
    undefined;

  await logActivity({
    organizationId: ctx.organizationId ?? undefined,
    processId: processIdOrNull ?? undefined,
    userId: ctx.user.id,
    actorName: ctx.user.name ?? undefined,
    actorEmail: ctx.user.email ?? undefined,
    actorRole: ctx.platformAdminAccess ? PLATFORM_ADMIN_ACTOR_ROLE : ctx.orgMembership?.role ?? undefined,
    orgName: ctx.orgName ?? undefined,
    sourceContext: extras?.sourceContext ?? "api",
    ipAddress: ip,
    action,
    entityType: extras?.entityType,
    entityId: extras?.entityId,
    correlationId: ctx.correlationId,
    requestId: ctx.requestId,
    details: extras?.details,
  });
}
