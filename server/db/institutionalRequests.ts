/**
 * Kernel — Institutional Request Engine Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) de solicitações, respostas, atribuições,
 * timeline, notificações e referências documentais. Padrão getDb(): degrada
 * graciosamente sem DB. Multi-tenant por organization_id (jamais cruza organizações).
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import { toDbDatetime, fromDbDatetime } from "./institutionalConsultations";
import {
  institutionalRequestsTable,
  institutionalResponsesTable,
  requestAssignmentsTable,
  requestTimelinesTable,
  requestNotificationsTable,
  documentReferencesTable,
} from "../../drizzle/schema";
import type { InstitutionalRequest, RequestStatus, RequestPriority, RequestType, BusinessDomainCode } from "../domain/institutionalRequest";
import type { InstitutionalResponse } from "../domain/institutionalResponse";
import type { RequestTimelineEntry } from "../domain/requestTimeline";
import type { RequestAssignment } from "../domain/requestAssignment";
import type { RequestNotification } from "../domain/requestNotification";
import type { DocumentReference } from "../domain/documentReference";

/**
 * Fronteira de persistência de DATETIME (padrão canônico — igual a `procurement.ts`).
 * O modelo de domínio usa ISO ("…T…Z"); o MySQL em modo estrito rejeita ISO em
 * colunas `datetime(3)`. Convertemos ISO→DB na escrita e DB→ISO na leitura, sem
 * alterar o modelo de domínio nem o contrato público (entra/sai ISO).
 * `signedAt` de `institutional_responses` é VARCHAR(30) e NÃO passa por aqui.
 */
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
const fromDb = (v: string): string => fromDbDatetime(v) ?? v;

// ─── Requests ──────────────────────────────────────────────────────────────

export async function insertRequest(r: InstitutionalRequest): Promise<InstitutionalRequest | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(institutionalRequestsTable).values({
    id: r.id, organizationId: r.organizationId, sourceDomain: r.sourceDomain, destinationDomain: r.destinationDomain,
    requestType: r.requestType, referenceProcessId: r.referenceProcessId, referenceDocumentId: r.referenceDocumentId,
    title: r.title, description: r.description, priority: r.priority, status: r.status,
    requestedBy: r.requestedBy, assignedTo: r.assignedTo, correlationId: r.correlationId,
    createdAt: toDb(r.createdAt), updatedAt: toDb(r.updatedAt),
  }).onDuplicateKeyUpdate({ set: { status: r.status, assignedTo: r.assignedTo, updatedAt: toDb(r.updatedAt) } });
  return r;
}

function rowToRequest(r: typeof institutionalRequestsTable.$inferSelect): InstitutionalRequest {
  return {
    id: r.id, organizationId: r.organizationId, sourceDomain: r.sourceDomain as BusinessDomainCode,
    destinationDomain: r.destinationDomain as BusinessDomainCode, requestType: r.requestType as RequestType,
    referenceProcessId: r.referenceProcessId, referenceDocumentId: r.referenceDocumentId, title: r.title,
    description: r.description ?? "", priority: r.priority as RequestPriority, status: r.status as RequestStatus,
    requestedBy: r.requestedBy, assignedTo: r.assignedTo ?? null, correlationId: r.correlationId,
    createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt),
  };
}

export async function getRequest(id: string, orgId: number): Promise<InstitutionalRequest | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(institutionalRequestsTable)
    .where(and(eq(institutionalRequestsTable.id, id), eq(institutionalRequestsTable.organizationId, orgId))).limit(1);
  return rows.length > 0 ? rowToRequest(rows[0]) : null;
}

export async function updateRequestStatus(id: string, orgId: number, status: string, assignedTo: number | null, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(institutionalRequestsTable).set({ status, assignedTo, updatedAt: toDb(updatedAt) })
    .where(and(eq(institutionalRequestsTable.id, id), eq(institutionalRequestsTable.organizationId, orgId)));
  return true;
}

/** Inbox: solicitações pendentes para um domínio (destino). */
export async function listPendingForDomain(orgId: number, destinationDomain: string, limit = 50): Promise<Array<{ id: string; sourceDomain: string; requestType: string; title: string; priority: string; status: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(institutionalRequestsTable)
    .where(and(
      eq(institutionalRequestsTable.organizationId, orgId),
      eq(institutionalRequestsTable.destinationDomain, destinationDomain),
      inArray(institutionalRequestsTable.status, ["PENDING", "RECEIVED", "IN_PROGRESS", "WAITING_INFORMATION"]),
    ))
    .orderBy(desc(institutionalRequestsTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, sourceDomain: r.sourceDomain, requestType: r.requestType, title: r.title, priority: r.priority, status: r.status, createdAt: fromDb(r.createdAt) }));
}

/** Solicitações concluídas/devolvidas para um domínio (origem ou destino). */
export async function listCompletedForDomain(orgId: number, domain: string, asSource: boolean, limit = 50): Promise<Array<{ id: string; requestType: string; title: string; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const domainCol = asSource ? institutionalRequestsTable.sourceDomain : institutionalRequestsTable.destinationDomain;
  const rows = await db.select().from(institutionalRequestsTable)
    .where(and(
      eq(institutionalRequestsTable.organizationId, orgId),
      eq(domainCol, domain),
      inArray(institutionalRequestsTable.status, ["COMPLETED", "RETURNED", "ARCHIVED"]),
    ))
    .orderBy(desc(institutionalRequestsTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, requestType: r.requestType, title: r.title, status: r.status, updatedAt: fromDb(r.updatedAt) }));
}

