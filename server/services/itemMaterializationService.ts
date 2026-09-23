/**
 * P0 piloto — MATERIALIZAÇÃO CANÔNICA Pesquisa de Preços → Itens Inteligentes (hardening).
 *
 * FASE 1 — BASE (determinística, TRANSACIONAL, sem IA) — `materializeIntelligentItemsTx(tx, …)`, na MESMA
 * transação da gravação da pesquisa/cotações (promoção canônica E caminho manual): Pesquisa + cotações +
 * base dos Itens Inteligentes, ou nada.
 *
 *   Identidade (sem fuzzy): chave lógica = descrição normalizada | unidade canônica | quantidade.
 *     1) item v2 (id derivado da chave) → 2) ALIAS registrado (chave → item canônico) → 3) RECONCILIAÇÃO
 *     com item LEGADO (id antigo, só descrição): automática SÓ quando há exatamente UM candidato com a
 *     mesma descrição normalizada e unidade/quantidade compatíveis ou ausentes; o legado permanece o item
 *     canônico (id, status, approvedBy, CATMAT decidido, lineage preservados) e a chave v2 vira alias.
 *     2+ candidatos, ou candidato incompatível ⇒ FAIL-CLOSED: nenhum item novo (sem duplicar demanda), os
 *     candidatos ficam `review_required` e a resolução é humana (`resolveItemIdentity`).
 *
 *   Convergência (identidade de CONTEÚDO — quoteId + contentHash, nunca só quoteId):
 *     - item `pendente`/`em_analise`: cotações atualizadas deterministicamente (média recalculada);
 *     - item `aprovado`/`rejeitado`: números NUNCA sobrescritos em silêncio — `source_state = source_changed`
 *       e o conjunto novo fica em `pending_suppliers` até a decisão humana (`applyItemSourceUpdate`);
 *     - nada mudou (mesmo conjunto id+conteúdo) → nenhuma escrita (replay-safe).
 *
 * FASE 2 — ENRIQUECIMENTO (pós-commit, degradável, durável): pending → processing → done | failed, com
 * tentativas/último erro; `recoverStaleEnrichment` retoma pendências antigas ou processing travado.
 *
 * Tenant-scoped em todas as leituras/escritas. Nenhuma chamada a provider dentro de transação.
 */
import { createHash } from "crypto";
import { and, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  intelligentItemsTable, catmatDecisionsTable, intelligentItemIdentityAliasesTable, priceResearchItemsTable,
} from "../../drizzle/schema";
import { getDb } from "../db/connection";
import { toDbDatetime } from "../db/institutionalConsultations";
import {
  consolidateQuotes, mergeQuotes, intelligentItemIdForKey, intelligentItemLogicalKey, normalizeDescription,
  canonicalUnit, quantityMilli, quoteSetSignature, validQuotes, withContentHash, type PriceQuote, type ConsolidatedItem,
} from "../domain/priceQuoteConsolidation";
import { averageCents, centsToDecimalString, centsToReais, reaisToCents, type Cents } from "../domain/money";
import type { IntelligentItemSupplier } from "../domain/intelligentItem";
import { rankCATMAT, suggestedAndAlternatives } from "../domain/catmatMatching";
import { createItemRecommendation, createItemRisk, detectPriceOutlier } from "../domain/itemRecommendation";
import {
  insertCatmatMatch, insertItemRecommendation, insertItemRisk, recordProcessEvent, insertResearch, insertResearchItem,
  type ProcurementExecutor,
} from "../db/procurement";
import { createPriceResearchWorkspace, extractItemsFromText, type PriceResearchSource, type PriceResearchWorkspace } from "../domain/priceResearch";
import { catmatCandidates, suggestSpecifications } from "./itemIntelligenceService";
import { serviceLogger } from "./observabilityService";
import { assertKernelAccess } from "./kernelAccessService";

const log = serviceLogger("ItemMaterializationService");
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;

/** Máximo de tentativas do enriquecimento antes de `failed` terminal. */
export const ENRICHMENT_MAX_ATTEMPTS = 3;
/** Pendência/processamento parado há mais que isto é retomado pela recuperação. */
export const ENRICHMENT_STALE_MS = 10 * 60 * 1000;

type ItemRow = typeof intelligentItemsTable.$inferSelect;

export interface MaterializedItemRef {
  id: string; logicalKey: string;
  /** Cotações VÁLIDAS (com preço) do conjunto vigente do item. */
  quoteCount: number;
  averageCents: Cents;
}

