/**
 * Sprint 2 — Document Version Service.
 * Versionamento imutável — cada versão é um snapshot completo do documento.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents, documentVersions } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import type { TrpcAuditCtx } from "./activityLogService";
import type {
  StructuredDocumentContent,
  ActorSnapshot,
  WorkflowSnapshot,
  VersionSourceContext,
  DocumentStatusValue,
} from "../domain/documentTypes";

const log = serviceLogger("DocumentVersionService");

export interface CreateVersionParams {
  documentId:     number;
  organizationId: number;
  contentSnapshot?: string | null;
  structuredSnapshot?: StructuredDocumentContent | null;
  changeReason?:  string | null;
  sourceContext?: VersionSourceContext;
  workflowSnapshot?: WorkflowSnapshot | null;
  correlationId?: string;
  requestId?:     string;
}

/**
 * Cria um snapshot imutável do documento.
 * Retorna a versão criada (com id e versionNumber).
 */
export async function createVersion(
  params: CreateVersionParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof documentVersions.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  // Determina o próximo versionNumber
  const rows = await db
    .select({ maxVer: sql<number>`COALESCE(MAX(${documentVersions.versionNumber}), 0)` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, params.documentId));

  const nextVersionNumber = (rows[0]?.maxVer ?? 0) + 1;

  const actorSnapshot: ActorSnapshot = {
    userId:  ctx.user.id,
    name:    ctx.user.name   ?? "Unknown",
    email:   ctx.user.email  ?? "",
    role:    ctx.orgMembership?.role ?? "operator",
    orgId:   ctx.organizationId ?? 0,
    orgName: ctx.orgName ?? "",
  };

  const [inserted] = await db.insert(documentVersions).values({
    organizationId:     params.organizationId,
    documentId:         params.documentId,
    versionNumber:      nextVersionNumber,
    contentSnapshot:    params.contentSnapshot    ?? null,
    structuredSnapshot: params.structuredSnapshot ?? null,
    diffMetadata:       null,
    changeReason:       params.changeReason       ?? null,
    sourceContext:      params.sourceContext       ?? "manual",
    actorSnapshot:      actorSnapshot as unknown as Record<string, unknown>,
    workflowSnapshot:   params.workflowSnapshot   ?? null,
    correlationId:      params.correlationId ?? ctx.correlationId ?? null,
    requestId:          params.requestId     ?? ctx.requestId     ?? null,
    createdBy:          ctx.user.id,
  }).$returningId();

  const version = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, inserted.id))
    .limit(1);

  log.info("version_created", {
    documentId:     params.documentId,
    versionNumber:  nextVersionNumber,
    sourceContext:  params.sourceContext,
    organizationId: params.organizationId,
  });

  return version[0];
}

/**
 * Lista todas as versões de um documento, ordenadas por versionNumber desc.
 */
export async function listVersions(
  documentId:     number,
  organizationId: number,
): Promise<(typeof documentVersions.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(documentVersions)
    .where(and(
      eq(documentVersions.documentId,     documentId),
      eq(documentVersions.organizationId, organizationId),
    ))
    .orderBy(desc(documentVersions.versionNumber));
}

/**
 * Busca uma versão específica pelo número.
 */
export async function getVersion(
  documentId:     number,
  versionNumber:  number,
  organizationId: number,
): Promise<typeof documentVersions.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(documentVersions)
    .where(and(
      eq(documentVersions.documentId,     documentId),
      eq(documentVersions.versionNumber,  versionNumber),
      eq(documentVersions.organizationId, organizationId),
    ))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Retorna a versão mais recente de um documento.
 */
export async function getLatestVersion(
  documentId:     number,
  organizationId: number,
): Promise<typeof documentVersions.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(documentVersions)
    .where(and(
      eq(documentVersions.documentId,     documentId),
      eq(documentVersions.organizationId, organizationId),
    ))
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Restaura o documento para uma versão anterior.
 * Cria uma nova versão com o conteúdo do snapshot histórico (não sobrescreve o histórico).
 */
export async function restoreToVersion(
  documentId:    number,
  versionNumber: number,
  ctx:           TrpcAuditCtx,
): Promise<typeof documents.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const targetVersion = await getVersion(documentId, versionNumber, orgId);
  if (!targetVersion) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Versão ${versionNumber} não encontrada.` });
  }

  const docRows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
    .limit(1);

  if (docRows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
  }

  const doc = docRows[0];

  // Cria nova versão a partir do snapshot histórico
  const newVersion = await createVersion({
    documentId,
    organizationId:     orgId,
    contentSnapshot:    targetVersion.contentSnapshot,
    structuredSnapshot: targetVersion.structuredSnapshot as StructuredDocumentContent | null,
    changeReason:       `Restaurado para versão ${versionNumber}`,
    sourceContext:      "restore",
    correlationId:      ctx.correlationId,
    requestId:          ctx.requestId,
  }, ctx);

  // Atualiza o documento com o conteúdo restaurado
  await db
    .update(documents)
    .set({
      content:          targetVersion.contentSnapshot    ?? doc.content,
      structuredContent: targetVersion.structuredSnapshot ?? doc.structuredContent,
      currentVersionId: newVersion.id,
      version:          doc.version + 1,
      updatedBy:        ctx.user.id,
    })
    .where(eq(documents.id, documentId));

  log.info("document_restored", {
    documentId,
    fromVersion: versionNumber,
    newVersionId: newVersion.id,
    organizationId: orgId,
  });

  const updated = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return updated[0];
}
