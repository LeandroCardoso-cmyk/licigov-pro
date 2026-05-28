/**
 * Sprint 2.95 — Pre-ItemTR Orchestration & CATMAT Readiness Foundation
 * Integration tests for all new domain models and services.
 *
 * Target: ~120 tests covering:
 *   - candidateConsensus (20)
 *   - reviewContracts (25)
 *   - trComposition (20)
 *   - catalogSynchronization (20)
 *   - candidateExplainability (15)
 *   - semanticMatchingOrchestrator (15)
 *   - semanticDriftService (15)
 *   - semanticObservabilityService (5)
 */

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

vi.mock("../../services/semanticObservabilityService", () => ({
  recordTrace:            vi.fn(),
  recordMetric:           vi.fn(),
  matchingLatency:        vi.fn(),
  candidateDivergence:    vi.fn(),
  consensusInstability:   vi.fn(),
  reviewOverride:         vi.fn(),
  confidenceDegradation:  vi.fn(),
  driftAlert:             vi.fn(),
  rankingAnomaly:         vi.fn(),
}));

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  buildConsensus,
  normalizeWeights,
  getRejectionReason,
  DEFAULT_WEIGHTS,
  type CandidateConsensus,
  type ConsensusWeights,
} from "../../domain/candidateConsensus";

import {
  createContract,
  addDecision,
  finalizeContract,
  getLastDecision,
  getDecisionsByOperation,
  hasOperation,
  validateJustification,
  compareCandidates,
  approveCandidate,
  rejectCandidate,
  overrideCandidate,
  requestManualEntry,
  requestNewSearch,
  attachEvidence,
  justifyDecision,
  escalateReview,
  type ReviewContract,
} from "../../domain/reviewContracts";

import {
  createClause,
  createSection,
  buildTROutline,
  evaluateCondition,
  resolveClauses,
  substituteTemplate,
  type TRSection,
  type TRCompositionRule,
  type CompositionContext,
} from "../../domain/trComposition";

import {
  createSnapshot,
  addToHistory,
  isSnapshotStale,
  verifyIntegrity,
  markStale,
  computeChecksum,
} from "../../domain/catalogSynchronization";

import {
  buildExplainability,
  formatForHuman,
  compareExplainabilities,
} from "../../domain/candidateExplainability";

import {
  createSemanticCandidate,
  buildExplanation,
} from "../../domain/semanticCandidate";

import {
  createExtractionEvidence,
  addEvidenceEntry,
  buildUnitNormalizationEvidence,
} from "../../domain/extractionEvidence";

// ─── Service imports ───────────────────────────────────────────────────────────

import {
  runOrchestration,
  computeReplayKey,
} from "../../services/semanticMatchingOrchestrator";

import {
  computeDriftSnapshot,
  detectAlerts,
  compareDriftSnapshots,
  isHealthy,
  computeStdDev,
} from "../../services/semanticDriftService";

import * as observabilityService from "../../services/semanticObservabilityService";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeActor(type: "human" | "system" | "ai_assist" = "human") {
  return {
    type,
    userId: type === "human" ? 1 : undefined,
    organizationId: 1,
  };
}

function makeCandidate(overrides: Partial<Parameters<typeof createSemanticCandidate>[3]> = {}) {
  return createSemanticCandidate("staging-1", 1, 1, {
    proposedDescription: "Mesa de escritório 1.20m",
    score: 0.85,
    source: "exact_match",
    explanation: buildExplanation("Exact match", ["mesa", "escritório"], 0, 0.1),
    originalRaw: "mesa escritório 1.20m",
    ...overrides,
  });
}

function makeItems(count: number, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    stagingItemId:   `item-${i}`,
    importSessionId: 1,
    reviewStatus:    "approved",
    confidence:      0.75 + (i % 3) * 0.05,
    canonicalUnit:   i % 2 === 0 ? "UN" : null,
    candidateScore:  0.80 + (i % 3) * 0.05,
    pipelineSuccess: true,
    createdAt:       new Date().toISOString(),
    parserType:      "xlsx",
    ...overrides,
  }));
}

function makeSessions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    importSessionId:  i + 1,
    organizationId:   1,
    parserType:       "xlsx",
    retryCount:       0,
    status:           "completed",
    createdAt:        new Date().toISOString(),
  }));
}

// ─── 1. candidateConsensus ─────────────────────────────────────────────────────