export interface MaterializationResult {
  readonly created: string[];
  readonly updated: string[];
  readonly unchanged: string[];
  /** Itens decididos (aprovado/rejeitado) cuja fonte NÃO mudou — nada a fazer. */
  readonly preserved: string[];
  /** Itens decididos cuja fonte MUDOU — decisão preservada, `source_changed` sinalizado. */
  readonly sourceChanged: string[];
  /** Itens legados reconciliados automaticamente com a chave v2 (alias criado). */
  readonly reconciled: string[];
  /** Hash das chaves lógicas com identidade AMBÍGUA (nenhum item criado; revisão humana). */
  readonly reviewRequired: string[];
  readonly items: ReadonlyArray<MaterializedItemRef>;
}

export function logicalKeyHash(logicalKey: string): string {
  return createHash("sha256").update(logicalKey).digest("hex");
}

function parseSuppliers(raw: string | null): IntelligentItemSupplier[] {
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p as IntelligentItemSupplier[] : []; } catch { return []; }
}

/** Cotação (domínio canônico) → entrada de fornecedor do Item Inteligente (valor em REAIS). */
function quoteToSupplier(q: PriceQuote): IntelligentItemSupplier {
  const h = withContentHash(q);
  return {
    name: q.supplier.trim() || "Fornecedor não identificado",
    value: q.valueCents !== null ? centsToReais(q.valueCents) : 0,
    ...(q.brand ? { brand: q.brand } : {}),
    ...(q.model ? { model: q.model } : {}),
    ...(q.source ? { source: q.source } : {}),
    quoteId: q.quoteId,
    researchId: q.researchId,
    contentHash: h.contentHash,
  };
}

/** Fornecedor persistido → cotação. Entradas legadas sem quoteId ganham id estável (posição + conteúdo). */
function supplierToQuote(s: IntelligentItemSupplier, idx: number, base: { description: string; quantity: number; unit: string }): PriceQuote {
  const q: PriceQuote = {
    quoteId: s.quoteId ?? `legacy:${idx}:${s.name}:${s.value}`,
    researchId: s.researchId ?? "",
    description: base.description, quantity: base.quantity, unit: base.unit,
    supplier: s.name ?? "", brand: s.brand ?? "", model: s.model ?? "", source: s.source ?? "",
    valueCents: s.value > 0 ? reaisToCents(s.value) : null,
  };
  return s.contentHash ? { ...q, contentHash: s.contentHash } : q;
}

function quotesOf(raw: string | null, row: { description: string | null; quantity: string; unit: string }): PriceQuote[] {
  const base = { description: row.description ?? "", quantity: Number(row.quantity), unit: row.unit };
  return parseSuppliers(raw).map((s, i) => supplierToQuote(s, i, base));
}

function avgOf(quotes: readonly PriceQuote[]): Cents {
  return averageCents(validQuotes(quotes).map((q) => q.valueCents as Cents));
}

/** Item "nativo v2": o id é o derivado da sua PRÓPRIA chave lógica (não é legado). */
function isV2Native(row: ItemRow, org: number, processId: string): boolean {
  const key = intelligentItemLogicalKey({ description: row.description ?? "", unit: row.unit, quantity: Number(row.quantity) });
  return row.id === intelligentItemIdForKey(org, processId, key);
}

function legacyCompatible(row: ItemRow, g: ConsolidatedItem): boolean {
  const unitOk = !row.unit?.trim() || canonicalUnit(row.unit) === canonicalUnit(g.unit);
  const q = Number(row.quantity);
  const qtyOk = !q || quantityMilli(q) === quantityMilli(g.quantity);
  return unitOk && qtyOk;
}

async function lockItem(tx: ProcurementExecutor, org: number, id: string): Promise<ItemRow | null> {
  const rows = await tx.select().from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.id, id), eq(intelligentItemsTable.organizationId, org)))
    .for("update").limit(1);
  return rows[0] ?? null;
}

async function insertAlias(tx: ProcurementExecutor, p: {
  org: number; processId: string; logicalKey: string; itemId: string; resolution: "auto_legacy" | "manual" | "new_item";
  actorUserId?: number | null; reason?: string | null; correlationId: string;
}): Promise<string> {
  const keyHash = logicalKeyHash(p.logicalKey);
  // Append-only; corrida → no-op e prevalece o alias gravado primeiro (UNIQUE por tenant+processo+chave).
  await tx.insert(intelligentItemIdentityAliasesTable).values({
    organizationId: p.org, processId: p.processId, logicalKeyHash: keyHash, logicalKey: p.logicalKey,
    itemId: p.itemId, resolution: p.resolution, actorUserId: p.actorUserId ?? null, reason: p.reason ?? null,
    correlationId: p.correlationId.slice(0, 64),
  }).onDuplicateKeyUpdate({ set: { logicalKeyHash: sql`${intelligentItemIdentityAliasesTable.logicalKeyHash}` } });
  const rows = await tx.select({ itemId: intelligentItemIdentityAliasesTable.itemId }).from(intelligentItemIdentityAliasesTable)
    .where(and(eq(intelligentItemIdentityAliasesTable.organizationId, p.org), eq(intelligentItemIdentityAliasesTable.processId, p.processId), eq(intelligentItemIdentityAliasesTable.logicalKeyHash, keyHash)))
    .limit(1);
  return rows[0].itemId;
}

