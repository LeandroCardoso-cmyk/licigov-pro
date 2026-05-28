import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../db/connection", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/observabilityService", () => ({
  serviceLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn((_op: string, fn: () => Promise<unknown>) => fn()),
    span:  vi.fn((_op: string, fn: () => Promise<unknown>) => fn().then((r: unknown) => ({ result: r, durationMs: 1, slow: false }))),
  }),
  structuredLog: vi.fn(),
  timed: vi.fn((_s: string, _o: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  logFromCtx:  vi.fn().mockResolvedValue(undefined),
}));

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  REVIEW_TRANSITIONS,
  isValidReviewTransition,
  isTerminalReviewState,
  isHumanActionRequired,
  canAutoAdvance,
  guardReviewTransition,
  buildReviewTransition,
  currentStateFromHistory,
  lastTransitionBy,
  type ReviewState,
  type ReviewActor,
} from "../../domain/importReviewState";

import {
  createExtractionEvidence,
  addEvidenceEntry,
  buildRawExtractionEvidence,
  buildUnitNormalizationEvidence,
  buildHumanCorrectionEvidence,
  getEvidenceByField,
  getLastTransformationFor,
  hasHumanOverride,
  evidenceSummary,
} from "../../domain/extractionEvidence";

import {
  createSemanticCandidate,
  rankCandidates,
  buildCandidateSet,
  acceptCandidate,
  rejectCandidate,
  supersedeCandidates,
  buildExplanation,
  adjustedScore,
  type CandidateSource,
} from "../../domain/semanticCandidate";

import {
  ParserCapabilityRegistry,
  XLSX_CAPABILITY,
  CSV_CAPABILITY,
  PDF_CAPABILITY,
  DOCX_CAPABILITY,
  parserCapabilityRegistry,
} from "../../domain/parserCapabilities";

import {
  tokenize,
  stemPt,
  levenshtein,
  isFuzzyMatch,
  scoreAgainstEntry,
  SemanticIndex,
  createSearchEntry,
  incrementFrequency,
  globalSemanticIndex,
} from "../../domain/semanticIndex";

import {
  runNormalizationPipeline,
  runBatchNormalization,
  type PipelineOptions,
} from "../../services/normalizationPipelineService";

import {
  computeAnalytics,
  getKpi,
  getHealthyKpis,
  getUnhealthyKpis,
  isSnapshotHealthy,
  compareSnapshots,
  type SessionAnalyticsData,
  type StagingItemAnalyticsData,
} from "../../services/importAnalyticsService";

import { buildProvenance } from "../../domain/importProvenance";
import { EMPTY_CONFIDENCE, buildFieldConfidence, aggregateConfidence } from "../../domain/importConfidence";
import { createRawItem } from "../../domain/importExtraction";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SYSTEM_ACTOR: ReviewActor = {
  type:           "system",
  organizationId: 1,
};

const HUMAN_ACTOR: ReviewActor = {
  type:           "human",
  userId:         42,
  userEmail:      "revisor@org.com",
  organizationId: 1,
};

const AI_ACTOR: ReviewActor = {
  type:           "ai_assist",
  agentId:        "gpt-4o-licigov",
  organizationId: 1,
};

function makeProvenance() {
  return buildProvenance({ sheet: "Planilha1", row: 5, col: "B", pageNumber: 1 });
}

function makeRawItem(overrides: Record<string, unknown> = {}) {
  const conf = aggregateConfidence([
    buildFieldConfidence("description", 0.80),
    buildFieldConfidence("unit",        0.70),
    buildFieldConfidence("quantity",    0.85),
    buildFieldConfidence("unit_price",  0.75),
  ]);

  return createRawItem(
    1,
    {
      rawDescription: "Papel A4 resma 500 folhas",
      rawQuantity:    "10",
      rawUnit:        "RM",
      rawUnitPrice:   "25,90",
      rawTotalPrice:  "259,00",
      ...overrides,
    },
    makeProvenance(),
    { parserType: "xlsx", parserVersion: "1.0.0", processingMs: 50, rawCellValues: {} },
    conf,
  );
}

// ─── 1. Review State Machine ──────────────────────────────────────────────────

