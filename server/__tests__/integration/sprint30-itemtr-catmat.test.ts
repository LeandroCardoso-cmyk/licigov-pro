/**
 * Sprint 3.0 — ItemTR + CATMAT/CATSER + TR Intelligence Engine.
 * Integration tests for all new domain models and services.
 *
 * Coverage:
 *   - itemTR
 *   - itemReviewWorkflow
 *   - clauseIntelligence
 *   - catalogIntegrationService
 *   - catalogSearchEngine
 *   - itemMatchingEngine
 *   - trIntelligenceEngine
 *   - itemAnalyticsService
 *   - semanticObservabilityService (new helpers)
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  createItemTR,
  computeItemTRId,
  selectCandidate,
  approveItem,
  rejectItem,
  overrideItem,
  markManualEntry,
  finalizeItem,
  addWarning,
  recomputeTotals,
  attachConsensus,
  itemConfidenceLevel,
  type ItemTR,
} from "../../domain/itemTR";

import {
  ITEM_REVIEW_TRANSITIONS,
  isValidItemReviewTransition,
  isTerminalItemReviewState,
  guardItemReviewTransition,
  buildItemReviewTransition,
  appendItemReviewTransition,
  currentItemStateFromHistory,
  lastItemTransitionBy,
  assertOverrideJustification,
  MIN_OVERRIDE_JUSTIFICATION_LENGTH,
  type ItemReviewState,
  type ItemReviewHistory,
} from "../../domain/itemReviewWorkflow";

import {
  recommendClauses,
  selectClauseTemplate,
  evaluateConditionalClause,
  injectLegalReference,
  linkClauseToItem,
  inferProcurementType,
  type ClauseTemplate,
  type ClauseRecommendationContext,
  type ClauseItemInput,
} from "../../domain/clauseIntelligence";

import {
  createSemanticCandidate,
  buildExplanation,
  type SemanticCandidate,
} from "../../domain/semanticCandidate";

import type { ExtractionProvenance } from "../../domain/importProvenance";
import type { ReviewActor } from "../../domain/importReviewState";

// ─── Service imports ──────────────────────────────────────────────────────────

import {
  normalizeCatalogEntry,
  ingestCatalog,
  indexCatalog,
  syncCatalog,
  computeCatalogChecksum,
  cacheCatalog,
  getCatalogSnapshot,
  getCachedIndex,
  getCachedEntries,
  clearCatalogCache,
  ingestSeedCatalog,
  SEED_CATALOG,
  type CatalogEntry,
} from "../../services/catalogIntegrationService";

import {
  searchExact,
  searchAlias,
  searchToken,
  searchNormalized,
  searchFuzzy,
  searchSemantic,
  rankResults,
  searchWithFallback,
  searchAll,
} from "../../services/catalogSearchEngine";

import {
  runItemMatching,
  computeMatchingReplayKey,
  type ItemMatchingInput,
} from "../../services/itemMatchingEngine";

import {
  composeItemSection,
  composeQuantities,
  groupItems,
  enrichSpecification,
  runRecommendationEngine,
  injectLegalClauses,
  orchestrateSections,
  linkSemanticClauses,
  composeTR,
  computeCompositionReplayKey,
  type TRIntelligenceInput,
} from "../../services/trIntelligenceEngine";

import {
  candidateAcceptanceRate,
  overrideRate,
  manualCorrectionRate,
  catalogAccuracy,
  clauseUsageRate,
  semanticConfidenceDrift,
  matchingStability,
  reviewLatency,
  computeItemAnalytics,
  type ItemLifecycleData,
} from "../../services/itemAnalyticsService";

import * as observability from "../../services/semanticObservabilityService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProvenance(): ExtractionProvenance {
  return {
    sourceFileId:   "file-1",
    sourceFileName: "edital.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceChecksum: "abc123",
    location:       { sheet: "Itens", row: 2 },
    parserType:     "xlsx",
    parserVersion:  "1.0.0",
    extractedAt:    "2026-01-01T00:00:00.000Z",
  };
}

function makeActor(type: ReviewActor["type"] = "human"): ReviewActor {
  return {
    type,
    userId: type === "human" ? 42 : undefined,
    userEmail: type === "human" ? "rev@gov.br" : undefined,
    organizationId: 1,
  };
}

function makeItem(overrides: Partial<Parameters<typeof createItemTR>[0]> = {}): ItemTR {
  return createItemTR({
    organizationId: 1,
    processId:      100,
    itemNumber:     1,
    description:    "Papel A4 branco 75g resma",
    unit:           "RESMA",
    quantity:       10,
    estimatedUnitPrice: 25.5,
    provenance:     makeProvenance(),
    sourceImportSessionId: 5,
    canonicalUnit:  "RESMA",
    catmatCode:     "150001",
    ...overrides,
  });
}

function makeCandidateFor(item: ItemTR, overrides: Partial<Parameters<typeof createSemanticCandidate>[3]> = {}): SemanticCandidate {
  return createSemanticCandidate("staging-1", 5, 1, {
    proposedDescription: "Papel A4 branco 75g resma 500 folhas",
    score: 0.9,
    source: "exact_match",
    explanation: buildExplanation("Exact", ["papel", "a4"], 0, 0.1),
    originalRaw: "papel a4",
    catmatCode: "150001",
    catmatDesc: "Papel A4 branco 75g resma 500 folhas",
    ...overrides,
  });
}

function makeTemplate(overrides: Partial<ClauseTemplate> = {}): ClauseTemplate {
  return {
    id:            "tpl-warranty",
    type:          "specification",
    title:         "Garantia",
    content:       "O objeto deverá ter garantia mínima de {{warrantyMonths}} meses.",
    legalBasis:    "Art. 40, §1º, Lei 14.133/2021",
    priority:      10,
    appliesTo:     ["bem", "tic"],
    baseRelevance: 0.7,
    ...overrides,
  };
}

const SEED = ingestSeedCatalog(0);

beforeEach(() => {
  clearCatalogCache();
});

// ─── itemTR ──────────────────────────────────────────────────────────────────

describe("itemTR — creation & identity", () => {
  it("creates an ItemTR with deterministic id", () => {
    const a = makeItem();
    const b = makeItem();
    expect(a.id).toBe(b.id);
    expect(a.id.length).toBe(32);
  });

  it("computeItemTRId is a pure function of inputs", () => {
    const id1 = computeItemTRId(1, 100, 1, 5);
    const id2 = computeItemTRId(1, 100, 1, 5);
    const id3 = computeItemTRId(1, 100, 2, 5);
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("different org yields different id", () => {
    expect(computeItemTRId(1, 100, 1, 5)).not.toBe(computeItemTRId(2, 100, 1, 5));
  });

  it("initializes review state to pending_match", () => {
    expect(makeItem().reviewState).toBe("pending_match");
  });

  it("computes estimatedTotalPrice on creation", () => {
    expect(makeItem({ estimatedUnitPrice: 25.5, quantity: 10 }).estimatedTotalPrice).toBe(255);
  });

  it("null unit price yields null total", () => {
    expect(makeItem({ estimatedUnitPrice: null }).estimatedTotalPrice).toBeNull();
  });

  it("defaults normalizedDescription to description", () => {
    const i = makeItem({ normalizedDescription: undefined });
    expect(i.normalizedDescription).toBe(i.description);
  });

  it("clamps confidenceScore to [0,1]", () => {
    expect(makeItem({ confidenceScore: 1.5 }).confidenceScore).toBe(1);
    expect(makeItem({ confidenceScore: -0.3 }).confidenceScore).toBe(0);
  });

  it("organizationId is mandatory and preserved", () => {
    expect(makeItem({ organizationId: 7 }).organizationId).toBe(7);
  });

  it("metadata and warnings start empty arrays/objects", () => {
    const i = makeItem();
    expect(i.warnings).toEqual([]);
    expect(i.metadata).toEqual({});
  });
});

describe("itemTR — immutability & mutations", () => {
  it("addWarning returns a new object", () => {
    const a = makeItem();
    const b = addWarning(a, "PRICE_MISMATCH");
    expect(b).not.toBe(a);
    expect(a.warnings).toEqual([]);
    expect(b.warnings).toContain("PRICE_MISMATCH");
  });

  it("addWarning dedups", () => {
    const a = addWarning(makeItem(), "W1");
    const b = addWarning(a, "W1");
    expect(b.warnings).toEqual(["W1"]);
  });

  it("recomputeTotals recalculates", () => {
    const a = makeItem({ estimatedUnitPrice: 10, quantity: 3 });
    // recomputeTotals não depende de transição de estado — testa só o cálculo
    const b = recomputeTotals({ ...a, quantity: 5 });
    expect(b.estimatedTotalPrice).toBe(50);
  });

  it("recomputeTotals is idempotent when unchanged", () => {
    const a = makeItem();
    const b = recomputeTotals(a);
    expect(b.estimatedTotalPrice).toBe(a.estimatedTotalPrice);
  });

  it("preserves provenance through mutations", () => {
    const a = makeItem();
    const b = addWarning(a, "X");
    expect(b.provenance).toEqual(a.provenance);
  });
});

describe("itemTR — candidate selection", () => {
  it("selectCandidate links catmat and advances state", () => {
    const cand = makeCandidateFor(makeItem());
    const item = makeItem({ semanticCandidates: [cand] });
    const next = selectCandidate(item, cand.id, makeActor());
    expect(next.selectedCandidate?.id).toBe(cand.id);
    expect(next.catmatCode).toBe("150001");
    expect(next.reviewState).toBe("awaiting_review");
    expect(next.confidenceScore).toBe(cand.score);
  });

  it("selectCandidate throws on unknown candidate", () => {
    const item = makeItem({ semanticCandidates: [] });
    expect(() => selectCandidate(item, "nope", makeActor())).toThrow();
  });

  it("selectCandidate is immutable", () => {
    const cand = makeCandidateFor(makeItem());
    const item = makeItem({ semanticCandidates: [cand] });
    const next = selectCandidate(item, cand.id, makeActor());
    expect(item.selectedCandidate).toBeNull();
    expect(next).not.toBe(item);
  });
});

describe("itemTR — lifecycle (approve/reject/override)", () => {
  function awaiting(): ItemTR {
    const cand = makeCandidateFor(makeItem());
    return selectCandidate(makeItem({ semanticCandidates: [cand] }), cand.id, makeActor());
  }

  it("approveItem by human sets approvedBy/At", () => {
    const item = awaiting();
    const approved = approveItem(item, makeActor());
    expect(approved.reviewState).toBe("approved");
    expect(approved.approvedBy).toBe(42);
    expect(approved.approvedAt).not.toBeNull();
  });

  it("approveItem by system throws", () => {
    const item = awaiting();
    expect(() => approveItem(item, makeActor("system"))).toThrow();
  });

  it("rejectItem moves to rejected (terminal)", () => {
    const item = awaiting();
    const rejected = rejectItem(item, makeActor(), "fora do escopo");
    expect(rejected.reviewState).toBe("rejected");
    expect(isTerminalItemReviewState(rejected.reviewState)).toBe(true);
  });

  it("overrideItem applies fields and recomputes totals", () => {
    const item = awaiting();
    const over = overrideItem(item, makeActor(), { quantity: 20, estimatedUnitPrice: 30 }, "correção do quantitativo");
    expect(over.reviewState).toBe("overridden");
    expect(over.quantity).toBe(20);
    expect(over.estimatedTotalPrice).toBe(600);
  });

  it("overrideItem requires justification >= 5 chars", () => {
    const item = awaiting();
    expect(() => overrideItem(item, makeActor(), { quantity: 1 }, "no")).toThrow();
  });

  it("overrideItem by system throws", () => {
    const item = awaiting();
    expect(() => overrideItem(item, makeActor("system"), { quantity: 1 }, "valid justification")).toThrow();
  });

  it("finalizeItem requires prior approved/overridden", () => {
    const item = makeItem();
    expect(() => finalizeItem(item, makeActor())).toThrow();
  });

  it("finalizeItem succeeds after approval", () => {
    const approved = approveItem(awaiting(), makeActor());
    const finalized = finalizeItem(approved, makeActor());
    expect(finalized.reviewState).toBe("finalized");
  });

  it("markManualEntry moves to manual_entry", () => {
    const m = markManualEntry(makeItem(), makeActor());
    expect(m.reviewState).toBe("manual_entry");
  });

  it("review history is append-only and grows", () => {
    const item = awaiting();
    expect(item.reviewHistory.length).toBeGreaterThanOrEqual(2);
    const approved = approveItem(item, makeActor());
    expect(approved.reviewHistory.length).toBe(item.reviewHistory.length + 1);
  });

  it("attachConsensus updates confidence", () => {
    const cand = makeCandidateFor(makeItem());
    const item = makeItem({ semanticCandidates: [cand] });
    const consensus = { consensusScore: 0.77 } as never;
    const next = attachConsensus(item, consensus);
    expect(next.confidenceScore).toBe(0.77);
  });

  it("itemConfidenceLevel reflects score bands", () => {
    expect(itemConfidenceLevel(makeItem({ confidenceScore: 0.9 }))).toBe("high");
    expect(itemConfidenceLevel(makeItem({ confidenceScore: 0.5 }))).toBe("low");
  });
});

// ─── itemReviewWorkflow ────────────────────────────────────────────────────────

describe("itemReviewWorkflow — states & transitions", () => {
  const states: ItemReviewState[] = [
    "pending_match", "candidate_generated", "awaiting_review", "approved",
    "rejected", "overridden", "manual_entry", "finalized",
  ];

  it("declares all 8 states in transition table", () => {
    for (const s of states) expect(ITEM_REVIEW_TRANSITIONS[s]).toBeDefined();
  });

  it("rejected and finalized are terminal", () => {
    expect(ITEM_REVIEW_TRANSITIONS.rejected).toEqual([]);
    expect(ITEM_REVIEW_TRANSITIONS.finalized).toEqual([]);
    expect(isTerminalItemReviewState("rejected")).toBe(true);
    expect(isTerminalItemReviewState("finalized")).toBe(true);
  });

  it("valid transition pending_match → candidate_generated", () => {
    expect(isValidItemReviewTransition("pending_match", "candidate_generated")).toBe(true);
  });

  it("invalid transition pending_match → finalized", () => {
    expect(isValidItemReviewTransition("pending_match", "finalized")).toBe(false);
  });

  it("guard blocks system approval", () => {
    const g = guardItemReviewTransition("awaiting_review", "approved", makeActor("system"));
    expect(g.canTransition).toBe(false);
  });

  it("guard allows human approval", () => {
    const g = guardItemReviewTransition("awaiting_review", "approved", makeActor("human"));
    expect(g.canTransition).toBe(true);
  });

  it("guard allows ai_assist override", () => {
    const g = guardItemReviewTransition("awaiting_review", "overridden", makeActor("ai_assist"));
    expect(g.canTransition).toBe(true);
  });

  it("guard blocks finalize without prior approved/overridden", () => {
    const g = guardItemReviewTransition("approved", "finalized", makeActor(), { history: [] });
    // approved is in `from`, so finalize is allowed
    expect(g.canTransition).toBe(true);
  });

  it("guard blocks invalid transition outright", () => {
    const g = guardItemReviewTransition("rejected", "approved", makeActor());
    expect(g.canTransition).toBe(false);
  });

  it("override transition requires justification", () => {
    expect(() => buildItemReviewTransition("i1", "awaiting_review", "overridden", makeActor(), {})).toThrow();
  });

  it("assertOverrideJustification enforces min length", () => {
    expect(() => assertOverrideJustification("hi")).toThrow();
    expect(() => assertOverrideJustification("valid reason")).not.toThrow();
    expect(MIN_OVERRIDE_JUSTIFICATION_LENGTH).toBe(5);
  });

  it("history append is immutable", () => {
    const t = buildItemReviewTransition("i1", "pending_match", "candidate_generated", makeActor("system"));
    const h0: ItemReviewHistory = [];
    const h1 = appendItemReviewTransition(h0, t);
    expect(h0.length).toBe(0);
    expect(h1.length).toBe(1);
  });

  it("currentItemStateFromHistory is deterministic", () => {
    const t1 = buildItemReviewTransition("i1", "pending_match", "candidate_generated", makeActor("system"));
    const t2 = buildItemReviewTransition("i1", "candidate_generated", "awaiting_review", makeActor("system"));
    const history = appendItemReviewTransition(appendItemReviewTransition([], t1), t2);
    expect(currentItemStateFromHistory(history)).toBe("awaiting_review");
  });

  it("empty history returns initial", () => {
    expect(currentItemStateFromHistory([])).toBe("pending_match");
  });

  it("lastItemTransitionBy filters by actor type", () => {
    const sys = buildItemReviewTransition("i1", "pending_match", "candidate_generated", makeActor("system"));
    const hum = buildItemReviewTransition("i1", "awaiting_review", "approved", makeActor("human"));
    const history = appendItemReviewTransition(appendItemReviewTransition([], sys), hum);
    expect(lastItemTransitionBy(history, "human")?.toState).toBe("approved");
    expect(lastItemTransitionBy(history, "ai_assist")).toBeNull();
  });
});

// ─── clauseIntelligence ────────────────────────────────────────────────────────

describe("clauseIntelligence", () => {
  const item: ClauseItemInput = {
    id: "item-1",
    normalizedDescription: "notebook portatil 16gb ram ssd",
    canonicalUnit: "UN",
    catmatCode: "194567",
    catserCode: null,
  };

  const ctx: ClauseRecommendationContext = {
    procurementType: "bem",
    templates: [
      makeTemplate({ id: "tpl-a", priority: 5, baseRelevance: 0.6, appliesTo: ["bem"] }),
      makeTemplate({ id: "tpl-b", priority: 10, baseRelevance: 0.5, appliesTo: ["bem"] }),
    ],
    compositionContext: { warrantyMonths: 12 },
  };

  it("recommendClauses returns deterministic ordering", () => {
    const r1 = recommendClauses(item, ctx);
    const r2 = recommendClauses(item, ctx);
    expect(r1.map(r => r.id)).toEqual(r2.map(r => r.id));
  });

  it("orders by priority DESC then relevance", () => {
    const recs = recommendClauses(item, ctx);
    expect(recs[0].templateId).toBe("tpl-b"); // priority 10
  });

  it("substitutes template variables", () => {
    const recs = recommendClauses(item, ctx);
    expect(recs.some(r => r.content.includes("12 meses"))).toBe(true);
  });

  it("injects legal reference", () => {
    const recs = recommendClauses(item, ctx);
    expect(recs.every(r => r.legalBasis == null || r.content.includes(r.legalBasis))).toBe(true);
  });

  it("injectLegalReference no-op without basis", () => {
    expect(injectLegalReference("abc", null)).toBe("abc");
  });

  it("injectLegalReference idempotent", () => {
    const once = injectLegalReference("abc", "Art. 5º");
    expect(injectLegalReference(once, "Art. 5º")).toBe(once);
  });

  it("excludes templates not applicable to type", () => {
    const recs = recommendClauses(item, {
      ...ctx,
      templates: [makeTemplate({ id: "x", appliesTo: ["obra"] })],
    });
    expect(recs.find(r => r.templateId === "x")).toBeUndefined();
  });

  it("generic templates apply to any type", () => {
    const recs = recommendClauses(item, {
      ...ctx,
      templates: [makeTemplate({ id: "g", appliesTo: ["generico"] })],
    });
    expect(recs.find(r => r.templateId === "g")).toBeDefined();
  });

  it("semantic match boosts relevance", () => {
    const recs = recommendClauses(item, {
      ...ctx,
      templates: [makeTemplate({ id: "sem", appliesTo: ["bem"], baseRelevance: 0.5 })],
      semanticClauses: [{ templateId: "sem", matchTokens: ["notebook", "ssd"], bonus: 0.3 }],
    });
    const rec = recs.find(r => r.templateId === "sem")!;
    expect(rec.source).toBe("semantic_match");
    expect(rec.relevanceScore).toBeGreaterThan(0.5);
  });

  it("override takes precedence and is marked", () => {
    const recs = recommendClauses(item, {
      ...ctx,
      overrides: [makeTemplate({ id: "ov", appliesTo: ["bem"] })],
    });
    const rec = recs.find(r => r.templateId === "ov")!;
    expect(rec.isOverride).toBe(true);
    expect(rec.source).toBe("override");
  });

  it("conditional clause included when condition met", () => {
    const recs = recommendClauses(item, {
      ...ctx,
      conditionals: [{ templateId: "tpl-a", condition: "requiresWarranty" }],
      compositionContext: { requiresWarranty: true, warrantyMonths: 12 },
    });
    expect(recs.find(r => r.templateId === "tpl-a")).toBeDefined();
  });

  it("evaluateConditionalClause respects context", () => {
    expect(evaluateConditionalClause({ templateId: "t", condition: "x" }, { x: true })).toBe(true);
    expect(evaluateConditionalClause({ templateId: "t", condition: "x" }, { x: false })).toBe(false);
  });

  it("selectClauseTemplate is deterministic best pick", () => {
    const t = selectClauseTemplate(ctx.templates, "bem");
    expect(t?.id).toBe("tpl-b");
  });

  it("selectClauseTemplate returns null when none applicable", () => {
    expect(selectClauseTemplate([makeTemplate({ appliesTo: ["obra"] })], "servico")).toBeNull();
  });

  it("linkClauseToItem produces a link", () => {
    const recs = recommendClauses(item, ctx);
    const link = linkClauseToItem(recs[0], item);
    expect(link.itemId).toBe("item-1");
    expect(link.recommendationId).toBe(recs[0].id);
  });

  it("inferProcurementType from catalog codes", () => {
    expect(inferProcurementType(item)).toBe("bem");
    expect(inferProcurementType({ ...item, catmatCode: null, catserCode: "500120" })).toBe("servico");
    expect(inferProcurementType({ ...item, catmatCode: null, catserCode: null })).toBe("generico");
  });
});

// ─── catalogIntegrationService ─────────────────────────────────────────────────

describe("catalogIntegrationService", () => {
  it("normalizeCatalogEntry tokenizes and normalizes unit", () => {
    const e = normalizeCatalogEntry(SEED_CATALOG[0], 0);
    expect(e.canonicalUnit).toBe("RESMA");
    expect(e.tokens.length).toBeGreaterThan(0);
    expect(e.tokens).toEqual([...e.tokens].sort());
  });

  it("normalization is deterministic", () => {
    const a = normalizeCatalogEntry(SEED_CATALOG[0], 0);
    const b = normalizeCatalogEntry(SEED_CATALOG[0], 0);
    expect(a.tokens).toEqual(b.tokens);
    expect(a.normalizedDescription).toBe(b.normalizedDescription);
  });

  it("ingestCatalog sorts by code", () => {
    const entries = ingestCatalog(SEED_CATALOG, 0);
    const codes = entries.map(e => e.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("seed catalog contains catmat and catser", () => {
    expect(SEED.some(e => e.catalogType === "catmat")).toBe(true);
    expect(SEED.some(e => e.catalogType === "catser")).toBe(true);
  });

  it("indexCatalog builds a searchable index", () => {
    const idx = indexCatalog(SEED);
    expect(idx.size()).toBe(SEED.filter(e => e.active).length);
  });

  it("indexing is deterministic (same size)", () => {
    expect(indexCatalog(SEED).size()).toBe(indexCatalog(SEED).size());
  });

  it("computeCatalogChecksum is deterministic and order-independent", () => {
    const a = computeCatalogChecksum(SEED);
    const b = computeCatalogChecksum([...SEED].reverse());
    expect(a).toBe(b);
  });

  it("checksum changes when entries change", () => {
    const modified: CatalogEntry[] = [...SEED];
    modified[0] = { ...modified[0], normalizedDescription: "changed" };
    expect(computeCatalogChecksum(SEED)).not.toBe(computeCatalogChecksum(modified));
  });

  it("syncCatalog creates snapshot + history (create)", () => {
    const result = syncCatalog(1, "catmat", "v1", SEED);
    expect(result.snapshot.organizationId).toBe(1);
    expect(result.history.operation).toBe("create");
    expect(result.snapshot.checksum).toBe(result.checksum);
  });

  it("syncCatalog with previous snapshot records update", () => {
    const first = syncCatalog(1, "catmat", "v1", SEED);
    const second = syncCatalog(1, "catmat", "v2", SEED, { previousSnapshot: first.snapshot });
    expect(second.history.operation).toBe("update");
    expect(second.snapshot.snapshotLineage).toBe(first.snapshot.id);
  });

  it("sync is replay-safe (same checksum for same entries)", () => {
    const a = syncCatalog(1, "catmat", "v1", SEED);
    const b = syncCatalog(1, "catmat", "v1", SEED);
    expect(a.checksum).toBe(b.checksum);
  });

  it("cacheCatalog stores and getCatalogSnapshot retrieves", () => {
    cacheCatalog(1, "catmat", "v1", SEED);
    expect(getCatalogSnapshot(1, "catmat")).not.toBeNull();
    expect(getCachedIndex(1, "catmat")).not.toBeNull();
    expect(getCachedEntries(1, "catmat")?.length).toBe(SEED.length);
  });

  it("cache miss returns null", () => {
    expect(getCatalogSnapshot(999, "catmat")).toBeNull();
  });

  it("expired cache (ttl 0) returns null", () => {
    cacheCatalog(1, "catmat", "v1", SEED, 0);
    expect(getCatalogSnapshot(1, "catmat")).toBeNull();
  });

  it("organizationId 0 = global seed", () => {
    expect(SEED.every(e => e.organizationId === 0)).toBe(true);
  });
});

// ─── catalogSearchEngine ───────────────────────────────────────────────────────

describe("catalogSearchEngine", () => {
  it("searchExact matches normalized description", () => {
    const results = searchExact("Papel A4 branco 75g resma 500 folhas", SEED);
    expect(results.length).toBe(1);
    expect(results[0].matchSource).toBe("exact");
    expect(results[0].score).toBe(1.0);
  });

  it("searchAlias matches registered alias", () => {
    const results = searchAlias("papel sulfite a4", SEED);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].matchSource).toBe("alias");
  });

  it("searchToken finds intersection", () => {
    const results = searchToken("notebook computador", SEED);
    expect(results.some(r => r.entry.code === "194567")).toBe(true);
  });

  it("searchNormalized requires all tokens present", () => {
    const results = searchNormalized("notebook portatil", SEED);
    expect(results.some(r => r.entry.code === "194567")).toBe(true);
  });

  it("searchFuzzy tolerates typos", () => {
    const results = searchFuzzy("notbook portatil", SEED); // typo: notbook
    expect(results.some(r => r.entry.code === "194567")).toBe(true);
  });

  it("searchSemantic produces scored results", () => {
    const results = searchSemantic("caneta esferografica azul", SEED);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("rankResults orders deterministically", () => {
    const combined = [...searchToken("notebook", SEED), ...searchSemantic("notebook", SEED)];
    const r1 = rankResults(combined);
    const r2 = rankResults([...combined].reverse());
    expect(r1.map(r => r.entry.code)).toEqual(r2.map(r => r.entry.code));
  });

  it("rankResults dedups by code", () => {
    const combined = [...searchToken("notebook", SEED), ...searchSemantic("notebook", SEED)];
    const ranked = rankResults(combined);
    const codes = ranked.map(r => r.entry.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every result has an explainable rationale", () => {
    const ranked = searchAll("notebook portatil", SEED);
    expect(ranked.every(r => r.rankRationale.length > 0)).toBe(true);
  });

  it("searchWithFallback uses exact first", () => {
    const r = searchWithFallback("Papel A4 branco 75g resma 500 folhas", SEED);
    expect(r.usedSource).toBe("exact");
    expect(r.cascade[0]).toBe("exact");
  });

  it("searchWithFallback cascades to fuzzy on typo", () => {
    const r = searchWithFallback("notbook portatil ram", SEED);
    expect(["token", "normalized", "fuzzy"]).toContain(r.usedSource);
    expect(r.results.length).toBeGreaterThan(0);
  });

  it("searchWithFallback returns none for gibberish", () => {
    const r = searchWithFallback("zzzqqq xxyy", SEED);
    expect(r.usedSource).toBe("none");
    expect(r.results.length).toBe(0);
  });

  it("searchAll combines strategies and ranks", () => {
    const results = searchAll("alcool 70 antisseptico", SEED);
    expect(results.some(r => r.entry.code === "267890")).toBe(true);
  });

  it("empty query yields no results", () => {
    expect(searchExact("", SEED)).toEqual([]);
    expect(searchAll("", SEED)).toEqual([]);
  });
});

// ─── itemMatchingEngine ────────────────────────────────────────────────────────

describe("itemMatchingEngine", () => {
  function makeInput(overrides: Partial<ItemMatchingInput> = {}): ItemMatchingInput {
    return {
      description:     "notebook portatil 16gb ram ssd 512gb",
      canonicalUnit:   "UN",
      parserType:      "xlsx",
      confidence:      0.8,
      organizationId:  0,
      processId:       100,
      importSessionId: 5,
      stagingItemId:   "staging-1",
      ...overrides,
    };
  }

  it("produces exactly 8 stage results", () => {
    const r = runItemMatching(makeInput(), SEED);
    expect(r.stageResults.length).toBe(8);
    expect(r.stageResults.map(s => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("replayKey is deterministic", () => {
    const input = makeInput();
    expect(computeMatchingReplayKey(input)).toBe(computeMatchingReplayKey(input));
  });

  it("same input yields same candidateSet ids & consensus score", () => {
    const input = makeInput();
    const r1 = runItemMatching(input, SEED);
    const r2 = runItemMatching(input, SEED);
    expect(r1.replayKey).toBe(r2.replayKey);
    expect(r1.candidateSet.candidates.map(c => c.id)).toEqual(r2.candidateSet.candidates.map(c => c.id));
    expect(r1.consensus.consensusScore).toBe(r2.consensus.consensusScore);
  });

  it("different description yields different replayKey", () => {
    expect(computeMatchingReplayKey(makeInput())).not.toBe(
      computeMatchingReplayKey(makeInput({ description: "outra coisa" })),
    );
  });

  it("correlationId is unique per run", () => {
    const input = makeInput();
    expect(runItemMatching(input, SEED).correlationId).not.toBe(runItemMatching(input, SEED).correlationId);
  });

  it("generates candidates for matching description", () => {
    const r = runItemMatching(makeInput(), SEED);
    expect(r.candidateSet.candidates.length).toBeGreaterThan(0);
  });

  it("builds consensus and explainability per candidate", () => {
    const r = runItemMatching(makeInput(), SEED);
    expect(r.consensus).toBeDefined();
    for (const c of r.candidateSet.candidates) {
      expect(r.explainabilities[c.id]).toBeDefined();
    }
  });

  it("reviewRequired true for no matches", () => {
    const r = runItemMatching(makeInput({ description: "zzz qqq xxyy nada" }), SEED);
    expect(r.candidateSet.candidates.length).toBe(0);
    expect(r.reviewRequired).toBe(true);
  });

  it("scopes entries to org or global", () => {
    const orgEntries: CatalogEntry[] = ingestSeedCatalog(7);
    const r = runItemMatching(makeInput({ organizationId: 7 }), [...orgEntries, ...SEED]);
    expect(r.organizationId).toBe(7);
  });

  it("stage results include warnings when appropriate", () => {
    const r = runItemMatching(makeInput({ canonicalUnit: null }), SEED);
    const norm = r.stageResults.find(s => s.name === "normalization_influence")!;
    expect(norm.notes).toContain("NO_CANONICAL_UNIT");
  });

  it("selectedCandidate matches consensus winner", () => {
    const r = runItemMatching(makeInput(), SEED);
    expect(r.selectedCandidate?.id).toBe(r.consensus.winningCandidate?.id ?? null);
  });
});

// ─── trIntelligenceEngine ──────────────────────────────────────────────────────

describe("trIntelligenceEngine", () => {
  function approvedItem(num: number, overrides: Partial<Parameters<typeof createItemTR>[0]> = {}): ItemTR {
    const base = makeItem({ itemNumber: num, ...overrides });
    const cand = makeCandidateFor(base);
    const sel = selectCandidate(makeItem({ itemNumber: num, semanticCandidates: [cand], ...overrides }), cand.id, makeActor());
    return approveItem(sel, makeActor());
  }

  function makeInput(items: ItemTR[]): TRIntelligenceInput {
    return {
      items,
      processContext: { modality: "pregão", processNumber: "PE-001/2026" },
      organizationId: 1,
    };
  }

  it("composeItemSection lists items in order", () => {
    const section = composeItemSection([approvedItem(2), approvedItem(1)]);
    expect(section.clauses[0].content).toContain("Item 1");
  });

  it("composeItemSection handles empty items gracefully", () => {
    const section = composeItemSection([]);
    expect(section.clauses.length).toBe(1);
  });

  it("composeQuantities aggregates totals", () => {
    const q = composeQuantities([approvedItem(1), approvedItem(2)]);
    expect(q.totalItems).toBe(2);
    expect(q.totalValue).toBeGreaterThan(0);
    expect(q.byUnit["RESMA"]).toBe(20);
  });

  it("groupItems groups deterministically", () => {
    const g1 = groupItems([approvedItem(1), approvedItem(2)]);
    const g2 = groupItems([approvedItem(2), approvedItem(1)]);
    expect(g1.map(g => g.key)).toEqual(g2.map(g => g.key));
  });

  it("enrichSpecification appends details", () => {
    const spec = enrichSpecification(approvedItem(1, { detailedSpecification: "branco 75g" }));
    expect(spec).toContain("CATMAT");
  });

  it("injectLegalClauses references Lei 14.133", () => {
    const section = injectLegalClauses({ modality: "pregão" });
    expect(section.clauses[0].content).toContain("14.133");
  });

  it("orchestrateSections orders by order field", () => {
    const sections = orchestrateSections([approvedItem(1)], { modality: "pregão" });
    expect(sections[0].order).toBeLessThan(sections[1].order);
  });

  it("composeTR is replay-safe (same replayKey)", () => {
    const input = makeInput([approvedItem(1), approvedItem(2)]);
    expect(composeTR(input).replayKey).toBe(composeTR(input).replayKey);
  });

  it("composeTR replayKey is order-independent in items", () => {
    const a = composeTR(makeInput([approvedItem(1), approvedItem(2)]));
    const b = composeTR(makeInput([approvedItem(2), approvedItem(1)]));
    expect(a.replayKey).toBe(b.replayKey);
  });

  it("composeTR handles empty items (fallback-safe)", () => {
    const result = composeTR(makeInput([]));
    expect(result.composedSections.length).toBeGreaterThan(0);
    expect(result.recommendedClauses).toEqual([]);
    expect(result.compositionRationale).toContain("vazia");
  });

  it("composeTR produces rationale and groups", () => {
    const result = composeTR(makeInput([approvedItem(1), approvedItem(2)]));
    expect(result.compositionRationale.length).toBeGreaterThan(0);
    expect(result.itemGroups.length).toBeGreaterThanOrEqual(1);
  });

  it("composeTR correlationId is unique", () => {
    const input = makeInput([approvedItem(1)]);
    expect(composeTR(input).correlationId).not.toBe(composeTR(input).correlationId);
  });

  it("runRecommendationEngine dedups by template", () => {
    const ctx: ClauseRecommendationContext = {
      procurementType: "bem",
      templates: [makeTemplate({ id: "t1", appliesTo: ["bem"] })],
      compositionContext: { warrantyMonths: 12 },
    };
    const recs = runRecommendationEngine([approvedItem(1), approvedItem(2)], ctx);
    expect(recs.filter(r => r.templateId === "t1").length).toBe(1);
  });

  it("linkSemanticClauses returns groups", () => {
    const groups = linkSemanticClauses([approvedItem(1)]);
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("computeCompositionReplayKey is pure", () => {
    const input = makeInput([approvedItem(1)]);
    expect(computeCompositionReplayKey(input)).toBe(computeCompositionReplayKey(input));
  });
});

// ─── itemAnalyticsService ──────────────────────────────────────────────────────

describe("itemAnalyticsService", () => {
  function makeLifecycle(n: number, overrides: Partial<ItemLifecycleData> = {}): ItemLifecycleData[] {
    return Array.from({ length: n }, (_, i) => ({
      itemId: `i${i}`,
      organizationId: 1,
      reviewState: "approved",
      hadCandidates: true,
      selectedCandidate: i % 2 === 0,
      overridden: i % 4 === 0,
      manualEntry: false,
      catalogLinked: true,
      catalogCorrect: i % 3 !== 0,
      confidenceScore: 0.7 + (i % 3) * 0.1,
      reviewLatencyMs: 1000 + i * 100,
      ...overrides,
    }));
  }

  it("candidateAcceptanceRate computes percent", () => {
    const kpi = candidateAcceptanceRate(makeLifecycle(4));
    expect(kpi.unit).toBe("percent");
    expect(kpi.value).toBe(50);
  });

  it("overrideRate counts overridden", () => {
    expect(overrideRate(makeLifecycle(4)).value).toBe(25);
  });

  it("manualCorrectionRate includes overrides", () => {
    expect(manualCorrectionRate(makeLifecycle(4)).value).toBeGreaterThan(0);
  });

  it("catalogAccuracy over linked items", () => {
    const kpi = catalogAccuracy(makeLifecycle(6));
    expect(kpi.value).toBeGreaterThan(0);
    expect(kpi.value).toBeLessThanOrEqual(100);
  });

  it("clauseUsageRate handles zero recommended", () => {
    expect(clauseUsageRate({ recommendedCount: 0, usedCount: 0 }).value).toBe(0);
    expect(clauseUsageRate({ recommendedCount: 4, usedCount: 2 }).value).toBe(50);
  });

  it("semanticConfidenceDrift averages deltas", () => {
    const kpi = semanticConfidenceDrift([
      { windowLabel: "w1", avgConfidence: 0.8 },
      { windowLabel: "w2", avgConfidence: 0.6 },
      { windowLabel: "w3", avgConfidence: 0.7 },
    ]);
    expect(kpi.value).toBeCloseTo(0.15, 4);
  });

  it("semanticConfidenceDrift zero for single window", () => {
    expect(semanticConfidenceDrift([{ windowLabel: "w", avgConfidence: 0.5 }]).value).toBe(0);
  });

  it("matchingStability 100% when consistent", () => {
    const kpi = matchingStability([
      { replayKey: "k1", candidateSetSignature: "s1" },
      { replayKey: "k1", candidateSetSignature: "s1" },
    ]);
    expect(kpi.value).toBe(100);
  });

  it("matchingStability detects instability", () => {
    const kpi = matchingStability([
      { replayKey: "k1", candidateSetSignature: "s1" },
      { replayKey: "k1", candidateSetSignature: "s2" },
    ]);
    expect(kpi.value).toBe(0);
  });

  it("reviewLatency averages ms", () => {
    const kpi = reviewLatency(makeLifecycle(3));
    expect(kpi.unit).toBe("ms");
    expect(kpi.value).toBeGreaterThan(0);
  });

  it("computeItemAnalytics returns 8 KPIs", () => {
    const snap = computeItemAnalytics(1, makeLifecycle(4));
    expect(snap.kpis.length).toBe(8);
    expect(snap.organizationId).toBe(1);
  });

  it("KPIs are pure (same input → same value)", () => {
    const data = makeLifecycle(4);
    expect(candidateAcceptanceRate(data).value).toBe(candidateAcceptanceRate(data).value);
  });

  it("handles empty input gracefully", () => {
    const snap = computeItemAnalytics(1, []);
    expect(snap.kpis.length).toBe(8);
    expect(snap.itemCount).toBe(0);
  });
});

// ─── semanticObservabilityService (new helpers) ───────────────────────────────

describe("semanticObservabilityService — Sprint 3.0 helpers", () => {
  const base = { correlationId: "c1", organizationId: 1 };

  it("matchingLatencyV2 is callable", () => {
    expect(() => observability.matchingLatencyV2({ ...base, stagingItemId: "s1", totalMs: 5, stageBreakdown: {}, candidateCount: 2 })).not.toThrow();
  });

  it("catalogLatency is callable", () => {
    expect(() => observability.catalogLatency({ ...base, catalogType: "catmat", operation: "sync", totalMs: 3, entryCount: 10 })).not.toThrow();
  });

  it("clauseGenerationLatency is callable", () => {
    expect(() => observability.clauseGenerationLatency({ ...base, itemCount: 2, clauseCount: 5, totalMs: 4 })).not.toThrow();
  });

  it("candidateInstability is callable", () => {
    expect(() => observability.candidateInstability({ ...base, replayKey: "k", expectedSignature: "a", actualSignature: "b" })).not.toThrow();
  });

  it("overrideFrequency is callable", () => {
    expect(() => observability.overrideFrequency({ organizationId: 1, windowLabel: "w", overrideCount: 1, totalItems: 10, rate: 0.1 })).not.toThrow();
  });

  it("semanticAnomaly is callable", () => {
    expect(() => observability.semanticAnomaly({ ...base, itemId: "i1", anomalyType: "x", description: "d" })).not.toThrow();
  });

  it("compositionAnomaly is callable", () => {
    expect(() => observability.compositionAnomaly({ ...base, replayKey: "k", anomalyType: "x", description: "d" })).not.toThrow();
  });

  it("catalogSyncAnomaly is callable", () => {
    expect(() => observability.catalogSyncAnomaly({ organizationId: 1, catalogType: "catmat", expectedChecksum: "a", actualChecksum: "b", description: "d" })).not.toThrow();
  });

  it("existing helpers remain intact", () => {
    expect(typeof observability.recordTrace).toBe("function");
    expect(typeof observability.matchingLatency).toBe("function");
    expect(typeof observability.rankingAnomaly).toBe("function");
  });
});