type Resolution =
  | { kind: "row"; row: ItemRow; reconciled: boolean }
  | { kind: "create" }
  | { kind: "ambiguous"; candidates: ItemRow[] };

async function resolveIdentity(tx: ProcurementExecutor, org: number, processId: string, g: ConsolidatedItem, correlationId: string): Promise<Resolution> {
  const v2Id = intelligentItemIdForKey(org, processId, g.logicalKey);
  const own = await lockItem(tx, org, v2Id);
  if (own) return { kind: "row", row: own, reconciled: false };

  const keyHash = logicalKeyHash(g.logicalKey);
  const alias = await tx.select().from(intelligentItemIdentityAliasesTable)
    .where(and(eq(intelligentItemIdentityAliasesTable.organizationId, org), eq(intelligentItemIdentityAliasesTable.processId, processId), eq(intelligentItemIdentityAliasesTable.logicalKeyHash, keyHash)))
    .limit(1);
  if (alias[0]) {
    if (alias[0].resolution === "new_item") return { kind: "create" };
    const target = await lockItem(tx, org, alias[0].itemId);
    if (target) return { kind: "row", row: target, reconciled: false };
  }

  // Candidatos LEGADOS: mesma descrição normalizada, não-nativos v2, sem alias para OUTRA chave.
  const processItems = await tx.select().from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.organizationId, org), eq(intelligentItemsTable.processId, processId)));
  const norm = normalizeDescription(g.description);
  const sameDesc = processItems.filter((r) => normalizeDescription(r.description ?? "") === norm && !isV2Native(r, org, processId));
  if (sameDesc.length === 0) return { kind: "create" };
  const aliased = await tx.select({ itemId: intelligentItemIdentityAliasesTable.itemId }).from(intelligentItemIdentityAliasesTable)
    .where(and(eq(intelligentItemIdentityAliasesTable.organizationId, org), eq(intelligentItemIdentityAliasesTable.processId, processId), inArray(intelligentItemIdentityAliasesTable.itemId, sameDesc.map((r) => r.id))));
  const taken = new Set(aliased.map((a) => a.itemId));
  const candidates = sameDesc.filter((r) => !taken.has(r.id));
  if (candidates.length === 0) return { kind: "create" };
  if (candidates.length === 1 && legacyCompatible(candidates[0], g)) {
    const winner = await insertAlias(tx, {
      org, processId, logicalKey: g.logicalKey, itemId: candidates[0].id, resolution: "auto_legacy",
      reason: "Reconciliação automática: único item legado com a mesma descrição e unidade/quantidade compatíveis.", correlationId,
    });
    const row = await lockItem(tx, org, winner);
    return row ? { kind: "row", row, reconciled: winner === candidates[0].id } : { kind: "create" };
  }
  return { kind: "ambiguous", candidates };
}

/**
 * FASE 1 — materialização BASE dentro da transação do chamador. Determinística e replay-safe.
 */