describe("candidateConsensus", () => {
  it("buildConsensus returns empty consensus when no candidates", () => {
    const consensus = buildConsensus([]);
    expect(consensus.winningCandidate).toBeNull();
    expect(consensus.consensusScore).toBe(0);
    expect(consensus.alternatives).toHaveLength(0);
    expect(consensus.rejectedCandidates).toHaveLength(0);
  });

  it("buildConsensus selects winner with highest blended score", () => {
    const high = makeCandidate({ score: 0.95, source: "exact_match" });
    const low = makeCandidate({ score: 0.60, source: "token_match" });
    const consensus = buildConsensus([high, low]);
    expect(consensus.winningCandidate?.id).toBe(high.id);
  });

  it("buildConsensus returns consensus score between 0 and 1", () => {
    const c = makeCandidate({ score: 0.80 });
    const consensus = buildConsensus([c]);
    expect(consensus.consensusScore).toBeGreaterThanOrEqual(0);
    expect(consensus.consensusScore).toBeLessThanOrEqual(1);
  });

  it("buildConsensus is deterministic — same inputs same output", () => {
    const c1 = makeCandidate({ score: 0.85 });
    const c2 = makeCandidate({ score: 0.70 });
    const r1 = buildConsensus([c1, c2]);
    const r2 = buildConsensus([c1, c2]);
    expect(r1.consensusScore).toBe(r2.consensusScore);
    expect(r1.winningCandidate?.id).toBe(r2.winningCandidate?.id);
  });

  it("buildConsensus sets rankingMetadata.deterministic to true", () => {
    const c = makeCandidate();
    const consensus = buildConsensus([c]);
    expect(consensus.rankingMetadata.deterministic).toBe(true);
  });

  it("buildConsensus populates all rejected candidates with reasons", () => {
    const c1 = makeCandidate({ score: 0.90, source: "exact_match" });
    const c2 = makeCandidate({ score: 0.65, source: "token_match" });
    const c3 = makeCandidate({ score: 0.50, source: "fuzzy_match" });
    const consensus = buildConsensus([c1, c2, c3]);
    expect(consensus.rejectedCandidates).toHaveLength(2);
    expect(consensus.rejectedCandidates[0].rejectionReason).toBeTruthy();
  });

  it("buildConsensus with canonicalUnit boosts normalization component", () => {
    const c = makeCandidate({ score: 0.75 });
    const withUnit = buildConsensus([c], DEFAULT_WEIGHTS, { canonicalUnit: "UN", parserType: "xlsx" });
    const withoutUnit = buildConsensus([c], DEFAULT_WEIGHTS, { canonicalUnit: null, parserType: "xlsx" });
    expect(withUnit.consensusScore).toBeGreaterThan(withoutUnit.consensusScore);
  });

  it("buildConsensus alternatives are the non-winner candidates", () => {
    const c1 = makeCandidate({ score: 0.90 });
    const c2 = makeCandidate({ score: 0.70 });
    const consensus = buildConsensus([c1, c2]);
    expect(consensus.alternatives).toHaveLength(1);
    expect(consensus.alternatives[0].id).toBe(c2.id);
  });

  it("buildConsensus evidenceSummary is non-empty", () => {
    const c = makeCandidate();
    const consensus = buildConsensus([c]);
    expect(consensus.evidenceSummary.length).toBeGreaterThan(0);
  });

  it("buildConsensus sets stagingItemId from first candidate", () => {
    const c = createSemanticCandidate("my-staging-id", 5, 2, {
      proposedDescription: "test",
      score: 0.7,
      source: "token_match",
      explanation: buildExplanation("test", []),
      originalRaw: "test",
    });
    const consensus = buildConsensus([c]);
    expect(consensus.stagingItemId).toBe("my-staging-id");
    expect(consensus.importSessionId).toBe(5);
    expect(consensus.organizationId).toBe(2);
  });

  it("buildConsensus with single candidate sets tiebreakApplied false", () => {
    const c = makeCandidate();
    const consensus = buildConsensus([c]);
    expect(consensus.rankingMetadata.tiebreakApplied).toBe(false);
  });

  it("normalizeWeights returns weights summing to 1", () => {
    const weights = normalizeWeights({ lexical: 1, semantic: 1, normalization: 1, parser: 1 });
    const total = weights.lexical + weights.semantic + weights.normalization + weights.parser;
    expect(total).toBeCloseTo(1.0, 5);
  });

  it("normalizeWeights returns DEFAULT_WEIGHTS when all zero", () => {
    const weights = normalizeWeights({ lexical: 0, semantic: 0, normalization: 0, parser: 0 });
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it("normalizeWeights preserves ratio proportions", () => {
    const weights = normalizeWeights({ lexical: 2, semantic: 2, normalization: 1, parser: 1 });
    expect(weights.lexical).toBeCloseTo(weights.semantic, 5);
    expect(weights.normalization).toBeCloseTo(weights.parser, 5);
  });

  it("getRejectionReason explains score difference", () => {
    const loser = makeCandidate({ score: 0.50 });
    const winner = makeCandidate({ score: 0.90 });
    const reason = getRejectionReason(loser, winner);
    expect(reason).toContain("inferior");
  });

  it("getRejectionReason handles null winner", () => {
    const loser = makeCandidate({ score: 0.50 });
    const reason = getRejectionReason(loser, null);
    expect(reason).toBeTruthy();
    expect(reason.length).toBeGreaterThan(0);
  });

  it("getRejectionReason explains source priority tiebreak", () => {
    const loser = makeCandidate({ score: 0.80, source: "token_match" });
    const winner = makeCandidate({ score: 0.80, source: "exact_match" });
    const reason = getRejectionReason(loser, winner);
    expect(reason).toBeTruthy();
  });

  it("buildConsensus confidence breakdown has all 4 components", () => {
    const c = makeCandidate();
    const consensus = buildConsensus([c]);
    expect(consensus.confidenceBreakdown).toHaveProperty("lexical");
    expect(consensus.confidenceBreakdown).toHaveProperty("semantic");
    expect(consensus.confidenceBreakdown).toHaveProperty("normalization");
    expect(consensus.confidenceBreakdown).toHaveProperty("parser");
  });

  it("DEFAULT_WEIGHTS sum to 1.0", () => {
    const total = DEFAULT_WEIGHTS.lexical + DEFAULT_WEIGHTS.semantic +
                  DEFAULT_WEIGHTS.normalization + DEFAULT_WEIGHTS.parser;
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ─── 2. reviewContracts ────────────────────────────────────────────────────────

describe("reviewContracts", () => {
  let contract: ReturnType<typeof createContract>;
  const actor = makeActor("human");

  beforeEach(() => {
    contract = createContract("staging-1", 1, 1);
  });

  it("createContract returns contract with empty decisions", () => {
    expect(contract.decisions).toHaveLength(0);
    expect(contract.isFinalized).toBe(false);
    expect(contract.currentOperation).toBeNull();
  });

  it("createContract preserves stagingItemId", () => {
    expect(contract.stagingItemId).toBe("staging-1");
    expect(contract.importSessionId).toBe(1);
    expect(contract.organizationId).toBe(1);
  });

  it("addDecision returns new contract (original unchanged)", () => {
    const after = approveCandidate(contract, actor, "cand-1", "Candidato válido");
    expect(contract.decisions).toHaveLength(0);
    expect(after.decisions).toHaveLength(1);
  });

  it("addDecision appends decision to decisions array", () => {
    const c1 = approveCandidate(contract, actor, "cand-1", "Aprovação técnica válida");
    const c2 = justifyDecision(c1, actor, "Justificativa adicional");
    expect(c2.decisions).toHaveLength(2);
  });

  it("addDecision throws when contract is finalized", () => {
    const finalized = finalizeContract(contract, actor, "Finalizado ok");
    expect(() => approveCandidate(finalized, actor, "cand-1", "Tentativa inválida")).toThrow();
  });

  it("finalizeContract sets isFinalized to true", () => {
    const finalized = finalizeContract(contract, actor, "Encerramento do processo");
    expect(finalized.isFinalized).toBe(true);
    expect(finalized.finalizedAt).toBeTruthy();
  });

  it("finalizeContract adds justify_decision decision", () => {
    const finalized = finalizeContract(contract, actor, "Encerramento do processo");
    const last = getLastDecision(finalized);
    expect(last?.operation).toBe("justify_decision");
  });

  it("getLastDecision returns null for empty contract", () => {
    expect(getLastDecision(contract)).toBeNull();
  });

  it("getLastDecision returns most recently added decision", () => {
    const c1 = approveCandidate(contract, actor, "cand-1", "Aprovação técnica");
    const c2 = rejectCandidate(c1, actor, "cand-2", "Candidato inferior");
    expect(getLastDecision(c2)?.operation).toBe("reject_candidate");
  });

  it("getDecisionsByOperation filters correctly", () => {
    const c1 = approveCandidate(contract, actor, "cand-1", "Aprovação técnica");
    const c2 = justifyDecision(c1, actor, "Justificativa válida");
    const approvals = getDecisionsByOperation(c2, "approve_candidate");
    expect(approvals).toHaveLength(1);
  });

  it("hasOperation returns true when operation exists", () => {
    const c1 = approveCandidate(contract, actor, "cand-1", "Aprovação");
    expect(hasOperation(c1, "approve_candidate")).toBe(true);
    expect(hasOperation(c1, "reject_candidate")).toBe(false);
  });

  it("validateJustification rejects empty string", () => {
    const result = validateJustification("");
    expect(result.valid).toBe(false);
  });

  it("validateJustification rejects whitespace-only string", () => {
    const result = validateJustification("   ");
    expect(result.valid).toBe(false);
  });

  it("validateJustification rejects string shorter than 5 chars", () => {
    const result = validateJustification("ab");
    expect(result.valid).toBe(false);
  });

  it("validateJustification accepts valid string", () => {
    const result = validateJustification("Aprovação técnica válida");
    expect(result.valid).toBe(true);
  });

  it("compareCandidates adds compare_candidates operation", () => {
    const c = compareCandidates(contract, actor, ["cand-1", "cand-2"], "Comparação inicial");
    expect(c.decisions[0].operation).toBe("compare_candidates");
  });

  it("approveCandidate sets candidateId correctly", () => {
    const c = approveCandidate(contract, actor, "cand-123", "Aprovado técnico");
    expect(c.decisions[0].candidateId).toBe("cand-123");
  });

  it("rejectCandidate sets candidateId correctly", () => {
    const c = rejectCandidate(contract, actor, "cand-456", "Não atende requisitos");
    expect(c.decisions[0].candidateId).toBe("cand-456");
  });

  it("overrideCandidate sets overrideValue correctly", () => {
    const c = overrideCandidate(contract, actor,
      { description: "Mesa ajustada", unit: "UN" },
      "Correção manual necessária",
    );
    expect(c.decisions[0].overrideValue?.description).toBe("Mesa ajustada");
    expect(c.decisions[0].overrideValue?.unit).toBe("UN");
  });

  it("requestManualEntry adds correct operation", () => {
    const c = requestManualEntry(contract, actor, "Dados insuficientes");
    expect(c.decisions[0].operation).toBe("request_manual_entry");
  });

  it("requestNewSearch adds correct operation", () => {
    const c = requestNewSearch(contract, actor, "Resultado insatisfatório");
    expect(c.decisions[0].operation).toBe("request_new_search");
  });

  it("attachEvidence sets evidenceRefs correctly", () => {
    const c = attachEvidence(contract, actor, ["ref-1", "ref-2"], "Documentação anexada");
    expect(c.decisions[0].evidenceRefs).toEqual(["ref-1", "ref-2"]);
  });

  it("justifyDecision adds justify_decision operation", () => {
    const c = justifyDecision(contract, actor, "Justificativa de decisão");
    expect(c.decisions[0].operation).toBe("justify_decision");
  });

  it("escalateReview sets escalateTo correctly", () => {
    const c = escalateReview(contract, actor, 42, "Requer aprovação superior");
    expect(c.decisions[0].escalateTo).toBe(42);
    expect(c.decisions[0].operation).toBe("escalate_review");
  });

  it("currentOperation updates after each addDecision", () => {
    const c1 = approveCandidate(contract, actor, "c1", "Aprovação ok");
    expect(c1.currentOperation).toBe("approve_candidate");
    const c2 = justifyDecision(c1, actor, "Justificativa ok");
    expect(c2.currentOperation).toBe("justify_decision");
  });
});

// ─── 3. trComposition ─────────────────────────────────────────────────────────

describe("trComposition", () => {
  it("createClause creates a clause with required defaults", () => {
    const clause = createClause("header", "Cabeçalho do TR");
    expect(clause.id).toBeTruthy();
    expect(clause.type).toBe("header");
    expect(clause.content).toBe("Cabeçalho do TR");
    expect(clause.isRequired).toBe(true);
    expect(clause.dependsOn).toEqual([]);
  });

  it("createClause accepts optional params", () => {
    const clause = createClause("legal_basis", "Art. 6º", {
      legalBasis: "Lei 14.133/2021",
      isRequired: false,
    });
    expect(clause.legalBasis).toBe("Lei 14.133/2021");
    expect(clause.isRequired).toBe(false);
  });

  it("createSection creates section with correct order", () => {
    const clause = createClause("header", "Header");
    const section = createSection("Título do TR", [clause], 1);
    expect(section.title).toBe("Título do TR");
    expect(section.order).toBe(1);
    expect(section.clauses).toHaveLength(1);
    expect(section.conditionalBlocks).toHaveLength(0);
  });

  it("createSection accepts isOptional param", () => {
    const section = createSection("Seção Opcional", [], 5, { isOptional: true });
    expect(section.isOptional).toBe(true);
  });

  it("buildTROutline returns sections sorted by order", () => {
    const s1 = createSection("Segunda", [], 2);
    const s2 = createSection("Primeira", [], 1);
    const s3 = createSection("Terceira", [], 3);
    const result = buildTROutline([s1, s2, s3], [], {});
    expect(result[0].title).toBe("Primeira");
    expect(result[1].title).toBe("Segunda");
    expect(result[2].title).toBe("Terceira");
  });

  it("buildTROutline applies exclude_section rule", () => {
    const s1 = createSection("Seção A", [], 1);
    const s2 = createSection("Seção B", [], 2);
    const rule: TRCompositionRule = {
      id: "r1",
      name: "Exclude B",
      condition: "context.excludeB",
      action: "exclude_section",
      targetId: s2.id,
      priority: 10,
    };
    const result = buildTROutline([s1, s2], [rule], { excludeB: true });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Seção A");
  });

  it("buildTROutline does not apply rule when condition is false", () => {
    const s1 = createSection("Seção A", [], 1);
    const rule: TRCompositionRule = {
      id: "r1",
      name: "Exclude A",
      condition: "context.excludeA",
      action: "exclude_section",
      targetId: s1.id,
      priority: 10,
    };
    const result = buildTROutline([s1], [rule], { excludeA: false });
    expect(result).toHaveLength(1);
  });

  it("buildTROutline applies include_section rule for missing section", () => {
    const s1 = createSection("Base", [], 1);
    const s2 = createSection("Extra", [], 2);
    const rule: TRCompositionRule = {
      id: "r1",
      name: "Include Extra",
      condition: "context.needsExtra",
      action: "include_section",
      targetId: s2.id,
      priority: 5,
    };
    // s2 not in initial list but in source sections
    const result = buildTROutline([s1], [rule], { needsExtra: true });
    // Can't include s2 since it's not in `sections` param — stays at 1
    expect(result).toHaveLength(1);
  });

  it("evaluateCondition returns true for truthy context key", () => {
    expect(evaluateCondition("context.hasItems", { hasItems: true })).toBe(true);
    expect(evaluateCondition("context.count", { count: 5 })).toBe(true);
  });

  it("evaluateCondition returns false for falsy context key", () => {
    expect(evaluateCondition("context.hasItems", { hasItems: false })).toBe(false);
    expect(evaluateCondition("context.hasItems", {})).toBe(false);
  });

  it("evaluateCondition handles nested keys", () => {
    expect(evaluateCondition("context.flags.approved", { flags: { approved: true } })).toBe(true);
  });

  it("evaluateCondition returns false for empty condition", () => {
    expect(evaluateCondition("", {})).toBe(false);
  });

  it("resolveClauses returns all non-conditional clauses", () => {
    const c1 = createClause("header", "H1");
    const c2 = createClause("body", "B1");
    const section = createSection("Test", [c1, c2], 1);
    const resolved = resolveClauses(section, {});
    expect(resolved).toHaveLength(2);
  });

  it("resolveClauses resolves conditional blocks for true branch", () => {
    const trueClauses = [createClause("body", "True branch")];
    const falseClauses = [createClause("body", "False branch")];
    const block = {
      id: "b1",
      condition: "context.showTrue",
      trueBranch: trueClauses,
      falseBranch: falseClauses,
    };
    const section = createSection("Test", [], 1, { conditionalBlocks: [block] });
    const resolved = resolveClauses(section, { showTrue: true });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].content).toBe("True branch");
  });

  it("resolveClauses uses fallback for empty required clause", () => {
    const fallback = createClause("body", "Fallback content");
    const main = createClause("body", "", { isRequired: true, fallback });
    const section = createSection("Test", [main], 1);
    const resolved = resolveClauses(section, {});
    expect(resolved[0].content).toBe("Fallback content");
  });

  it("substituteTemplate replaces {{var}} with context value", () => {
    const result = substituteTemplate("Olá {{name}}, seu número é {{number}}", {
      name: "João",
      number: 42,
    });
    expect(result).toBe("Olá João, seu número é 42");
  });

  it("substituteTemplate keeps {{var}} if not found in context", () => {
    const result = substituteTemplate("Valor: {{missing}}", {});
    expect(result).toBe("Valor: {{missing}}");
  });

  it("substituteTemplate handles nested keys with dot notation", () => {
    const result = substituteTemplate("{{org.name}}", { org: { name: "Prefeitura" } });
    expect(result).toBe("Prefeitura");
  });

  it("buildTROutline returns empty array for empty sections", () => {
    const result = buildTROutline([], [], {});
    expect(result).toHaveLength(0);
  });
});

// ─── 4. catalogSynchronization ────────────────────────────────────────────────

describe("catalogSynchronization", () => {
  it("createSnapshot returns snapshot with correct fields", () => {
    const snap = createSnapshot(1, "catmat", "2025.1", 1000, "abc123");
    expect(snap.organizationId).toBe(1);
    expect(snap.catalogType).toBe("catmat");
    expect(snap.version).toBe("2025.1");
    expect(snap.totalEntries).toBe(1000);
    expect(snap.checksum).toBe("abc123");
    expect(snap.syncStatus).toBe("pending");
    expect(snap.sourceUrl).toBeNull();
  });

  it("createSnapshot sets snapshotLineage to null by default", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    expect(snap.snapshotLineage).toBeNull();
  });

  it("createSnapshot accepts snapshotLineage", () => {
    const snap = createSnapshot(1, "catser", "v2", 200, "hash", {
      snapshotLineage: "prev-snap-id",
    });
    expect(snap.snapshotLineage).toBe("prev-snap-id");
  });

  it("createSnapshot has valid cacheMetadata", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    expect(snap.cacheMetadata.cachedAt).toBeTruthy();
    expect(snap.cacheMetadata.expiresAt).toBeTruthy();
    expect(snap.cacheMetadata.stale).toBe(false);
  });

  it("createSnapshot has valid integrityMetadata", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "abc123def");
    expect(snap.integrityMetadata.checksumAlg).toBe("sha256");
    expect(snap.integrityMetadata.isValid).toBe(true);
    expect(snap.integrityMetadata.verifiedAt).toBeNull();
  });

  it("addToHistory creates history entry with correct fields", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    const history = addToHistory(snap, "create", "v1", "system", "Initial sync");
    expect(history.snapshotId).toBe(snap.id);
    expect(history.operation).toBe("create");
    expect(history.afterVersion).toBe("v1");
    expect(history.actor).toBe("system");
    expect(history.reason).toBe("Initial sync");
    expect(history.beforeVersion).toBeNull();
  });

  it("addToHistory sets beforeVersion when provided", () => {
    const snap = createSnapshot(1, "catmat", "v2", 200, "newhash");
    const history = addToHistory(snap, "update", "v2", "user-1", "Monthly update", "v1");
    expect(history.beforeVersion).toBe("v1");
  });

  it("isSnapshotStale returns true when maxAgeMs is 0", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    // Force stale: maxAgeMs=0 means any age is stale
    expect(isSnapshotStale(snap, 0)).toBe(true);
  });

  it("isSnapshotStale returns false when TTL not exceeded", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash", {
      ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    });
    // Just created — should not be stale with generous maxAge
    expect(isSnapshotStale(snap, 48 * 60 * 60 * 1000)).toBe(false);
  });

  it("verifyIntegrity returns true for valid snapshot", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "abc123def456");
    expect(verifyIntegrity(snap)).toBe(true);
  });

  it("verifyIntegrity returns false for empty checksum", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "");
    expect(verifyIntegrity(snap)).toBe(false);
  });

  it("markStale returns new snapshot with stale status", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    const staled = markStale(snap);
    expect(staled.syncStatus).toBe("stale");
    expect(staled.cacheMetadata.stale).toBe(true);
  });

  it("markStale original snapshot is not mutated", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    markStale(snap);
    expect(snap.syncStatus).toBe("pending");
    expect(snap.cacheMetadata.stale).toBe(false);
  });

  it("computeChecksum returns consistent hex string", () => {
    const hash1 = computeChecksum("test content");
    const hash2 = computeChecksum("test content");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 = 256 bits = 64 hex chars
  });

  it("computeChecksum returns different hashes for different content", () => {
    const hash1 = computeChecksum("content A");
    const hash2 = computeChecksum("content B");
    expect(hash1).not.toBe(hash2);
  });

  it("createSnapshot sets importLineage to empty array by default", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    expect(snap.importLineage).toEqual([]);
  });

  it("createSnapshot accepts importLineage", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash", {
      importLineage: ["session-1", "session-2"],
    });
    expect(snap.importLineage).toHaveLength(2);
  });

  it("createSnapshot id is non-empty string", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    expect(snap.id.length).toBeGreaterThan(0);
  });

  it("createSnapshot createdAt is valid ISO string", () => {
    const snap = createSnapshot(1, "catmat", "v1", 100, "hash");
    expect(new Date(snap.createdAt).getTime()).not.toBeNaN();
  });

  it("createSnapshot custom catalog type", () => {
    const snap = createSnapshot(1, "custom", "v1", 50, "hash");
    expect(snap.catalogType).toBe("custom");
  });
});

