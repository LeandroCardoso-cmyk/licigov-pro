/**
 * Sprint 2 — DocumentoLicitatorio Core Service.
 *
 * Aggregate root do core documental: CRUD, locking e export foundation.
 * Toda operação é tenant-safe, auditável e versionada.
 */
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { appendOutboxEvent } from "./outboxService";
import { logActivity } from "./activityLogService";
import { addTimelineEvent } from "./documentTimelineService";
import { createVersion } from "./documentVersionService";
import { assertVersion, nextVersion } from "../domain/locking";
import {
  DOCUMENT_EVENT_TYPES,
  type DocumentoCriadoPayload,
  type DocumentoAtualizadoPayload,
} from "../domain/documentEvents";
import type {
  DocumentTypeValue,
  StructuredDocumentContent,
  DocumentMetadataFields,
} from "../domain/documentTypes";
import type { TrpcAuditCtx } from "./activityLogService";
import { buildPaginatedResult, normalizePagination, calculateOffset } from "../db/queryStrategy";
import type { PaginatedResult } from "../db/queryStrategy";

const log = serviceLogger("DocumentService");

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateDocumentoParams {
  processId:         number;
  documentType:      DocumentTypeValue;
  title?:            string | null;
  content?:          string | null;
  structuredContent?: StructuredDocumentContent | null;
  sourceType?:       "ai" | "upload";
  metadata?:         DocumentMetadataFields | null;
}

export async function createDocumento(
  params: CreateDocumentoParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const [inserted] = await db.insert(documents).values({
    organizationId:   orgId,
    processId:        params.processId,
    type:             params.documentType,
    title:            params.title            ?? null,
    content:          params.content          ?? null,
    structuredContent: params.structuredContent ?? null,
    sourceType:       params.sourceType       ?? "ai",
    version:          1,
    createdBy:        ctx.user.id,
    updatedBy:        ctx.user.id,
    documentStatus:   "draft",
    metadata:         params.metadata         ?? null,
    isLocked:         0,
  }).$returningId();

  // Primeira versão
  const firstVersion = await createVersion({
    documentId:         inserted.id,
    organizationId:     orgId,
    contentSnapshot:    params.content          ?? null,
    structuredSnapshot: params.structuredContent ?? null,
    changeReason:       "Criação do documento",
    sourceContext:      "manual",
    correlationId:      ctx.correlationId,
    requestId:          ctx.requestId,
  }, ctx);

  // Atualiza currentVersionId
  await db.update(documents).set({ currentVersionId: firstVersion.id }).where(eq(documents.id, inserted.id));

  // Timeline
  await addTimelineEvent({
    organizationId: orgId,
    documentId:     inserted.id,
    eventType:      "documento_criado",
    ctx,
    versionId:      firstVersion.id,
    toState:        "draft",
  });

  // Outbox
  const criadoPayload: DocumentoCriadoPayload = {
    documentId:   inserted.id,
    processId:    params.processId,
    documentType: params.documentType,
    title:        params.title ?? null,
    createdBy:    ctx.user.id,
  };

  await appendOutboxEvent({
    organizationId: orgId,
    eventType:      DOCUMENT_EVENT_TYPES.DOCUMENTO_CRIADO,
    aggregateType:  "Document",
    aggregateId:    String(inserted.id),
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    actorId:        ctx.user.id,
    actorName:      ctx.user.name ?? undefined,
    payload:        criadoPayload as unknown as Record<string, unknown>,
  });

  // Activity log
  await logActivity({
    organizationId: orgId,
    processId:      params.processId,
    userId:         ctx.user.id,
    actorName:      ctx.user.name  ?? undefined,
    actorEmail:     ctx.user.email ?? undefined,
    actorRole:      ctx.orgMembership?.role ?? undefined,
    orgName:        ctx.orgName ?? undefined,
    sourceContext:  "api",
    action:         "document_created",
    entityType:     "document",
    entityId:       inserted.id,
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    details:        { documentType: params.documentType, title: params.title },
  });

  log.info("document_created", { documentId: inserted.id, type: params.documentType, orgId });

  const created = await db.select().from(documents).where(eq(documents.id, inserted.id)).limit(1);
  return created[0];
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getDocumentoById(
  id:             number,
  organizationId: number,
): Promise<typeof documents.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function listDocumentosByProcess(
  processId:      number,
  organizationId: number,
): Promise<(typeof documents.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(documents)
    .where(and(
      eq(documents.processId,     processId),
      eq(documents.organizationId, organizationId),
      isNull(documents.archivedAt),
    ));
}

export async function paginateDocumentos(
  organizationId: number,
  page:           number,
  pageSize:       number,
): Promise<PaginatedResult<typeof documents.$inferSelect>> {
  const db = await getDb();
  const params = normalizePagination({ page, pageSize });
  if (!db) return buildPaginatedResult([], 0, params);

  const offset = calculateOffset(params);
  const rows   = await db
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), isNull(documents.archivedAt)))
    .limit(params.pageSize)
    .offset(offset);

  const total = await db
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), isNull(documents.archivedAt)));

  return buildPaginatedResult(rows, total.length, params);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface UpdateDocumentoParams {
  title?:             string | null;
  content?:           string | null;
  structuredContent?: StructuredDocumentContent | null;
  metadata?:          DocumentMetadataFields | null;
  changeReason?:      string | null;
}

