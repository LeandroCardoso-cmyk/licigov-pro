/**
 * RC-3 — Official Document Engine Persistence Repository
 *
 * Persiste os documentos oficiais (todas as versões, append-only por linhagem) e a
 * timeline documental. Padrão getDb(): degrada sem DB. Multi-tenant por tenant_id.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import { officialDocumentsTable, officialDocumentTimelineTable } from "../../drizzle/schema";
import type { OfficialDocument, DocumentBusinessDomain, OfficialDocumentType, OfficialDocumentStatus } from "../domain/officialDocument";

function rowToDoc(r: typeof officialDocumentsTable.$inferSelect): OfficialDocument {
  let metadata: Record<string, unknown> = {};
  try { metadata = r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : {}; } catch { metadata = {}; }
  return {
    id: r.id, tenantId: r.tenantId, businessDomain: r.businessDomain as DocumentBusinessDomain,
    documentType: r.documentType as OfficialDocumentType, origin: r.origin, title: r.title, version: r.version,
    status: r.status as OfficialDocumentStatus, template: r.template, content: r.content ?? "", metadata,
    author: r.author, lineageId: r.lineageId, correlationId: r.correlationId, replayHash: r.replayHash,
    storageKey: r.storageKey ?? "", mimeType: r.mimeType ?? "", size: r.size ?? 0, hash: r.hash ?? "",
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function insertOfficialDocument(doc: OfficialDocument): Promise<OfficialDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(officialDocumentsTable).values({
    id: doc.id, tenantId: doc.tenantId, businessDomain: doc.businessDomain, documentType: doc.documentType,
    origin: doc.origin, title: doc.title, version: doc.version, status: doc.status, template: doc.template,
    content: doc.content, metadata: JSON.stringify(doc.metadata), author: doc.author, lineageId: doc.lineageId,
    correlationId: doc.correlationId, replayHash: doc.replayHash,
    storageKey: doc.storageKey, mimeType: doc.mimeType, size: doc.size, hash: doc.hash,
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  }).onDuplicateKeyUpdate({ set: { content: doc.content, status: doc.status, metadata: JSON.stringify(doc.metadata), updatedAt: doc.updatedAt } });
  return doc;
}

/**
 * RC-3.5 — Atualiza as referências de storage de um documento oficial após o export
 * (Document Engine → Storage Service → S3). Nunca grava binário; apenas a referência.
 */
export async function updateOfficialDocumentStorageRefs(params: {
  id: string; tenantId: number; storageKey: string; mimeType: string; size: number; hash: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(officialDocumentsTable)
    .set({ storageKey: params.storageKey, mimeType: params.mimeType, size: params.size, hash: params.hash })
    .where(and(eq(officialDocumentsTable.id, params.id), eq(officialDocumentsTable.tenantId, params.tenantId)));
}

export async function getOfficialDocument(id: string, tenantId: number): Promise<OfficialDocument | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.id, id), eq(officialDocumentsTable.tenantId, tenantId))).limit(1);
  return rows.length ? rowToDoc(rows[0]) : null;
}

/** Última versão de uma linhagem (para versionamento incremental). */
export async function getLatestByLineage(lineageId: string, tenantId: number): Promise<OfficialDocument | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)))
    .orderBy(desc(officialDocumentsTable.version)).limit(1);
  return rows.length ? rowToDoc(rows[0]) : null;
}

export async function countVersions(lineageId: string, tenantId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: officialDocumentsTable.id }).from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)));
  return rows.length;
}

export async function listVersions(lineageId: string, tenantId: number): Promise<Array<{ id: string; version: number; status: string; replayHash: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentsTable)
    .where(and(eq(officialDocumentsTable.lineageId, lineageId), eq(officialDocumentsTable.tenantId, tenantId)))
    .orderBy(asc(officialDocumentsTable.version));
  return rows.map(r => ({ id: r.id, version: r.version, status: r.status, replayHash: r.replayHash, createdAt: r.createdAt }));
}

export async function listOfficialDocuments(tenantId: number, opts: { businessDomain?: string; origin?: string; limit?: number } = {}): Promise<Array<{ id: string; businessDomain: string; documentType: string; origin: string; title: string; version: number; status: string; lineageId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentsTable)
    .where(eq(officialDocumentsTable.tenantId, tenantId)).orderBy(desc(officialDocumentsTable.updatedAt)).limit(opts.limit ?? 100);
  let mapped = rows.map(r => ({ id: r.id, businessDomain: r.businessDomain, documentType: r.documentType, origin: r.origin, title: r.title, version: r.version, status: r.status, lineageId: r.lineageId, createdAt: r.createdAt }));
  if (opts.businessDomain) mapped = mapped.filter(d => d.businessDomain === opts.businessDomain);
  if (opts.origin) mapped = mapped.filter(d => d.origin === opts.origin);
  return mapped;
}

// ─── Timeline documental (append-only) ────────────────────────────────────────

export async function countDocumentTimeline(lineageId: string, tenantId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: officialDocumentTimelineTable.id }).from(officialDocumentTimelineTable)
    .where(and(eq(officialDocumentTimelineTable.lineageId, lineageId), eq(officialDocumentTimelineTable.tenantId, tenantId)));
  return rows.length;
}

export async function insertDocumentTimelineEntry(params: { tenantId: number; lineageId: string; documentId: string; order: number; eventType: string; actor: string; summary: string; correlationId: string }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = createHash("sha256").update(`odtl:${params.tenantId}:${params.lineageId}:${params.order}:${params.eventType}`).digest("hex").slice(0, 20);
  await db.insert(officialDocumentTimelineTable).values({
    id, tenantId: params.tenantId, lineageId: params.lineageId, documentId: params.documentId, eventOrder: params.order,
    eventType: params.eventType, actor: params.actor, summary: params.summary, correlationId: params.correlationId,
  }).onDuplicateKeyUpdate({ set: { summary: params.summary } });
}

export async function listDocumentTimeline(lineageId: string, tenantId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentTimelineTable)
    .where(and(eq(officialDocumentTimelineTable.lineageId, lineageId), eq(officialDocumentTimelineTable.tenantId, tenantId)))
    .orderBy(asc(officialDocumentTimelineTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", createdAt: r.createdAt }));
}