export async function materializeIntelligentItemsTx(
  tx: ProcurementExecutor,
  params: { organizationId: number; processId: string; researchId: string; quotes: readonly PriceQuote[]; correlationId: string },
): Promise<MaterializationResult> {
  const { organizationId: org, processId } = params;
  const groups = consolidateQuotes(params.quotes);
  const r = { created: [] as string[], updated: [] as string[], unchanged: [] as string[], preserved: [] as string[], sourceChanged: [] as string[], reconciled: [] as string[], reviewRequired: [] as string[] };
  const items: MaterializedItemRef[] = [];
  const now = toDb(new Date().toISOString());

  for (const g of groups) {
    const res = await resolveIdentity(tx, org, processId, g, params.correlationId);

    if (res.kind === "ambiguous") {
      const keyHash = logicalKeyHash(g.logicalKey);
      for (const c of res.candidates) {
        await tx.update(intelligentItemsTable).set({
          sourceState: "review_required",
          sourceStateReason: `identidade_ambigua:${keyHash}`.slice(0, 255),
          sourceChangedAt: now,
        }).where(and(eq(intelligentItemsTable.id, c.id), eq(intelligentItemsTable.organizationId, org)));
      }
      r.reviewRequired.push(keyHash);
      continue;
    }

    if (res.kind === "create") {
      const id = intelligentItemIdForKey(org, processId, g.logicalKey);
      await tx.insert(intelligentItemsTable).values({
        id, organizationId: org, processId, sourceResearchId: params.researchId,
        description: g.description, quantity: String(g.quantity), unit: g.unit,
        averagePrice: centsToDecimalString(g.averageCents),
        suppliers: JSON.stringify(g.quotes.map(quoteToSupplier)),
        suggestedCatmat: null, alternativeCatmat: "[]", specifications: "[]", risks: "[]", recommendations: "[]",
        status: "pendente", approvedBy: null, enrichmentStatus: "pending", sourceState: "current",
        correlationId: params.correlationId, createdAt: now, updatedAt: now,
      });
      r.created.push(id);
      items.push({ id, logicalKey: g.logicalKey, quoteCount: g.pricedQuoteCount, averageCents: g.averageCents });
      continue;
    }

    const row = res.row;
    if (res.reconciled) r.reconciled.push(row.id);
    const current = quotesOf(row.suppliers, row);
    const decided = row.status === "aprovado" || row.status === "rejeitado";

    if (!decided) {
      const merged = mergeQuotes(current, g.quotes);
      if (quoteSetSignature(merged) === quoteSetSignature(current) && row.sourceState === "current") {
        r.unchanged.push(row.id);
        items.push({ id: row.id, logicalKey: g.logicalKey, quoteCount: validQuotes(current).length, averageCents: reaisToCents(row.averagePrice) });
        continue;
      }
      const avg = avgOf(merged);
      await tx.update(intelligentItemsTable).set({
        suppliers: JSON.stringify(merged.map(quoteToSupplier)),
        averagePrice: centsToDecimalString(avg),
        enrichmentStatus: "pending", sourceState: "current", sourceStateReason: null, pendingSuppliers: null,
        updatedAt: now,
      }).where(and(eq(intelligentItemsTable.id, row.id), eq(intelligentItemsTable.organizationId, org)));
      r.updated.push(row.id);
      items.push({ id: row.id, logicalKey: g.logicalKey, quoteCount: validQuotes(merged).length, averageCents: avg });
      continue;
    }

    // Decidido: a decisão humana e seus números são preservados; mudança de fonte é SINALIZADA.
    const pending = row.pendingSuppliers ? quotesOf(row.pendingSuppliers, row) : null;
    const merged = mergeQuotes(pending ?? current, g.quotes);
    const ref = { id: row.id, logicalKey: g.logicalKey, quoteCount: validQuotes(current).length, averageCents: reaisToCents(row.averagePrice) };
    if (quoteSetSignature(merged) === quoteSetSignature(current)) {
      r.preserved.push(row.id); items.push(ref); continue;
    }
    if (pending && quoteSetSignature(merged) === quoteSetSignature(pending)) {
      r.sourceChanged.push(row.id); items.push(ref); continue; // já sinalizado com o mesmo conjunto
    }
    await tx.update(intelligentItemsTable).set({
      sourceState: "source_changed",
      sourceStateReason: `Pesquisa alterada após decisão (${row.status}); média proposta ${centsToDecimalString(avgOf(merged))}.`.slice(0, 255),
      sourceChangedAt: now,
      pendingSuppliers: JSON.stringify(merged.map(quoteToSupplier)),
      updatedAt: now,
    }).where(and(eq(intelligentItemsTable.id, row.id), eq(intelligentItemsTable.organizationId, org)));
    r.sourceChanged.push(row.id);
    items.push(ref);
  }
  return { ...r, items };
}

/** Timeline pós-commit das sinalizações (fonte alterada / identidade ambígua). Best-effort. */
export async function recordMaterializationSignals(p: {
  organizationId: number; processId: string; result: MaterializationResult; actorUserId: number; correlationId: string;
}): Promise<void> {
  const { result } = p;
  if (result.sourceChanged.length > 0) {
    await recordProcessEvent({
      organizationId: p.organizationId, processId: p.processId, eventType: "change", actor: String(p.actorUserId),
      summary: `Fonte alterada em ${result.sourceChanged.length} Item(ns) Inteligente(s) já decidido(s) — decisão preservada; revisão necessária.`,
      refId: result.sourceChanged[0], correlationId: p.correlationId,
    }).catch(() => {});
  }
  if (result.reviewRequired.length > 0) {
    await recordProcessEvent({
      organizationId: p.organizationId, processId: p.processId, eventType: "change", actor: String(p.actorUserId),
      summary: `Identidade ambígua em ${result.reviewRequired.length} item(ns) (legado × nova pesquisa) — nada foi fundido; revisão humana necessária.`,
      refId: result.reviewRequired[0].slice(0, 20), correlationId: p.correlationId,
    }).catch(() => {});
  }
}

