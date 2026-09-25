/**
 * Itens da Contratação — serviço (orquestração). A área é TRANSVERSAL ao processo: funciona qualquer que seja
 * a etapa em que o processo começou (DFD, ETP, Pesquisa, TR, importação). Pesquisa/DFD NÃO são donos dos
 * itens: fornecem CANDIDATOS (evidência) que o servidor confirma; o servidor normalmente só informa a
 * quantidade PREVISTA. A quantidade prevista alimenta o MESMO ledger do Contexto Canônico (#256) —
 * `items.<canonicalItemId>.plannedQuantity`, fonte "user" — sem nenhuma fonte paralela.
 *
 * Garantias: organizationId SEMPRE do contexto autenticado; ids de item/lote/fonte SEMPRE revalidados no
 * servidor; toda escrita numa ÚNICA transação (tudo-ou-nada) com idempotência (replay / CONFLICT em payload
 * divergente) e concorrência otimista por `revision` (STALE_REVISION); auditoria append-only com hashes
 * antes/depois (sem conteúdo integral); nada de IA, fuzzy ou similaridade para identidade ou lote.
 */
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { serviceLogger } from "./observabilityService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { resolveProcurementContext } from "./canonicalContextService";
import { appendContextFacts } from "../db/procurementContext";
import {
  listIntelligentItems, getGeneratedDocumentByKind, recordProcessEvent, type ProcurementExecutor,
} from "../db/procurement";
import { getLatestOfficialPromotion } from "../db/officialDocumentPromotions";
import {
  listProcurementItems, listProcurementLots, listItemSourceLinks, lockItem, lockLot, nextItemOrdinal, nextLotOrdinal,
  insertItemIfAbsent, insertLotIfAbsent, updateItemCAS, updateLotCAS, insertSourceLinkIfAbsent, appendItemEvents,
  type ItemEvent,
} from "../db/procurementItems";
import {
  priceResearchCandidateSources, dfdCandidateSources, matchCandidates, planCandidateDecisions, parsePlannedQuantity,
  procurementItemId, procurementLotId, itemFingerprint, lotCodeKey, governedChangeReason, stateHash, ItemDomainError,
  GOVERNED_CHANGE_REQUIRED,
  type ItemCandidate, type CandidateDecision, type CandidateSourceType, type ProcurementItem, type ProcurementLot,
  type ItemSourceLink, type ItemProvenance, type GovernanceState, type NeedChange,
} from "../domain/procurementItems";
import { factValueHash, itemPath, normalizeText, type CanonicalField, type ProcurementCanonicalContext } from "../domain/canonicalProcurementContext";
import { buildDFDPrefill, parseDFD, linkDFDRows, readMarkers } from "../domain/dfdPrefill";
import { sumCents } from "../domain/money";

const log = serviceLogger("ProcurementItemsService");
const ITEMS_AREA_SOURCE = "items-area";

interface Actor { organizationId: number; processId: string; actorUserId: number; correlationId: string }

function domainError(err: unknown): never {
  if (err instanceof ItemDomainError) {
    const code = ["STALE_CANDIDATES", "CANDIDATE_ALREADY_LINKED", "DUPLICATE_DECISION"].includes(err.code) ? "CONFLICT"
      : ["ITEM_NOT_FOUND", "LOT_NOT_FOUND"].includes(err.code) ? "NOT_FOUND" : "BAD_REQUEST";
    throw new TRPCError({ code, message: err.message });
  }
  throw err;
}

// ─── Governança ────────────────────────────────────────────────────────────────────────

async function loadGovernance(org: number, pid: string, ctx: ProcurementCanonicalContext | null): Promise<GovernanceState> {
  const officialEmittedKinds: string[] = [];
  for (const k of ["etp", "tr", "edital"] as const) {
    if (await getLatestOfficialPromotion(org, pid, k).catch(() => null)) officialEmittedKinds.push(k);
  }
  const consumed = new Set<string>();
  for (const k of ["dfd", "etp", "tr", "edital"] as const) {
    const doc = await getGeneratedDocumentByKind(pid, org, k).catch(() => null);
    if (!doc || doc.status !== "aprovado") continue;
    for (const key of Object.keys(readMarkers(doc.sources ?? []).prefill)) if (key.startsWith("item:")) consumed.add(key.slice(5));
    if (k === "dfd" && ctx) for (const l of linkDFDRows(parseDFD(doc.content), buildDFDPrefill(ctx).items, doc.sources ?? [])) if (l.itemId) consumed.add(l.itemId);
  }
  return { officialEmittedKinds, itemsConsumedByApproved: consumed };
}