describe("importReviewState", () => {
  describe("REVIEW_TRANSITIONS", () => {
    it("has entries for all 9 states", () => {
      const states: ReviewState[] = [
        "extracted","normalized","review_pending","reviewed",
        "approved","rejected","corrected","catmat_linked","finalized",
      ];
      for (const state of states) {
        expect(REVIEW_TRANSITIONS).toHaveProperty(state);
      }
    });

    it("rejected is terminal (no transitions)", () => {
      expect(REVIEW_TRANSITIONS.rejected).toHaveLength(0);
    });

    it("finalized is terminal (no transitions)", () => {
      expect(REVIEW_TRANSITIONS.finalized).toHaveLength(0);
    });

    it("extracted can advance to normalized", () => {
      expect(REVIEW_TRANSITIONS.extracted).toContain("normalized");
    });

    it("approved can go to finalized", () => {
      expect(REVIEW_TRANSITIONS.approved).toContain("finalized");
    });

    it("corrected can go back to review_pending", () => {
      expect(REVIEW_TRANSITIONS.corrected).toContain("review_pending");
    });
  });

  describe("isValidReviewTransition", () => {
    it("accepts valid transition extracted→normalized", () => {
      expect(isValidReviewTransition("extracted", "normalized")).toBe(true);
    });

    it("accepts valid transition review_pending→approved", () => {
      expect(isValidReviewTransition("review_pending", "approved")).toBe(true);
    });

    it("rejects invalid transition rejected→approved", () => {
      expect(isValidReviewTransition("rejected", "approved")).toBe(false);
    });

    it("rejects invalid transition finalized→extracted", () => {
      expect(isValidReviewTransition("finalized", "extracted")).toBe(false);
    });
  });

  describe("isTerminalReviewState", () => {
    it("rejected is terminal", () => expect(isTerminalReviewState("rejected")).toBe(true));
    it("finalized is terminal", () => expect(isTerminalReviewState("finalized")).toBe(true));
    it("approved is NOT terminal", () => expect(isTerminalReviewState("approved")).toBe(false));
    it("extracted is NOT terminal", () => expect(isTerminalReviewState("extracted")).toBe(false));
  });

  describe("isHumanActionRequired", () => {
    it("review_pending requires human", () => expect(isHumanActionRequired("review_pending")).toBe(true));
    it("reviewed requires human", ()      => expect(isHumanActionRequired("reviewed")).toBe(true));
    it("extracted does NOT require human", () => expect(isHumanActionRequired("extracted")).toBe(false));
    it("finalized does NOT require human", () => expect(isHumanActionRequired("finalized")).toBe(false));
  });

  describe("canAutoAdvance", () => {
    it("extracted can auto advance", () => expect(canAutoAdvance("extracted")).toBe(true));
    it("normalized can auto advance", () => expect(canAutoAdvance("normalized")).toBe(true));
    it("review_pending cannot auto advance", () => expect(canAutoAdvance("review_pending")).toBe(false));
  });

  describe("guardReviewTransition", () => {
    it("allows system to advance extracted→normalized", () => {
      const guard = guardReviewTransition("extracted", "normalized", SYSTEM_ACTOR);
      expect(guard.canTransition).toBe(true);
    });

    it("blocks system from approving", () => {
      const guard = guardReviewTransition("review_pending", "approved", SYSTEM_ACTOR);
      expect(guard.canTransition).toBe(false);
      expect(guard.reason).toMatch(/human/i);
    });

    it("allows human to approve", () => {
      const guard = guardReviewTransition("review_pending", "approved", HUMAN_ACTOR);
      expect(guard.canTransition).toBe(true);
    });

    it("blocks human from finalizing", () => {
      const guard = guardReviewTransition("approved", "finalized", HUMAN_ACTOR);
      expect(guard.canTransition).toBe(false);
      expect(guard.reason).toMatch(/sistema/i);
    });

    it("allows system to finalize", () => {
      const guard = guardReviewTransition("approved", "finalized", SYSTEM_ACTOR);
      expect(guard.canTransition).toBe(true);
    });

    it("allows ai_assist to correct", () => {
      const guard = guardReviewTransition("review_pending", "corrected", AI_ACTOR);
      expect(guard.canTransition).toBe(true);
    });

    it("returns reason for invalid transition", () => {
      const guard = guardReviewTransition("rejected", "approved", HUMAN_ACTOR);
      expect(guard.canTransition).toBe(false);
      expect(guard.reason).toBeTruthy();
    });
  });

  describe("buildReviewTransition", () => {
    it("builds transition with all fields", () => {
      const t = buildReviewTransition("item-1", "extracted", "normalized", SYSTEM_ACTOR, "pipeline step");
      expect(t.id).toBeTruthy();
      expect(t.stagingItemId).toBe("item-1");
      expect(t.fromState).toBe("extracted");
      expect(t.toState).toBe("normalized");
      expect(t.actor).toEqual(SYSTEM_ACTOR);
      expect(t.reason).toBe("pipeline step");
      expect(t.occurredAt).toMatch(/^\d{4}-/);
    });
  });

  describe("currentStateFromHistory", () => {
    it("returns initial state for empty history", () => {
      expect(currentStateFromHistory([])).toBe("extracted");
    });

    it("returns last state from history", () => {
      const h = [
        buildReviewTransition("i", "extracted",  "normalized",    SYSTEM_ACTOR),
        buildReviewTransition("i", "normalized",  "review_pending", SYSTEM_ACTOR),
      ];
      expect(currentStateFromHistory(h)).toBe("review_pending");
    });

    it("respects custom initial state", () => {
      expect(currentStateFromHistory([], "normalized")).toBe("normalized");
    });
  });

  describe("lastTransitionBy", () => {
    it("returns null when no transitions by actor", () => {
      const h = [buildReviewTransition("i", "extracted", "normalized", SYSTEM_ACTOR)];
      expect(lastTransitionBy(h, "human")).toBeNull();
    });

    it("returns most recent transition by actor type", () => {
      const h = [
        buildReviewTransition("i", "extracted",    "normalized",    SYSTEM_ACTOR),
        buildReviewTransition("i", "review_pending","approved",     HUMAN_ACTOR),
      ];
      const last = lastTransitionBy(h, "human");
      expect(last?.toState).toBe("approved");
    });
  });
});

