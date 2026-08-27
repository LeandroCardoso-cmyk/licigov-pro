/**
 * Sprint 5.1 — Processo Licitatório Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) do processo, pesquisa de preços, itens
 * inteligentes, CATMAT, recomendações, riscos, histórico, timeline e documentos.
 * Padrão getDb(): degrada graciosamente sem DB. Multi-tenant por organization_id.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "./connection";
import { toDbDatetime, fromDbDatetime } from "./institutionalConsultations";
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
  generatedDocumentEditsTable,
} from "../../drizzle/schema";
import { draftContentHash } from "../domain/generatedDocument";
import type { ProcurementWorkspace, ProcessStage, ProcessStatus, StartOption } from "../domain/procurementProcess";
import type { PriceResearchWorkspace, PriceResearchItem } from "../domain/priceResearch";
import type { IntelligentProcurementItem, ItemStatus, IntelligentItemSupplier } from "../domain/intelligentItem";
import type { CATMATMatch } from "../domain/catmatMatching";
import type { ItemRecommendation, ItemRisk } from "../domain/itemRecommendation";
import type { GeneratedDocument } from "../domain/generatedDocument";

// C.4A — executor aceita a conexão (db) ou uma transação (tx), permitindo compor a persistência
// documental atomicamente (insertGeneratedDocument + official + timeline + idempotency numa única tx).
// Quando ausente, usa getDb() — assinatura compatível com todos os callers existentes.
type ProcDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ProcurementExecutor = ProcDb | Parameters<Parameters<ProcDb["transaction"]>[0]>[0];

function parseArr<T>(raw: string | null): T[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as T[] : []; } catch { return []; }
}

/**
 * Conversão de data na FRONTEIRA DO BANCO (reutiliza os helpers oficiais do
 * projeto — mesma convenção do repositório de consultas institucionais).
 *
 * Causa-raiz da falha de criação do Processo Licitatório canônico (PR B): o
 * domínio produz timestamps via `new Date().toISOString()` (com separador `T` e
 * sufixo `Z`), que colunas MySQL `DATETIME(3)` em modo estrito rejeitam
 * ("Incorrect datetime value"). O pipeline legado nunca inseria datetime
 * explícito (usava o default do banco), por isso o bug só aparece no fluxo
 * canônico recém-conectado. `toDb` normaliza na escrita; `fromDbDatetime` volta
 * a ISO na leitura (round-trip). Timestamps do domínio são sempre ISO válidos.
 */
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
const fromDb = (v: string): string => fromDbDatetime(v) ?? v;

// ─── Process ─────────────────────────────────────────────────────────────────

export async function insertProcess(p: ProcurementWorkspace): Promise<ProcurementWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(procurementProcessesTable).values({
    id: p.id, organizationId: p.organizationId, processNumber: p.processNumber, object: p.object,
    modality: p.modality, currentStage: p.currentStage, status: p.status, startOption: p.startOption,
    responsibleUser: p.responsibleUser, participants: JSON.stringify(p.participants),
    activeCopilots: JSON.stringify(p.activeCopilots), correlationId: p.correlationId,
    createdAt: toDb(p.createdAt), updatedAt: toDb(p.updatedAt),
  }).onDuplicateKeyUpdate({ set: { currentStage: p.currentStage, status: p.status, modality: p.modality, updatedAt: toDb(p.updatedAt) } });
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
    correlationId: r.correlationId, createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt),
  };
}

export async function listProcesses(orgId: number, limit = 50): Promise<Array<{ id: string; processNumber: string; object: string; modality: string | null; currentStage: string; status: string; updatedAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  // Ordenação determinística: updatedAt desc + id como desempate estável
  // (a Central depende de ordem previsível — Escopo 3 da PR B).
  const rows = await db.select().from(procurementProcessesTable)
    .where(eq(procurementProcessesTable.organizationId, orgId))
    .orderBy(desc(procurementProcessesTable.updatedAt), asc(procurementProcessesTable.id)).limit(limit);
  return rows.map(r => ({ id: r.id, processNumber: r.processNumber, object: r.object ?? "", modality: r.modality, currentStage: r.currentStage, status: r.status, updatedAt: fromDb(r.updatedAt) }));
}