function assertNotGoverned(state: GovernanceState, change: NeedChange, itemId: string | null): void {
  const reason = governedChangeReason(state, change, itemId);
  if (reason) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${GOVERNED_CHANGE_REQUIRED}: ${reason}` });
}

// ─── Runner de escrita (idempotência + transação única) ──────────────────────────────────

async function runItemsWrite<T>(a: Actor & { op: string; idempotencyKey: string; payload: unknown }, fn: (tx: ProcurementExecutor) => Promise<T>): Promise<{ result: T; replayed: boolean }> {
  const payloadHash = createHash("sha256").update(JSON.stringify({ op: a.op, o: a.organizationId, p: a.processId, x: a.payload })).digest("hex");
  const check = await checkIdempotency(a.idempotencyKey, a.actorUserId, a.organizationId, a.op, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com conteúdo diferente — operação recusada." });
    const raw = check.response;
    return { result: (typeof raw === "string" ? JSON.parse(raw) : raw) as T, replayed: true };
  }
  if (check.status === "processing") throw new TRPCError({ code: "CONFLICT", message: "Operação idêntica já em processamento — aguarde a conclusão." });
  const db = await getDb();
  if (!db) {
    await failIdempotencyKey(a.idempotencyKey, a.actorUserId, a.organizationId).catch(() => {});
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — nada foi gravado." });
  }
  try {
    let result!: T;
    await db.transaction(async (tx) => {
      result = await fn(tx as unknown as ProcurementExecutor);
      await saveIdempotencyResult(a.idempotencyKey, a.actorUserId, a.organizationId, result, tx);
    });
    return { result, replayed: false };
  } catch (err) {
    await failIdempotencyKey(a.idempotencyKey, a.actorUserId, a.organizationId).catch(() => {});
    throw err;
  }
}

function staleRevision(): never {
  throw new TRPCError({ code: "CONFLICT", message: "STALE_REVISION: o item foi alterado por outra pessoa — recarregue antes de salvar." });
}

async function requireItem(tx: ProcurementExecutor, a: Actor, itemId: string, expectedRevision: number): Promise<ProcurementItem> {
  const it = await lockItem(tx, a.organizationId, a.processId, itemId);
  if (!it) throw new TRPCError({ code: "NOT_FOUND", message: "Item inexistente neste processo." });
  if (it.revision !== expectedRevision) staleRevision();
  return it;
}

async function requireLot(tx: ProcurementExecutor, a: Actor, lotId: string): Promise<ProcurementLot> {
  const lot = await lockLot(tx, a.organizationId, a.processId, lotId);
  if (!lot || lot.status !== "active") throw new TRPCError({ code: "NOT_FOUND", message: "Lote inexistente ou arquivado neste processo." });
  return lot;
}

/**
 * Quantidade PREVISTA → ledger do Contexto Canônico (fonte "user", confirmada), com superação consciente:
 * `basisValueHash` = o valor vigente que o servidor viu; em CONFLITO, uma afirmação por valor divergente
 * (todas com o mesmo valor novo) — a decisão humana resolve o conflito explicitamente.
 */
async function writePlannedQuantity(tx: ProcurementExecutor, a: Actor, itemId: string, current: CanonicalField | null, value: number | null, revision: number, mode: string): Promise<void> {
  const bases = current?.status === "conflict" && current.conflict?.length
    ? current.conflict.map((c) => stateHashOfFact(c.value))
    : [current?.valueHash ?? null];
  await appendContextFacts(a.organizationId, a.processId, bases.map((basis, i) => ({
    path: itemPath(itemId, "plannedQuantity"), value, sourceType: "user" as const,
    sourceId: i === 0 ? ITEMS_AREA_SOURCE : `${ITEMS_AREA_SOURCE}#${i}`,
    sourceVersion: `r${revision}:${mode}`, status: "confirmed" as const, actorUserId: a.actorUserId, basisValueHash: basis,
  })), a.correlationId, tx);
}

/** Hash de fato (mesma normalização do ledger) — base da superação consciente. */
function stateHashOfFact(v: string | number | null): string { return factValueHash(v); }

function plannedField(ctx: ProcurementCanonicalContext | null, itemId: string): CanonicalField | null {
  return ctx?.items.find((i) => i.key === itemId)?.plannedQuantity ?? null;
}

async function ctxOrNull(a: Actor, executor?: ProcurementExecutor): Promise<ProcurementCanonicalContext | null> {
  return resolveProcurementContext({ organizationId: a.organizationId, processId: a.processId, correlationId: a.correlationId, executor }).catch(() => null);
}

// ─── Workspace (leitura) ─────────────────────────────────────────────────────────────────

export interface ItemsWorkspaceItem {
  id: string; description: string; unit: string; lotId: string | null; ordinal: number; status: string; revision: number;
  origin: string; provenance: ItemProvenance;
  plannedQuantity: { value: number | null; status: string; sourceType: string | null; mode: string | null; actorUserId: number | null; updatedAt: string | null };
  sources: Array<{ sourceType: string; sourceId: string; sourceQuantity: number | null; sourceLotCode: string | null; sourceDescription: string; sourceUnit: string }>;
  unitReferencePriceCents: number | null; priceAmbiguous: boolean; estimatedTotalCents: number | null;
}

export interface ItemsWorkspace {
  items: ItemsWorkspaceItem[];
  withdrawn: Array<{ id: string; description: string; unit: string }>;
  lots: Array<{ id: string; code: string; name: string; description: string | null; ordinal: number; revision: number; itemCount: number }>;
  hasLots: boolean;
  stats: { itemCount: number; lotCount: number; unassignedItemCount: number; unknownQuantityCount: number; conflictCount: number };
  estimatedTotalCents: number | null;
  contextVersion: number | null; contextDigest: string | null;
  governance: { locked: boolean; reason: string | null; officialEmittedKinds: string[] };
  sources: { priceResearchItems: number; dfdRows: number };
}