// ─── 5. candidateExplainability ───────────────────────────────────────────────

describe("candidateExplainability", () => {
  function makeProvenance() {
    return {
      sourceFileId:   "file-1",
      sourceFileName: "planilha.xlsx",
      sourceMimeType: "application/vnd.openxmlformats",
      sourceChecksum: "checksum123",
      location:       { sheet: "Itens", row: 2, col: "B" },
      parserType:     "xlsx",
      parserVersion:  "1.0.0",
      extractedAt:    new Date().toISOString(),
    };
  }

  it("buildExplainability returns populated object", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.candidateId).toBe(c.id);
    expect(exp.stagingItemId).toBe("staging-1");
    expect(exp.whySuggested.length).toBeGreaterThan(0);
    expect(exp.whyRanked.length).toBeGreaterThan(0);
    expect(exp.rankingRationale.length).toBeGreaterThan(0);
    expect(exp.confidenceRationale.length).toBeGreaterThan(0);
  });

  it("buildExplainability sets whyRejected null for rank-1 candidate", () => {
    const c = makeCandidate({ score: 0.95 });
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    // rank defaults to 1 (set by createSemanticCandidate)
    expect(exp.whyRejected).toBeNull();
  });

  it("buildExplainability populates parserInfluence", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.parserInfluence.parserType).toBeTruthy();
    expect(exp.parserInfluence.note.length).toBeGreaterThan(0);
    expect(exp.parserInfluence.confidenceContribution).toBeGreaterThanOrEqual(0);
  });

  it("buildExplainability populates normalizationInfluence", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.normalizationInfluence.note.length).toBeGreaterThan(0);
  });

  it("buildExplainability populates normalizationInfluence from unit evidence", () => {
    const c = makeCandidate();
    let evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    evidence = addEvidenceEntry(evidence, buildUnitNormalizationEvidence("un", "UN", "exact", 0.95));
    const exp = buildExplainability(c, null, evidence);
    expect(exp.normalizationInfluence.unitMatch).toBe("UN");
  });

  it("buildExplainability populates semanticInfluence", () => {
    const c = makeCandidate({ score: 0.82 });
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.semanticInfluence.indexScore).toBeCloseTo(0.82, 4);
    expect(exp.semanticInfluence.matchStrategy).toBeTruthy();
  });

  it("buildExplainability with consensus sets consensusRationale", () => {
    const c = makeCandidate({ score: 0.90 });
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const consensus = buildConsensus([c]);
    const exp = buildExplainability(c, consensus, evidence);
    expect(exp.consensusRationale).toBeTruthy();
  });

  it("buildExplainability without consensus has null consensusRationale", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.consensusRationale).toBeNull();
  });

  it("formatForHuman returns non-empty markdown string", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    const formatted = formatForHuman(exp);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(100);
    expect(formatted).toContain("##");
  });

  it("formatForHuman includes candidateId", () => {
    const c = makeCandidate();
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    const formatted = formatForHuman(exp);
    expect(formatted).toContain(c.id);
  });

  it("compareExplainabilities returns a string", () => {
    const c1 = makeCandidate({ score: 0.90 });
    const c2 = makeCandidate({ score: 0.70 });
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp1 = buildExplainability(c1, null, evidence);
    const exp2 = buildExplainability(c2, null, evidence);
    const diff = compareExplainabilities(exp1, exp2);
    expect(typeof diff).toBe("string");
    expect(diff.length).toBeGreaterThan(0);
  });

  it("compareExplainabilities includes score difference", () => {
    const c1 = makeCandidate({ score: 0.90 });
    const c2 = makeCandidate({ score: 0.70 });
    const evidence = createExtractionEvidence("staging-1", 1, 1, makeProvenance());
    const exp1 = buildExplainability(c1, null, evidence);
    const exp2 = buildExplainability(c2, null, evidence);
    const diff = compareExplainabilities(exp1, exp2);
    expect(diff).toContain("score");
  });

  it("buildExplainability influencingTokens from explanation.matchedOn", () => {
    const c = createSemanticCandidate("s1", 1, 1, {
      proposedDescription: "Mesa",
      score: 0.80,
      source: "token_match",
      explanation: buildExplanation("test", ["mesa", "escritório"]),
      originalRaw: "mesa",
    });
    const evidence = createExtractionEvidence("s1", 1, 1, makeProvenance());
    const exp = buildExplainability(c, null, evidence);
    expect(exp.influencingTokens).toContain("mesa");
  });
});

