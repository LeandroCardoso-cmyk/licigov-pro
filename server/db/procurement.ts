/**
 * Sprint 5.1 — Processo Licitatório Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do processo, pesquisa de preços, itens
 * inteligentes, CATMAT, recomendações, riscos, histórico, timeline e documentos.
 * Padrão getDb(): degrada graciosamente sem DB. Multi-tenant por organization_id.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import {
  procurementProcessesTable,
  priceResearchTable,
  priceResearchItemsTable,
  intelligentItemsTable,
  itemCatmatMatchesTable,
  itemRecommendationsTable,
  itemRisksTable,
  itemHistoryTable,
  processTimelineTable,
  generatedDocumentsTable,
} from "../../drizzle/schema";
import type { ProcurementWorkspace, ProcessStage, ProcessStatus, StartOption } from "../domain/procurementProcess";
import type { PriceResearchWorkspace, PriceResearchItem } from "../domain/priceResearch";
import type { IntelligentProcurementItem, ItemStatus, IntelligentItemSupplier } from "../domain/intelligentItem";
import type { CATMATMatch } from "../domain/catmatMatching";
import type { ItemRecommendation, ItemRisk } from "../domain/itemRecommendation";
import type { GeneratedDocument } from "../domain/generatedDocument";

function parseArr<T>(raw: string | null): T[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : []; } catch { return []; }
}

// ─── Process ─────────────────────────────────────────────────────────────────

export async function insertProcess(p: ProcurementWorkspace): Promise<ProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(procurementProcessesTable).values({
    id: p.id, organizationId: p.organizationId, processNumber: p.processNumber, object: p.object,
    modality: p.modality, currentStage: p.currentStage, status: p.status, startOption: p.startOption,
    responsibleUser: p.responsibleUser, participants: JSON.stringify(p.participants),
    activeCopilots: JSON.stringify(p.activeCopilots), correlationId: p.correlationId,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }).onDuplicateKeyUpdate({ set: { currentStage: p.currentStage, status: p.status, modality: p.modality, updatedAt: p.updatedAt } });
  return p;
}

export async function getProcess(id: string, orgId: number): Promise<ProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(procurementProcessesTable)
    .where(and(eq(procurementProcessesTable.id, id), eq(procurementProcessesTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, organizationId: r.organizationId, processNumber: r.processNumber, object: r.object ?? "",
    modality: r.modality, currentStage: r.currentStage as ProcessStage, status: r.status as ProcessStatus,
    startOption: r.startOption as StartOption, responsibleUser: r.responsibleUser,
    participants: parseArr<number>(r.participants), activeCopilots: parseArr<ProcurementWorkspace["activeCopilots"][number]>(r.activeCopilots),
    correlationId: r.correlationId, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listProcesses(orgId: number, limit = 50): Promise<Array<{ id: string; processNumber: string; object: string; currentStage: string; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementProcessesTable)
    .where(eq(procurementProcessesTable.organizationId, orgId)).orderBy(desc(procurementProcessesTable.updatedAt)).limit(limit);
  return rows.map(r => ({ id: r.id, processNumber: r.processNumber, object: r.object ?? "", currentStage: r.currentStage, status: r.status, updatedAt: r.updatedAt }));
}

export async function updateProcessStage(id: string, orgId: number, stage: string, status: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(procurementProcessesTable).set({ currentStage: stage, status, updatedAt })
    .where(and(eq(procurementProcessesTable.id, id), eq(procurementProcessesTable.organizationId, orgId)));
  return true;
}

// ─── Price research ────────────────────────────────────────────────────────

export async function insertResearch(r: PriceResearchWorkspace): Promise<PriceResearchWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(priceResearchTable).values({
    id: r.id, organizationId: r.organizationId, processId: r.processId, source: r.source,
    itemCount: r.itemCount, correlationId: r.correlationId, createdAt: r.createdAt,
  }).onDuplicateKeyUpdate({ set: { itemCount: r.itemCount } });
  return r;
}

export async function insertResearchItem(it: PriceResearchItem): Promise<PriceResearchItem | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(priceResearchItemsTable).values({
    id: it.id, organizationId: it.organizationId, researchId: it.researchId, processId: it.processId,
    description: it.description, quantity: String(it.quantity), unit: it.unit, supplier: it.supplier,
    brand: it.brand, model: it.model, value: String(it.value), observations: it.observations,
    source: it.source, createdAt: it.createdAt,
  }).onDuplicateKeyUpdate({ set: { value: String(it.value), quantity: String(it.quantity) } });
  return it;
}

// ─── Intelligent items ────────────────────────────────────────────────────

export async function insertIntelligentItem(it: IntelligentProcurementItem): Promise<IntelligentProcurementItem | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(intelligentItemsTable).values({
    id: it.id, organizationId: it.organizationId, processId: it.processId, sourceResearchId: it.sourceResearchId,
    description: it.description, quantity: String(it.quantity), unit: it.unit, averagePrice: String(it.averagePrice),
    suppliers: JSON.stringify(it.suppliers), suggestedCatmat: it.suggestedCATMAT,
    alternativeCatmat: JSON.stringify(it.alternativeCATMAT), specifications: JSON.stringify(it.specifications),
    risks: JSON.stringify(it.risks), recommendations: JSON.stringify(it.recommendations),
    status: it.status, approvedBy: it.approvedBy, correlationId: it.correlationId,
    createdAt: it.createdAt, updatedAt: it.updatedAt,
  }).onDuplicateKeyUpdate({ set: { status: it.status, suggestedCatmat: it.suggestedCATMAT, approvedBy: it.approvedBy, updatedAt: it.updatedAt } });
  return it;
}

export async function getIntelligentItem(id: string, orgId: number): Promise<IntelligentProcurementItem | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, orgId))).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, organizationId: r.organizationId, processId: r.processId, sourceResearchId: r.sourceResearchId,
    description: r.description ?? "", quantity: Number(r.quantity), unit: r.unit, averagePrice: Number(r.averagePrice),
    suppliers: parseArr<IntelligentItemSupplier>(r.suppliers), suggestedCATMAT: r.suggestedCatmat ?? null,
    alternativeCATMAT: parseArr<string>(r.alternativeCatmat), specifications: parseArr<string>(r.specifications),
    risks: parseArr<string>(r.risks), recommendations: parseArr<string>(r.recommendations),
    status: r.status as ItemStatus, approvedBy: r.approvedBy ?? null, correlationId: r.correlationId,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function listIntelligentItems(processId: string, orgId: number): Promise<Array<{ id: string; description: string; quantity: number; unit: string; averagePrice: number; suggestedCATMAT: string | null; status: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.processId, processId), eq(intelligentItemsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, description: r.description ?? "", quantity: Number(r.quantity), unit: r.unit, averagePrice: Number(r.averagePrice), suggestedCATMAT: r.suggestedCatmat ?? null, status: r.status }));
}

export async function updateItemStatus(id: string, orgId: number, status: ItemStatus, approvedBy: number | null, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(intelligentItemsTable).set({ status, approvedBy, updatedAt })
    .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, orgId)));
  return true;
}

export async function updateItemCatmat(id: string, orgId: number, catmat: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(intelligentItemsTable).set({ suggestedCatmat: catmat, updatedAt })
    .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, orgId)));
  return true;
}

// ─── CATMAT matches ────────────────────────────────────────────────────────

export async function insertCatmatMatch(m: CATMATMatch): Promise<CATMATMatch | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(itemCatmatMatchesTable).values({
    id: m.id, organizationId: m.organizationId, itemId: m.itemId, catmatCode: m.catmatCode,
    catmatDescription: m.catmatDescription, score: String(m.score), matchRank: m.rank,
    decision: m.decision, correlationId: m.correlationId, createdAt: m.createdAt,
  }).onDuplicateKeyUpdate({ set: { decision: m.decision } });
  return m;
}

export async function listCatmatMatches(itemId: string, orgId: number): Promise<Array<{ id: string; catmatCode: string; catmatDescription: string; score: number; rank: number; decision: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(itemCatmatMatchesTable)
    .where(and(eq(itemCatmatMatchesTable.itemId, itemId), eq(itemCatmatMatchesTable.organizationId, orgId)))
    .orderBy(asc(itemCatmatMatchesTable.matchRank));
  return rows.map(r => ({ id: r.id, catmatCode: r.catmatCode, catmatDescription: r.catmatDescription ?? "", score: Number(r.score), rank: r.matchRank, decision: r.decision }));
}

export async function updateMatchDecision(id: string, orgId: number, decision: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(itemCatmatMatchesTable).set({ decision })
    .where(and(eq(itemCatmatMatchesTable.id, id), eq(itemCatmatMatchesTable.organizationId, orgId)));
  return true;
}

// ─── Recommendations & risks ─────────────────────────────────────────────────

export async function insertItemRecommendation(rec: ItemRecommendation): Promise<ItemRecommendation | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(itemRecommendationsTable).values({
    id: rec.id, organizationId: rec.organizationId, itemId: rec.itemId, recType: rec.type,
    summary: rec.summary, reasoning: rec.reasoning, explainability: rec.explainability,
    provenance: rec.provenance, confidence: String(rec.confidence),
    accepted: rec.accepted === null ? null : (rec.accepted ? 1 : 0), correlationId: rec.correlationId, createdAt: rec.createdAt,
  }).onDuplicateKeyUpdate({ set: { accepted: rec.accepted === null ? null : (rec.accepted ? 1 : 0) } });
  return rec;
}

export async function listRecommendations(itemId: string, orgId: number): Promise<Array<{ id: string; type: string; summary: string; reasoning: string; explainability: string; provenance: string; confidence: number; accepted: boolean | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(itemRecommendationsTable)
    .where(and(eq(itemRecommendationsTable.itemId, itemId), eq(itemRecommendationsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, type: r.recType, summary: r.summary ?? "", reasoning: r.reasoning ?? "", explainability: r.explainability ?? "", provenance: r.provenance, confidence: Number(r.confidence), accepted: r.accepted === null ? null : r.accepted === 1 }));
}

export async function insertItemRisk(risk: ItemRisk): Promise<ItemRisk | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(itemRisksTable).values({
    id: risk.id, organizationId: risk.organizationId, itemId: risk.itemId, riskType: risk.type,
    severity: risk.severity, description: risk.description, explanation: risk.explanation,
    correlationId: risk.correlationId, createdAt: risk.createdAt,
  }).onDuplicateKeyUpdate({ set: { severity: risk.severity } });
  return risk;
}

export async function listItemRisks(itemId: string, orgId: number): Promise<Array<{ id: string; type: string; severity: string; description: string; explanation: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(itemRisksTable)
    .where(and(eq(itemRisksTable.itemId, itemId), eq(itemRisksTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, type: r.riskType, severity: r.severity, description: r.description ?? "", explanation: r.explanation ?? "" }));
}

export async function listItemHistory(processId: string, orgId: number): Promise<Array<{ id: string; object: string; year: number; winningSupplier: string; homologatedPrice: number; catmatUsed: string; outcome: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(itemHistoryTable)
    .where(and(eq(itemHistoryTable.processId, processId), eq(itemHistoryTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, object: r.object ?? "", year: r.year, winningSupplier: r.winningSupplier, homologatedPrice: Number(r.homologatedPrice), catmatUsed: r.catmatUsed, outcome: r.outcome }));
}

// ─── Timeline ─────────────────────────────────────────────────────────────

export async function recordProcessEvent(params: {
  organizationId: number; processId: string; eventType: string; actor: string; summary: string; refId?: string; correlationId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ id: processTimelineTable.id }).from(processTimelineTable)
    .where(and(eq(processTimelineTable.processId, params.processId), eq(processTimelineTable.organizationId, params.organizationId)));
  const order = existing.length;
  const id = createHash("sha256").update(`ptl:${params.organizationId}:${params.processId}:${order}:${params.eventType}`).digest("hex").slice(0, 20);
  await db.insert(processTimelineTable).values({
    id, organizationId: params.organizationId, processId: params.processId, eventOrder: order,
    eventType: params.eventType, actor: params.actor, summary: params.summary, refId: params.refId ?? "",
    correlationId: params.correlationId,
  }).onDuplicateKeyUpdate({ set: { summary: params.summary } });
}

export async function listProcessTimeline(processId: string, orgId: number): Promise<Array<{ id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(processTimelineTable)
    .where(and(eq(processTimelineTable.processId, processId), eq(processTimelineTable.organizationId, orgId)))
    .orderBy(asc(processTimelineTable.eventOrder));
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", refId: r.refId, createdAt: r.createdAt }));
}

// ─── Generated documents ─────────────────────────────────────────────────────

export async function insertGeneratedDocument(d: GeneratedDocument): Promise<GeneratedDocument | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(generatedDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, processId: d.processId, kind: d.kind, title: d.title,
    content: d.content, status: d.status, sources: JSON.stringify(d.sources), modality: d.modality,
    form: d.form, platform: d.platform, legalJustification: d.legalJustification,
    correlationId: d.correlationId, createdAt: d.createdAt, updatedAt: d.updatedAt,
  }).onDuplicateKeyUpdate({ set: { content: d.content, status: d.status, updatedAt: d.updatedAt } });
  return d;
}

export async function listGeneratedDocuments(processId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; status: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.processId, processId), eq(generatedDocumentsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, status: r.status }));
}