export async function getProcurementItemsWorkspace(a: Omit<Actor, "actorUserId">): Promise<ItemsWorkspace> {
  const t0 = Date.now();
  const actor = { ...a, actorUserId: 0 };
  const [items, lots, links, ctx, iis, dfd] = await Promise.all([
    listProcurementItems(a.organizationId, a.processId), listProcurementLots(a.organizationId, a.processId),
    listItemSourceLinks(a.organizationId, a.processId), ctxOrNull(actor),
    listIntelligentItems(a.processId, a.organizationId).catch(() => []),
    getGeneratedDocumentByKind(a.processId, a.organizationId, "dfd").catch(() => null),
  ]);
  const gov = await loadGovernance(a.organizationId, a.processId, ctx);
  const byCtx = new Map((ctx?.items ?? []).map((i) => [i.key, i]));
  const active = items.filter((i) => i.status === "active");
  const activeLots = lots.filter((l) => l.status === "active");
  const view: ItemsWorkspaceItem[] = active
    .map((it) => {
      const c = byCtx.get(it.id);
      const pq = c?.plannedQuantity;
      const version = pq?.source?.version ?? null;
      return {
        id: it.id, description: it.description, unit: it.unit, lotId: activeLots.some((l) => l.id === it.lotId) ? it.lotId : null,
        ordinal: it.ordinal, status: it.status, revision: it.revision, origin: it.origin, provenance: it.provenance,
        plannedQuantity: {
          value: pq?.value ?? null, status: pq?.status ?? "unknown", sourceType: pq?.source?.type ?? null,
          mode: version ? version.split(":")[1] ?? null : pq?.source ? "dfd" : null,
          actorUserId: pq?.actorUserId ?? null, updatedAt: pq?.updatedAt ?? null,
        },
        sources: links.filter((l) => l.itemId === it.id).map((l) => ({
          sourceType: l.sourceType, sourceId: l.sourceId, sourceQuantity: l.sourceQuantity, sourceLotCode: l.sourceLotCode,
          sourceDescription: l.sourceDescription, sourceUnit: l.sourceUnit,
        })),
        unitReferencePriceCents: c?.priceContext.unitReferencePriceCents ?? null,
        priceAmbiguous: c?.priceContext.priceAmbiguous ?? false,
        estimatedTotalCents: c?.estimatedTotalCents ?? null,
      };
    });
  const lotOrder = new Map(activeLots.map((l, i) => [l.id, i]));
  view.sort((x, y) => {
    const lx = x.lotId === null ? Number.MAX_SAFE_INTEGER : lotOrder.get(x.lotId)!;
    const ly = y.lotId === null ? Number.MAX_SAFE_INTEGER : lotOrder.get(y.lotId)!;
    return lx - ly || x.ordinal - y.ordinal || (x.id < y.id ? -1 : 1);
  });
  const totals = view.map((v) => v.estimatedTotalCents);
  const complete = view.length > 0 && totals.every((t) => t !== null);
  const govReason = governedChangeReason(gov, "create", null);
  const out: ItemsWorkspace = {
    items: view,
    withdrawn: items.filter((i) => i.status === "withdrawn").map((i) => ({ id: i.id, description: i.description, unit: i.unit })),
    lots: activeLots.map((l) => ({ id: l.id, code: l.code, name: l.name, description: l.description, ordinal: l.ordinal, revision: l.revision, itemCount: view.filter((v) => v.lotId === l.id).length })),
    hasLots: activeLots.length > 0,
    stats: {
      itemCount: view.length, lotCount: activeLots.length,
      unassignedItemCount: activeLots.length ? view.filter((v) => v.lotId === null).length : 0,
      unknownQuantityCount: view.filter((v) => v.plannedQuantity.value === null).length,
      conflictCount: view.filter((v) => v.plannedQuantity.status === "conflict").length,
    },
    estimatedTotalCents: complete ? sumCents(totals as number[]) : null,
    contextVersion: ctx?.version ?? null, contextDigest: ctx ? ctx.digest.slice(0, 16) : null,
    governance: { locked: govReason !== null, reason: govReason, officialEmittedKinds: [...gov.officialEmittedKinds] },
    sources: {
      priceResearchItems: (iis ?? []).filter((i) => i.status !== "rejeitado").length,
      dfdRows: dfd ? unlinkedRows(dfd, items, lots, links).length : 0,
    },
  };
  log.info("procurement_items_workspace_resolved", {
    organizationId: a.organizationId, processId: a.processId, correlationId: a.correlationId,
    itemCount: out.stats.itemCount, lotCount: out.stats.lotCount, unassignedItemCount: out.stats.unassignedItemCount,
    unknownQuantityCount: out.stats.unknownQuantityCount, conflictCount: out.stats.conflictCount,
    candidateCount: out.sources.priceResearchItems + out.sources.dfdRows, durationMs: Date.now() - t0,
  });
  return out;
}

// ─── Candidatos (projeção read-only) ─────────────────────────────────────────────────────

/**
 * Linhas da tabela do DFD sem Item Canônico correspondente — mesma ligação do DFD assistido, na MESMA ordem de
 * autoridade: linhagem persistida (canonicalItemId) → vínculo de fonte persistido (linha já confirmada como
 * item) → recuperação por fingerprint exato (legado). Linha já ligada NÃO volta a ser candidata.
 */
function unlinkedRows(
  doc: { id: string; content: string; sources?: string[] | null },
  items: readonly ProcurementItem[], lots: readonly ProcurementLot[], links: readonly ItemSourceLink[],
) {
  const code = new Map(lots.filter((l) => l.status === "active").map((l) => [l.id, l.code]));
  const linkable = items.filter((i) => i.status === "active").map((i) => ({
    key: i.id, fingerprint: i.fingerprint, lotCode: i.lotId ? code.get(i.lotId) ?? null : null,
    description: i.description, unit: i.unit, plannedQuantity: null, qtyOrigin: null, qtyConflict: false,
  }));
  const sourceLinks = links.filter((l) => l.sourceType === "dfd" && l.sourceId === doc.id).map((l) => {
    const sep = l.sourceItemKey.indexOf(":"); // `${fingerprint}:${lotKey}` — fingerprint é hex (sem ":")
    const lot = sep >= 0 ? l.sourceItemKey.slice(sep + 1) : "";
    return { fingerprint: sep >= 0 ? l.sourceItemKey.slice(0, sep) : l.sourceItemKey, lotKey: lot || null, itemId: l.itemId };
  });
  return linkDFDRows(parseDFD(doc.content), linkable, doc.sources ?? [], sourceLinks).filter((l) => l.itemId === null).map((l) => l.row);
}

export interface CandidateProjection {
  source: CandidateSourceType;
  candidates: ItemCandidate[];
  sourceDigest: string;
  counts: { sourceItemCount: number; matchedCount: number; newCandidateCount: number; ambiguousCount: number; blockedCount: number };
}