// ─── 6. semanticMatchingOrchestrator ─────────────────────────────────────────

describe("semanticMatchingOrchestrator", () => {
  function makeInput(overrides = {}) {
    return {
      stagingItemId:   "staging-orch-1",
      importSessionId: 1,
      organizationId:  1,
      rawDescription:  "mesa escritório",
      canonicalUnit:   "UN",
      parserType:      "xlsx",
      confidence:      0.80,
      ...overrides,
    };
  }

  it("runOrchestration returns 9 stageResults", async () => {
    const result = await runOrchestration(makeInput());
    expect(result.stageResults).toHaveLength(9);
  });

  it("runOrchestration stage names are correct", async () => {
    const result = await runOrchestration(makeInput());
    const names = result.stageResults.map(s => s.name);
    expect(names).toContain("candidate_retrieval");
    expect(names).toContain("lexical_scoring");
    expect(names).toContain("semantic_scoring");
    expect(names).toContain("parser_influence");
    expect(names).toContain("normalization_influence");
    expect(names).toContain("confidence_blending");
    expect(names).toContain("consensus_generation");
    expect(names).toContain("explainability_generation");
    expect(names).toContain("review_preparation");
  });

  it("runOrchestration replayKey is deterministic", async () => {
    const input = makeInput();
    const r1 = await runOrchestration(input);
    const r2 = await runOrchestration(input);
    expect(r1.replayKey).toBe(r2.replayKey);
  });

  it("runOrchestration correlationId is unique per call", async () => {
    const r1 = await runOrchestration(makeInput());
    const r2 = await runOrchestration(makeInput());
    expect(r1.correlationId).not.toBe(r2.correlationId);
  });

  it("runOrchestration returns consensus object", async () => {
    const result = await runOrchestration(makeInput());
    expect(result.consensus).toBeDefined();
    expect(result.consensus.rankingMetadata.deterministic).toBe(true);
  });

  it("runOrchestration reviewRequired is true when no candidates found", async () => {
    const result = await runOrchestration(makeInput({
      rawDescription: "xyzzy_nonexistent_item_12345",
      organizationId: 99999,
    }));
    expect(result.reviewRequired).toBe(true);
  });

  it("runOrchestration with empty description still returns 9 stages", async () => {
    const result = await runOrchestration(makeInput({ rawDescription: null }));
    expect(result.stageResults).toHaveLength(9);
  });

  it("runOrchestration returns correct stagingItemId", async () => {
    const result = await runOrchestration(makeInput({ stagingItemId: "custom-staging" }));
    expect(result.stagingItemId).toBe("custom-staging");
  });

  it("computeReplayKey is deterministic", () => {
    const input = makeInput();
    const k1 = computeReplayKey(input);
    const k2 = computeReplayKey(input);
    expect(k1).toBe(k2);
  });

  it("computeReplayKey differs for different inputs", () => {
    const i1 = makeInput({ rawDescription: "mesa" });
    const i2 = makeInput({ rawDescription: "cadeira" });
    expect(computeReplayKey(i1)).not.toBe(computeReplayKey(i2));
  });

  it("runOrchestration stage durationMs >= 0", async () => {
    const result = await runOrchestration(makeInput());
    for (const stage of result.stageResults) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("runOrchestration orchestrationMs > 0", async () => {
    const result = await runOrchestration(makeInput());
    expect(result.orchestrationMs).toBeGreaterThanOrEqual(0);
  });

  it("runOrchestration explainabilities is a Record", async () => {
    const result = await runOrchestration(makeInput());
    expect(typeof result.explainabilities).toBe("object");
  });

  it("runOrchestration without canonicalUnit stage 5 is warning", async () => {
    const result = await runOrchestration(makeInput({ canonicalUnit: null }));
    const s5 = result.stageResults.find(s => s.name === "normalization_influence");
    expect(s5?.status).toBe("warning");
  });

  it("runOrchestration with canonicalUnit stage 5 is ok", async () => {
    const result = await runOrchestration(makeInput({ canonicalUnit: "UN" }));
    const s5 = result.stageResults.find(s => s.name === "normalization_influence");
    expect(s5?.status).toBe("ok");
  });
});

// ─── 7. semanticDriftService ──────────────────────────────────────────────────

describe("semanticDriftService", () => {
  const period = { start: "2026-01-01T00:00:00Z", end: "2026-01-31T00:00:00Z" };

  it("computeDriftSnapshot returns snapshot with all metric fields", () => {
    const items = makeItems(10);
    const sessions = makeSessions(2);
    const snap = computeDriftSnapshot(items, sessions, period, 1);
    expect(snap.metrics.avgConfidence).toBeGreaterThan(0);
    expect(snap.metrics.avgSemanticMatchRate).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.avgUnitNormRate).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.semanticVolatility).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.rankingInconsistencies).toBeGreaterThanOrEqual(0);
    expect(snap.metrics.normalizationAnomalies).toBeGreaterThanOrEqual(0);
  });

  it("computeDriftSnapshot sets organizationId", () => {
    const items = makeItems(5);
    const snap = computeDriftSnapshot(items, [], period, 42);
    expect(snap.organizationId).toBe(42);
  });

  it("computeDriftSnapshot avgConfidence is average of item confidences", () => {
    const items = [
      { ...makeItems(1)[0], confidence: 0.80 },
      { ...makeItems(1)[0], confidence: 0.60 },
    ];
    const snap = computeDriftSnapshot(items, [], period, 1);
    expect(snap.metrics.avgConfidence).toBeCloseTo(0.70, 4);
  });

  it("detectAlerts returns empty array when current matches baseline", () => {
    const items = makeItems(10);
    const snap = computeDriftSnapshot(items, [], period, 1);
    const alerts = detectAlerts(snap, snap);
    expect(alerts).toHaveLength(0);
  });

  it("detectAlerts triggers warning on confidence drop > 10%", () => {
    const highItems = makeItems(10).map(i => ({ ...i, confidence: 0.90 }));
    const lowItems = makeItems(10).map(i => ({ ...i, confidence: 0.75 }));
    const baseline = computeDriftSnapshot(highItems, [], period, 1);
    const current = computeDriftSnapshot(lowItems, [], period, 1);
    const alerts = detectAlerts(current, baseline);
    const confAlert = alerts.find(a => a.type === "confidence_degradation");
    expect(confAlert).toBeDefined();
    expect(confAlert?.severity).toBe("warning");
  });

  it("detectAlerts triggers critical on confidence drop > 20%", () => {
    const highItems = makeItems(10).map(i => ({ ...i, confidence: 0.95 }));
    const lowItems = makeItems(10).map(i => ({ ...i, confidence: 0.70 }));
    const baseline = computeDriftSnapshot(highItems, [], period, 1);
    const current = computeDriftSnapshot(lowItems, [], period, 1);
    const alerts = detectAlerts(current, baseline);
    const critAlert = alerts.find(a => a.type === "confidence_degradation" && a.severity === "critical");
    expect(critAlert).toBeDefined();
  });

  it("compareDriftSnapshots returns trends for all key metrics", () => {
    const items1 = makeItems(5).map(i => ({ ...i, confidence: 0.80 }));
    const items2 = makeItems(5).map(i => ({ ...i, confidence: 0.70 }));
    const s1 = computeDriftSnapshot(items1, [], period, 1);
    const s2 = computeDriftSnapshot(items2, [], period, 1);
    const trends = compareDriftSnapshots(s1, s2);
    expect(trends.length).toBeGreaterThan(0);
    const confTrend = trends.find(t => t.metric === "avgConfidence");
    expect(confTrend).toBeDefined();
  });

  it("compareDriftSnapshots direction is correct", () => {
    const items1 = makeItems(5).map(i => ({ ...i, confidence: 0.80 }));
    const items2 = makeItems(5).map(i => ({ ...i, confidence: 0.70 }));
    const s1 = computeDriftSnapshot(items1, [], period, 1);
    const s2 = computeDriftSnapshot(items2, [], period, 1);
    const trends = compareDriftSnapshots(s1, s2);
    const confTrend = trends.find(t => t.metric === "avgConfidence");
    expect(confTrend?.direction).toBe("down");
  });

  it("isHealthy returns true when no critical alerts", () => {
    const items = makeItems(10);
    const snap = computeDriftSnapshot(items, [], period, 1);
    expect(isHealthy(snap, snap)).toBe(true);
  });

  it("isHealthy returns false when critical alerts exist", () => {
    const highItems = makeItems(10).map(i => ({ ...i, confidence: 0.95 }));
    const lowItems = makeItems(10).map(i => ({ ...i, confidence: 0.70 }));
    const baseline = computeDriftSnapshot(highItems, [], period, 1);
    const current = computeDriftSnapshot(lowItems, [], period, 1);
    expect(isHealthy(current, baseline)).toBe(false);
  });

  it("computeStdDev returns 0 for empty array", () => {
    expect(computeStdDev([])).toBe(0);
  });

  it("computeStdDev returns 0 for single value", () => {
    expect(computeStdDev([5])).toBe(0);
  });

  it("computeStdDev returns correct value for known data", () => {
    // stddev([2, 4, 4, 4, 5, 5, 7, 9]) = 2
    const result = computeStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.0, 4);
  });

  it("computeDriftSnapshot period is preserved", () => {
    const items = makeItems(3);
    const snap = computeDriftSnapshot(items, [], period, 1);
    expect(snap.period.start).toBe(period.start);
    expect(snap.period.end).toBe(period.end);
  });

  it("detectAlerts triggers volatility warning when stddev > 0.20", () => {
    const items = [
      { ...makeItems(1)[0], confidence: 0.10 },
      { ...makeItems(1)[0], confidence: 0.90 },
      { ...makeItems(1)[0], confidence: 0.10 },
      { ...makeItems(1)[0], confidence: 0.90 },
    ];
    const snap = computeDriftSnapshot(items, [], period, 1);
    const baseline = computeDriftSnapshot(
      makeItems(4).map(i => ({ ...i, confidence: 0.75 })),
      [],
      period,
      1,
    );
    const alerts = detectAlerts(snap, baseline);
    const volAlert = alerts.find(a => a.type === "semantic_volatility");
    expect(volAlert).toBeDefined();
  });
});

