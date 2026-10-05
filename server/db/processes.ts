import { eq, and, or, desc, sql } from "drizzle-orm";
import {
  processes, documents, editalParameters, platforms, users,
  InsertProcess, InsertDocument, InsertEditalParameter,
} from "../../drizzle/schema";
import { getDb } from "./connection";

type ProcessStatus = (typeof processes.$inferSelect)["status"];
type DocumentType = (typeof documents.$inferSelect)["type"];

/**
 * RC-SEC-PR-A — Retorna o insertId numérico do processo criado.
 * O retorno de `db.insert().values()` é um array `[ResultSetHeader, ...]`;
 * o `insertId` correto vem de `result[0].insertId` (antes lia-se
 * `(result as any).insertId`, produzindo NaN e quebrando auditoria/geração).
 */
export async function createProcess(process: InsertProcess): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(processes).values(process);
  return result[0].insertId;
}

export async function getProcessesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: processes.id, name: processes.name, description: processes.description,
      object: processes.object, estimatedValue: processes.estimatedValue,
      modality: processes.modality, category: processes.category,
      platformId: processes.platformId, status: processes.status,
      ownerId: processes.ownerId, createdAt: processes.createdAt,
      updatedAt: processes.updatedAt, platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));
}

export async function searchProcesses(userId: number, query: string) {
  const db = await getDb();
  if (!db) return [];
  const searchTerm = `%${query}%`;
  return await db
    .select()
    .from(processes)
    .where(
      and(
        eq(processes.ownerId, userId),
        or(
          sql`${processes.name} LIKE ${searchTerm}`,
          sql`${processes.object} LIKE ${searchTerm}`,
          sql`CAST(${processes.id} AS CHAR) LIKE ${searchTerm}`
        )
      )
    )
    .orderBy(desc(processes.updatedAt))
    .limit(10);
}

/**
 * RC-LEGAL-SEC-001 — INSEGURA (sem filtro de organização). Mantida para os
 * consumidores externos pré-existentes (`platforms.ts::updateProcessPlatform`
 * e demais chamadas no domínio de `processesRouter`, fora do escopo desta
 * sprint). NÃO usar em código novo fora desse domínio — para leituras
 * institucionais cross-router, usar `getProcessByIdForOrganization` abaixo.
 */