async function projectCandidates(org: number, pid: string, source: CandidateSourceType, executor?: ProcurementExecutor): Promise<CandidateProjection> {
  const [items, lots, links] = await Promise.all([
    listProcurementItems(org, pid, executor), listProcurementLots(org, pid, executor), listItemSourceLinks(org, pid, executor),
  ]);
  let sources;
  if (source === "price_research") {
    const iis = await listIntelligentItems(pid, org);
    sources = priceResearchCandidateSources(iis.map((i) => ({ id: i.id, description: i.description, unit: i.unit, quantity: i.quantity, status: i.status, sourceState: i.sourceState })));
  } else {
    const dfd = await getGeneratedDocumentByKind(pid, org, "dfd");
    // Só linhas do DFD que AINDA não correspondem a um Item Canônico (as demais já são o próprio item).
    sources = dfd ? dfdCandidateSources(dfd.id, unlinkedRows(dfd, items, lots, links).map((r) => ({ description: r.description, unit: r.unit, quantity: r.quantity, lotCode: r.lotCode }))) : [];
  }
  const candidates = matchCandidates(sources, items, links, lots);
  const sourceDigest = createHash("sha256").update(JSON.stringify(candidates.map((c) => [c.candidateKey, c.sourceDigest, c.match.status, c.match.candidateItemIds]))).digest("hex").slice(0, 32);
  const counts = {
    sourceItemCount: candidates.length,
    matchedCount: candidates.filter((c) => c.match.status === "linked").length,
    newCandidateCount: candidates.filter((c) => c.match.status === "new").length,
    ambiguousCount: candidates.filter((c) => c.match.status === "ambiguous" || c.match.status === "possible_match").length,
    blockedCount: candidates.filter((c) => c.match.status === "blocked").length,
  };
  return { source, candidates, sourceDigest, counts };
}

/** "Preparar itens da contratação" — projeção determinística (mesma fonte ⇒ mesmos candidatos). Não grava nada. */
export async function prepareItemCandidates(a: Omit<Actor, "actorUserId"> & { source: CandidateSourceType }): Promise<CandidateProjection> {
  const p = await projectCandidates(a.organizationId, a.processId, a.source);
  log.info("procurement_items_candidates_prepared", {
    organizationId: a.organizationId, processId: a.processId, correlationId: a.correlationId, source: a.source,
    sourceDigest: p.sourceDigest.slice(0, 16), ...p.counts,
  });
  return p;
}

// ─── Confirmar candidatos (transação única) ──────────────────────────────────────────────

export interface ConfirmResult { created: string[]; linked: string[]; skipped: number; lotsCreated: string[] }

export async function confirmItemCandidates(a: Actor & {
  source: CandidateSourceType; expectedSourceDigest: string; decisions: CandidateDecision[]; idempotencyKey: string;
}): Promise<{ result: ConfirmResult; replayed: boolean }> {
  const projection = await projectCandidates(a.organizationId, a.processId, a.source);
  return runItemsWrite({ ...a, op: "procurement.items.confirm", payload: { s: a.source, d: a.expectedSourceDigest, x: a.decisions } }, async (tx) => {
    if (projection.sourceDigest !== a.expectedSourceDigest) {
      throw new TRPCError({ code: "CONFLICT", message: "STALE_CANDIDATES: a lista de itens identificados mudou — recarregue e revise novamente." });
    }
    const [items, lots] = await Promise.all([listProcurementItems(a.organizationId, a.processId, tx), listProcurementLots(a.organizationId, a.processId, tx)]);
    let plan;
    try {
      plan = planCandidateDecisions({ organizationId: a.organizationId, processId: a.processId, candidates: projection.candidates, decisions: a.decisions, items, lots });
    } catch (e) { domainError(e); }
    const gov = await loadGovernance(a.organizationId, a.processId, null);
    if (plan.creates.length || plan.lotsToCreate.length) assertNotGoverned(gov, "create", null);

    const events: ItemEvent[] = [];
    const now = new Date().toISOString();
    for (const l of plan.lotsToCreate) {
      const ord = await nextLotOrdinal(tx, a.organizationId, a.processId);
      const created = await insertLotIfAbsent(tx, {
        id: l.lotId, organizationId: a.organizationId, processId: a.processId, code: l.code, codeKey: l.codeKey,
        name: `Lote ${l.code}`, description: null, ordinal: ord, status: "active", revision: 1, createdBy: a.actorUserId, updatedBy: a.actorUserId,
      }, a.correlationId);
      if (created) events.push({ lotId: l.lotId, eventType: "procurement_lot_created", actorUserId: a.actorUserId, afterHash: stateHash([l.code]), source: "source_structure" });
    }
    const result: ConfirmResult = { created: [], linked: [], skipped: plan.skipped, lotsCreated: plan.lotsToCreate.map((l) => l.lotId) };
    const link = (itemId: string, c: ItemCandidate): Omit<ItemSourceLink, "createdAt"> => ({
      itemId, sourceType: c.sourceType, sourceId: c.sourceId, sourceItemKey: c.sourceItemKey, sourceDigest: c.sourceDigest,
      sourceQuantity: c.sourceQuantity, sourceDescription: c.description, sourceUnit: c.unit, sourceLotCode: c.sourceLotCode, createdBy: a.actorUserId,
    });
    for (const c of plan.creates) {
      const ord = await nextItemOrdinal(tx, a.organizationId, a.processId);
      const lotId = c.lot.kind === "none" ? null : c.lot.lotId;
      const src = c.candidate.sourceType;
      const provenance: ItemProvenance = {
        description: { source: c.descriptionOverridden ? "user" : src, sourceId: c.candidate.sourceId, sourceValue: c.candidate.description, overriddenBy: c.descriptionOverridden ? a.actorUserId : null, at: now },
        unit: { source: c.unitOverridden ? "user" : src, sourceId: c.candidate.sourceId, sourceValue: c.candidate.unit, overriddenBy: c.unitOverridden ? a.actorUserId : null, at: now },
        lot: { assignedBy: lotId ? a.actorUserId : null, source: c.lot.kind === "source" ? "source_structure" : lotId ? "manual" : null, at: lotId ? now : null },
        manual: null,
      };
      const inserted = await insertItemIfAbsent(tx, {
        id: c.itemId, organizationId: a.organizationId, processId: a.processId, description: c.description, unit: c.unit,
        lotId, ordinal: ord, status: "active", fingerprint: itemFingerprint(c.description, c.unit), origin: src, provenance,
        revision: 1, createdBy: a.actorUserId, updatedBy: a.actorUserId,
      }, a.correlationId);
      const linked = await insertSourceLinkIfAbsent(tx, a.organizationId, a.processId, link(c.itemId, c.candidate), a.correlationId);
      if (!inserted) continue; // id determinístico pela origem ⇒ confirmar de novo não duplica
      result.created.push(c.itemId);
      events.push({ itemId: c.itemId, eventType: "procurement_item_created", actorUserId: a.actorUserId, afterHash: stateHash([c.description, c.unit, lotId]), source: src,
        details: { descriptionOverridden: c.descriptionOverridden, unitOverridden: c.unitOverridden } });
      if (linked) events.push({ itemId: c.itemId, eventType: "procurement_source_item_linked", actorUserId: a.actorUserId, source: src, afterHash: c.candidate.sourceDigest.slice(0, 16) });
      if (lotId) events.push({ itemId: c.itemId, lotId, eventType: "procurement_item_assigned_to_lot", actorUserId: a.actorUserId, source: c.lot.kind === "source" ? "source_structure" : "manual" });
      if (c.quantity !== null) {
        await writePlannedQuantity(tx, a, c.itemId, null, c.quantity, 1, c.quantityMode === "adopted_source" ? `adopted_source:${src}` : "informed");
        events.push({
          itemId: c.itemId, eventType: c.quantityMode === "adopted_source" ? "procurement_source_quantity_adopted" : "procurement_planned_quantity_changed",
          actorUserId: a.actorUserId, beforeHash: stateHash(null), afterHash: stateHash(c.quantity), source: c.quantityMode === "adopted_source" ? src : "user",
          details: c.quantityMode === "adopted_source" ? { observed: c.candidate.sourceQuantity, adopted: c.quantity } : null,
        });
      }
    }
    for (const l of plan.links) {
      if (await insertSourceLinkIfAbsent(tx, a.organizationId, a.processId, link(l.itemId, l.candidate), a.correlationId)) {
        result.linked.push(l.itemId);
        events.push({ itemId: l.itemId, eventType: "procurement_source_item_linked", actorUserId: a.actorUserId, source: l.candidate.sourceType, afterHash: l.candidate.sourceDigest.slice(0, 16), reason: "associado pelo servidor" });
      }
    }
    await appendItemEvents(tx, a.organizationId, a.processId, events, a.correlationId);
    if (result.created.length || result.linked.length) {
      await recordProcessEvent({
        organizationId: a.organizationId, processId: a.processId, eventType: "change", actor: String(a.actorUserId),
        summary: `Itens da contratação: ${result.created.length} item(ns) preparado(s) e ${result.linked.length} associado(s) a partir ${a.source === "price_research" ? "da Pesquisa de Preços" : "do DFD"}.`,
        refId: a.processId, correlationId: a.correlationId,
      }, tx);
    }
    log.info("procurement_item_candidate_prepared", {
      organizationId: a.organizationId, processId: a.processId, correlationId: a.correlationId, actorUserId: a.actorUserId, source: a.source,
      created: result.created.length, linked: result.linked.length, skipped: result.skipped, lotsCreated: result.lotsCreated.length,
    });
    return result;
  });
}