export async function updateProcessStage(id: string, orgId: number, stage: string, status: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(procurementProcessesTable).set({ currentStage: stage, status, updatedAt: toDb(updatedAt) })
    .where(and(eq(procurementProcessesTable.id, id), eq(procurementProcessesTable.organizationId, orgId)));
  return true;
}

// ─── Price research ────────────────────────────────────────────────────────

export async function insertResearch(r: PriceResearchWorkspace): Promise<PriceResearchWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(priceResearchTable).values({
    id: r.id, organizationId: r.organizationId, processId: r.processId, source: r.source,
    itemCount: r.itemCount, correlationId: r.correlationId, createdAt: toDb(r.createdAt),
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
    source: it.source, createdAt: toDb(it.createdAt),
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
    createdAt: toDb(it.createdAt), updatedAt: toDb(it.updatedAt),
  }).onDuplicateKeyUpdate({ set: { status: it.status, suggestedCatmat: it.suggestedCATMAT, approvedBy: it.approvedBy, updatedAt: toDb(it.updatedAt) } });
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
    createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt),
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
  await db.update(intelligentItemsTable).set({ status, approvedBy, updatedAt: toDb(updatedAt) })
    .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, orgId)));
  return true;
}

export async function updateItemCatmat(id: string, orgId: number, catmat: string, updatedAt: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(intelligentItemsTable).set({ suggestedCatmat: catmat, updatedAt: toDb(updatedAt) })
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
    decision: m.decision, correlationId: m.correlationId, createdAt: toDb(m.createdAt),
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
    accepted: rec.accepted === null ? null : (rec.accepted ? 1 : 0), correlationId: rec.correlationId, createdAt: toDb(rec.createdAt),
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
    correlationId: risk.correlationId, createdAt: toDb(risk.createdAt),
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
}, executor?: ProcurementExecutor): Promise<void> {
  const db = executor ?? await getDb();
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
  return rows.map(r => ({ id: r.id, order: r.eventOrder, eventType: r.eventType, actor: r.actor, summary: r.summary ?? "", refId: r.refId, createdAt: fromDb(r.createdAt) }));
}

// ─── Generated documents ─────────────────────────────────────────────────────

export async function insertGeneratedDocument(d: GeneratedDocument, executor?: ProcurementExecutor): Promise<GeneratedDocument | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  // C.4B.3A — `author_user_id` é o ORIGINADOR ESTÁVEL: gravado só no INSERT (criação), NUNCA
  // sobrescrito no update. O update preserva a autoria original e apenas atualiza conteúdo/status
  // (a proveniência da alteração material — último ator + ledger — é responsabilidade de
  // applyDraftContentMutationTx, não deste upsert de baixo nível).
  await db.insert(generatedDocumentsTable).values({
    id: d.id, organizationId: d.organizationId, processId: d.processId, kind: d.kind, title: d.title,
    content: d.content, status: d.status, sources: JSON.stringify(d.sources), modality: d.modality,
    form: d.form, platform: d.platform, legalJustification: d.legalJustification, authorUserId: d.authorUserId,
    lastSubstantiveActorUserId: d.lastSubstantiveActorUserId, lastSubstantiveAt: d.lastSubstantiveAt ? toDb(d.lastSubstantiveAt) : null,
    correlationId: d.correlationId, createdAt: toDb(d.createdAt), updatedAt: toDb(d.updatedAt),
  }).onDuplicateKeyUpdate({ set: { content: d.content, status: d.status, updatedAt: toDb(d.updatedAt) } });
  return d;
}

// C.4B.3A — operações materiais registradas no ledger:
//   ai_regenerate   = ETP/TR/Edital gerados/regenerados por IA (Kernel/copilotos);
//   dfd_regenerate  = regeneração DETERMINÍSTICA (template, sem IA) do DFD "criar do zero";
//   dfd_manual_edit = edição humana manual do DFD (saveDFD governado);
//   human_edit      = reservado para o editor humano de ETP/TR/Edital (C.4B.3B).
export type DraftEditOperation = "human_edit" | "ai_regenerate" | "dfd_regenerate" | "dfd_manual_edit";

