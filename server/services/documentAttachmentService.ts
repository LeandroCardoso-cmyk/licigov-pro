/**
 * Sprint 2.5 — Document Attachment Service.
 *
 * Lifecycle completo de anexos documentais: registro, listagem,
 * soft delete, verificação de integridade e audit trail.
 *
 * Tenant-safe: toda operação valida organizationId.
 * Storage-agnostic: storageKey aponta para S3/GCS/local — adapter externo.
 */
import { eq, and, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { getDb } from "../db/connection";
import { documentAttachments } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { logActivity } from "./activityLogService";
import { addTimelineEvent } from "./documentTimelineService";
import type { TrpcAuditCtx } from "./activityLogService";

const log = serviceLogger("DocumentAttachmentService");

export type ScanStatus = "pending" | "clean" | "infected" | "error";

export interface RegisterAttachmentParams {
  documentId:       number;
  versionId?:       number | null;
  filename:         string;
  originalFilename: string;
  mimeType:         string;
  fileSize:         number;
  storageKey:       string;
  fileBuffer?:      Buffer; // quando disponível, computa hash imediatamente
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function registerAttachment(
  params: RegisterAttachmentParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof documentAttachments.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const contentHash = params.fileBuffer
    ? createHash("sha256").update(params.fileBuffer).digest("hex")
    : null;

  const [inserted] = await db.insert(documentAttachments).values({
    organizationId:   orgId,
    documentId:       params.documentId,
    versionId:        params.versionId ?? null,
    filename:         params.filename,
    originalFilename: params.originalFilename,
    mimeType:         params.mimeType,
    fileSize:         params.fileSize,
    storageKey:       params.storageKey,
    contentHash,
    scanStatus:       "pending",
    uploadedBy:       ctx.user.id,
  }).$returningId();

  // Timeline e audit — silent fail
  try {
    await addTimelineEvent({
      organizationId: orgId,
      documentId:     params.documentId,
      eventType:      "anexo_adicionado",
      ctx,
      details: {
        filename:  params.filename,
        mimeType:  params.mimeType,
        fileSize:  params.fileSize,
        hasSha256: !!contentHash,
      },
    });
  } catch { /* silent */ }

  await logActivity({
    organizationId: orgId,
    userId:         ctx.user.id,
    actorName:      ctx.user.name   ?? undefined,
    actorEmail:     ctx.user.email  ?? undefined,
    actorRole:      ctx.orgMembership?.role ?? undefined,
    sourceContext:  "api",
    action:         "attachment_register",
    entityType:     "document_attachment",
    entityId:       inserted.id,
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    details:        { documentId: params.documentId, filename: params.filename },
  });

  log.info("attachment_registered", {
    attachmentId: inserted.id,
    documentId:   params.documentId,
    mimeType:     params.mimeType,
    orgId,
  });

  const rows = await db.select().from(documentAttachments)
    .where(eq(documentAttachments.id, inserted.id))
    .limit(1);
  return rows[0];
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function listAttachments(
  documentId:     number,
  organizationId: number,
): Promise<(typeof documentAttachments.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(documentAttachments)
    .where(and(
      eq(documentAttachments.documentId,     documentId),
      eq(documentAttachments.organizationId, organizationId),
      isNull(documentAttachments.deletedAt),
    ));
}

export async function getAttachment(
  attachmentId:   number,
  organizationId: number,
): Promise<typeof documentAttachments.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(documentAttachments)
    .where(and(
      eq(documentAttachments.id,             attachmentId),
      eq(documentAttachments.organizationId, organizationId),
      isNull(documentAttachments.deletedAt),
    ))
    .limit(1);

  return rows[0] ?? null;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function softDeleteAttachment(
  attachmentId:   number,
  organizationId: number,
  ctx:            TrpcAuditCtx,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const att = await getAttachment(attachmentId, organizationId);
  if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });

  await db.update(documentAttachments)
    .set({ deletedAt: new Date() })
    .where(eq(documentAttachments.id, attachmentId));

  log.info("attachment_soft_deleted", { attachmentId, organizationId });
}

// ─── Integrity ────────────────────────────────────────────────────────────────

export async function verifyAttachmentIntegrity(
  attachmentId:   number,
  organizationId: number,
  fileBuffer:     Buffer,
): Promise<{ valid: boolean; expectedHash: string | null; actualHash: string }> {
  const att = await getAttachment(attachmentId, organizationId);
  if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado." });

  const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
  const valid      = att.contentHash === actualHash;

  log.info("attachment_integrity_checked", { attachmentId, valid, organizationId });

  return { valid, expectedHash: att.contentHash ?? null, actualHash };
}

// ─── Scan status update ───────────────────────────────────────────────────────

export async function updateScanStatus(
  attachmentId:   number,
  organizationId: number,
  status:         ScanStatus,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.update(documentAttachments)
    .set({ scanStatus: status })
    .where(and(
      eq(documentAttachments.id,             attachmentId),
      eq(documentAttachments.organizationId, organizationId),
    ));

  log.info("attachment_scan_updated", { attachmentId, status, organizationId });
}