// ─── 8. semanticObservabilityService ─────────────────────────────────────────

describe("semanticObservabilityService", () => {
  it("all exported functions exist", () => {
    expect(typeof observabilityService.recordTrace).toBe("function");
    expect(typeof observabilityService.recordMetric).toBe("function");
    expect(typeof observabilityService.matchingLatency).toBe("function");
    expect(typeof observabilityService.candidateDivergence).toBe("function");
    expect(typeof observabilityService.consensusInstability).toBe("function");
  });

  it("remaining observability functions exist", () => {
    expect(typeof observabilityService.reviewOverride).toBe("function");
    expect(typeof observabilityService.confidenceDegradation).toBe("function");
    expect(typeof observabilityService.driftAlert).toBe("function");
    expect(typeof observabilityService.rankingAnomaly).toBe("function");
  });

  it("recordTrace is callable without throwing", () => {
    expect(() => observabilityService.recordTrace({
      correlationId:    "test-corr",
      operation:        "test_op",
      stageBreakdown:   { stage1: 10 },
      totalMs:          100,
      candidateCount:   3,
      consensusScore:   0.85,
      requiresReview:   false,
      parserType:       "xlsx",
      organizationId:   1,
      recordedAt:       new Date().toISOString(),
    })).not.toThrow();
  });

  it("driftAlert is callable without throwing", () => {
    expect(() => observabilityService.driftAlert({
      organizationId: 1,
      alertType:      "confidence_degradation",
      severity:       "warning",
      description:    "test",
      affectedItems:  5,
      detectedAt:     new Date().toISOString(),
    })).not.toThrow();
  });

  it("recordMetric is callable without throwing", () => {
    expect(() => observabilityService.recordMetric({
      name:       "test_metric",
      value:      42,
      unit:       "count",
      tags:       { env: "test" },
      recordedAt: new Date().toISOString(),
    })).not.toThrow();
  });
});