// ─── Item manual ──────────────────────────────────────────────────────────────────────────

export async function createManualItem(a: Actor & {
  description: string; unit: string; plannedQuantity?: string | number | null; lotId?: string | null;
  reason?: string | null; contextDocumentKind?: "dfd" | "etp" | "tr" | "edital" | null; idempotencyKey: string;
}): Promise<{ result: { itemId: string }; replayed: boolean }> {
  const description = normalizeText(a.description);
  const unit = normalizeText(a.unit);
  if (!description || !unit) throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_ITEM: descrição e unidade são obrigatórias." });
  const q = parsePlannedQuantity(a.plannedQuantity ?? null);
  if (!q.ok) throw new TRPCError({ code: "BAD_REQUEST", message: q.error });
  const contextDocumentId = a.contextDocumentKind
    ? (await getGeneratedDocumentByKind(a.processId, a.organizationId, a.contextDocumentKind))?.id ?? null : null;
  const itemId = procurementItemId(a.organizationId, a.processId, `manual:${a.actorUserId}:${a.idempotencyKey}`);
  return runItemsWrite({ ...a, op: "procurement.items.manual", payload: { description, unit, q: q.value, lot: a.lotId ?? null, r: a.reason ?? null, k: a.contextDocumentKind ?? null } }, async (tx) => {
    assertNotGoverned(await loadGovernance(a.organizationId, a.processId, null), "create", null);
    if (a.lotId) await requireLot(tx, a, a.lotId);
    const now = new Date().toISOString();
    const inserted = await insertItemIfAbsent(tx, {
      id: itemId, organizationId: a.organizationId, processId: a.processId, description, unit, lotId: a.lotId ?? null,
      ordinal: await nextItemOrdinal(tx, a.organizationId, a.processId), status: "active", fingerprint: itemFingerprint(description, unit),
      origin: "manual", revision: 1, createdBy: a.actorUserId, updatedBy: a.actorUserId,
      provenance: {
        description: { source: "manual", sourceId: null, sourceValue: null, overriddenBy: null, at: now },
        unit: { source: "manual", sourceId: null, sourceValue: null, overriddenBy: null, at: now },
        lot: { assignedBy: a.lotId ? a.actorUserId : null, source: a.lotId ? "manual" : null, at: a.lotId ? now : null },
        manual: { reason: a.reason?.trim() || null, contextDocumentId },
      },
    }, a.correlationId);
    if (inserted) {
      const events: ItemEvent[] = [{ itemId, eventType: "procurement_item_added_manually", actorUserId: a.actorUserId, afterHash: stateHash([description, unit, a.lotId ?? null]), source: "manual", reason: a.reason ?? null,
        details: contextDocumentId ? { contextDocumentKind: a.contextDocumentKind } : null }];
      if (a.lotId) events.push({ itemId, lotId: a.lotId, eventType: "procurement_item_assigned_to_lot", actorUserId: a.actorUserId, source: "manual" });
      if (q.value !== null) {
        await writePlannedQuantity(tx, a, itemId, null, q.value, 1, "informed");
        events.push({ itemId, eventType: "procurement_planned_quantity_changed", actorUserId: a.actorUserId, beforeHash: stateHash(null), afterHash: stateHash(q.value), source: "user" });
      }
      await appendItemEvents(tx, a.organizationId, a.processId, events, a.correlationId);
      await recordProcessEvent({ organizationId: a.organizationId, processId: a.processId, eventType: "change", actor: String(a.actorUserId), summary: "Itens da contratação: item adicionado manualmente.", refId: itemId, correlationId: a.correlationId }, tx);
    }
    return { itemId };
  });
}