// ─── Ações humanas explícitas ────────────────────────────────────────────────────

/**
 * Aplica as cotações ATUALIZADAS (`pending_suppliers`) a um item com fonte alterada. Um item aprovado/
 * rejeitado volta a `em_analise` (a decisão anterior deixa de valer para números novos — nunca silencioso).
 */
export async function applyItemSourceUpdate(p: {
  organizationId: number; itemId: string; actorUserId: number; correlationId: string;
}): Promise<{ itemId: string; status: string; averageCents: Cents; quoteCount: number }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível." });
  const out = await db.transaction(async (tx) => {
    const row = await lockItem(tx, p.organizationId, p.itemId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
    if (row.sourceState !== "source_changed" || !row.pendingSuppliers) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Não há atualização de cotações pendente para este item." });
    }
    const quotes = quotesOf(row.pendingSuppliers, row);
    const avg = avgOf(quotes);
    const decided = row.status === "aprovado" || row.status === "rejeitado";
    const now = toDb(new Date().toISOString());
    await tx.update(intelligentItemsTable).set({
      suppliers: JSON.stringify(quotes.map(quoteToSupplier)), averagePrice: centsToDecimalString(avg),
      pendingSuppliers: null, sourceState: "current", sourceStateReason: null,
      ...(decided ? { status: "em_analise", approvedBy: null } : {}),
      enrichmentStatus: "pending", updatedAt: now,
    }).where(and(eq(intelligentItemsTable.id, row.id), eq(intelligentItemsTable.organizationId, p.organizationId)));
    await recordProcessEvent({
      organizationId: p.organizationId, processId: row.processId, eventType: "change", actor: String(p.actorUserId),
      summary: `Cotações atualizadas aplicadas ao item "${(row.description ?? "").slice(0, 80)}"${decided ? ` — decisão anterior (${row.status}) invalidada; item volta a análise` : ""}.`,
      refId: row.id, correlationId: p.correlationId,
    }, tx);
    return { itemId: row.id, status: decided ? "em_analise" : row.status, averageCents: avg, quoteCount: validQuotes(quotes).length, processId: row.processId };
  });
  await enrichMaterializedItems({ organizationId: p.organizationId, processId: out.processId, itemIds: [out.itemId], correlationId: p.correlationId });
  return { itemId: out.itemId, status: out.status, averageCents: out.averageCents, quoteCount: out.quoteCount };
}

/** Cotações da pesquisa do processo cuja chave lógica tem o hash informado (base da re-materialização). */
async function quotesForKeyHash(tx: ProcurementExecutor, org: number, processId: string, keyHash: string): Promise<PriceQuote[]> {
  const rows = await tx.select().from(priceResearchItemsTable)
    .where(and(eq(priceResearchItemsTable.organizationId, org), eq(priceResearchItemsTable.processId, processId)));
  return rows.map((q) => ({
    quoteId: q.id, researchId: q.researchId, description: q.description ?? "", quantity: Number(q.quantity), unit: q.unit,
    supplier: q.supplier ?? "", brand: q.brand ?? "", model: q.model ?? "", source: q.source ?? "",
    valueCents: reaisToCents(q.value) > 0 ? reaisToCents(q.value) : null,
  })).filter((q) => logicalKeyHash(intelligentItemLogicalKey(q)) === keyHash);
}

/**
 * Resolução HUMANA de identidade ambígua: vincula a chave lógica (hash) a um item existente do processo, ou
 * declara que é um item NOVO. Grava alias `manual`/`new_item` (append-only) e re-materializa a chave a partir
 * das cotações já persistidas — mesma transação.
 */
