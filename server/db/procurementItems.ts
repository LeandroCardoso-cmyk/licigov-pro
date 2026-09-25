/**
 * Itens da Contratação — acesso a procurement_items / procurement_lots / procurement_item_source_links /
 * procurement_item_events. TODA leitura e escrita é escopada por (organizationId, processId). Sem regra de
 * negócio aqui: só persistência tx-aware, locks (FOR UPDATE) e CAS por `revision`.
 */
import { and, asc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import {
  procurementItemsTable, procurementLotsTable, procurementItemSourceLinksTable, procurementItemEventsTable,
  priceResearchTable, importPromotions, importSessions,
  type ProcurementItemRow, type ProcurementLotRow,
} from "../../drizzle/schema";
import { fromDbDatetime } from "./institutionalConsultations";
import type { ProcurementExecutor } from "./procurement";
import type {
  ProcurementItem, ProcurementLot, ItemSourceLink, ItemProvenance, ItemOrigin, ItemStatus, LotStatus, CandidateSourceType,
  PriceResearchRecord,
} from "../domain/procurementItems";

async function exec(executor?: ProcurementExecutor): Promise<ProcurementExecutor> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Banco de dados indisponível — Itens da contratação indisponíveis (fail-closed).");
  return db as ProcurementExecutor;
}

const ts = (v: string) => fromDbDatetime(v) ?? v;

function toItem(r: ProcurementItemRow): ProcurementItem {
  return {
    id: r.id, organizationId: r.organizationId, processId: r.processId, description: r.description, unit: r.unit,
    lotId: r.lotId ?? null, ordinal: r.ordinal, status: r.status as ItemStatus, fingerprint: r.fingerprint,
    origin: r.origin as ItemOrigin, provenance: JSON.parse(r.provenanceJson) as ItemProvenance, revision: r.revision,
    createdBy: r.createdBy, updatedBy: r.updatedBy, createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt),
  };
}

function toLot(r: ProcurementLotRow): ProcurementLot {
  return {
    id: r.id, organizationId: r.organizationId, processId: r.processId, code: r.code, codeKey: r.codeKey, name: r.name,
    description: r.description ?? null, ordinal: r.ordinal, status: r.status as LotStatus, revision: r.revision,
    createdBy: r.createdBy, updatedBy: r.updatedBy, createdAt: ts(r.createdAt), updatedAt: ts(r.updatedAt),
  };
}

const itemScope = (org: number, pid: string) => and(eq(procurementItemsTable.organizationId, org), eq(procurementItemsTable.processId, pid));
const lotScope = (org: number, pid: string) => and(eq(procurementLotsTable.organizationId, org), eq(procurementLotsTable.processId, pid));

export async function listProcurementItems(org: number, pid: string, executor?: ProcurementExecutor): Promise<ProcurementItem[]> {
  const db = executor ?? await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementItemsTable).where(itemScope(org, pid))
    .orderBy(asc(procurementItemsTable.ordinal), asc(procurementItemsTable.id));
  return rows.map(toItem);
}

export async function listProcurementLots(org: number, pid: string, executor?: ProcurementExecutor): Promise<ProcurementLot[]> {
  const db = executor ?? await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementLotsTable).where(lotScope(org, pid))
    .orderBy(asc(procurementLotsTable.ordinal), asc(procurementLotsTable.id));
  return rows.map(toLot);
}

export async function listItemSourceLinks(org: number, pid: string, executor?: ProcurementExecutor): Promise<ItemSourceLink[]> {
  const db = executor ?? await getDb();
  if (!db) return [];
  const rows = await db.select().from(procurementItemSourceLinksTable)
    .where(and(eq(procurementItemSourceLinksTable.organizationId, org), eq(procurementItemSourceLinksTable.processId, pid)))
    .orderBy(asc(procurementItemSourceLinksTable.id));
  return rows.map((r) => ({
    itemId: r.itemId, sourceType: r.sourceType as CandidateSourceType, sourceId: r.sourceId, sourceItemKey: r.sourceItemKey,
    sourceDigest: r.sourceDigest, sourceQuantity: r.sourceQuantity == null ? null : Number(r.sourceQuantity),
    sourceDescription: r.sourceDescription, sourceUnit: r.sourceUnit, sourceLotCode: r.sourceLotCode ?? null,
    createdBy: r.createdBy, createdAt: ts(r.createdAt),
  }));
}

