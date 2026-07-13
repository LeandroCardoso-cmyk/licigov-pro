/**
 * FASE 5 — Contratação Direta Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do DirectProcurementWorkspace e agregados
 * (procedimento, propostas, justificativas, documentação, ratificação, publicações).
 * Reutiliza o Timeline Engine (process_timeline) e o Price Research Workspace —
 * NUNCA duplica infraestrutura. Padrão getDb(): degrada sem DB. Multi-tenant.
 * Nomes namespaced para não colidir com o repo legado `server/db/directContracts.ts`.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  directProcurementWorkspacesTable, directProcurementProceduresTable,
  proposalCollectionsTable, proposalDocumentsTable, contractJustificationsTable,
  priceJustificationsTable, requiredDocumentsTable, ratificationsTable, generatedPublicationsTable,
} from "../../drizzle/schema";
import type {
  DirectProcurementWorkspace, DirectProcurementType, DirectProcedureType,
  DirectProcurementStage, DirectProcurementStatus, DirectStartOption, AdaptiveFlags,
} from "../domain/directProcurementWorkspace";
import { DIRECT_DOMAIN_COPILOTS, defaultFlags } from "../domain/directProcurementWorkspace";
import type { DirectProcurementProcedure, ProposalCollection, ProposalDocument } from "../domain/directProcurementProcedure";
import type { ContractJustification, PriceJustification, RequiredDocument, Ratification, GeneratedPublication } from "../domain/directProcurementJustifications";
import type { CopilotType } from "../domain/institutionalCopilot";

function parseArr<T>(raw: string | null): T[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : []; } catch { return []; }
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export async function insertDirectProcurementWorkspace(ws: DirectProcurementWorkspace): Promise<DirectProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(directProcurementWorkspacesTable).values({
    id: ws.id, organizationId: ws.organizationId, processNumber: ws.processNumber, object: ws.object,
    procurementType: ws.procurementType, procedureType: ws.procedureType, legalBasis: ws.legalBasis,
    startOption: ws.startOption, currentStage: ws.currentStage, status: ws.status, responsibleUser: ws.responsibleUser,
    participants: JSON.stringify(ws.participants), activeCopilots: JSON.stringify(ws.activeCopilots),
    flags: JSON.stringify(ws.flags), correlationId: ws.correlationId, createdAt: ws.createdAt, updatedAt: ws.updatedAt,
  }).onDuplicateKeyUpdate({ set: {
    procurementType: ws.procurementType, procedureType: ws.procedureType, legalBasis: ws.legalBasis,
    currentStage: ws.currentStage, status: ws.status, flags: JSON.stringify(ws.flags), updatedAt: ws.updatedAt,
  } });
  return ws;
}

export async function getDirectProcurementWorkspace(id: string, orgId: number): Promise<DirectProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(directProcurementWorkspacesTable)
    .where(and(eq(directProcurementWorkspacesTable.id, id), eq(directProcurementWorkspacesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  const flags = (() => {
    try { return r.flags ? JSON.parse(r.flags) as AdaptiveFlags : defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
    catch { return defaultFlags(r.procurementType as DirectProcurementType, r.startOption as DirectStartOption); }
  })();
  return {
    id: r.id, organizationId: r.organizationId, processNumber: r.processNumber, object: r.object ?? "",
    procurementType: r.procurementType as DirectProcurementType, procedureType: r.procedureType as DirectProcedureType,
    legalBasis: r.legalBasis, startOption: r.startOption as DirectStartOption,
    currentStage: r.currentStage as DirectProcurementStage, status: r.status as DirectProcurementStatus,
    responsibleUser: r.responsibleUser, participants: parseArr<number>(r.participants),
    activeCopilots: (parseArr<CopilotType>(r.activeCopilots).length ? parseArr<CopilotType>(r.activeCopilots) : DIRECT_DOMAIN_COPILOTS),
    flags, correlationId: r.correlationId, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listDirectProcurementWorkspaces(orgId: number, limit = 50): Promise<Array<{ id: string; processNumber: string; object: string; procurementType: string; procedureType: string; currentStage: string; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(directProcurementWorkspacesTable)
    .where(eq(directProcurementWorkspacesTable.organizationId, orgId))
    .orderBy(desc(directProcurementWorkspacesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, processNumber: r.processNumber, object: r.object ?? "", procurementType: r.procurementType, procedureType: r.procedureType, currentStage: r.currentStage, status: r.status, updatedAt: r.updatedAt }));
}

export async function updateDirectProcurementStage(id: string, orgId: number, stage: string, status: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(directProcurementWorkspacesTable).set({ currentStage: stage, status, updatedAt })
    .where(and(eq(directProcurementWorkspacesTable.id, id), eq(directProcurementWorkspacesTable.organizationId, orgId)));
  return true;
}

// ─── Procedure ───────────────────────────────────────────────────────────────

export async function insertDirectProcedure(p: DirectProcurementProcedure): Promise<DirectProcurementProcedure | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(directProcurementProceduresTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, procedureType: p.procedureType,
    platform: p.platform, receiptMethod: p.receiptMethod, instructions: p.instructions, correlationId: p.correlationId, createdAt: p.createdAt,
  }).onDuplicateKeyUpdate({ set: { procedureType: p.procedureType, platform: p.platform, receiptMethod: p.receiptMethod, instructions: p.instructions } });
  return p;
}

export async function getDirectProcedure(workspaceId: string, orgId: number): Promise<{ id: string; procedureType: string; platform: string | null; receiptMethod: string | null; instructions: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(directProcurementProceduresTable)
    .where(and(eq(directProcurementProceduresTable.workspaceId, workspaceId), eq(directProcurementProceduresTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, procedureType: r.procedureType, platform: r.platform ?? null, receiptMethod: r.receiptMethod ?? null, instructions: r.instructions ?? "" };
}

// ─── Proposals ───────────────────────────────────────────────────────────────

export async function insertProposalCollection(p: ProposalCollection): Promise<ProposalCollection | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(proposalCollectionsTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, supplierName: p.supplierName,
    supplierDocument: p.supplierDocument, proposalValue: String(p.proposalValue), protocol: p.protocol,
    receivedVia: p.receivedVia, correlationId: p.correlationId, createdAt: p.createdAt,
  }).onDuplicateKeyUpdate({ set: { proposalValue: String(p.proposalValue), protocol: p.protocol } });
  return p;
}

export async function listProposalCollections(workspaceId: string, orgId: number): Promise<Array<{ id: string; supplierName: string; supplierDocument: string; proposalValue: number; protocol: string; receivedVia: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(proposalCollectionsTable)
    .where(and(eq(proposalCollectionsTable.workspaceId, workspaceId), eq(proposalCollectionsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, supplierName: r.supplierName, supplierDocument: r.supplierDocument, proposalValue: Number(r.proposalValue), protocol: r.protocol, receivedVia: r.receivedVia }));
}

export async function insertProposalDocument(d: ProposalDocument): Promise<ProposalDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(proposalDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, proposalId: d.proposalId, workspaceId: d.workspaceId,
    kind: d.kind, title: d.title, documentReference: d.documentReference, correlationId: d.correlationId, createdAt: d.createdAt,
  }).onDuplicateKeyUpdate({ set: { title: d.title } });
  return d;
}

export async function listProposalDocuments(proposalId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; documentReference: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(proposalDocumentsTable)
    .where(and(eq(proposalDocumentsTable.proposalId, proposalId), eq(proposalDocumentsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, documentReference: r.documentReference }));
}

// ─── Contract justification ──────────────────────────────────────────────────

export async function upsertContractJustification(j: ContractJustification): Promise<ContractJustification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(contractJustificationsTable).values({
    id: j.id, organizationId: j.organizationId, workspaceId: j.workspaceId, need: j.need, publicInterest: j.publicInterest,
    motivation: j.motivation, legalFoundation: j.legalFoundation, benefits: j.benefits, alternatives: j.alternatives,
    correlationId: j.correlationId, createdAt: j.createdAt, updatedAt: j.updatedAt,
  }).onDuplicateKeyUpdate({ set: {
    need: j.need, publicInterest: j.publicInterest, motivation: j.motivation, legalFoundation: j.legalFoundation,
    benefits: j.benefits, alternatives: j.alternatives, updatedAt: j.updatedAt,
  } });
  return j;
}

export async function getContractJustification(workspaceId: string, orgId: number): Promise<ContractJustification | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(contractJustificationsTable)
    .where(and(eq(contractJustificationsTable.workspaceId, workspaceId), eq(contractJustificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, organizationId: r.organizationId, workspaceId: r.workspaceId, need: r.need ?? "", publicInterest: r.publicInterest ?? "", motivation: r.motivation ?? "", legalFoundation: r.legalFoundation ?? "", benefits: r.benefits ?? "", alternatives: r.alternatives ?? "", correlationId: r.correlationId, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

// ─── Price justification ─────────────────────────────────────────────────────

export async function upsertPriceJustification(j: PriceJustification): Promise<PriceJustification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(priceJustificationsTable).values({
    id: j.id, organizationId: j.organizationId, workspaceId: j.workspaceId, source: j.source, justification: j.justification,
    referenceValue: String(j.referenceValue), researchId: j.researchId, documentReferences: JSON.stringify(j.documentReferences),
    correlationId: j.correlationId, createdAt: j.createdAt,
  }).onDuplicateKeyUpdate({ set: { source: j.source, justification: j.justification, referenceValue: String(j.referenceValue), researchId: j.researchId, documentReferences: JSON.stringify(j.documentReferences) } });
  return j;
}

export async function getPriceJustification(workspaceId: string, orgId: number): Promise<{ id: string; source: string; justification: string; referenceValue: number; researchId: string; documentReferences: string[] } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(priceJustificationsTable)
    .where(and(eq(priceJustificationsTable.workspaceId, workspaceId), eq(priceJustificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, source: r.source, justification: r.justification ?? "", referenceValue: Number(r.referenceValue), researchId: r.researchId, documentReferences: parseArr<string>(r.documentReferences) };
}

// ─── Required documents (checklist) ──────────────────────────────────────────

export async function insertRequiredDocument(d: RequiredDocument): Promise<RequiredDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(requiredDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, workspaceId: d.workspaceId, name: d.name, required: d.required ? 1 : 0,
    status: d.status, documentReference: d.documentReference, correlationId: d.correlationId,
  }).onDuplicateKeyUpdate({ set: { status: d.status, documentReference: d.documentReference } });
  return d;
}

export async function listRequiredDocuments(workspaceId: string, orgId: number): Promise<Array<{ id: string; name: string; required: boolean; status: string; documentReference: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(requiredDocumentsTable)
    .where(and(eq(requiredDocumentsTable.workspaceId, workspaceId), eq(requiredDocumentsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, name: r.name, required: r.required === 1, status: r.status, documentReference: r.documentReference }));
}

export async function updateRequiredDocumentStatus(id: string, orgId: number, status: string, documentReference: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(requiredDocumentsTable).set({ status, documentReference })
    .where(and(eq(requiredDocumentsTable.id, id), eq(requiredDocumentsTable.organizationId, orgId)));
  return true;
}

// ─── Ratification ────────────────────────────────────────────────────────────

export async function insertRatification(r: Ratification): Promise<Ratification | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(ratificationsTable).values({
    id: r.id, organizationId: r.organizationId, workspaceId: r.workspaceId, responsible: r.responsible,
    decision: r.decision, justification: r.justification, evidence: JSON.stringify(r.evidence), correlationId: r.correlationId, ratifiedAt: r.ratifiedAt,
  }).onDuplicateKeyUpdate({ set: { decision: r.decision, justification: r.justification, evidence: JSON.stringify(r.evidence) } });
  return r;
}

export async function getRatification(workspaceId: string, orgId: number): Promise<{ id: string; responsible: number; decision: string; justification: string; evidence: string[]; ratifiedAt: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(ratificationsTable)
    .where(and(eq(ratificationsTable.workspaceId, workspaceId), eq(ratificationsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, responsible: r.responsible, decision: r.decision, justification: r.justification ?? "", evidence: parseArr<string>(r.evidence), ratifiedAt: r.ratifiedAt };
}

// ─── Publications ────────────────────────────────────────────────────────────

export async function insertGeneratedPublication(p: GeneratedPublication): Promise<GeneratedPublication | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(generatedPublicationsTable).values({
    id: p.id, organizationId: p.organizationId, workspaceId: p.workspaceId, kind: p.kind, title: p.title,
    content: p.content, correlationId: p.correlationId, createdAt: p.createdAt,
  }).onDuplicateKeyUpdate({ set: { content: p.content, title: p.title } });
  return p;
}

export async function listGeneratedPublications(workspaceId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(generatedPublicationsTable)
    .where(and(eq(generatedPublicationsTable.workspaceId, workspaceId), eq(generatedPublicationsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, createdAt: r.createdAt }));
}