/**
 * C.4B.3A — Estado de PARTIDA esperado (concorrência), com AUSÊNCIA explícita (sem null ambíguo):
 *   - `absent`  → o ator começou sem rascunho (1ª geração). Se sob lock já existir → CONFLICT
 *     (não converte silenciosamente uma 1ª geração concorrente em regeneração; o originador vencedor
 *     permanece);
 *   - `present` → o ator começou de um conteúdo cujo hash é `contentHash`; se o hash vigente sob lock
 *     divergir → CONFLICT (não sobrescreve alteração concorrente).
 */
export type DraftExpectedState = { type: "absent" } | { type: "present"; contentHash: string };

export interface DraftMutationInput {
  organizationId: number;
  processId: string;
  kind: string;
  actorUserId: number;
  /** Conteúdo/estado alvo. Em criação é o documento completo (author = actor). Em atualização o
   *  conteúdo é aplicado e o originador é PRESERVADO (o author do `doc` é ignorado). */
  doc: GeneratedDocument;
  operation: DraftEditOperation;
  /** Estado de partida capturado no início do attempt, revalidado SOB LOCK. */
  expectedState: DraftExpectedState;
  idempotencyKey: string;
  correlationId: string;
  reason?: string | null;
}

/** Resultado + SNAPSHOT CANÔNICO persistido (Blocker 2): a resposta cacheável reflete EXATAMENTE o
 *  estado de generated_documents após a operação — originador preservado, último ator conforme no-op. */
export interface DraftMutationResult { created: boolean; changed: boolean; document: GeneratedDocument; }

type GeneratedDocRow = typeof generatedDocumentsTable.$inferSelect;

/** Mapeia a LINHA persistida (sob lock) para o snapshot canônico de domínio. */
function rowToGeneratedDocument(r: GeneratedDocRow): GeneratedDocument {
  return {
    id: r.id, processId: r.processId, organizationId: r.organizationId, kind: r.kind as GeneratedDocument["kind"],
    title: r.title, content: r.content ?? "", status: r.status as GeneratedDocument["status"],
    sources: parseArr<string>(r.sources), modality: r.modality as GeneratedDocument["modality"],
    form: r.form as GeneratedDocument["form"], platform: r.platform as GeneratedDocument["platform"],
    legalJustification: r.legalJustification ?? "", authorUserId: r.authorUserId ?? null,
    lastSubstantiveActorUserId: r.lastSubstantiveActorUserId ?? null,
    lastSubstantiveAt: r.lastSubstantiveAt ? fromDb(r.lastSubstantiveAt) : null,
    correlationId: r.correlationId, createdAt: fromDb(r.createdAt), updatedAt: fromDb(r.updatedAt),
  };
}

/**
 * C.4B.3A — Mutação governada do conteúdo do rascunho DENTRO de uma transação:
 *   1. SELECT ... FOR UPDATE (lock de linha) tenant-scoped por (org, process, kind);
 *   2. revalida o estado de partida (`expectedState`) SOB LOCK — ausência-esperada-mas-presente,
 *      presença-esperada-mas-ausente, ou hash divergente → CONFLICT (sem overwrite, sem ledger errado);
 *   3. no-op determinístico quando o hash não muda (sem ledger, sem alterar último ator);
 *   4. quando muda: atualiza conteúdo, PRESERVA `author_user_id`, define último ator substantivo,
 *      e faz APPEND no ledger imutável `generated_document_edits` (com previous_content + hashes);
 *   5. criação quando `expectedState.type === "absent"` e o rascunho ainda não existe (author = actor).
 * Retorna o SNAPSHOT CANÔNICO persistido. Nenhum partial commit: chamada dentro da transação do caller.
 */
