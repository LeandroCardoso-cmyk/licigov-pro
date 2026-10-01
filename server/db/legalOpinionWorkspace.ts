/**
 * FASE 5 — Parecer Jurídico Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do LegalOpinionWorkspace, pareceres (drafts),
 * versões, templates, histórico e atribuições de procurador. Padrão getDb():
 * degrada graciosamente sem DB. Multi-tenant por organization_id. Nomes de função
 * namespaced para não colidir com o repo legado `server/db/legalOpinions.ts`.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import { toDbDatetime } from "./institutionalConsultations";

// STRICT_TRANS_TABLES: colunas DATETIME(3) exigem 'YYYY-MM-DD HH:MM:SS.sss' (nunca ISO 'T…Z'). Converte
// ISO→DATETIME antes de gravar (mesmo padrão de db/procurement, db/officialDocuments, db/directProcurement).
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
import {
  legalOpinionWorkspacesTable,
  legalOpinionDraftsTable,
  legalOpinionVersionsTable,
  legalOpinionTemplatesTable,
  legalOpinionHistoryTable,
  lawyerAssignmentsTable,
} from "../../drizzle/schema";
import type {
  LegalOpinionWorkspace, LegalOpinionStage, LegalOpinionWorkspaceStatus, LegalOpinionPriority,
} from "../domain/legalOpinionWorkspace";
import type {
  LegalOpinionDraft, LegalOpinionType, LegalOpinionConclusion, LegalOpinionDraftStatus, SignatureMethod,
} from "../domain/legalOpinionDraft";
import type { LawyerAssignment } from "../domain/lawyerAssignment";

function parseArr(raw: string | null): string[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as string[] : []; } catch { return []; }
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export async function insertLegalOpinionWorkspace(ws: LegalOpinionWorkspace): Promise<LegalOpinionWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(legalOpinionWorkspacesTable).values({
    id: ws.id, organizationId: ws.organizationId, requestId: ws.requestId, sourceDomain: ws.sourceDomain,
    referenceProcessId: ws.referenceProcessId, requestType: ws.requestType, currentStage: ws.currentStage,
    status: ws.status, assignedLawyer: ws.assignedLawyer, responsibleSector: ws.responsibleSector,
    priority: ws.priority, correlationId: ws.correlationId, createdAt: toDb(ws.createdAt), updatedAt: toDb(ws.updatedAt),
  }).onDuplicateKeyUpdate({ set: { currentStage: ws.currentStage, status: ws.status, assignedLawyer: ws.assignedLawyer, updatedAt: toDb(ws.updatedAt) } });
  return ws;
}

export async function getLegalOpinionWorkspace(id: string, orgId: number): Promise<LegalOpinionWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(legalOpinionWorkspacesTable)
    .where(and(eq(legalOpinionWorkspacesTable.id, id), eq(legalOpinionWorkspacesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  return rowToWorkspace(rows[0]);
}

export async function getLegalOpinionWorkspaceByRequest(requestId: string, orgId: number): Promise<LegalOpinionWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(legalOpinionWorkspacesTable)
    .where(and(eq(legalOpinionWorkspacesTable.requestId, requestId), eq(legalOpinionWorkspacesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  return rowToWorkspace(rows[0]);
}

export async function updateLegalOpinionWorkspaceStage(
  id: string, orgId: number, stage: LegalOpinionStage, status: LegalOpinionWorkspaceStatus,
  assignedLawyer: number | null, updatedAt: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(legalOpinionWorkspacesTable).set({ currentStage: stage, status, assignedLawyer, updatedAt: toDb(updatedAt) })
    .where(and(eq(legalOpinionWorkspacesTable.id, id), eq(legalOpinionWorkspacesTable.organizationId, orgId)));
  return true;
}

export async function listLegalOpinionWorkspaces(
  orgId: number, opts: { activeOnly?: boolean; limit?: number } = {},
): Promise<Array<{ id: string; requestId: string; sourceDomain: string; requestType: string; currentStage: string; status: string; priority: string; assignedLawyer: number | null; createdAt: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(legalOpinionWorkspacesTable)
    .where(eq(legalOpinionWorkspacesTable.organizationId, orgId))
    .orderBy(desc(legalOpinionWorkspacesTable.updatedAt)).limit(opts.limit ?? 50);
  const mapped = rows.map(r => ({
    id: r.id, requestId: r.requestId, sourceDomain: r.sourceDomain, requestType: r.requestType,
    currentStage: r.currentStage, status: r.status, priority: r.priority, assignedLawyer: r.assignedLawyer ?? null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }));
  if (opts.activeOnly) return mapped.filter(r => r.currentStage !== "RETURNED" && r.currentStage !== "ARCHIVED");
  return mapped;
}

function rowToWorkspace(r: typeof legalOpinionWorkspacesTable.$inferSelect): LegalOpinionWorkspace {
  return {
    id: r.id, organizationId: r.organizationId, requestId: r.requestId, sourceDomain: r.sourceDomain,
    referenceProcessId: r.referenceProcessId, requestType: r.requestType,
    currentStage: r.currentStage as LegalOpinionStage, status: r.status as LegalOpinionWorkspaceStatus,
    assignedLawyer: r.assignedLawyer ?? null, responsibleSector: r.responsibleSector,
    priority: r.priority as LegalOpinionPriority, correlationId: r.correlationId,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// ─── Draft (parecer) ──────────────────────────────────────────────────────────

/** Linha de `legal_opinion_drafts` para um INSERT (sem upsert). */
function draftInsertValues(d: LegalOpinionDraft) {
  return {
    id: d.id, organizationId: d.organizationId, workspaceId: d.workspaceId, requestId: d.requestId,
    opinionType: d.opinionType, report: d.report, foundation: d.foundation, conclusion: d.conclusion,
    conclusionType: d.conclusionType, recommendations: JSON.stringify(d.recommendations),
    reservations: JSON.stringify(d.reservations), attachments: JSON.stringify(d.attachments),
    status: d.status, version: d.version, signed: d.signed ? 1 : 0, signatureMethod: d.signatureMethod,
    signedBy: d.signedBy, signedAt: d.signedAt, author: d.author, correlationId: d.correlationId,
    createdAt: toDb(d.createdAt), updatedAt: toDb(d.updatedAt),
  };
}

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle. */
function isDuplicateKeyError(err: unknown): boolean {
  let x: unknown = err;
  for (let i = 0; i < 4 && x && typeof x === "object"; i++) {
    const e = x as { code?: string; errno?: number; cause?: unknown };
    if (e.code === "ER_DUP_ENTRY" || e.errno === 1062) return true;
    x = e.cause;
  }
  return false;
}