// ─── Quantidade prevista (informar / "Usar N") ───────────────────────────────────────────

export type QuantityChange =
  | { itemId: string; expectedRevision: number; mode: "informed"; quantity: string | number | null }
  | { itemId: string; expectedRevision: number; mode: "adopt_source"; sourceType: CandidateSourceType; sourceId: string };

/**
 * Aplica 1..N decisões de quantidade numa ÚNICA transação (a ação "Usar quantidades do documento" é esta
 * mesma operação com N itens escolhidos no preview). "Usar N" = adoção EXPLÍCITA da quantidade vista na
 * fonte vinculada ao item (validada no servidor) — nunca automática. Nova versão do contexto; drafts que
 * consumiram o valor ficam desatualizados; documento aprovado ⇒ GOVERNED_CHANGE_REQUIRED.
 */
export async function setPlannedQuantities(a: Actor & { changes: QuantityChange[]; reason?: string | null; idempotencyKey: string }): Promise<{ result: { updated: string[] }; replayed: boolean }> {
  if (!a.changes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhuma alteração informada." });
  if (new Set(a.changes.map((c) => c.itemId)).size !== a.changes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Item repetido na mesma operação." });
  const parsed = a.changes.map((c) => {
    if (c.mode !== "informed") return null;
    const q = parsePlannedQuantity(c.quantity);
    if (!q.ok) throw new TRPCError({ code: "BAD_REQUEST", message: q.error });
    return q.value;
  });
  return runItemsWrite({ ...a, op: "procurement.items.quantity", payload: { c: a.changes, r: a.reason ?? null } }, async (tx) => {
    const links = await listItemSourceLinks(a.organizationId, a.processId, tx);
    const ctx = await ctxOrNull(a, tx);
    const gov = await loadGovernance(a.organizationId, a.processId, ctx);
    const events: ItemEvent[] = [];
    const updated: string[] = [];
    for (const [i, c] of a.changes.entries()) {
      const it = await requireItem(tx, a, c.itemId, c.expectedRevision);
      if (it.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ITEM_WITHDRAWN: item retirado da contratação." });
      let value: number | null;
      let mode: string;
      let observed: number | null = null;
      if (c.mode === "adopt_source") {
        const l = links.find((x) => x.itemId === it.id && x.sourceType === c.sourceType && x.sourceId === c.sourceId);
        if (!l || l.sourceQuantity === null) throw new TRPCError({ code: "BAD_REQUEST", message: "NO_SOURCE_QUANTITY: a fonte vinculada não informa quantidade para este item." });
        value = l.sourceQuantity; observed = l.sourceQuantity; mode = `adopted_source:${l.sourceType}`;
      } else { value = parsed[i]; mode = "informed"; }
      const current = plannedField(ctx, it.id);
      const before = current?.value ?? null;
      if (current?.status !== "conflict" && stateHash(before) === stateHash(value)) continue; // no-op honesto
      assertNotGoverned(gov, before === null && current?.status !== "conflict" ? "quantity_define" : "quantity_change", it.id);
      if (!(await updateItemCAS(tx, a.organizationId, a.processId, it.id, it.revision, a.actorUserId, {}))) staleRevision();
      await writePlannedQuantity(tx, a, it.id, current, value, it.revision + 1, mode);
      updated.push(it.id);
      events.push({
        itemId: it.id, eventType: c.mode === "adopt_source" ? "procurement_source_quantity_adopted" : "procurement_planned_quantity_changed",
        actorUserId: a.actorUserId, beforeHash: stateHash(before), afterHash: stateHash(value),
        source: c.mode === "adopt_source" ? c.sourceType : "user", reason: a.reason ?? null,
        details: c.mode === "adopt_source" ? { observed, adopted: value } : { resolvedConflict: current?.status === "conflict" },
      });
    }
    await appendItemEvents(tx, a.organizationId, a.processId, events, a.correlationId);
    if (updated.length) {
      await recordProcessEvent({ organizationId: a.organizationId, processId: a.processId, eventType: "change", actor: String(a.actorUserId),
        summary: `Itens da contratação: quantidade prevista definida/alterada em ${updated.length} item(ns).`, refId: a.processId, correlationId: a.correlationId }, tx);
    }
    return { updated };
  });
}

// ─── Descrição / unidade / retirada ───────────────────────────────────────────────────────

export async function updateProcurementItem(a: Actor & {
  itemId: string; expectedRevision: number; description?: string; unit?: string; reason?: string | null; idempotencyKey: string;
}): Promise<{ result: { itemId: string; revision: number }; replayed: boolean }> {
  return runItemsWrite({ ...a, op: "procurement.items.update", payload: { i: a.itemId, r: a.expectedRevision, d: a.description ?? null, u: a.unit ?? null, why: a.reason ?? null } }, async (tx) => {
    const it = await requireItem(tx, a, a.itemId, a.expectedRevision);
    const description = a.description === undefined ? it.description : normalizeText(a.description);
    const unit = a.unit === undefined ? it.unit : normalizeText(a.unit);
    if (!description || !unit) throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_ITEM: descrição e unidade são obrigatórias." });
    if (description === it.description && unit === it.unit) return { itemId: it.id, revision: it.revision };
    const gov = await loadGovernance(a.organizationId, a.processId, await ctxOrNull(a, tx));
    if (description !== it.description) assertNotGoverned(gov, "description", it.id);
    if (unit !== it.unit) assertNotGoverned(gov, "unit", it.id);
    const now = new Date().toISOString();
    const provenance: ItemProvenance = {
      ...it.provenance,
      description: description !== it.description ? { ...it.provenance.description, source: "user", overriddenBy: a.actorUserId, at: now } : it.provenance.description,
      unit: unit !== it.unit ? { ...it.provenance.unit, source: "user", overriddenBy: a.actorUserId, at: now } : it.provenance.unit,
    };
    if (!(await updateItemCAS(tx, a.organizationId, a.processId, it.id, it.revision, a.actorUserId, { description, unit, fingerprint: itemFingerprint(description, unit), provenance }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{
      itemId: it.id, eventType: "procurement_item_updated", actorUserId: a.actorUserId,
      beforeHash: stateHash([it.description, it.unit]), afterHash: stateHash([description, unit]), source: "user", reason: a.reason ?? null,
      details: { description: description !== it.description, unit: unit !== it.unit },
    }], a.correlationId);
    return { itemId: it.id, revision: it.revision + 1 };
  });
}

/** Retira o item da contratação (nunca hard-delete; motivo obrigatório; histórico e vínculos preservados). */
export async function withdrawProcurementItem(a: Actor & { itemId: string; expectedRevision: number; reason: string; idempotencyKey: string }) {
  if (!a.reason?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo da retirada." });
  return runItemsWrite({ ...a, op: "procurement.items.withdraw", payload: { i: a.itemId, r: a.expectedRevision, why: a.reason } }, async (tx) => {
    const it = await requireItem(tx, a, a.itemId, a.expectedRevision);
    if (it.status === "withdrawn") return { itemId: it.id };
    assertNotGoverned(await loadGovernance(a.organizationId, a.processId, await ctxOrNull(a, tx)), "withdraw", it.id);
    if (!(await updateItemCAS(tx, a.organizationId, a.processId, it.id, it.revision, a.actorUserId, { status: "withdrawn", withdrawnReason: a.reason.trim() }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{ itemId: it.id, lotId: it.lotId, eventType: "procurement_item_withdrawn", actorUserId: a.actorUserId, beforeHash: stateHash("active"), afterHash: stateHash("withdrawn"), source: "user", reason: a.reason }], a.correlationId);
    return { itemId: it.id };
  });
}

// ─── Lotes ─────────────────────────────────────────────────────────────────────────────────

export async function createProcurementLot(a: Actor & { code: string; name: string; description?: string | null; idempotencyKey: string }) {
  const code = normalizeText(a.code);
  const name = normalizeText(a.name);
  if (!code || !name) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe código e nome do lote." });
  const codeKey = lotCodeKey(code);
  return runItemsWrite({ ...a, op: "procurement.lots.create", payload: { code, name, d: a.description ?? null } }, async (tx) => {
    assertNotGoverned(await loadGovernance(a.organizationId, a.processId, null), "lot", null);
    const lotId = procurementLotId(a.organizationId, a.processId, `manual:${codeKey}`);
    const ok = await insertLotIfAbsent(tx, {
      id: lotId, organizationId: a.organizationId, processId: a.processId, code, codeKey, name, description: a.description?.trim() || null,
      ordinal: await nextLotOrdinal(tx, a.organizationId, a.processId), status: "active", revision: 1, createdBy: a.actorUserId, updatedBy: a.actorUserId,
    }, a.correlationId);
    if (!ok) throw new TRPCError({ code: "CONFLICT", message: "LOT_CODE_EXISTS: já existe um lote com este código neste processo." });
    await appendItemEvents(tx, a.organizationId, a.processId, [{ lotId, eventType: "procurement_lot_created", actorUserId: a.actorUserId, afterHash: stateHash([code, name]), source: "manual" }], a.correlationId);
    return { lotId };
  });
}

export async function updateProcurementLot(a: Actor & { lotId: string; expectedRevision: number; code?: string; name?: string; description?: string | null; idempotencyKey: string }) {
  return runItemsWrite({ ...a, op: "procurement.lots.update", payload: { l: a.lotId, r: a.expectedRevision, c: a.code ?? null, n: a.name ?? null, d: a.description ?? null } }, async (tx) => {
    const lot = await requireLot(tx, a, a.lotId);
    if (lot.revision !== a.expectedRevision) staleRevision();
    const code = a.code === undefined ? lot.code : normalizeText(a.code);
    const name = a.name === undefined ? lot.name : normalizeText(a.name);
    if (!code || !name) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe código e nome do lote." });
    const codeKey = lotCodeKey(code);
    if (codeKey !== lot.codeKey && (await listProcurementLots(a.organizationId, a.processId, tx)).some((l) => l.codeKey === codeKey)) {
      throw new TRPCError({ code: "CONFLICT", message: "LOT_CODE_EXISTS: já existe um lote com este código neste processo." });
    }
    const description = a.description === undefined ? lot.description : a.description?.trim() || null;
    if (!(await updateLotCAS(tx, a.organizationId, a.processId, lot.id, lot.revision, a.actorUserId, { code, codeKey, name, description }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{ lotId: lot.id, eventType: "procurement_lot_updated", actorUserId: a.actorUserId, beforeHash: stateHash([lot.code, lot.name, lot.description]), afterHash: stateHash([code, name, description]), source: "user" }], a.correlationId);
    return { lotId: lot.id };
  });
}

/** Arquiva o lote (nunca hard-delete). Exige lote vazio — itens são movidos explicitamente antes. */
export async function archiveProcurementLot(a: Actor & { lotId: string; expectedRevision: number; reason: string; idempotencyKey: string }) {
  if (!a.reason?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o motivo do arquivamento." });
  return runItemsWrite({ ...a, op: "procurement.lots.archive", payload: { l: a.lotId, r: a.expectedRevision, why: a.reason } }, async (tx) => {
    const lot = await requireLot(tx, a, a.lotId);
    if (lot.revision !== a.expectedRevision) staleRevision();
    const items = await listProcurementItems(a.organizationId, a.processId, tx);
    if (items.some((i) => i.status === "active" && i.lotId === lot.id)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "LOT_NOT_EMPTY: mova os itens deste lote antes de arquivá-lo." });
    assertNotGoverned(await loadGovernance(a.organizationId, a.processId, null), "lot", null);
    if (!(await updateLotCAS(tx, a.organizationId, a.processId, lot.id, lot.revision, a.actorUserId, { status: "archived" }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{ lotId: lot.id, eventType: "procurement_lot_archived", actorUserId: a.actorUserId, source: "user", reason: a.reason }], a.correlationId);
    return { lotId: lot.id };
  });
}

/** Atribui/move/retira o item de lote. Pertencimento é ESTADO: o id do item não muda. */
export async function assignItemToLot(a: Actor & { itemId: string; expectedRevision: number; lotId: string | null; idempotencyKey: string }) {
  return runItemsWrite({ ...a, op: "procurement.items.lot", payload: { i: a.itemId, r: a.expectedRevision, l: a.lotId } }, async (tx) => {
    const it = await requireItem(tx, a, a.itemId, a.expectedRevision);
    if (it.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "ITEM_WITHDRAWN: item retirado da contratação." });
    if (a.lotId) await requireLot(tx, a, a.lotId);
    if (it.lotId === a.lotId) return { itemId: it.id, revision: it.revision };
    assertNotGoverned(await loadGovernance(a.organizationId, a.processId, null), "lot", it.id);
    const now = new Date().toISOString();
    if (!(await updateItemCAS(tx, a.organizationId, a.processId, it.id, it.revision, a.actorUserId, {
      lotId: a.lotId, provenance: { ...it.provenance, lot: { assignedBy: a.lotId ? a.actorUserId : null, source: a.lotId ? "manual" : null, at: now } },
    }))) staleRevision();
    const eventType = it.lotId === null ? "procurement_item_assigned_to_lot" : a.lotId === null ? "procurement_item_unassigned_from_lot" : "procurement_item_moved_between_lots";
    await appendItemEvents(tx, a.organizationId, a.processId, [{ itemId: it.id, lotId: a.lotId ?? it.lotId, eventType, actorUserId: a.actorUserId, beforeHash: stateHash(it.lotId), afterHash: stateHash(a.lotId), source: "manual" }], a.correlationId);
    return { itemId: it.id, revision: it.revision + 1 };
  });
}

/** Reordena (sobe/desce) o item dentro do seu grupo (mesmo lote ou "sem lote"). Ordem persistida (ordinal). */
export async function moveProcurementItem(a: Actor & { itemId: string; expectedRevision: number; direction: "up" | "down"; idempotencyKey: string }) {
  return runItemsWrite({ ...a, op: "procurement.items.move", payload: { i: a.itemId, r: a.expectedRevision, d: a.direction } }, async (tx) => {
    const it = await requireItem(tx, a, a.itemId, a.expectedRevision);
    const group = (await listProcurementItems(a.organizationId, a.processId, tx)).filter((i) => i.status === "active" && i.lotId === it.lotId);
    const idx = group.findIndex((g) => g.id === it.id);
    const other = group[a.direction === "up" ? idx - 1 : idx + 1];
    if (!other) return { itemId: it.id };
    const o = await lockItem(tx, a.organizationId, a.processId, other.id);
    if (!o) staleRevision();
    if (!(await updateItemCAS(tx, a.organizationId, a.processId, it.id, it.revision, a.actorUserId, { ordinal: o.ordinal }))) staleRevision();
    if (!(await updateItemCAS(tx, a.organizationId, a.processId, o.id, o.revision, a.actorUserId, { ordinal: it.ordinal }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{ itemId: it.id, eventType: "procurement_item_reordered", actorUserId: a.actorUserId, beforeHash: stateHash(it.ordinal), afterHash: stateHash(o.ordinal), source: "user" }], a.correlationId);
    return { itemId: it.id };
  });
}

export async function moveProcurementLot(a: Actor & { lotId: string; expectedRevision: number; direction: "up" | "down"; idempotencyKey: string }) {
  return runItemsWrite({ ...a, op: "procurement.lots.move", payload: { l: a.lotId, r: a.expectedRevision, d: a.direction } }, async (tx) => {
    const lot = await requireLot(tx, a, a.lotId);
    if (lot.revision !== a.expectedRevision) staleRevision();
    const lots = (await listProcurementLots(a.organizationId, a.processId, tx)).filter((l) => l.status === "active");
    const idx = lots.findIndex((l) => l.id === lot.id);
    const other = lots[a.direction === "up" ? idx - 1 : idx + 1];
    if (!other) return { lotId: lot.id };
    const o = await lockLot(tx, a.organizationId, a.processId, other.id);
    if (!o) staleRevision();
    if (!(await updateLotCAS(tx, a.organizationId, a.processId, lot.id, lot.revision, a.actorUserId, { ordinal: o.ordinal }))) staleRevision();
    if (!(await updateLotCAS(tx, a.organizationId, a.processId, o.id, o.revision, a.actorUserId, { ordinal: lot.ordinal }))) staleRevision();
    await appendItemEvents(tx, a.organizationId, a.processId, [{ lotId: lot.id, eventType: "procurement_lot_reordered", actorUserId: a.actorUserId, beforeHash: stateHash(lot.ordinal), afterHash: stateHash(o.ordinal), source: "user" }], a.correlationId);
    return { lotId: lot.id };
  });
}