export async function resolveItemIdentity(p: {
  organizationId: number; processId: string; logicalKeyHash: string; targetItemId: string | null;
  actorUserId: number; reason: string; correlationId: string;
}): Promise<MaterializationResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível." });
  if (p.reason.trim().length < 5) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Informe o motivo da resolução (mín. 5 caracteres)." });
  const result = await db.transaction(async (tx) => {
    const quotes = await quotesForKeyHash(tx, p.organizationId, p.processId, p.logicalKeyHash);
    if (quotes.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Nenhuma cotação do processo corresponde a esta identidade." });
    const logicalKey = intelligentItemLogicalKey(quotes[0]);
    if (p.targetItemId) {
      const target = await lockItem(tx, p.organizationId, p.targetItemId);
      if (!target || target.processId !== p.processId) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado neste processo." });
    }
    await insertAlias(tx, {
      org: p.organizationId, processId: p.processId, logicalKey, itemId: p.targetItemId ?? intelligentItemIdForKey(p.organizationId, p.processId, logicalKey),
      resolution: p.targetItemId ? "manual" : "new_item", actorUserId: p.actorUserId, reason: p.reason.slice(0, 255), correlationId: p.correlationId,
    });
    // Limpa a sinalização de ambiguidade desta chave nos candidatos (decisões e números intactos).
    await tx.update(intelligentItemsTable).set({ sourceState: "current", sourceStateReason: null })
      .where(and(eq(intelligentItemsTable.organizationId, p.organizationId), eq(intelligentItemsTable.processId, p.processId),
        eq(intelligentItemsTable.sourceStateReason, `identidade_ambigua:${p.logicalKeyHash}`.slice(0, 255))));
    return materializeIntelligentItemsTx(tx, { organizationId: p.organizationId, processId: p.processId, researchId: quotes[0].researchId, quotes, correlationId: p.correlationId });
  });
  await enrichMaterializedItems({ organizationId: p.organizationId, processId: p.processId, itemIds: [...result.created, ...result.updated], correlationId: p.correlationId });
  return result;
}

// ─── FASE 2 — enriquecimento durável ─────────────────────────────────────────────

/** Claim atômico do enriquecimento (pending ou processing-travado → processing). */
async function claimEnrichment(org: number, itemId: string, staleBefore: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const res = await db.update(intelligentItemsTable).set({
    enrichmentStatus: "processing",
    enrichmentAttempts: sql`${intelligentItemsTable.enrichmentAttempts} + 1`,
    enrichmentLastAttemptAt: toDb(new Date().toISOString()),
  }).where(and(
    eq(intelligentItemsTable.id, itemId), eq(intelligentItemsTable.organizationId, org),
    lt(intelligentItemsTable.enrichmentAttempts, ENRICHMENT_MAX_ATTEMPTS),
    or(
      eq(intelligentItemsTable.enrichmentStatus, "pending"),
      and(eq(intelligentItemsTable.enrichmentStatus, "processing"),
        or(isNull(intelligentItemsTable.enrichmentLastAttemptAt), lt(intelligentItemsTable.enrichmentLastAttemptAt, staleBefore))),
    ),
  ));
  const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
  return (header?.affectedRows ?? 0) === 1;
}

/**
 * FASE 2 — enriquecimento PÓS-COMMIT, degradável e idempotente (ids determinísticos + upsert). Nunca lança.
 * Cada item é reivindicado atomicamente (processing); sucesso → done; falha → pending (nova tentativa pela
 * recuperação) até o limite, depois failed. Sugestão CATMAT NUNCA sobrescreve decisão humana (ledger).
 */