export async function lockItem(tx: ProcurementExecutor, org: number, pid: string, id: string): Promise<ProcurementItem | null> {
  const rows = await tx.select().from(procurementItemsTable).where(and(itemScope(org, pid), eq(procurementItemsTable.id, id))).for("update").limit(1);
  return rows[0] ? toItem(rows[0]) : null;
}

export async function lockLot(tx: ProcurementExecutor, org: number, pid: string, id: string): Promise<ProcurementLot | null> {
  const rows = await tx.select().from(procurementLotsTable).where(and(lotScope(org, pid), eq(procurementLotsTable.id, id))).for("update").limit(1);
  return rows[0] ? toLot(rows[0]) : null;
}

export async function nextItemOrdinal(tx: ProcurementExecutor, org: number, pid: string): Promise<number> {
  const [r] = await tx.select({ m: sql<number>`COALESCE(MAX(${procurementItemsTable.ordinal}), 0)` }).from(procurementItemsTable).where(itemScope(org, pid));
  return Number(r?.m ?? 0) + 1;
}

export async function nextLotOrdinal(tx: ProcurementExecutor, org: number, pid: string): Promise<number> {
  const [r] = await tx.select({ m: sql<number>`COALESCE(MAX(${procurementLotsTable.ordinal}), 0)` }).from(procurementLotsTable).where(lotScope(org, pid));
  return Number(r?.m ?? 0) + 1;
}

/** Insere o item se o id (determinístico pela origem) ainda não existe. Retorna false se já existia. */
export async function insertItemIfAbsent(tx: ProcurementExecutor, it: Omit<ProcurementItem, "createdAt" | "updatedAt">, correlationId: string): Promise<boolean> {
  const exists = await tx.select({ id: procurementItemsTable.id }).from(procurementItemsTable).where(eq(procurementItemsTable.id, it.id)).limit(1);
  if (exists.length) return false;
  await tx.insert(procurementItemsTable).values({
    id: it.id, organizationId: it.organizationId, processId: it.processId, description: it.description, unit: it.unit,
    lotId: it.lotId, ordinal: it.ordinal, status: it.status, fingerprint: it.fingerprint, origin: it.origin,
    provenanceJson: JSON.stringify(it.provenance), revision: it.revision, createdBy: it.createdBy, updatedBy: it.updatedBy,
    correlationId: correlationId.slice(0, 64),
  }).onDuplicateKeyUpdate({ set: { id: it.id } });
  return true;
}

export async function insertLotIfAbsent(tx: ProcurementExecutor, lot: Omit<ProcurementLot, "createdAt" | "updatedAt">, correlationId: string): Promise<boolean> {
  const exists = await tx.select({ id: procurementLotsTable.id }).from(procurementLotsTable)
    .where(and(lotScope(lot.organizationId, lot.processId), eq(procurementLotsTable.codeKey, lot.codeKey))).limit(1);
  if (exists.length) return false;
  await tx.insert(procurementLotsTable).values({
    id: lot.id, organizationId: lot.organizationId, processId: lot.processId, code: lot.code, codeKey: lot.codeKey,
    name: lot.name, description: lot.description, ordinal: lot.ordinal, status: lot.status, revision: lot.revision,
    createdBy: lot.createdBy, updatedBy: lot.updatedBy, correlationId: correlationId.slice(0, 64),
  });
  return true;
}

export type ItemPatch = Partial<Pick<ProcurementItem, "description" | "unit" | "lotId" | "ordinal" | "status" | "fingerprint" | "provenance">> & { withdrawnReason?: string | null };