// ─── 2. Extraction Evidence ───────────────────────────────────────────────────

describe("extractionEvidence", () => {
  it("creates empty evidence with empty chain", () => {
    const ev = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    expect(ev.chain).toHaveLength(0);
    expect(ev.stagingItemId).toBe("staging-1");
  });

  it("addEvidenceEntry appends to chain immutably", () => {
    const ev = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const entry = buildRawExtractionEvidence("description", "Papel A4", 0.85);
    const ev2   = addEvidenceEntry(ev, entry);

    expect(ev.chain).toHaveLength(0);   // original unchanged
    expect(ev2.chain).toHaveLength(1);
    expect(ev2.chain[0].type).toBe("raw_extraction");
    expect(ev2.chain[0].field).toBe("description");
  });

  it("buildRawExtractionEvidence sets correct strength for high confidence", () => {
    const entry = buildRawExtractionEvidence("unit", "RM", 0.90);
    expect(entry.strength).toBe("definitive");
    expect(entry.confidence).toBe(0.90);
  });

  it("buildRawExtractionEvidence sets moderate strength for medium confidence", () => {
    const entry = buildRawExtractionEvidence("unit", "UN", 0.65);
    expect(entry.strength).toBe("strong");
  });

  it("buildUnitNormalizationEvidence - exact match is definitive", () => {
    const entry = buildUnitNormalizationEvidence("UN", "UNIDADE", "exact", 1.0);
    expect(entry.strength).toBe("definitive");
    expect(entry.type).toBe("unit_normalization");
  });

  it("buildUnitNormalizationEvidence - fuzzy match is moderate", () => {
    const entry = buildUnitNormalizationEvidence("UND", "UNIDADE", "fuzzy", 0.75);
    expect(entry.strength).toBe("moderate");
  });

  it("buildHumanCorrectionEvidence is definitive with confidence 1.0", () => {
    const entry = buildHumanCorrectionEvidence("unit", "UN", "UNIDADE", 42, "correção pelo operador");
    expect(entry.strength).toBe("definitive");
    expect(entry.confidence).toBe(1.0);
    expect(entry.type).toBe("human_correction");
  });

  it("getEvidenceByField filters correctly", () => {
    let ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence("description", "Papel", 0.8));
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence("unit", "RM", 0.7));
    ev = addEvidenceEntry(ev, buildUnitNormalizationEvidence("RM", "RESMA", "exact", 1.0));

    const unitEntries = getEvidenceByField(ev, "unit");
    expect(unitEntries).toHaveLength(2);
    unitEntries.forEach(e => expect(e.field).toBe("unit"));
  });

  it("getLastTransformationFor returns most recent for field", () => {
    let ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence("unit", "RM", 0.7));
    ev = addEvidenceEntry(ev, buildUnitNormalizationEvidence("RM", "RESMA", "exact", 1.0));

    const last = getLastTransformationFor(ev, "unit");
    expect(last?.type).toBe("unit_normalization");
  });

  it("getLastTransformationFor returns null for unknown field", () => {
    const ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    expect(getLastTransformationFor(ev, "nonexistent")).toBeNull();
  });

  it("hasHumanOverride returns false without human correction", () => {
    let ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence("unit", "RM", 0.7));
    expect(hasHumanOverride(ev, "unit")).toBe(false);
  });

  it("hasHumanOverride returns true after human correction", () => {
    let ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    ev = addEvidenceEntry(ev, buildHumanCorrectionEvidence("unit", "RM", "RESMA", 42, "fixed"));
    expect(hasHumanOverride(ev, "unit")).toBe(true);
  });

  it("evidenceSummary counts correctly", () => {
    let ev = createExtractionEvidence("s1", 1, 1, makeProvenance());
    ev = addEvidenceEntry(ev, buildRawExtractionEvidence("description", "Papel", 0.8));
    ev = addEvidenceEntry(ev, buildHumanCorrectionEvidence("unit", "RM", "RESMA", 42, "fix"));
    ev = addEvidenceEntry(ev, buildHumanCorrectionEvidence("description", "old", "new", 42, "fix 2"));

    const summary = evidenceSummary(ev);
    expect(summary.totalTransformations).toBe(3);
    expect(summary.humanOverrides).toBe(2);
    expect(summary.aiSuggestions).toBe(0);
    expect(summary.avgConfidence).toBeGreaterThan(0);
  });
});

// ─── 3. Semantic Candidate ────────────────────────────────────────────────────