/** Solicitações vinculadas a um processo (para o domínio de origem exibir respostas). */
export async function listRequestsForProcess(orgId: number, processId: string): Promise<Array<{ id: string; destinationDomain: string; requestType: string; status: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(institutionalRequestsTable)
    .where(and(eq(institutionalRequestsTable.organizationId, orgId), eq(institutionalRequestsTable.referenceProcessId, processId)));
  return rows.map(r => ({ id: r.id, destinationDomain: r.destinationDomain, requestType: r.requestType, status: r.status }));
}

// ─── Responses ─────────────────────────────────────────────────────────────

export async function insertResponse(resp: InstitutionalResponse): Promise<InstitutionalResponse | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(institutionalResponsesTable).values({
    id: resp.id, organizationId: resp.organizationId, requestId: resp.requestId, responder: resp.responder,
    responseType: resp.responseType, responseStatus: resp.responseStatus, comments: resp.comments,
    attachedDocuments: JSON.stringify(resp.attachedDocuments), signed: resp.signed ? 1 : 0,
    signatureMethod: resp.signatureMethod, signedAt: resp.signedAt, correlationId: resp.correlationId, createdAt: toDb(resp.createdAt),
  }).onDuplicateKeyUpdate({ set: { responseStatus: resp.responseStatus, signed: resp.signed ? 1 : 0, signatureMethod: resp.signatureMethod, signedAt: resp.signedAt } });
  return resp;
}

export async function getResponseForRequest(requestId: string, orgId: number): Promise<{ id: string; responder: number; responseType: string; responseStatus: string; comments: string; signed: boolean; signatureMethod: string | null } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(institutionalResponsesTable)
    .where(and(eq(institutionalResponsesTable.requestId, requestId), eq(institutionalResponsesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, responder: r.responder, responseType: r.responseType, responseStatus: r.responseStatus, comments: r.comments ?? "", signed: r.signed === 1, signatureMethod: r.signatureMethod ?? null };
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export async function insertAssignment(a: RequestAssignment): Promise<RequestAssignment | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(requestAssignmentsTable).values({
    id: a.id, organizationId: a.organizationId, requestId: a.requestId, userId: a.userId,
    sector: a.sector, queue: a.queue, priority: a.priority, correlationId: a.correlationId, createdAt: toDb(a.createdAt),
  }).onDuplicateKeyUpdate({ set: { userId: a.userId, queue: a.queue, priority: a.priority } });
  return a;
}

// ─── Timeline ───────────────────────────────────────────────────────────────

export async function insertRequestTimelineEntry(e: RequestTimelineEntry): Promise<RequestTimelineEntry | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(requestTimelinesTable).values({
    id: e.id, organizationId: e.organizationId, requestId: e.requestId, eventOrder: e.order,
    eventType: e.eventType, actor: e.actor, summary: e.summary, refId: e.refId, correlationId: e.correlationId, createdAt: toDb(e.createdAt),
  }).onDuplicateKeyUpdate({ set: { summary: e.summary } });
  return e;
}

export async function listRequestTimeline(requestId: string, orgId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(requestTimelinesTable)
    .where(and(eq(requestTimelinesTable.requestId, requestId), eq(requestTimelinesTable.organizationId, orgId)))
    .orderBy(asc(requestTimelinesTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", refId: r.refId, createdAt: fromDb(r.createdAt) }));
}

export async function countTimeline(requestId: string, orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: requestTimelinesTable.id }).from(requestTimelinesTable)
    .where(and(eq(requestTimelinesTable.requestId, requestId), eq(requestTimelinesTable.organizationId, orgId)));
  return rows.length;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function insertNotification(n: RequestNotification): Promise<RequestNotification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(requestNotificationsTable).values({
    id: n.id, organizationId: n.organizationId, requestId: n.requestId, recipientUser: n.recipientUser,
    channel: n.channel, title: n.title, message: n.message, status: n.status, correlationId: n.correlationId, createdAt: toDb(n.createdAt),
  }).onDuplicateKeyUpdate({ set: { status: n.status } });
  return n;
}

export async function listNotifications(orgId: number, recipientUser: number, limit = 50): Promise<Array<{ id: string; requestId: string; title: string; message: string; status: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(requestNotificationsTable)
    .where(and(eq(requestNotificationsTable.organizationId, orgId), eq(requestNotificationsTable.recipientUser, recipientUser)))
    .orderBy(desc(requestNotificationsTable.createdAt)).limit(limit);
  return rows.map(r => ({ id: r.id, requestId: r.requestId, title: r.title, message: r.message ?? "", status: r.status, createdAt: fromDb(r.createdAt) }));
}

// ─── Document references ──────────────────────────────────────────────────────

export async function insertDocumentReference(ref: DocumentReference): Promise<DocumentReference | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(documentReferencesTable).values({
    id: ref.id, organizationId: ref.organizationId, requestId: ref.requestId, originDomain: ref.originDomain,
    documentId: ref.documentId, version: ref.version, snapshot: ref.snapshot, title: ref.title,
    correlationId: ref.correlationId, createdAt: toDb(ref.createdAt),
  }).onDuplicateKeyUpdate({ set: { snapshot: ref.snapshot } });
  return ref;
}

export async function listDocumentReferences(requestId: string, orgId: number): Promise<Array<{ id: string; originDomain: string; documentId: string; version: number; snapshot: string; title: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(documentReferencesTable)
    .where(and(eq(documentReferencesTable.requestId, requestId), eq(documentReferencesTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, originDomain: r.originDomain, documentId: r.documentId, version: r.version, snapshot: r.snapshot, title: r.title }));
}