export async function enrichMaterializedItems(params: {
  organizationId: number; processId: string; itemIds: readonly string[]; correlationId: string;
}): Promise<{ enriched: number; failed: number; skipped: number }> {
  const db = await getDb();
  if (!db || params.itemIds.length === 0) return { enriched: 0, failed: 0, skipped: 0 };
  let enriched = 0, failed = 0, skipped = 0;
  const staleBefore = toDb(new Date(Date.now() - ENRICHMENT_STALE_MS).toISOString());
  for (const itemId of params.itemIds) {
    if (!(await claimEnrichment(params.organizationId, itemId, staleBefore))) { skipped++; continue; }
    const rows = await db.select().from(intelligentItemsTable)
      .where(and(eq(intelligentItemsTable.organizationId, params.organizationId), eq(intelligentItemsTable.id, itemId))).limit(1);
    const it = rows[0];
    if (!it) { skipped++; continue; }
    try {
      // Mesmo gate de acesso ao Kernel do enriquecimento legado (sem chamada a provider).
      assertKernelAccess("processo_licitatorio", "procurement_knowledge_graph");
      const description = it.description ?? "";
      const suppliers = parseSuppliers(it.suppliers);
      const matches = rankCATMAT({
        itemId: it.id, organizationId: params.organizationId, description,
        candidates: catmatCandidates(description), correlationId: params.correlationId,
      });
      const { suggested, alternatives } = suggestedAndAlternatives(matches);
      const values = suppliers.map((s) => s.value).filter((v) => v > 0);
      const risks = [];
      const outlier = detectPriceOutlier(values);
      if (outlier.outlier) {
        risks.push(createItemRisk({
          itemId: it.id, organizationId: params.organizationId, type: "preco_fora_da_curva", severity: "alto",
          description: "Um dos preços desvia mais de 50% da média.",
          explanation: "Verifique a fonte da cotação divergente antes de usar a média.", correlationId: params.correlationId,
        }));
      }
      if (values.length < 3) {
        risks.push(createItemRisk({
          itemId: it.id, organizationId: params.organizationId, type: "baixa_competitividade", severity: "medio",
          description: "Menos de 3 cotações válidas na pesquisa.",
          explanation: "Amostra pequena pode comprometer a estimativa. Recomenda-se ampliar as fontes.", correlationId: params.correlationId,
        }));
      }
      const recs = [];
      if (suggested) {
        recs.push(createItemRecommendation({
          itemId: it.id, organizationId: params.organizationId, type: "catmat",
          summary: `Sugestão de CATMAT ${suggested.catmatCode}.`,
          reasoning: `Maior aderência de descrição (score ${suggested.score.toFixed(2)}) entre os candidatos.`,
          explainability: "Ranking por interseção de tokens; SUGESTÃO — o servidor decide (confirmar/rejeitar/substituir).",
          provenance: "catmat_matching", confidence: suggested.score, correlationId: params.correlationId,
        }));
      }
      for (const m of matches) await insertCatmatMatch(m);
      for (const risk of risks) await insertItemRisk(risk);
      for (const rec of recs) await insertItemRecommendation(rec);

      const decidedCatalog = await db.select({ id: catmatDecisionsTable.id }).from(catmatDecisionsTable)
        .where(and(eq(catmatDecisionsTable.organizationId, params.organizationId), eq(catmatDecisionsTable.itemId, it.id))).limit(1);
      await db.update(intelligentItemsTable).set({
        ...(decidedCatalog.length === 0 && !it.suggestedCatmat ? { suggestedCatmat: suggested?.catmatCode ?? null } : {}),
        alternativeCatmat: JSON.stringify(alternatives.map((a) => a.catmatCode)),
        specifications: JSON.stringify(suggestSpecifications(description)),
        risks: JSON.stringify(risks.map((x) => x.description)),
        enrichmentStatus: "done", enrichmentErrorCode: null,
      }).where(and(eq(intelligentItemsTable.id, it.id), eq(intelligentItemsTable.organizationId, params.organizationId)));
      enriched++;
    } catch (err) {
      failed++;
      const terminal = (it.enrichmentAttempts ?? 1) >= ENRICHMENT_MAX_ATTEMPTS;
      const code = (err instanceof Error ? err.name : "ERROR").slice(0, 40);
      log.warn("item_enrichment_failed", {
        organizationId: params.organizationId, processId: params.processId, itemId: it.id, terminal,
        correlationId: params.correlationId, error: err instanceof Error ? err.message : String(err),
      });
      await db.update(intelligentItemsTable).set({ enrichmentStatus: terminal ? "failed" : "pending", enrichmentErrorCode: code })
        .where(and(eq(intelligentItemsTable.id, it.id), eq(intelligentItemsTable.organizationId, params.organizationId)))
        .catch(() => {});
    }
  }
  return { enriched, failed, skipped };
}

/**
 * Recuperação DURÁVEL (boot / replay de promoção): retoma enriquecimentos `pending` antigos ou `processing`
 * travado (processo morreu), respeitando o limite de tentativas. Replay-safe (claim atômico por item).
 * `organizationId`/`processId` opcionais restringem o escopo (ex.: replay da promoção daquele processo);
 * `staleMs: 0` retoma qualquer pendência imediatamente (replay explícito).
 */