export type LegalOpinionDraftClaim =
  | { readonly status: "inserted" }
  | { readonly status: "exists"; readonly drafts: LegalOpinionDraft[] }
  | { readonly status: "workspace_missing" };

/**
 * R3 / PR-06 (SEM-006) — CRIAÇÃO do parecer, NUNCA upsert. Numa transação: trava a linha do workspace
 * (`SELECT … FOR UPDATE`, mutex por workspace — serializa criações concorrentes de QUALQUER tipo), relê os pareceres
 * existentes do workspace e, só se não houver nenhum, INSERE o rascunho e a versão v1. Havendo parecer, devolve-os
 * SEM escrever nada (o serviço decide convergir ou CONFLICT). Sem DB ⇒ null (degrada).
 */
export async function claimNewLegalOpinionDraft(d: LegalOpinionDraft, v1: {
  contentHash: string; snapshot: string; author: number; correlationId: string;
}): Promise<LegalOpinionDraftClaim | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db.transaction(async (tx): Promise<LegalOpinionDraftClaim> => {
      const ws = await tx.select({ id: legalOpinionWorkspacesTable.id }).from(legalOpinionWorkspacesTable)
        .where(and(eq(legalOpinionWorkspacesTable.id, d.workspaceId), eq(legalOpinionWorkspacesTable.organizationId, d.organizationId)))
        .for("update");
      if (ws.length === 0) return { status: "workspace_missing" };
      const rows = await tx.select().from(legalOpinionDraftsTable)
        .where(and(eq(legalOpinionDraftsTable.workspaceId, d.workspaceId), eq(legalOpinionDraftsTable.organizationId, d.organizationId)))
        .orderBy(asc(legalOpinionDraftsTable.id));
      if (rows.length > 0) return { status: "exists", drafts: rows.map(rowToDraft) };
      await tx.insert(legalOpinionDraftsTable).values(draftInsertValues(d));
      await tx.insert(legalOpinionVersionsTable).values({
        id: versionId(d.organizationId, d.id, d.version), organizationId: d.organizationId, draftId: d.id, workspaceId: d.workspaceId,
        version: d.version, contentHash: v1.contentHash, snapshot: v1.snapshot, author: v1.author, correlationId: v1.correlationId,
      });
      return { status: "inserted" };
    });
  } catch (err) {
    // Defesa em profundidade: a PRIMARY KEY também impede o duplo INSERT — nunca vira sobrescrita.
    if (!isDuplicateKeyError(err)) throw err;
    return { status: "exists", drafts: await listLegalOpinionDraftsByWorkspace(d.workspaceId, d.organizationId) };
  }
}

