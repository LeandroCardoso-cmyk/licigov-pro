/**
 * Sprint 2 — Document Draft & Autosave Service.
 *
 * Um rascunho por usuário por documento.
 * Autosave incremental com detecção de conflito via optimistic locking.
 */
import { eq, and, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents, documentDrafts } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { assertVersion, nextVersion } from "../domain/locking";
import { createVersion } from "./documentVersionService";
import type { TrpcAuditCtx } from "./activityLogService";
import type { StructuredDocumentContent } from "../domain/documentTypes";

const log = serviceLogger("DocumentDraftService");

/** 7 dias de retenção para drafts */
export const DRAFT_EXPIRY_DAYS = 7;
/** Frequência mínima recomendada de autosave: 2 segundos de debounce */
export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 2_000;

function draftExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + DRAFT_EXPIRY_DAYS);
  return d;
}

/**
 * Salva (ou atualiza) o rascunho de autosave de um usuário.
 * Inclui optimistic locking: `expectedDraftVersion` deve corresponder ao
 * `version` atual do draft para evitar overwrite de outra sessão.
 *
 * Na primeira chamada, `expectedDraftVersion` deve ser 0.
 */
export async function saveDraft(
  documentId:           number,
  userId:               number,
  content:              { text?: string | null; structured?: StructuredDocumentContent | null },
  ctx:                  TrpcAuditCtx,
  expectedDraftVersion: number = 0,
): Promise<typeof documentDrafts.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const existing = await db
    .select()
    .from(documentDrafts)
    .where(and(eq(documentDrafts.documentId, documentId), eq(documentDrafts.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    const draft = existing[0];
    // Optimistic locking: previne overwrite de outra sessão
    assertVersion(expectedDraftVersion, draft.version, "DocumentDraft", documentId);

    await db
      .update(documentDrafts)
      .set({
        contentDraft:    content.text       ?? draft.contentDraft,
        structuredDraft: content.structured ?? draft.structuredDraft,
        version:         nextVersion(draft.version),
        lastSavedAt:     new Date(),
        expiresAt:       draftExpiresAt(),
        correlationId:   ctx.correlationId,
      })
      .where(and(eq(documentDrafts.documentId, documentId), eq(documentDrafts.userId, userId)));

    log.debug("draft_updated", { documentId, userId, newVersion: nextVersion(draft.version) });

    const updated = await db
      .select()
      .from(documentDrafts)
      .where(and(eq(documentDrafts.documentId, documentId), eq(documentDrafts.userId, userId)))
      .limit(1);
    return updated[0];
  }

  // Novo draft
  const docRows = await db.select({ id: documents.id, version: documents.version })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (docRows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  }

  const [inserted] = await db.insert(documentDrafts).values({
    organizationId:  orgId,
    documentId,
    userId,
    contentDraft:    content.text       ?? null,
    structuredDraft: content.structured ?? null,
    baseVersionId:   null,
    version:         1,
    lastSavedAt:     new Date(),
    expiresAt:       draftExpiresAt(),
    correlationId:   ctx.correlationId,
  }).$returningId();

  log.info("draft_created", { documentId, userId, organizationId: orgId });

  const newDraft = await db
    .select()
    .from(documentDrafts)
    .where(eq(documentDrafts.id, inserted.id))
    .limit(1);
  return newDraft[0];
}

/**
 * Retorna o draft ativo de um usuário para um documento.
 * Retorna null se não existe ou expirou.
 */
export async function getDraft(
  documentId:     number,
  userId:         number,
  organizationId: number,
): Promise<typeof documentDrafts.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(documentDrafts)
    .where(and(
      eq(documentDrafts.documentId,     documentId),
      eq(documentDrafts.userId,         userId),
      eq(documentDrafts.organizationId, organizationId),
    ))
    .limit(1);

  if (rows.length === 0) return null;
  const draft = rows[0];

  // Draft expirado
  if (draft.expiresAt < new Date()) {
    await discardDraft(documentId, userId, organizationId);
    return null;
  }

  return draft;
}

/**
 * Publica o draft como nova versão oficial do documento.
 * Requer correspondência do version do documento (optimistic locking).
 */
export async function publishDraft(
  documentId:      number,
  userId:          number,
  expectedVersion: number,
  changeReason:    string | null,
  ctx:             TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const draft = await getDraft(documentId, userId, orgId);
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho não encontrado ou expirado." });

  const docRows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (docRows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = docRows[0];
  assertVersion(expectedVersion, doc.version, "Document", documentId);

  // Cria versão a partir do draft
  const newVersion = await createVersion({
    documentId,
    organizationId:     orgId,
    contentSnapshot:    draft.contentDraft,
    structuredSnapshot: draft.structuredDraft as StructuredDocumentContent | null,
    changeReason:       changeReason ?? "Publicação de rascunho",
    sourceContext:      "autosave_publish",
    correlationId:      ctx.correlationId,
    requestId:          ctx.requestId,
  }, ctx);

  // Atualiza documento
  await db.update(documents).set({
    content:          draft.contentDraft    ?? doc.content,
    structuredContent: draft.structuredDraft ?? doc.structuredContent,
    currentVersionId: newVersion.id,
    version:          nextVersion(doc.version),
    updatedBy:        userId,
  }).where(eq(documents.id, documentId));

  // Remove draft publicado
  await db.delete(documentDrafts).where(
    and(eq(documentDrafts.documentId, documentId), eq(documentDrafts.userId, userId)),
  );

  log.info("draft_published", { documentId, userId, newVersionId: newVersion.id });

  const updated = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return updated[0];
}

/**
 * Descarta o rascunho de um usuário.
 */
export async function discardDraft(
  documentId:     number,
  userId:         number,
  organizationId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.delete(documentDrafts).where(
    and(
      eq(documentDrafts.documentId,     documentId),
      eq(documentDrafts.userId,         userId),
      eq(documentDrafts.organizationId, organizationId),
    ),
  );

  log.debug("draft_discarded", { documentId, userId });
}

/**
 * Remove drafts expirados. Chamado periodicamente por job de limpeza.
 * Retorna o número de drafts removidos.
 */
export async function cleanupExpiredDrafts(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const now = new Date();
  const result = await db.delete(documentDrafts).where(lt(documentDrafts.expiresAt, now));
  const removed = (result as unknown as { rowsAffected?: number }).rowsAffected ?? 0;

  if (removed > 0) {
    log.info("expired_drafts_cleaned", { removed });
  }

  return removed;
}
