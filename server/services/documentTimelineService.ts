/**
 * Sprint 2 — Document Timeline Service.
 * Registro cronológico imutável de todos os eventos de um documento.
 * Falha silenciosa: nunca bloqueia o fluxo principal.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db/connection";
import { documentTimeline } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { buildPaginatedResult, normalizePagination, calculateOffset } from "../db/queryStrategy";
import type { PaginatedResult } from "../db/queryStrategy";
import type { DocumentTimelineEventType } from "../domain/documentTypes";
import type { TrpcAuditCtx } from "./activityLogService";

const log = serviceLogger("DocumentTimelineService");

export interface TimelineEventParams {
  organizationId: number;
  documentId: number;
  eventType: DocumentTimelineEventType;
  ctx: TrpcAuditCtx;
  versionId?: number;
  fromState?: string;
  toState?: string;
  details?: Record<string, unknown>;
}

/**
 * Registra um evento na timeline do documento.
 * Falha silenciosa — timeline nunca deve bloquear operações.
 */
export async function addTimelineEvent(params: TimelineEventParams): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const ip =
      (params.ctx.req as { ip?: string } | undefined)?.ip ??
      (params.ctx.req as { socket?: { remoteAddress?: string } } | undefined)?.socket?.remoteAddress ??
      undefined;

    await db.insert(documentTimeline).values({
      organizationId: params.organizationId,
      documentId:     params.documentId,
      eventType:      params.eventType,
      actorId:        params.ctx.user.id,
      actorName:      params.ctx.user.name   ?? null,
      actorEmail:     params.ctx.user.email  ?? null,
      actorRole:      params.ctx.orgMembership?.role ?? null,
      versionId:      params.versionId  ?? null,
      fromState:      params.fromState  ?? null,
      toState:        params.toState    ?? null,
      details:        params.details ? { ...params.details, ip } : (ip ? { ip } : null),
      correlationId:  params.ctx.correlationId,
      requestId:      params.ctx.requestId,
    });

    log.debug("timeline_event_added", {
      eventType:      params.eventType,
      documentId:     params.documentId,
      organizationId: params.organizationId,
    });
  } catch (err) {
    log.error("timeline_event_failed", {
      eventType:  params.eventType,
      documentId: params.documentId,
      error:      err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Retorna a timeline completa de um documento, ordenada por occurredAt desc.
 */
export async function getDocumentTimeline(
  documentId: number,
  organizationId: number,
): Promise<(typeof documentTimeline.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(documentTimeline)
    .where(and(
      eq(documentTimeline.documentId,     documentId),
      eq(documentTimeline.organizationId, organizationId),
    ))
    .orderBy(desc(documentTimeline.occurredAt));
}

/**
 * Timeline paginada.
 */
export async function paginateDocumentTimeline(
  documentId:     number,
  organizationId: number,
  page:           number,
  pageSize:       number,
): Promise<PaginatedResult<typeof documentTimeline.$inferSelect>> {
  const db = await getDb();
  if (!db) return buildPaginatedResult([], 0, normalizePagination({ page, pageSize }));

  const params = normalizePagination({ page, pageSize });
  const offset = calculateOffset(params);

  const rows = await db
    .select()
    .from(documentTimeline)
    .where(and(
      eq(documentTimeline.documentId,     documentId),
      eq(documentTimeline.organizationId, organizationId),
    ))
    .orderBy(desc(documentTimeline.occurredAt))
    .limit(params.pageSize)
    .offset(offset);

  // total count
  const countRows = await db
    .select()
    .from(documentTimeline)
    .where(and(
      eq(documentTimeline.documentId,     documentId),
      eq(documentTimeline.organizationId, organizationId),
    ));

  return buildPaginatedResult(rows, countRows.length, params);
}