/** CAS por revision: só atualiza se a revisão vigente for a esperada. false = concorrência (STALE_REVISION). */
export async function updateItemCAS(tx: ProcurementExecutor, org: number, pid: string, id: string, expectedRevision: number, actor: number, patch: ItemPatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    revision: sql`${procurementItemsTable.revision} + 1`, updatedBy: actor, updatedAt: sql`CURRENT_TIMESTAMP(3)`,
  };
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.unit !== undefined) set.unit = patch.unit;
  if (patch.lotId !== undefined) set.lotId = patch.lotId;
  if (patch.ordinal !== undefined) set.ordinal = patch.ordinal;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.fingerprint !== undefined) set.fingerprint = patch.fingerprint;
  if (patch.provenance !== undefined) set.provenanceJson = JSON.stringify(patch.provenance);
  if (patch.withdrawnReason !== undefined) set.withdrawnReason = patch.withdrawnReason;
  const res = await tx.update(procurementItemsTable).set(set)
    .where(and(itemScope(org, pid), eq(procurementItemsTable.id, id), eq(procurementItemsTable.revision, expectedRevision)));
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return (header?.affectedRows ?? 0) === 1;
}

export type LotPatch = Partial<Pick<ProcurementLot, "name" | "description" | "ordinal" | "status" | "code" | "codeKey">>;

export async function updateLotCAS(tx: ProcurementExecutor, org: number, pid: string, id: string, expectedRevision: number, actor: number, patch: LotPatch): Promise<boolean> {
  const set: Record<string, unknown> = {
    revision: sql`${procurementLotsTable.revision} + 1`, updatedBy: actor, updatedAt: sql`CURRENT_TIMESTAMP(3)`, ...patch,
  };
  const res = await tx.update(procurementLotsTable).set(set)
    .where(and(lotScope(org, pid), eq(procurementLotsTable.id, id), eq(procurementLotsTable.revision, expectedRevision)));
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return (header?.affectedRows ?? 0) === 1;
}

/** Vínculo evidência → item. UNIQUE por evidência: a mesma evidência nunca é vinculada duas vezes. */
export async function insertSourceLinkIfAbsent(tx: ProcurementExecutor, org: number, pid: string, link: Omit<ItemSourceLink, "createdAt">, correlationId: string): Promise<boolean> {
  const exists = await tx.select({ id: procurementItemSourceLinksTable.id }).from(procurementItemSourceLinksTable).where(and(
    eq(procurementItemSourceLinksTable.organizationId, org), eq(procurementItemSourceLinksTable.processId, pid),
    eq(procurementItemSourceLinksTable.sourceType, link.sourceType), eq(procurementItemSourceLinksTable.sourceId, link.sourceId),
    eq(procurementItemSourceLinksTable.sourceItemKey, link.sourceItemKey),
  )).limit(1);
  if (exists.length) return false;
  await tx.insert(procurementItemSourceLinksTable).values({
    organizationId: org, processId: pid, itemId: link.itemId, sourceType: link.sourceType, sourceId: link.sourceId.slice(0, 64),
    sourceItemKey: link.sourceItemKey.slice(0, 64), sourceDigest: link.sourceDigest.slice(0, 32),
    sourceQuantity: link.sourceQuantity === null ? null : String(link.sourceQuantity),
    sourceDescription: link.sourceDescription, sourceUnit: link.sourceUnit.slice(0, 30), sourceLotCode: link.sourceLotCode?.slice(0, 40) ?? null,
    createdBy: link.createdBy, correlationId: correlationId.slice(0, 64),
  }).onDuplicateKeyUpdate({ set: { itemId: sql`${procurementItemSourceLinksTable.itemId}` } });
  return true;
}

export interface ItemEvent {
  itemId?: string | null; lotId?: string | null; eventType: string; actorUserId: number;
  beforeHash?: string | null; afterHash?: string | null; source?: string | null; reason?: string | null;
  details?: Record<string, unknown> | null;
}