export async function recoverStaleEnrichment(opts: {
  organizationId?: number; processId?: string; staleMs?: number; limit?: number; correlationId?: string;
} = {}): Promise<{ scanned: number; enriched: number; failed: number; skipped: number }> {
  const db = await getDb();
  if (!db) return { scanned: 0, enriched: 0, failed: 0, skipped: 0 };
  const staleMs = opts.staleMs ?? ENRICHMENT_STALE_MS;
  const staleBefore = toDb(new Date(Date.now() - staleMs + (staleMs === 0 ? 1000 : 0)).toISOString());
  const rows = await db.select({ id: intelligentItemsTable.id, org: intelligentItemsTable.organizationId, processId: intelligentItemsTable.processId })
    .from(intelligentItemsTable)
    .where(and(
      ...(opts.organizationId !== undefined ? [eq(intelligentItemsTable.organizationId, opts.organizationId)] : []),
      ...(opts.processId !== undefined ? [eq(intelligentItemsTable.processId, opts.processId)] : []),
      lt(intelligentItemsTable.enrichmentAttempts, ENRICHMENT_MAX_ATTEMPTS),
      or(
        and(eq(intelligentItemsTable.enrichmentStatus, "pending"),
          or(isNull(intelligentItemsTable.enrichmentLastAttemptAt), lt(intelligentItemsTable.enrichmentLastAttemptAt, staleBefore), lt(intelligentItemsTable.updatedAt, staleBefore))),
        and(eq(intelligentItemsTable.enrichmentStatus, "processing"),
          or(isNull(intelligentItemsTable.enrichmentLastAttemptAt), lt(intelligentItemsTable.enrichmentLastAttemptAt, staleBefore))),
      ),
    ))
    .limit(opts.limit ?? 200);
  const totals = { scanned: rows.length, enriched: 0, failed: 0, skipped: 0 };
  const byScope = new Map<string, { org: number; processId: string; ids: string[] }>();
  for (const row of rows) {
    const k = `${row.org}:${row.processId}`;
    if (!byScope.has(k)) byScope.set(k, { org: row.org, processId: row.processId, ids: [] });
    byScope.get(k)!.ids.push(row.id);
  }
  for (const s of byScope.values()) {
    const out = await enrichMaterializedItems({ organizationId: s.org, processId: s.processId, itemIds: s.ids, correlationId: opts.correlationId ?? "enrichment-recovery" });
    totals.enriched += out.enriched; totals.failed += out.failed; totals.skipped += out.skipped;
  }
  if (rows.length > 0) log.info("enrichment_recovery_ran", totals);
  return totals;
}

/**
 * Pesquisa MANUAL/COLAR (legado convergido): pesquisa + cotações + materialização base na MESMA transação
 * (`writeResearch` grava a pesquisa e as cotações com o executor da transação) e enriquecimento pós-commit.
 */
export async function persistResearchAndMaterialize(params: {
  organizationId: number; processId: string; researchId: string; quotes: readonly PriceQuote[]; correlationId: string;
  writeResearch: (tx: ProcurementExecutor) => Promise<void>;
}): Promise<MaterializationResult> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível — pesquisa não persistida (fail-closed).");
  const result = await db.transaction(async (tx) => {
    await params.writeResearch(tx);
    return materializeIntelligentItemsTx(tx, params);
  });
  await enrichMaterializedItems({
    organizationId: params.organizationId, processId: params.processId,
    itemIds: [...result.created, ...result.updated], correlationId: params.correlationId,
  });
  return result;
}

/**
 * Caminho MANUAL/COLAR da Pesquisa de Preços (router `importPriceResearch` delega aqui): extração
 * determinística do texto → pesquisa + cotações + base dos Itens Inteligentes (UMA transação) → sinais e
 * timeline → enriquecimento pós-commit. Mesmo modelo canônico da promoção da ingestão.
 */
export async function importManualPriceResearch(p: {
  organizationId: number; processId: string; source: PriceResearchSource; text: string; actorUserId: number; correlationId: string;
}): Promise<{ research: PriceResearchWorkspace; quoteCount: number; result: MaterializationResult }> {
  const research = createPriceResearchWorkspace({ processId: p.processId, organizationId: p.organizationId, source: p.source, correlationId: p.correlationId });
  const rawItems = extractItemsFromText(p.text, { researchId: research.id, processId: p.processId, organizationId: p.organizationId });
  const result = await persistResearchAndMaterialize({
    organizationId: p.organizationId, processId: p.processId, researchId: research.id, correlationId: p.correlationId,
    quotes: rawItems.map((it) => ({
      quoteId: it.id, researchId: research.id, description: it.description, quantity: it.quantity, unit: it.unit,
      supplier: it.supplier, brand: it.brand, model: it.model, source: it.source,
      valueCents: it.value > 0 ? reaisToCents(it.value) : null,
    })),
    writeResearch: async (tx) => {
      await insertResearch({ ...research, itemCount: rawItems.length }, tx);
      for (const it of rawItems) await insertResearchItem(it, tx);
    },
  });
  await recordMaterializationSignals({ organizationId: p.organizationId, processId: p.processId, result, actorUserId: p.actorUserId, correlationId: p.correlationId });
  await recordProcessEvent({
    organizationId: p.organizationId, processId: p.processId, eventType: "change", actor: String(p.actorUserId),
    summary: `Pesquisa importada (${p.source}): ${rawItems.length} cotação(ões) → ${result.items.length} Item(ns) Inteligente(s).`,
    refId: research.id, correlationId: p.correlationId,
  }).catch(() => {});
  return { research: { ...research, itemCount: rawItems.length }, quoteCount: rawItems.length, result };
}