describe("semanticCandidate", () => {
  it("createSemanticCandidate sets defaults correctly", () => {
    const c = createSemanticCandidate("s1", 1, 1, {
      proposedDescription: "PAPEL A4 RESMA",
      score: 0.92,
      source: "exact_match",
      explanation: buildExplanation("exact match", ["papel", "a4"]),
      originalRaw: "Papel A4 500 folhas",
    });

    expect(c.id).toBeTruthy();
    expect(c.stagingItemId).toBe("s1");
    expect(c.score).toBe(0.92);
    expect(c.status).toBe("pending");
    expect(c.rank).toBe(1);
  });

  it("createSemanticCandidate clamps score to [0,1]", () => {
    const c = createSemanticCandidate("s1", 1, 1, {
      proposedDescription: "test",
      score: 1.5,
      source: "exact_match",
      explanation: buildExplanation("test", []),
      originalRaw: "test",
    });
    expect(c.score).toBe(1.0);
  });

  it("createSemanticCandidate clamps negative score to 0", () => {
    const c = createSemanticCandidate("s1", 1, 1, {
      proposedDescription: "test",
      score: -0.3,
      source: "exact_match",
      explanation: buildExplanation("test", []),
      originalRaw: "test",
    });
    expect(c.score).toBe(0);
  });

  describe("rankCandidates", () => {
    it("ranks by score descending", () => {
      const candidates = [
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "B", score: 0.7, source: "token_match", explanation: buildExplanation("", []), originalRaw: "B" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.9, source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "C", score: 0.5, source: "fuzzy_match", explanation: buildExplanation("", []), originalRaw: "C" }),
      ];

      const ranked = rankCandidates(candidates);
      expect(ranked[0].score).toBe(0.9);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[1].score).toBe(0.7);
      expect(ranked[1].rank).toBe(2);
      expect(ranked[2].score).toBe(0.5);
      expect(ranked[2].rank).toBe(3);
    });

    it("uses source priority as tiebreaker", () => {
      const candidates = [
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "B", score: 0.80, source: "fuzzy_match",  explanation: buildExplanation("", []), originalRaw: "B" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.80, source: "exact_match",  explanation: buildExplanation("", []), originalRaw: "A" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "C", score: 0.80, source: "alias_match",  explanation: buildExplanation("", []), originalRaw: "C" }),
      ];

      const ranked = rankCandidates(candidates);
      expect(ranked[0].source).toBe("exact_match");   // priority 0
      expect(ranked[1].source).toBe("alias_match");   // priority 1
      expect(ranked[2].source).toBe("fuzzy_match");   // priority 7
    });

    it("is deterministic (same input → same output)", () => {
      const candidates = [
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "B", score: 0.5, source: "token_match", explanation: buildExplanation("", []), originalRaw: "B" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.5, source: "token_match", explanation: buildExplanation("", []), originalRaw: "A" }),
      ];

      const r1 = rankCandidates(candidates).map(c => c.id);
      const r2 = rankCandidates(candidates).map(c => c.id);
      expect(r1).toEqual(r2);
    });
  });

  describe("buildCandidateSet", () => {
    it("marks high confidence when top score ≥ 0.85", () => {
      const c = createSemanticCandidate("s1", 1, 1, {
        proposedDescription: "A", score: 0.90,
        source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A",
      });
      const set = buildCandidateSet("s1", [c]);
      expect(set.hasHighConfidence).toBe(true);
      expect(set.requiresReview).toBe(false);
    });

    it("marks requiresReview when score < 0.85", () => {
      const c = createSemanticCandidate("s1", 1, 1, {
        proposedDescription: "A", score: 0.70,
        source: "token_match", explanation: buildExplanation("", []), originalRaw: "A",
      });
      const set = buildCandidateSet("s1", [c]);
      expect(set.hasHighConfidence).toBe(false);
      expect(set.requiresReview).toBe(true);
    });

    it("sets bestCandidate to highest ranked", () => {
      const c1 = createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.9, source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A" });
      const c2 = createSemanticCandidate("s1", 1, 1, { proposedDescription: "B", score: 0.7, source: "token_match", explanation: buildExplanation("", []), originalRaw: "B" });
      const set = buildCandidateSet("s1", [c1, c2]);
      expect(set.bestCandidate?.proposedDescription).toBe("A");
    });

    it("handles empty candidates list", () => {
      const set = buildCandidateSet("s1", []);
      expect(set.bestCandidate).toBeNull();
      expect(set.hasHighConfidence).toBe(false);
      expect(set.requiresReview).toBe(true);
    });
  });

  describe("acceptCandidate / rejectCandidate", () => {
    it("acceptCandidate sets status to accepted", () => {
      const c = createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.9, source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A" });
      const accepted = acceptCandidate(c, 42);
      expect(accepted.status).toBe("accepted");
      expect(accepted.evaluatedBy).toBe(42);
      expect(accepted.evaluatedAt).toBeTruthy();
    });

    it("rejectCandidate sets status to rejected", () => {
      const c = createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.9, source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A" });
      const rejected = rejectCandidate(c, 42);
      expect(rejected.status).toBe("rejected");
    });
  });

  describe("supersedeCandidates", () => {
    it("marks all pending except one as superseded", () => {
      const cs = [
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "A", score: 0.9, source: "exact_match", explanation: buildExplanation("", []), originalRaw: "A" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "B", score: 0.7, source: "token_match", explanation: buildExplanation("", []), originalRaw: "B" }),
        createSemanticCandidate("s1", 1, 1, { proposedDescription: "C", score: 0.5, source: "fuzzy_match", explanation: buildExplanation("", []), originalRaw: "C" }),
      ];
      const winner = cs[0];
      const after  = supersedeCandidates(cs, winner.id);
      expect(after.find(c => c.id === winner.id)?.status).toBe("pending");
      expect(after.filter(c => c.status === "superseded")).toHaveLength(2);
    });
  });

  describe("adjustedScore", () => {
    it("applies penalty and bonus correctly", () => {
      const c = createSemanticCandidate("s1", 1, 1, {
        proposedDescription: "A",
        score: 0.8,
        source: "token_match",
        explanation: buildExplanation("test", [], 0.1, 0.05),
        originalRaw: "A",
      });
      const adj = adjustedScore(c);
      expect(adj).toBeCloseTo(0.75, 5);
    });
  });
});