export async function updateDocumento(
  id:              number,
  params:          UpdateDocumentoParams,
  expectedVersion: number,
  ctx:             TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, orgId)))
    .limit(1);

  if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = rows[0];

  // Verifica lock ativo
  if (doc.isLocked && doc.lockedBy !== ctx.user.id) {
    if (!doc.lockExpiresAt || doc.lockExpiresAt > new Date()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Documento bloqueado por outro usuário. ${doc.lockReason ?? ""}`.trim(),
      });
    }
  }

  assertVersion(expectedVersion, doc.version, "Document", id);

  const changedFields = Object.keys(params).filter(k => params[k as keyof UpdateDocumentoParams] !== undefined);

  await db.update(documents).set({
    title:             params.title             !== undefined ? params.title             : doc.title,
    content:           params.content           !== undefined ? params.content           : doc.content,
    structuredContent: params.structuredContent !== undefined ? params.structuredContent : doc.structuredContent,
    metadata:          params.metadata          !== undefined ? params.metadata          : doc.metadata,
    version:           nextVersion(doc.version),
    updatedBy:         ctx.user.id,
  }).where(eq(documents.id, id));

  // Cria versão
  const newVersion = await createVersion({
    documentId:         id,
    organizationId:     orgId,
    contentSnapshot:    params.content           ?? doc.content,
    structuredSnapshot: (params.structuredContent ?? doc.structuredContent) as StructuredDocumentContent | null,
    changeReason:       params.changeReason ?? "Atualização manual",
    sourceContext:      "manual",
    correlationId:      ctx.correlationId,
    requestId:          ctx.requestId,
  }, ctx);

  await db.update(documents).set({ currentVersionId: newVersion.id }).where(eq(documents.id, id));

  // Timeline
  await addTimelineEvent({
    organizationId: orgId,
    documentId:     id,
    eventType:      "documento_editado",
    ctx,
    versionId:      newVersion.id,
    details:        { changedFields, changeReason: params.changeReason },
  });

  // Outbox
  const atualizadoPayload: DocumentoAtualizadoPayload = {
    documentId:   id,
    processId:    doc.processId,
    newVersion:   nextVersion(doc.version),
    changedFields,
    title:        params.title ?? doc.title,
  };

  await appendOutboxEvent({
    organizationId: orgId,
    eventType:      DOCUMENT_EVENT_TYPES.DOCUMENTO_ATUALIZADO,
    aggregateType:  "Document",
    aggregateId:    String(id),
    correlationId:  ctx.correlationId,
    actorId:        ctx.user.id,
    actorName:      ctx.user.name ?? undefined,
    payload:        atualizadoPayload as unknown as Record<string, unknown>,
  });

  // Activity log
  await logActivity({
    organizationId: orgId,
    processId:      doc.processId,
    userId:         ctx.user.id,
    actorName:      ctx.user.name  ?? undefined,
    actorEmail:     ctx.user.email ?? undefined,
    actorRole:      ctx.orgMembership?.role ?? undefined,
    orgName:        ctx.orgName ?? undefined,
    action:         "document_updated",
    entityType:     "document",
    entityId:       id,
    correlationId:  ctx.correlationId,
    details:        { changedFields },
  });

  const updated = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return updated[0];
}

// ─── Edit Lock ────────────────────────────────────────────────────────────────

export async function lockDocumento(
  id:          number,
  reason:      string | null,
  ttlMinutes:  number,
  ctx:         TrpcAuditCtx,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const orgId = ctx.organizationId;
  if (!orgId) return;

  const lockExpiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await db.update(documents).set({
    isLocked:      1,
    lockedBy:      ctx.user.id,
    lockReason:    reason,
    lockExpiresAt,
  }).where(and(eq(documents.id, id), eq(documents.organizationId, orgId)));

  await addTimelineEvent({
    organizationId: orgId,
    documentId:     id,
    eventType:      "documento_bloqueado",
    ctx,
    details:        { reason, ttlMinutes },
  });

  log.info("document_locked", { documentId: id, lockedBy: ctx.user.id, ttlMinutes });
}

export async function unlockDocumento(
  id:  number,
  ctx: TrpcAuditCtx,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const orgId = ctx.organizationId;
  if (!orgId) return;

  await db.update(documents).set({
    isLocked:      0,
    lockedBy:      null,
    lockReason:    null,
    lockExpiresAt: null,
  }).where(and(eq(documents.id, id), eq(documents.organizationId, orgId)));

  await addTimelineEvent({
    organizationId: orgId,
    documentId:     id,
    eventType:      "documento_desbloqueado",
    ctx,
  });

  log.info("document_unlocked", { documentId: id, unlockedBy: ctx.user.id });
}

// ─── Export Foundation ────────────────────────────────────────────────────────

import type { ExportResult, ExportPipelineOptions } from "../domain/documentTypes";
import { buildExportFilename } from "../domain/documentTypes";

/**
 * Sprint 2 foundation — exportação HTML básica.
 * DOCX e PDF serão implementados na Sprint 3.
 */
export async function exportDocumentToHtml(
  documentId: number,
  orgId:      number,
  options?:   Partial<ExportPipelineOptions>,
): Promise<ExportResult> {
  const doc = await getDocumentoById(documentId, orgId);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const title   = doc.title ?? `Documento ${doc.type.toUpperCase()} #${doc.id}`;
  const body    = doc.content ?? "(sem conteúdo)";
  const content = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px}
  h1{color:#1a365d}pre{white-space:pre-wrap}</style>
</head>
<body>
  <h1>${title}</h1>
  <pre>${body.replace(/</g, "&lt;")}</pre>
</body>
</html>`;

  return {
    format:      "html",
    content,
    mimeType:    "text/html; charset=utf-8",
    filename:    buildExportFilename(doc.type as DocumentTypeValue, title, "html"),
    generatedAt: new Date(),
  };
}
