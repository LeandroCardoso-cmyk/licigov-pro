/**
 * Sprint 2.95 — Semantic Matching Orchestrator.
 *
 * Orquestra os 9 estágios do pipeline de matching semântico avançado.
 * Combina candidatos, consenso e explainability em um único resultado coerente.
 * Determinístico: mesmo input → mesmo replayKey (correlationId é único por execução).
 *
 * Estágios:
 *   1. candidate_retrieval    — busca no globalSemanticIndex
 *   2. lexical_scoring        — interseção de tokens
 *   3. semantic_scoring       — scoreAgainstEntry por entry
 *   4. parser_influence       — confiança do parser
 *   5. normalization_influence — boost de unidade canônica
 *   6. confidence_blending    — ponderação por DEFAULT_WEIGHTS
 *   7. consensus_generation   — buildConsensus
 *   8. explainability_generation — buildExplainability por candidato
 *   9. review_preparation     — decide se revisão é necessária
 */

import { nanoid } from "nanoid";
import { createHash } from "crypto";

import { globalSemanticIndex, tokenize, scoreAgainstEntry } from "../domain/semanticIndex";
import {
  createSemanticCandidate,
  buildExplanation,
  buildCandidateSet,
  type CandidateSet,
} from "../domain/semanticCandidate";
import {
  buildConsensus,
  DEFAULT_WEIGHTS,
  type CandidateConsensus,
} from "../domain/candidateConsensus";
import {
  buildExplainability,
  type CandidateExplainability,
} from "../domain/candidateExplainability";
import { parserCapabilityRegistry } from "../domain/parserCapabilities";
import type { ParserType } from "../domain/importTypes";
import {
  createExtractionEvidence,
  type ExtractionEvidence,
} from "../domain/extractionEvidence";
import type { ExtractionProvenance } from "../domain/importProvenance";

// ─── Input / Output types ─────────────────────────────────────────────────────

export interface OrchestratorInput {
  stagingItemId:  string;
  importSessionId: number;
  organizationId: number;
  rawDescription: string | null;
  canonicalUnit:  string | null;
  parserType:     string;
  confidence:     number;
}

export interface OrchestratorStageResult {
  stage:          number;
  name:           string;
  status:         "ok" | "warning" | "skipped" | "failed";
  durationMs:     number;
  candidateCount: number;
  notes:          string[];
}

export interface OrchestratorResult {
  stagingItemId:    string;
  importSessionId:  number;
  organizationId:   number;
  candidateSet:     CandidateSet;
  consensus:        CandidateConsensus;
  explainabilities: Record<string, CandidateExplainability>;
  reviewRequired:   boolean;
  orchestrationMs:  number;
  stageResults:     OrchestratorStageResult[];
  correlationId:    string;  // unique per call (nanoid)
  replayKey:        string;  // deterministic hash of sorted input fields
  generatedAt:      string;
}

// ─── replayKey computation ─────────────────────────────────────────────────────

function computeReplayKey(input: OrchestratorInput): string {
  const sortedFields = {
    canonicalUnit:  input.canonicalUnit,
    confidence:     input.confidence,
    importSessionId: input.importSessionId,
    organizationId: input.organizationId,
    parserType:     input.parserType,
    rawDescription: input.rawDescription,
    stagingItemId:  input.stagingItemId,
  };
  return createHash("sha256")
    .update(JSON.stringify(sortedFields), "utf8")
    .digest("hex");
}

// ─── Main orchestration ───────────────────────────────────────────────────────