/** Ledger APPEND-ONLY de auditoria (sem conteúdo documental integral). */
export async function appendItemEvents(tx: ProcurementExecutor, org: number, pid: string, events: readonly ItemEvent[], correlationId: string): Promise<void> {
  if (!events.length) return;
  await tx.insert(procurementItemEventsTable).values(events.map((e) => ({
    organizationId: org, processId: pid, itemId: e.itemId ?? null, lotId: e.lotId ?? null, eventType: e.eventType,
    actorUserId: e.actorUserId, beforeHash: e.beforeHash ?? null, afterHash: e.afterHash ?? null, source: e.source ?? null,
    reason: e.reason?.slice(0, 500) ?? null, detailsJson: e.details ? JSON.stringify(e.details) : null,
    correlationId: correlationId.slice(0, 64),
  })));
}

export async function listItemEvents(org: number, pid: string, executor?: ProcurementExecutor) {
  const db = await exec(executor);
  return db.select().from(procurementItemEventsTable)
    .where(and(eq(procurementItemEventsTable.organizationId, org), eq(procurementItemEventsTable.processId, pid)))
    .orderBy(asc(procurementItemEventsTable.id));
}

// ─── Proveniência das pesquisas do processo (fonte de candidatos) ────────────────────────────

/**
 * Pesquisas (`price_research`) do processo com a proveniência COMPROVADA pelo ledger — só leitura, tudo por
 * (organizationId, processId), revalidando sessão e promoção no mesmo escopo:
 *  - `promoted_session`: há `import_promotions` (targetKind price_research, targetRef = pesquisa) cuja sessão
 *    é do MESMO tenant/processo, `approved` e `promotionStatus = promoted`;
 *  - `manual_import`: pesquisa do processo SEM nenhuma promoção associada (caminho manual/colar).
 * Pesquisa com promoção cuja sessão não se comprova ⇒ omitida (desconhecida ⇒ inelegível, fail-closed).
 * Também conta as sessões de Pesquisa de Preços ainda NÃO promovidas (em revisão/aguardando promoção).
 */
export async function listPriceResearchProvenance(org: number, pid: string, executor?: ProcurementExecutor): Promise<{
  researches: PriceResearchRecord[]; sessionsAwaitingPromotion: number;
}> {
  const db = await exec(executor);
  const researches = await db.select({ id: priceResearchTable.id }).from(priceResearchTable)
    .where(and(eq(priceResearchTable.organizationId, org), eq(priceResearchTable.processId, pid)));
  const ids = researches.map((r) => r.id);
  const promotions = ids.length === 0 ? [] : await db.select({ targetRef: importPromotions.targetRef, sessionId: importPromotions.importSessionId })
    .from(importPromotions)
    .where(and(eq(importPromotions.organizationId, org), eq(importPromotions.procurementProcessId, pid),
      eq(importPromotions.targetKind, "price_research"), isNotNull(importPromotions.targetRef), inArray(importPromotions.targetRef, ids)));
  const sessionIds = [...new Set(promotions.map((p) => p.sessionId))];
  const validSessions = new Set((sessionIds.length === 0 ? [] : await db.select({ id: importSessions.id }).from(importSessions)
    .where(and(eq(importSessions.organizationId, org), eq(importSessions.procurementProcessId, pid), inArray(importSessions.id, sessionIds),
      eq(importSessions.status, "approved"), eq(importSessions.promotionStatus, "promoted")))).map((r) => r.id));
  const out: PriceResearchRecord[] = [];
  for (const id of ids) {
    const promos = promotions.filter((p) => p.targetRef === id);
    if (promos.length === 0) { out.push({ researchId: id, provenance: "manual_import", importSessionId: null }); continue; }
    const ok = promos.find((p) => validSessions.has(p.sessionId));
    if (ok) out.push({ researchId: id, provenance: "promoted_session", importSessionId: ok.sessionId });
  }
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(importSessions)
    .where(and(eq(importSessions.organizationId, org), eq(importSessions.procurementProcessId, pid),
      eq(importSessions.importType, "price_research"), eq(importSessions.promotionStatus, "none"),
      notInArray(importSessions.status, ["rejected", "failed", "archived"])));
  return { researches: out, sessionsAwaitingPromotion: Number(n) };
}