export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      id: processes.id, name: processes.name, description: processes.description,
      object: processes.object, estimatedValue: processes.estimatedValue,
      modality: processes.modality, category: processes.category,
      platformId: processes.platformId, status: processes.status,
      ownerId: processes.ownerId, createdAt: processes.createdAt,
      updatedAt: processes.updatedAt, platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(eq(processes.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** RC-LEGAL-SEC-001 — organizationId obrigatório; nunca aceitar do cliente sem resolução no servidor. */
export async function getProcessByIdForOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select({
      id: processes.id, name: processes.name, description: processes.description,
      object: processes.object, estimatedValue: processes.estimatedValue,
      modality: processes.modality, category: processes.category,
      platformId: processes.platformId, status: processes.status,
      ownerId: processes.ownerId, createdAt: processes.createdAt,
      updatedAt: processes.updatedAt, platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(and(eq(processes.id, id), eq(processes.organizationId, organizationId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateProcessStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(processes).set({ status: status as ProcessStatus }).where(eq(processes.id, id));
}

// ─── RC-SEC-PR-A — Variantes tenant-scoped de processos e documentos ─────────
// `processes` e `documents` possuem organizationId próprio → filtro direto.
// Cross-tenant e inexistente retornam o MESMO resultado externo (undefined/[]/no-op).

export async function listProcessesForOrganization(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: processes.id, name: processes.name, description: processes.description,
      object: processes.object, estimatedValue: processes.estimatedValue,
      modality: processes.modality, category: processes.category,
      platformId: processes.platformId, status: processes.status,
      ownerId: processes.ownerId, createdAt: processes.createdAt,
      updatedAt: processes.updatedAt, platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(eq(processes.organizationId, organizationId))
    .orderBy(desc(processes.updatedAt));
}

export async function searchProcessesForOrganization(organizationId: number, query: string) {
  const db = await getDb();
  if (!db) return [];
  const searchTerm = `%${query}%`;
  return await db
    .select()
    .from(processes)
    .where(
      and(
        eq(processes.organizationId, organizationId),
        or(
          sql`${processes.name} LIKE ${searchTerm}`,
          sql`${processes.object} LIKE ${searchTerm}`,
          sql`CAST(${processes.id} AS CHAR) LIKE ${searchTerm}`
        )
      )
    )
    .orderBy(desc(processes.updatedAt))
    .limit(10);
}

export async function updateProcessStatusForOrganization(
  id: number,
  organizationId: number,
  status: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(processes)
    .set({ status: status as ProcessStatus })
    .where(and(eq(processes.id, id), eq(processes.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}

export async function getDocumentByIdForOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentsByProcessForOrganization(processId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(documents)
    .where(and(eq(documents.processId, processId), eq(documents.organizationId, organizationId)))
    .orderBy(desc(documents.createdAt));
}

export async function getDocumentByProcessAndTypeForOrganization(
  processId: number,
  type: string,
  organizationId: number,
) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.processId, processId),
      eq(documents.type, type as DocumentType),
      eq(documents.organizationId, organizationId),
    ))
    .orderBy(desc(documents.version))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentVersionsForOrganization(
  processId: number,
  type: string,
  organizationId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: documents.id, processId: documents.processId, type: documents.type,
      content: documents.content, sourceType: documents.sourceType, s3Key: documents.s3Key,
      fileUrl: documents.fileUrl, version: documents.version, documentStatus: documents.documentStatus,
      createdBy: documents.createdBy, createdByName: users.name,
      createdAt: documents.createdAt, updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(users, eq(documents.createdBy, users.id))
    .where(and(
      eq(documents.processId, processId),
      eq(documents.type, type as DocumentType),
      eq(documents.organizationId, organizationId),
    ))
    .orderBy(desc(documents.version));
}

export async function updateDocumentStatusForOrganization(
  documentId: number,
  organizationId: number,
  status: "draft" | "in_review" | "approved" | "rejected",
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(documents)
    .set({ documentStatus: status })
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}

/**
 * SEM-079 — FAIL-CLOSED: a linha legada de `documents` só é inserida com `organizationId` explícito E se o processo
 * pertencer a essa organização (antes: `InsertDocument` aceitava `organizationId` ausente/NULL — foi assim que o
 * `restoreVersion` legado gravou linhas sem organização, e copiava conteúdo entre processos). Sem organização válida
 * ou com processo de outra organização ⇒ erro, ZERO escrita. Nenhum caller de router hoje (LEG-009).
 */
export async function createDocument(document: InsertDocument & { organizationId: number }) {
  const organizationId = document.organizationId as number | null | undefined;
  if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
    throw new Error("createDocument: organizationId obrigatório (LEGACY_DOCUMENT_ORGANIZATION_REQUIRED)");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const owner = await db
    .select({ id: processes.id })
    .from(processes)
    .where(and(eq(processes.id, document.processId), eq(processes.organizationId, organizationId as number)))
    .limit(1);
  if (owner.length === 0) {
    throw new Error("createDocument: processo não pertence à organização (LEGACY_DOCUMENT_PROCESS_ORGANIZATION_MISMATCH)");
  }
  return await db.insert(documents).values(document);
}

export async function getDocumentsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(documents).where(eq(documents.processId, processId)).orderBy(desc(documents.createdAt));
}

export async function getDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentByProcessAndType(processId: number, type: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documents)
    .where(and(eq(documents.processId, processId), eq(documents.type, type as DocumentType)))
    .orderBy(desc(documents.version))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentVersions(processId: number, type: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: documents.id,
      processId: documents.processId,
      type: documents.type,
      content: documents.content,
      sourceType: documents.sourceType,
      s3Key: documents.s3Key,
      fileUrl: documents.fileUrl,
      version: documents.version,
      documentStatus: documents.documentStatus,
      createdBy: documents.createdBy,
      createdByName: users.name,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(users, eq(documents.createdBy, users.id))
    .where(and(eq(documents.processId, processId), eq(documents.type, type as DocumentType)))
    .orderBy(desc(documents.version));
}

// SEM-078 — `updateDocumentStatus(documentId, status)` (escrita SEM organização, que podia marcar "approved" por id) foi
// REMOVIDA: sem callers; o caminho vigente é `updateDocumentStatusForOrganization` (tenant-scoped).

export async function upsertEditalParameters(params: InsertEditalParameter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(editalParameters).values(params).onDuplicateKeyUpdate({
    set: {
      modalidade: params.modalidade, formato: params.formato,
      criterioJulgamento: params.criterioJulgamento, regimeContratacao: params.regimeContratacao,
    },
  });
}

export async function getEditalParametersByProcess(processId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(editalParameters)
    .where(eq(editalParameters.processId, processId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}