export async function runOrchestration(
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const startTotal = Date.now();
  const stageResults: OrchestratorStageResult[] = [];
  const correlationId = nanoid();
  const replayKey = computeReplayKey(input);

  // Build a minimal ExtractionEvidence for explainability
  const minimalProvenance: ExtractionProvenance = {
    sourceFileId:    input.stagingItemId,
    sourceFileName:  "unknown",
    sourceMimeType:  "application/octet-stream",
    sourceChecksum:  "",
    location:        {},
    parserType:      input.parserType,
    parserVersion:   "1.0.0",
    extractedAt:     new Date().toISOString(),
  };
  const evidence: ExtractionEvidence = createExtractionEvidence(
    input.stagingItemId,
    input.importSessionId,
    input.organizationId,
    minimalProvenance,
  );

  // ── Stage 1: candidate_retrieval ────────────────────────────────────────────
  let s1Start = Date.now();
  const searchResults = globalSemanticIndex.search(
    input.rawDescription ?? "",
    input.organizationId,
    5,
    0.30,
  );
  stageResults.push({
    stage: 1,
    name: "candidate_retrieval",
    status: searchResults.length > 0 ? "ok" : "warning",
    durationMs: Date.now() - s1Start,
    candidateCount: searchResults.length,
    notes: searchResults.length === 0 ? ["NO_CANDIDATES_FOUND"] : [],
  });

  // ── Stage 2: lexical_scoring ─────────────────────────────────────────────────
  s1Start = Date.now();
  const queryTokens = input.rawDescription ? tokenize(input.rawDescription) : [];
  const lexicalScores: Record<string, number> = {};
  for (const { entry } of searchResults) {
    const allEntryTokens = [...entry.tokens, ...entry.synonymTokens];
    const intersect = queryTokens.filter(t => allEntryTokens.includes(t));
    const union = new Set([...queryTokens, ...entry.tokens]).size;
    lexicalScores[entry.id] = union > 0 ? intersect.length / union : 0;
  }
  stageResults.push({
    stage: 2,
    name: "lexical_scoring",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: searchResults.length,
    notes: [],
  });

  // ── Stage 3: semantic_scoring ────────────────────────────────────────────────
  s1Start = Date.now();
  const semanticScores: Record<string, number> = {};
  for (const { entry } of searchResults) {
    const result = scoreAgainstEntry(queryTokens, entry);
    semanticScores[entry.id] = result.score;
  }
  stageResults.push({
    stage: 3,
    name: "semantic_scoring",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: searchResults.length,
    notes: [],
  });

  // ── Stage 4: parser_influence ────────────────────────────────────────────────
  s1Start = Date.now();
  const parserCap = parserCapabilityRegistry.get(input.parserType as ParserType);
  const parserConfidence = parserCap?.descriptionConfidence ?? 0.5;
  stageResults.push({
    stage: 4,
    name: "parser_influence",
    status: parserCap ? "ok" : "warning",
    durationMs: Date.now() - s1Start,
    candidateCount: searchResults.length,
    notes: parserCap ? [] : [`UNKNOWN_PARSER:${input.parserType}`],
  });

  // ── Stage 5: normalization_influence ─────────────────────────────────────────
  s1Start = Date.now();
  const normalizationInfluence = input.canonicalUnit ? 1.0 : 0.5;
  stageResults.push({
    stage: 5,
    name: "normalization_influence",
    status: input.canonicalUnit ? "ok" : "warning",
    durationMs: Date.now() - s1Start,
    candidateCount: searchResults.length,
    notes: input.canonicalUnit ? [] : ["NO_CANONICAL_UNIT"],
  });

  // ── Stage 6: confidence_blending ─────────────────────────────────────────────
  s1Start = Date.now();
  const w = DEFAULT_WEIGHTS;
  // Build SemanticCandidate array with blended scores
  const candidates = searchResults.map(({ entry, result }) => {
    const lexScore = lexicalScores[entry.id] ?? 0;
    const semScore = semanticScores[entry.id] ?? result.score;
    const normBoost = input.canonicalUnit != null
      ? Math.min(1.0, semScore + 0.10)
      : Math.max(0.0, semScore - 0.05);
    const blended = Math.min(1.0, Math.max(0.0,
      lexScore * w.lexical +
      semScore * w.semantic +
      normBoost * w.normalization +
      parserConfidence * w.parser,
    ));
    const source: "exact_match" | "alias_match" | "fuzzy_match" | "prefix_match" | "token_match" =
      result.strategy === "exact"  ? "exact_match"  :
      result.strategy === "alias"  ? "alias_match"  :
      result.strategy === "fuzzy"  ? "fuzzy_match"  :
      result.strategy === "prefix" ? "prefix_match" :
                                     "token_match";
    return createSemanticCandidate(
      input.stagingItemId,
      input.importSessionId,
      input.organizationId,
      {
        proposedDescription: entry.canonicalText,
        score:               blended,
        source,
        explanation:         buildExplanation(
          `Match via ${result.strategy}: "${input.rawDescription}" → "${entry.canonicalText}"`,
          result.matchedOn,
          0,
          lexScore,  // lexScore as bonus
        ),
        originalRaw:         input.rawDescription ?? "",
        catmatCode:          entry.catmatCode,
        catmatDesc:          entry.canonicalText,
        catmatGroup:         entry.catmatGroup,
        indexEntryId:        entry.id,
      },
    );
  });
  stageResults.push({
    stage: 6,
    name: "confidence_blending",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: candidates.length,
    notes: [],
  });

  // ── Stage 7: consensus_generation ────────────────────────────────────────────
  s1Start = Date.now();
  const consensus = buildConsensus(candidates, DEFAULT_WEIGHTS, {
    canonicalUnit: input.canonicalUnit,
    parserType:    input.parserType,
  });
  stageResults.push({
    stage: 7,
    name: "consensus_generation",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: candidates.length,
    notes: [],
  });

  // ── Stage 8: explainability_generation ───────────────────────────────────────
  s1Start = Date.now();
  const explainabilities: Record<string, CandidateExplainability> = {};
  for (const candidate of candidates) {
    explainabilities[candidate.id] = buildExplainability(candidate, consensus, evidence);
  }
  stageResults.push({
    stage: 8,
    name: "explainability_generation",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: candidates.length,
    notes: [],
  });

  // ── Stage 9: review_preparation ──────────────────────────────────────────────
  s1Start = Date.now();
  const reviewRequired = consensus.consensusScore < 0.85 || candidates.length === 0;
  stageResults.push({
    stage: 9,
    name: "review_preparation",
    status: "ok",
    durationMs: Date.now() - s1Start,
    candidateCount: candidates.length,
    notes: reviewRequired ? ["REVIEW_REQUIRED"] : [],
  });

  // ── Build candidate set ───────────────────────────────────────────────────────
  const candidateSet = buildCandidateSet(input.stagingItemId, candidates);

  return {
    stagingItemId:   input.stagingItemId,
    importSessionId: input.importSessionId,
    organizationId:  input.organizationId,
    candidateSet,
    consensus,
    explainabilities,
    reviewRequired,
    orchestrationMs: Date.now() - startTotal,
    stageResults,
    correlationId,
    replayKey,
    generatedAt:     new Date().toISOString(),
  };
}

// Re-export normalizationInfluence for testing
export { computeReplayKey };