export async function applyDraftContentMutationTx(
  tx: ProcurementExecutor,
  input: DraftMutationInput,
): Promise<DraftMutationResult> {
  const { organizationId, processId, kind, actorUserId, doc, expectedState } = input;
  const rows = await tx.select().from(generatedDocumentsTable)
    .where(and(
      eq(generatedDocumentsTable.processId, processId),
      eq(generatedDocumentsTable.organizationId, organizationId),
      eq(generatedDocumentsTable.kind, kind),
    )).for("update").limit(1);

  const now = new Date().toISOString();
  const newHash = draftContentHash(doc.content);

  if (rows.length === 0) {
    // Esperava conteúdo existente (edição/regeneração), mas não há → estado divergente.
    if (expectedState.type === "present") {
      throw new TRPCError({ code: "CONFLICT", message: "O rascunho esperado não existe mais — recarregue antes de continuar." });
    }
    // expectedState absent + ausência real → criação (author = originador; último ator = criador).
    const created: GeneratedDocument = {
      ...doc, authorUserId: actorUserId, lastSubstantiveActorUserId: actorUserId,
      lastSubstantiveAt: now, createdAt: doc.createdAt || now, updatedAt: now,
    };
    await insertGeneratedDocument(created, tx);
    return { created: true, changed: true, document: created };
  }

  const existing = rows[0];
  const currentContent = existing.content ?? "";
  const currentHash = draftContentHash(currentContent);

  // Ausência-esperada-mas-presente: 1ª geração concorrente já criou o rascunho → CONFLICT (o originador
  // vencedor permanece; não converte silenciosamente em regeneração/overwrite).
  if (expectedState.type === "absent") {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho já foi criado por outra operação — recarregue antes de continuar." });
  }
  // Concorrência otimista revalidada SOB LOCK (não substituível pela verificação fora da transação).
  if (expectedState.contentHash !== currentHash) {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde o carregamento — recarregue e revise antes de salvar." });
  }

  // No-op determinístico: mesmo conteúdo em bytes → não muda último ator nem cria ledger. Snapshot = atual.
  if (newHash === currentHash) {
    return { created: false, changed: false, document: rowToGeneratedDocument(existing) };
  }

  // Alteração MATERIAL: atualiza conteúdo, PRESERVA o originador, marca último ator substantivo.
  await tx.update(generatedDocumentsTable).set({
    title: doc.title, content: doc.content, status: doc.status, sources: JSON.stringify(doc.sources),
    modality: doc.modality, form: doc.form, platform: doc.platform, legalJustification: doc.legalJustification,
    lastSubstantiveActorUserId: actorUserId, lastSubstantiveAt: toDb(now), updatedAt: toDb(now),
  }).where(and(
    eq(generatedDocumentsTable.id, existing.id),
    eq(generatedDocumentsTable.organizationId, organizationId),
  ));

  await tx.insert(generatedDocumentEditsTable).values({
    organizationId, processId, generatedDocumentId: existing.id, kind,
    actorUserId, previousContentHash: currentHash, newContentHash: newHash,
    previousContent: currentContent, operation: input.operation,
    reason: input.reason ?? null, correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey, createdAt: toDb(now),
  });

  // Snapshot CANÔNICO: reflete EXATAMENTE o que ficou persistido. O UPDATE não altera
  // `correlation_id` (correlação da ORIGEM/criação do rascunho — a correlação de CADA alteração vive em
  // generated_document_edits.correlation_id), nem o originador (author preservado). Por isso o snapshot
  // usa os valores PERSISTIDOS de correlationId/authorUserId/createdAt, não os do `doc` da operação.
  const document: GeneratedDocument = {
    ...doc, id: existing.id, authorUserId: existing.authorUserId ?? null,
    lastSubstantiveActorUserId: actorUserId, lastSubstantiveAt: now,
    correlationId: existing.correlationId,
    createdAt: fromDb(existing.createdAt), updatedAt: now,
  };
  return { created: false, changed: true, document };
}

export async function listGeneratedDocuments(processId: string, orgId: number): Promise<Array<{ id: string; kind: string; title: string; status: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.processId, processId), eq(generatedDocumentsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, status: r.status }));
}

/** Carrega um documento gerado (com conteúdo) por processo + kind, tenant-scoped. */
export async function getGeneratedDocumentByKind(
  processId: string, orgId: number, kind: string,
): Promise<{ id: string; kind: string; title: string; content: string; status: string; authorUserId: number | null; lastSubstantiveActorUserId: number | null; updatedAt: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(generatedDocumentsTable)
    .where(and(
      eq(generatedDocumentsTable.processId, processId),
      eq(generatedDocumentsTable.organizationId, orgId),
      eq(generatedDocumentsTable.kind, kind),
    )).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, kind: r.kind, title: r.title, content: r.content ?? "", status: r.status,
    authorUserId: r.authorUserId ?? null, lastSubstantiveActorUserId: r.lastSubstantiveActorUserId ?? null,
    updatedAt: fromDb(r.updatedAt),
  };
}
