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
} from "../domain/documentTypes";

const log = serviceLogger("DocumentVersionService");

// PR D — tipos do executor: aceitam tanto a conexão (db) quanto uma transação (tx),
// para compor operações multi-gravação atômicas reutilizando o mesmo callback.
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
 * PR D / DATA-012 — Insere uma nova versão DENTRO de uma transação, de forma race-safe.
 *
 * O `versionNumber` era calculado com `MAX(...)+1` fora de qualquer lock: duas requisições
 * concorrentes geravam o MESMO número (violando o histórico imutável). Agora:
 *  1) tomamos um lock na linha-pai `documents` (`FOR UPDATE`) — mutex por documento, serializa
 *     toda a numeração de versão daquele documento;
 *  2) só então lemos o `MAX(versionNumber)` e inserimos a nova versão.
 *
 * Deve ser chamada sempre dentro de `tx` (o chamador abre a transação).
 */
async function insertVersionTx(
  tx: Tx,
  params: CreateVersionParams,
  ctx: TrpcAuditCtx,
): Promise<typeof documentVersions.$inferSelect> {
  // Mutex por documento (a linha-pai sempre existe): serializa a numeração concorrente.
  await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, params.documentId), eq(documents.organizationId, params.organizationId)))
    .for("update");

  const rows = await tx
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

  const [inserted] = await tx.insert(documentVersions).values({
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

  const version = await tx
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, inserted.id))
    .limit(1);

  log.info("version_created", {
    documentId:     params.documentId,
    versionNumber:  nextVersionNumber,
    sourceContext:  params.sourceContext,
    organizationId: params.organizationId,
    correlationId:  params.correlationId ?? ctx.correlationId ?? undefined,
  });

  return version[0];
}

/**
 * Cria um snapshot imutável do documento (transacional e race-safe).
 * Retorna a versão criada (com id e versionNumber).
 */
export async function createVersion(
  params: CreateVersionParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof documentVersions.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  try {
    return await db.transaction((tx) => insertVersionTx(tx, params, ctx));
  } catch (error) {
    // Observabilidade (OBS): rollback de operação crítica (nenhum estado parcial persistido).
    log.error("version_transaction_rollback", {
      documentId: params.documentId,
      organizationId: params.organizationId,
      correlationId: params.correlationId ?? ctx.correlationId ?? undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
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

  // PR D / DATA-012 — criar a nova versão E mover o ponteiro do documento devem ser ATÔMICOS:
  // se o update do ponteiro falhar depois da versão criada, o documento ficaria com histórico
  // novo mas ponteiro/estado antigo. Uma única transação garante tudo-ou-nada.
  let result: { updated: typeof documents.$inferSelect; newVersionId: number };
  try {
    result = await db.transaction(async (tx) => {
    // Lock + leitura da linha-pai (mutex por documento; consistente com insertVersionTx).
    const docRows = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)))
      .for("update")
      .limit(1);

    if (docRows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });
    }
    const doc = docRows[0];

    const targetRows = await tx
      .select()
      .from(documentVersions)
      .where(and(
        eq(documentVersions.documentId,     documentId),
        eq(documentVersions.versionNumber,  versionNumber),
        eq(documentVersions.organizationId, orgId),
      ))
      .limit(1);
    const targetVersion = targetRows[0];
    if (!targetVersion) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Versão ${versionNumber} não encontrada.` });
    }

    // Nova versão a partir do snapshot histórico (na MESMA transação).
    const newVersion = await insertVersionTx(tx, {
      documentId,
      organizationId:     orgId,
      contentSnapshot:    targetVersion.contentSnapshot,
      structuredSnapshot: targetVersion.structuredSnapshot as StructuredDocumentContent | null,
      changeReason:       `Restaurado para versão ${versionNumber}`,
      sourceContext:      "restore",
      correlationId:      ctx.correlationId,
      requestId:          ctx.requestId,
    }, ctx);

    await tx
      .update(documents)
      .set({
        content:           targetVersion.contentSnapshot    ?? doc.content,
        structuredContent: targetVersion.structuredSnapshot ?? doc.structuredContent,
        currentVersionId:  newVersion.id,
        version:           doc.version + 1,
        updatedBy:         ctx.user.id,
      })
      .where(eq(documents.id, documentId));

      const updated = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      return { updated: updated[0], newVersionId: newVersion.id };
    });
  } catch (error) {
    // Observabilidade (OBS): rollback de operação crítica (versão + ponteiro — tudo-ou-nada).
    log.error("restore_transaction_rollback", {
      documentId,
      fromVersion: versionNumber,
      organizationId: orgId,
      correlationId: ctx.correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  log.info("document_restored", {
    documentId,
    fromVersion: versionNumber,
    newVersionId: result.newVersionId,
    organizationId: orgId,
    correlationId: ctx.correlationId,
  });

  return result.updated;
}