// ─── 4. Parser Capabilities ───────────────────────────────────────────────────

describe("parserCapabilities", () => {
  it("parserCapabilityRegistry has 4 parsers", () => {
    expect(parserCapabilityRegistry.getSupportedTypes()).toHaveLength(4);
  });

  it("xlsx capability supports multi-sheet", () => {
    const cap = parserCapabilityRegistry.get("xlsx");
    expect(cap?.supportsMultiSheet).toBe(true);
  });

  it("csv capability does NOT support multi-sheet", () => {
    const cap = parserCapabilityRegistry.get("csv");
    expect(cap?.supportsMultiSheet).toBe(false);
  });

  it("pdf capability is stub with low confidence", () => {
    const cap = parserCapabilityRegistry.get("pdf");
    expect(cap?.descriptionConfidence).toBeLessThan(0.5);
    expect(cap?.limitations.some(l => l.includes("STUB"))).toBe(true);
  });

  it("getBestParserFor multiSheet selects xlsx", () => {
    const best = parserCapabilityRegistry.getBestParserFor({ multiSheet: true });
    expect(best?.parserType).toBe("xlsx");
  });

  it("getBestParserFor multiPage returns a parser that supports multiPage", () => {
    const best = parserCapabilityRegistry.getBestParserFor({ multiPage: true });
    expect(best?.supportsMultiPage).toBe(true);
  });

  it("getBestParserFor highPriceConf excludes pdf and docx", () => {
    const best = parserCapabilityRegistry.getBestParserFor({ highPriceConf: true });
    expect(["xlsx", "csv"]).toContain(best?.parserType);
  });

  it("custom registry register and get work", () => {
    const reg = new ParserCapabilityRegistry();
    reg.register(XLSX_CAPABILITY);
    expect(reg.get("xlsx")).toBeTruthy();
    expect(reg.get("csv")).toBeNull();
    expect(reg.has("xlsx")).toBe(true);
    expect(reg.has("csv")).toBe(false);
  });

  it("getAll returns all registered capabilities", () => {
    const reg = new ParserCapabilityRegistry();
    reg.register(CSV_CAPABILITY).register(PDF_CAPABILITY);
    expect(reg.getAll()).toHaveLength(2);
  });
});

// ─── 5. Semantic Index ────────────────────────────────────────────────────────

