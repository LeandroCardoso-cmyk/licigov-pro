import { eq, and, or, desc, sql } from "drizzle-orm";
import {
  processes, documents, editalParameters, platforms, users,
  InsertProcess, InsertDocument, InsertEditalParameter,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createProcess(process: InsertProcess) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(processes).values(process);
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

export async function updateProcessStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(processes).set({ status: status as any }).where(eq(processes.id, id));
}

export async function createDocument(document: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
    .where(and(eq(documents.processId, processId), eq(documents.type, type as any)))
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
    .where(and(eq(documents.processId, processId), eq(documents.type, type as any)))
    .orderBy(desc(documents.version));
}

export async function updateDocumentStatus(
  documentId: number,
  status: "draft" | "in_review" | "approved" | "rejected"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(documents).set({ documentStatus: status }).where(eq(documents.id, documentId));
}

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