/**
 * Grava edição/assinatura de um parecer AINDA NÃO ASSINADO, com CAS na versão lida. Parecer assinado é imutável NA
 * PERSISTÊNCIA: o `WHERE signed = 0` impede qualquer UPDATE posterior à assinatura, venha de onde vier. Devolve false
 * se nada foi gravado (assinado, versão concorrente ou inexistente). Sem DB ⇒ null (degrada).
 */
export async function updateUnsignedLegalOpinionDraft(d: LegalOpinionDraft, expectedVersion: number): Promise<boolean | null> {
  const db = await getDb();
  if (!db) return null;
  const res = await db.update(legalOpinionDraftsTable).set({
    report: d.report, foundation: d.foundation, conclusion: d.conclusion, conclusionType: d.conclusionType,
    recommendations: JSON.stringify(d.recommendations), reservations: JSON.stringify(d.reservations),
    attachments: JSON.stringify(d.attachments), status: d.status, version: d.version,
    signed: d.signed ? 1 : 0, signatureMethod: d.signatureMethod, signedBy: d.signedBy, signedAt: d.signedAt,
    updatedAt: toDb(d.updatedAt),
  }).where(and(
    eq(legalOpinionDraftsTable.id, d.id), eq(legalOpinionDraftsTable.organizationId, d.organizationId),
    eq(legalOpinionDraftsTable.signed, 0), eq(legalOpinionDraftsTable.version, expectedVersion),
  ));
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return (header?.affectedRows ?? 0) > 0;
}

/** Todos os pareceres (qualquer tipo) de um workspace, no tenant. */
export async function listLegalOpinionDraftsByWorkspace(workspaceId: string, orgId: number): Promise<LegalOpinionDraft[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(legalOpinionDraftsTable)
    .where(and(eq(legalOpinionDraftsTable.workspaceId, workspaceId), eq(legalOpinionDraftsTable.organizationId, orgId)))
    .orderBy(asc(legalOpinionDraftsTable.id));
  return rows.map(rowToDraft);
}