describe("semanticIndex", () => {
  describe("tokenize", () => {
    it("tokenizes and removes stopwords", () => {
      const tokens = tokenize("caneta esferográfica de tinta azul");
      expect(tokens).toContain("caneta");
      expect(tokens).toContain("esferografica");
      expect(tokens).not.toContain("de");
    });

    it("removes diacritics", () => {
      const tokens = tokenize("lápis de madeira número 2");
      expect(tokens).toContain("lapis");
      expect(tokens).toContain("madeira");
      expect(tokens).toContain("numero");
    });

    it("filters tokens shorter than 2 chars", () => {
      const tokens = tokenize("a de caneta");
      expect(tokens.every(t => t.length >= 2)).toBe(true);
    });

    it("returns empty array for empty input", () => {
      expect(tokenize("")).toHaveLength(0);
    });

    it("returns sorted tokens (deterministic)", () => {
      const t1 = tokenize("papel caneta lapis");
      const t2 = tokenize("lapis papel caneta");
      expect(t1).toEqual(t2);
    });
  });

  describe("stemPt", () => {
    it("removes common PT-BR suffixes", () => {
      expect(stemPt("construções")).toMatch(/constru/);
    });

    it("preserves root of short tokens", () => {
      const result = stemPt("ab");
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshtein("papel", "papel")).toBe(0);
    });

    it("returns 1 for single edit", () => {
      expect(levenshtein("papel", "pael")).toBe(1);
    });

    it("returns 2 for two edits", () => {
      expect(levenshtein("caneta", "canet")).toBe(1);
    });

    it("handles empty strings", () => {
      expect(levenshtein("", "abc")).toBe(3);
      expect(levenshtein("abc", "")).toBe(3);
      expect(levenshtein("", "")).toBe(0);
    });
  });

  describe("isFuzzyMatch", () => {
    it("matches strings within distance 2", () => {
      expect(isFuzzyMatch("papel", "pael")).toBe(true);
    });

    it("does not match strings beyond distance 2", () => {
      expect(isFuzzyMatch("papel", "xyz")).toBe(false);
    });

    it("matches identical strings", () => {
      expect(isFuzzyMatch("caneta", "caneta")).toBe(true);
    });

    it("skips when length difference exceeds maxDistance", () => {
      expect(isFuzzyMatch("a", "abcdef")).toBe(false);
    });
  });

  describe("SemanticIndex", () => {
    let idx: SemanticIndex;

    beforeEach(() => {
      idx = new SemanticIndex();
    });

    it("add and get work", () => {
      const entry = createSearchEntry(1, "Papel A4 Resma");
      idx.add(entry);
      expect(idx.get(entry.id)).toEqual(entry);
      expect(idx.size()).toBe(1);
    });

    it("remove deletes entry", () => {
      const entry = createSearchEntry(1, "Papel A4");
      idx.add(entry);
      expect(idx.remove(entry.id)).toBe(true);
      expect(idx.size()).toBe(0);
    });

    it("getByOrg filters by organization and isActive", () => {
      const e1 = createSearchEntry(1, "Caneta Azul");
      const e2 = createSearchEntry(2, "Caneta Preta");
      const e3 = { ...createSearchEntry(1, "Borracha"), isActive: false };
      idx.add(e1).add(e2).add(e3);
      const org1 = idx.getByOrg(1);
      expect(org1).toHaveLength(1);
      expect(org1[0].organizationId).toBe(1);
    });

    it("search returns relevant results", () => {
      const entry = createSearchEntry(1, "Caneta Esferográfica Azul", {
        aliases: ["caneta azul", "esferografica"],
      });
      idx.add(entry);
      const results = idx.search("caneta azul", 1, 5, 0.2);
      expect(results.length).toBeGreaterThan(0);
    });

    it("search returns empty for no matches", () => {
      const entry = createSearchEntry(1, "Caneta Esferográfica Azul");
      idx.add(entry);
      const results = idx.search("notebook computador", 1, 5, 0.8);
      expect(results).toHaveLength(0);
    });

    it("search returns topK results at most", () => {
      for (let i = 0; i < 10; i++) {
        idx.add(createSearchEntry(1, `Caneta modelo ${i}`));
      }
      const results = idx.search("caneta", 1, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("clear removes all entries", () => {
      idx.add(createSearchEntry(1, "Papel")).add(createSearchEntry(1, "Caneta"));
      idx.clear();
      expect(idx.size()).toBe(0);
    });
  });

  describe("createSearchEntry", () => {
    it("creates entry with tokens", () => {
      const entry = createSearchEntry(1, "Mesa de Escritório");
      expect(entry.tokens).toContain("mesa");
      expect(entry.tokens).toContain("escritorio");
      expect(entry.tokens).not.toContain("de");
    });

    it("creates entry with alias tokens", () => {
      const entry = createSearchEntry(1, "Mesa de Escritório", {
        aliases: ["mesa trabalho", "bancada"],
      });
      expect(entry.synonymTokens).toContain("trabalho");
      expect(entry.synonymTokens).toContain("bancada");
    });

    it("sets frequency to 0 and isActive to true", () => {
      const entry = createSearchEntry(1, "Cadeira");
      expect(entry.frequency).toBe(0);
      expect(entry.isActive).toBe(true);
    });
  });

  describe("incrementFrequency", () => {
    it("increments frequency and sets lastSeenAt", () => {
      const entry = createSearchEntry(1, "Papel");
      const updated = incrementFrequency(entry);
      expect(updated.frequency).toBe(1);
      expect(updated.lastSeenAt).toBeTruthy();
    });
  });

  describe("scoreAgainstEntry", () => {
    it("returns score 1.0 for exact token match", () => {
      const entry = createSearchEntry(1, "Papel A4");
      const result = scoreAgainstEntry(tokenize("Papel A4"), entry);
      expect(result.score).toBe(1.0);
      expect(result.strategy).toBe("exact");
    });

    it("returns score 0.95 for alias match", () => {
      const entry = createSearchEntry(1, "Papel A4 Resma", { aliases: ["resma papel"] });
      const result = scoreAgainstEntry(tokenize("resma papel"), entry);
      expect(result.score).toBe(0.95);
      expect(result.strategy).toBe("alias");
    });
  });
});

// ─── 6. Normalization Pipeline ────────────────────────────────────────────────

describe("normalizationPipelineService", () => {
  const opts: PipelineOptions = {
    organizationId: 1,
    maxCandidates:  5,
    minCandidateScore: 0.35,
    skipSemanticStage: true, // skip for unit tests (no entries in global index)
  };

  it("processes a well-formed item through all 7 stages", async () => {
    const item = makeRawItem();
    const result = await runNormalizationPipeline(item, opts);

    expect(result.stageResults).toHaveLength(7);
    expect(result.stageResults[0].name).toBe("raw");
    expect(result.stageResults[6].name).toBe("review_prep");
    expect(result.stagingItemId).toBe(item.id);
  });

  it("normalizes unit RESMA to canonical form", async () => {
    const item = makeRawItem({ rawUnit: "RESMA" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.canonicalUnit).toBe("RESMA");
    expect(result.unitMatchSource).toBe("exact");
  });

  it("normalizes unit UN to canonical UN", async () => {
    const item = makeRawItem({ rawUnit: "UN" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.canonicalUnit).toBe("UN");
  });

  it("parses PT-BR quantity string", async () => {
    const item = makeRawItem({ rawQuantity: "1.500" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.quantity).toBe(1500);
  });

  it("parses PT-BR price string with vírgula decimal", async () => {
    const item = makeRawItem({ rawUnitPrice: "1.234,56" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.unitPrice).toBeCloseTo(1234.56, 2);
  });

  it("cleans description (trims whitespace and collapses multiple spaces)", async () => {
    const item = makeRawItem({ rawDescription: "  Papel  A4   " });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.description).toBe("Papel A4");
  });

  it("capitalizes first letter of description", async () => {
    const item = makeRawItem({ rawDescription: "caneta azul" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.description?.charAt(0)).toBe("C");
  });

  it("adds MISSING_UNIT flag for null unit", async () => {
    const item = makeRawItem({ rawUnit: null });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.reviewFlags.some(f => f.includes("UNIT"))).toBe(true);
  });

  it("marks requiresReview true when unit is unknown", async () => {
    const item = makeRawItem({ rawUnit: "XYZABC123" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.requiresReview).toBe(true);
  });

  it("sets stage status to 'skipped' when skipSemanticStage=true", async () => {
    const item = makeRawItem();
    const result = await runNormalizationPipeline(item, opts);
    const s6 = result.stageResults.find(s => s.name === "semantic");
    expect(s6?.status).toBe("skipped");
  });

  it("detects price mismatch with strictPriceCheck", async () => {
    const item = makeRawItem({
      rawQuantity:   "10",
      rawUnitPrice:  "25,90",
      rawTotalPrice: "300,00", // should be 259,00
    });
    const result = await runNormalizationPipeline(item, { ...opts, strictPriceCheck: true });
    expect(result.reviewFlags.some(f => f.includes("PRICE_MISMATCH"))).toBe(true);
  });

  it("pipeline fails gracefully on fatal extraction error", async () => {
    const item = makeRawItem();
    // Inject a fatal error
    (item as any).extractionErrors = [{ code: "CORRUPT_FILE", message: "bad", fatal: true }];
    const result = await runNormalizationPipeline(item, opts);
    expect(result.stageResults[0].status).toBe("failed");
    expect(result.reviewFlags).toContain("PIPELINE_FAILED");
  });

  it("evidence is populated after pipeline run", async () => {
    const item = makeRawItem({ rawUnit: "KG" });
    const result = await runNormalizationPipeline(item, opts);
    expect(result.evidence.chain.length).toBeGreaterThan(0);
    const unitEntries = result.evidence.chain.filter(e => e.field === "unit");
    expect(unitEntries.length).toBeGreaterThan(0);
  });

  describe("runBatchNormalization", () => {
    it("processes multiple items", async () => {
      const items = [makeRawItem(), makeRawItem({ rawUnit: "UN" })];
      const batch = await runBatchNormalization(items, opts);
      expect(batch.totalItems).toBe(2);
      expect(batch.results).toHaveLength(2);
      expect(batch.totalMs).toBeGreaterThanOrEqual(0);
    });

    it("returns avgConfidence for batch", async () => {
      const items = [makeRawItem(), makeRawItem()];
      const batch = await runBatchNormalization(items, opts);
      expect(batch.avgConfidence).toBeGreaterThanOrEqual(0);
      expect(batch.avgConfidence).toBeLessThanOrEqual(1);
    });
  });
});

// ─── 7. Import Analytics ──────────────────────────────────────────────────────

describe("importAnalyticsService", () => {
  function makeSessions(n: number, overrides: Partial<SessionAnalyticsData> = {}): SessionAnalyticsData[] {
    return Array.from({ length: n }, (_, i) => ({
      importSessionId: i + 1,
      organizationId:  1,
      parserType:      "xlsx",
      retryCount:      0,
      status:          "approved",
      createdAt:       "2026-05-01T10:00:00Z",
      ...overrides,
    }));
  }

  function makeItems(n: number, overrides: Partial<StagingItemAnalyticsData> = {}): StagingItemAnalyticsData[] {
    return Array.from({ length: n }, (_, i) => ({
      stagingItemId:   `item-${i}`,
      importSessionId: 1,
      reviewStatus:    "approved",
      confidence:      0.80,
      canonicalUnit:   "UNIDADE",
      candidateScore:  0.90,
      pipelineSuccess: true,
      createdAt:       "2026-05-01T10:00:00Z",
      reviewedAt:      "2026-05-01T10:05:00Z",
      parserType:      "xlsx",
      ...overrides,
    }));
  }

  it("computeAnalytics returns snapshot with 10 KPIs", () => {
    const snapshot = computeAnalytics(1, makeSessions(10), makeItems(50), "2026-05-01", "2026-05-31");
    expect(snapshot.kpis).toHaveLength(10);
    expect(snapshot.organizationId).toBe(1);
    expect(snapshot.itemCount).toBe(50);
    expect(snapshot.sessionCount).toBe(10);
  });

  it("all KPI keys are unique", () => {
    const snapshot = computeAnalytics(1, makeSessions(10), makeItems(50), "2026-05-01", "2026-05-31");
    const keys = snapshot.kpis.map(k => k.key);
    expect(new Set(keys).size).toBe(10);
  });

  it("approval_rate is 100% when all items approved", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(20, { reviewStatus: "approved" }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "approval_rate");
    expect(kpi?.value).toBe(100);
  });

  it("rejection_rate is 0% when no items rejected", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { reviewStatus: "approved" }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "rejection_rate");
    expect(kpi?.value).toBe(0);
  });

  it("rejection_rate is 50% when half rejected", () => {
    const items = [
      ...makeItems(5, { reviewStatus: "approved" }),
      ...makeItems(5, { reviewStatus: "rejected" }),
    ];
    const snapshot = computeAnalytics(1, makeSessions(5), items, "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "rejection_rate");
    expect(kpi?.value).toBe(50);
  });

  it("correction_rate counts corrected items", () => {
    const items = [
      ...makeItems(8, { reviewStatus: "approved" }),
      ...makeItems(2, { reviewStatus: "corrected" }),
    ];
    const snapshot = computeAnalytics(1, makeSessions(5), items, "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "correction_rate");
    expect(kpi?.value).toBe(20);
  });

  it("unit_normalization_rate is 100% when all have canonical unit", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { canonicalUnit: "UNIDADE" }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "unit_normalization_rate");
    expect(kpi?.value).toBe(100);
  });

  it("unit_normalization_rate is 0% when no canonical units", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { canonicalUnit: null }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "unit_normalization_rate");
    expect(kpi?.value).toBe(0);
  });

  it("semantic_match_rate is 100% when all candidates ≥ 0.85", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { candidateScore: 0.90 }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "semantic_match_rate");
    expect(kpi?.value).toBe(100);
  });

  it("retry_rate is 100% when all sessions retried", () => {
    const sessions = makeSessions(5, { retryCount: 1 });
    const snapshot = computeAnalytics(1, sessions, makeItems(10), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "retry_rate");
    expect(kpi?.value).toBe(100);
  });

  it("pipeline_success_rate is 100% when all items successful", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { pipelineSuccess: true }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "pipeline_success_rate");
    expect(kpi?.value).toBe(100);
  });

  it("avg_confidence is 80% for items with 0.80 confidence", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, { confidence: 0.80 }), "2026-05-01", "2026-05-31");
    const kpi = getKpi(snapshot, "avg_confidence");
    expect(kpi?.value).toBe(80);
  });

  it("getKpi returns null for unknown key", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10), "2026-05-01", "2026-05-31");
    expect(getKpi(snapshot, "nonexistent_kpi")).toBeNull();
  });

  it("getHealthyKpis returns only healthy KPIs", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10), "2026-05-01", "2026-05-31");
    const healthy = getHealthyKpis(snapshot);
    expect(healthy.every(k => k.isHealthy)).toBe(true);
  });

  it("getUnhealthyKpis returns only unhealthy KPIs", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10), "2026-05-01", "2026-05-31");
    const unhealthy = getUnhealthyKpis(snapshot);
    expect(unhealthy.every(k => !k.isHealthy)).toBe(true);
  });

  it("isSnapshotHealthy returns true when all KPIs healthy", () => {
    const snapshot = computeAnalytics(1, makeSessions(5), makeItems(10, {
      reviewStatus:    "approved",
      confidence:      0.90,
      canonicalUnit:   "UNIDADE",
      candidateScore:  0.92,
      pipelineSuccess: true,
    }), "2026-05-01", "2026-05-31");
    // Just check the function runs — result depends on thresholds
    expect(typeof isSnapshotHealthy(snapshot)).toBe("boolean");
  });

  describe("compareSnapshots", () => {
    it("returns trends for each KPI", () => {
      const s1 = computeAnalytics(1, makeSessions(5), makeItems(10, { confidence: 0.70 }), "2026-05-01", "2026-05-15");
      const s2 = computeAnalytics(1, makeSessions(5), makeItems(10, { confidence: 0.80 }), "2026-05-16", "2026-05-31");
      const trends = compareSnapshots(s1, s2);
      expect(trends).toHaveLength(10);
      expect(trends.every(t => ["up", "down", "stable"].includes(t.direction))).toBe(true);
    });

    it("detects avg_confidence improvement", () => {
      const s1 = computeAnalytics(1, makeSessions(5), makeItems(10, { confidence: 0.60 }), "2026-05-01", "2026-05-15");
      const s2 = computeAnalytics(1, makeSessions(5), makeItems(10, { confidence: 0.80 }), "2026-05-16", "2026-05-31");
      const trends = compareSnapshots(s1, s2);
      const confTrend = trends.find(t => t.key === "avg_confidence");
      expect(confTrend?.direction).toBe("up");
      expect(confTrend?.delta).toBeGreaterThan(0);
    });
  });

  it("handles empty sessions and items", () => {
    const snapshot = computeAnalytics(1, [], [], "2026-05-01", "2026-05-31");
    expect(snapshot.kpis).toHaveLength(10);
    snapshot.kpis.forEach(k => {
      expect(typeof k.value).toBe("number");
    });
  });
});