export async function getLegalOpinionDraft(id: string, orgId: number): Promise<LegalOpinionDraft | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(legalOpinionDraftsTable)
    .where(and(eq(legalOpinionDraftsTable.id, id), eq(legalOpinionDraftsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  return rowToDraft(rows[0]);
}

export async function getLegalOpinionDraftByWorkspace(workspaceId: string, orgId: number): Promise<LegalOpinionDraft | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(legalOpinionDraftsTable)
    .where(and(eq(legalOpinionDraftsTable.workspaceId, workspaceId), eq(legalOpinionDraftsTable.organizationId, orgId)))
    .orderBy(desc(legalOpinionDraftsTable.version)).limit(1);
  if (rows.length === 0) return null;
  return rowToDraft(rows[0]);
}

function rowToDraft(r: typeof legalOpinionDraftsTable.$inferSelect): LegalOpinionDraft {
  return {
    id: r.id, organizationId: r.organizationId, workspaceId: r.workspaceId, requestId: r.requestId,
    opinionType: r.opinionType as LegalOpinionType, report: r.report ?? "", foundation: r.foundation ?? "",
    conclusion: r.conclusion ?? "", conclusionType: (r.conclusionType as LegalOpinionConclusion | null) ?? null,
    recommendations: parseArr(r.recommendations), reservations: parseArr(r.reservations),
    attachments: parseArr(r.attachments), status: r.status as LegalOpinionDraftStatus, version: r.version,
    signed: r.signed === 1, signatureMethod: (r.signatureMethod as SignatureMethod | null) ?? null,
    signedBy: r.signedBy ?? null, signedAt: r.signedAt ?? null, author: r.author,
    correlationId: r.correlationId, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

// ─── Versions ─────────────────────────────────────────────────────────────────

export async function insertLegalOpinionVersion(v: {
  organizationId: number; draftId: string; workspaceId: string; version: number;
  contentHash: string; snapshot: string; author: number; correlationId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = versionId(v.organizationId, v.draftId, v.version);
  // R3 / PR-06 — versões são APPEND-ONLY: uma versão já gravada nunca é sobrescrita (o duplicado é no-op).
  await db.insert(legalOpinionVersionsTable).values({
    id, organizationId: v.organizationId, draftId: v.draftId, workspaceId: v.workspaceId,
    version: v.version, contentHash: v.contentHash, snapshot: v.snapshot, author: v.author, correlationId: v.correlationId,
  }).onDuplicateKeyUpdate({ set: { id: sql`id` } });
}

function versionId(organizationId: number, draftId: string, version: number): string {
  return createHash("sha256").update(`lov:${organizationId}:${draftId}:${version}`).digest("hex").slice(0, 32);
}

export async function listLegalOpinionVersions(draftId: string, orgId: number): Promise<Array<{ id: string; version: number; contentHash: string; author: number; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(legalOpinionVersionsTable)
    .where(and(eq(legalOpinionVersionsTable.draftId, draftId), eq(legalOpinionVersionsTable.organizationId, orgId)))
    .orderBy(asc(legalOpinionVersionsTable.version));
  return rows.map(r => ({ id: r.id, version: r.version, contentHash: r.contentHash, author: r.author, createdAt: r.createdAt }));
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function listLegalOpinionTemplates(orgId: number): Promise<Array<{ id: string; name: string; opinionType: string; active: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(legalOpinionTemplatesTable)
    .where(eq(legalOpinionTemplatesTable.organizationId, orgId));
  return rows.map(r => ({ id: r.id, name: r.name, opinionType: r.opinionType, active: r.active === 1 }));
}

// ─── History (timeline do parecer) ──────────────────────────────────────────────

export async function countLegalOpinionHistory(workspaceId: string, orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: legalOpinionHistoryTable.id }).from(legalOpinionHistoryTable)
    .where(and(eq(legalOpinionHistoryTable.workspaceId, workspaceId), eq(legalOpinionHistoryTable.organizationId, orgId)));
  return rows.length;
}

export async function insertLegalOpinionHistory(e: {
  organizationId: number; workspaceId: string; order: number; eventType: string;
  actor: string; summary: string; refId?: string; correlationId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = createHash("sha256").update(`loh:${e.organizationId}:${e.workspaceId}:${e.order}:${e.eventType}`).digest("hex").slice(0, 20);
  await db.insert(legalOpinionHistoryTable).values({
    id, organizationId: e.organizationId, workspaceId: e.workspaceId, eventOrder: e.order,
    eventType: e.eventType, actor: e.actor, summary: e.summary, refId: e.refId ?? "", correlationId: e.correlationId,
  }).onDuplicateKeyUpdate({ set: { summary: e.summary } });
}

export async function listLegalOpinionHistory(workspaceId: string, orgId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(legalOpinionHistoryTable)
    .where(and(eq(legalOpinionHistoryTable.workspaceId, workspaceId), eq(legalOpinionHistoryTable.organizationId, orgId)))
    .orderBy(asc(legalOpinionHistoryTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", refId: r.refId, createdAt: r.createdAt }));
}

// ─── Lawyer assignments ─────────────────────────────────────────────────────────

export async function insertLawyerAssignment(a: LawyerAssignment): Promise<LawyerAssignment | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(lawyerAssignmentsTable).values({
    id: a.id, organizationId: a.organizationId, workspaceId: a.workspaceId, requestId: a.requestId,
    lawyerId: a.lawyerId, sector: a.sector, priority: a.priority, correlationId: a.correlationId, assignedAt: toDb(a.assignedAt),
  }).onDuplicateKeyUpdate({ set: { lawyerId: a.lawyerId, sector: a.sector, priority: a.priority } });
  return a;
}

export async function listLawyerAssignments(orgId: number, lawyerId?: number): Promise<Array<{ id: string; workspaceId: string; requestId: string; lawyerId: number | null; sector: string; priority: string; assignedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(lawyerAssignmentsTable)
    .where(eq(lawyerAssignmentsTable.organizationId, orgId));
  const mapped = rows.map(r => ({ id: r.id, workspaceId: r.workspaceId, requestId: r.requestId, lawyerId: r.lawyerId ?? null, sector: r.sector, priority: r.priority, assignedAt: r.assignedAt }));
  return lawyerId === undefined ? mapped : mapped.filter(r => r.lawyerId === lawyerId);
}
