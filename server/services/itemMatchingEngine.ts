/**
 * Sprint 3.0 — Item Matching Engine.
 *
 * Pipeline operacional de matching de itens contra o catálogo CATMAT/CATSER.
 * 8 estágios: lexical, alias, semantic, parser influence, normalization influence,
 * consensus scoring, explainability, review preparation.
 *
 * PRINCÍPIOS:
 *   - Replay-safe: mesma entrada → mesmo candidateSet/consensus/replayKey.
 *   - replayKey = sha256(JSON.stringify de inputs ordenados).
 *   - correlationId = nanoid() (único por execução, não afeta determinismo).
 *   - Scoring/ordering são funções puras dos inputs (sem Date.now()).
 *   - stageResults SEMPRE com 8 entradas.
 *
 * Reusa catalogSearchEngine (retrieval) e candidateConsensus (scoring).
 *
 * Embasamento: motivação técnica e rastreabilidade (Lei 14.133/2021, art. 5º).
 */

import { nanoid } from "nanoid";
import { createHash } from "crypto";

import {
  searchExact,
  searchAlias,
  searchSemantic,
  rankResults,
  type CatalogSearchResult,
} from "./catalogSearchEngine";
import type { CatalogEntry } from "./catalogIntegrationService";
import {
  createSemanticCandidate,
  buildExplanation,
  buildCandidateSet,
  rankCandidates,
  type SemanticCandidate,
  type CandidateSource,
  type CandidateSet,
} from "../domain/semanticCandidate";
import {
  buildConsensus,
  DEFAULT_WEIGHTS,
  type CandidateConsensus,
  type ConsensusWeights,
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

// ─── Input / Output ───────────────────────────────────────────────────────────

export interface ItemMatchingInput {
  description:     string;
  canonicalUnit:   string | null;
  parserType:      string;
  confidence:      number;
  organizationId:  number;
  processId:       number;
  importSessionId: number;
  stagingItemId:   string;
}

export interface MatchingStageResult {
  stage:          number;
  name:           string;
  status:         "ok" | "warning" | "skipped";
  durationMs:     number;
  candidateCount: number;
  notes:          string[];
}

export interface ItemMatchingResult {
  candidateSet:     CandidateSet;
  consensus:        CandidateConsensus;
  explainabilities: Record<string, CandidateExplainability>;
  selectedCandidate: SemanticCandidate | null;
  reviewRequired:   boolean;
  replayKey:        string;
  correlationId:    string;
  stageResults:     MatchingStageResult[]; // length === 8
  organizationId:   number;
  stagingItemId:    string;
  matchingMs:       number;
}

// ─── replayKey ────────────────────────────────────────────────────────────────

export function computeMatchingReplayKey(input: ItemMatchingInput): string {
  const sorted = {
    canonicalUnit:   input.canonicalUnit,
    confidence:      input.confidence,
    description:     input.description,
    importSessionId: input.importSessionId,
    organizationId:  input.organizationId,
    parserType:      input.parserType,
    processId:       input.processId,
    stagingItemId:   input.stagingItemId,
  };
  return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

// ─── Map search source → candidate source ────────────────────────────────────

function toCandidateSource(matchSource: CatalogSearchResult["matchSource"]): CandidateSource {
  switch (matchSource) {
    case "exact":      return "exact_match";
    case "alias":      return "alias_match";
    case "normalized": return "prefix_match";
    case "token":      return "token_match";
    case "semantic":   return "token_match";
    case "fuzzy":      return "fuzzy_match";
    default:           return "token_match";
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Executa o pipeline de 8 estágios. Determinístico e replay-safe.
 * durationMs é informativo (não afeta scoring/ordering).
 */
export function runItemMatching(
  input:   ItemMatchingInput,
  entries: CatalogEntry[],
  weights: ConsensusWeights = DEFAULT_WEIGHTS,
): ItemMatchingResult {
  const startTotal = Date.now();
  const correlationId = nanoid();
  const replayKey = computeMatchingReplayKey(input);
  const stageResults: MatchingStageResult[] = [];

  // Filter entries to this org + global (org 0). Deterministic.
  const scope = entries.filter(
    e => e.organizationId === input.organizationId || e.organizationId === 0,
  );

  // ── Stage 1: lexical (token) retrieval ──────────────────────────────────────
  let t0 = Date.now();
  const lexical = searchExact(input.description, scope);
  stageResults.push(stage(1, "lexical", lexical.length, Date.now() - t0,
    lexical.length === 0 ? ["NO_EXACT_MATCH"] : []));

  // ── Stage 2: alias retrieval ────────────────────────────────────────────────
  t0 = Date.now();
  const alias = searchAlias(input.description, scope);
  stageResults.push(stage(2, "alias", alias.length, Date.now() - t0,
    alias.length === 0 ? ["NO_ALIAS_MATCH"] : []));

  // ── Stage 3: semantic retrieval ─────────────────────────────────────────────
  t0 = Date.now();
  const semantic = searchSemantic(input.description, scope);
  stageResults.push(stage(3, "semantic", semantic.length, Date.now() - t0,
    semantic.length === 0 ? ["NO_SEMANTIC_MATCH"] : []));

  // Combined, deduped, ranked retrieval (deterministic).
  const retrieved = rankResults([...lexical, ...alias, ...semantic]);

  // ── Stage 4: parser influence ───────────────────────────────────────────────
  t0 = Date.now();
  const parserCap = parserCapabilityRegistry.get(input.parserType as ParserType);
  const parserConfidence = parserCap?.descriptionConfidence ?? 0.5;
  stageResults.push(stage(4, "parser_influence", retrieved.length, Date.now() - t0,
    parserCap ? [] : [`UNKNOWN_PARSER:${input.parserType}`]));

  // ── Stage 5: normalization influence ────────────────────────────────────────
  t0 = Date.now();
  const hasUnit = input.canonicalUnit != null;
  stageResults.push(stage(5, "normalization_influence", retrieved.length, Date.now() - t0,
    hasUnit ? [] : ["NO_CANONICAL_UNIT"]));

  // Build semantic candidates (deterministic: id seeded by replayKey + code + idx).
  const candidates: SemanticCandidate[] = retrieved.map((r, idx) => {
    const source = toCandidateSource(r.matchSource);
    const normBoost = hasUnit
      ? (r.entry.canonicalUnit === input.canonicalUnit ? 0.05 : 0)
      : -0.05;
    const baseScore = Math.min(1, Math.max(0, r.score + normBoost));
    const candidate = createSemanticCandidate(
      input.stagingItemId,
      input.importSessionId,
      input.organizationId,
      {
        proposedDescription: r.entry.description,
        proposedUnit:        r.entry.canonicalUnit ?? r.entry.unit,
        score:               baseScore,
        source,
        explanation:         buildExplanation(r.rankRationale, r.matchedTokens, 0, 0),
        originalRaw:         input.description,
        catmatCode:          r.entry.catalogType === "catmat" ? r.entry.code : undefined,
        catmatDesc:          r.entry.description,
        catmatGroup:         r.entry.group,
      },
    );
    // Force a deterministic id (replay-safe) overriding nanoid.
    return { ...candidate, id: deterministicCandidateId(replayKey, r.entry.code, idx), generatedAt: candidate.generatedAt };
  });

  // ── Stage 6: consensus scoring ──────────────────────────────────────────────
  t0 = Date.now();
  const consensus = buildConsensus(candidates, weights, {
    canonicalUnit: input.canonicalUnit,
    parserType:    input.parserType,
  });
  stageResults.push(stage(6, "consensus_scoring", candidates.length, Date.now() - t0, []));

  // ── Stage 7: explainability generation ──────────────────────────────────────
  t0 = Date.now();
  const provenance: ExtractionProvenance = {
    sourceFileId:   input.stagingItemId,
    sourceFileName: "unknown",
    sourceMimeType: "application/octet-stream",
    sourceChecksum: "",
    location:       {},
    parserType:     input.parserType,
    parserVersion:  "1.0.0",
    extractedAt:    new Date().toISOString(),
  };
  const evidence: ExtractionEvidence = createExtractionEvidence(
    input.stagingItemId,
    input.importSessionId,
    input.organizationId,
    provenance,
  );
  const rankedCandidates = rankCandidates(candidates);
  const explainabilities: Record<string, CandidateExplainability> = {};
  for (const candidate of rankedCandidates) {
    explainabilities[candidate.id] = buildExplainability(candidate, consensus, evidence);
  }
  stageResults.push(stage(7, "explainability", rankedCandidates.length, Date.now() - t0, []));

  // ── Stage 8: review preparation ─────────────────────────────────────────────
  t0 = Date.now();
  const reviewRequired = consensus.consensusScore < 0.85 || candidates.length === 0;
  stageResults.push(stage(8, "review_preparation", candidates.length, Date.now() - t0,
    reviewRequired ? ["REVIEW_REQUIRED"] : []));

  const candidateSet = buildCandidateSet(input.stagingItemId, candidates);

  return {
    candidateSet,
    consensus,
    explainabilities,
    selectedCandidate: consensus.winningCandidate,
    reviewRequired,
    replayKey,
    correlationId,
    stageResults,
    organizationId:    input.organizationId,
    stagingItemId:     input.stagingItemId,
    matchingMs:        Date.now() - startTotal,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stage(
  n:              number,
  name:           string,
  candidateCount: number,
  durationMs:     number,
  notes:          string[],
): MatchingStageResult {
  return {
    stage:  n,
    name,
    status: notes.length > 0 ? "warning" : "ok",
    durationMs,
    candidateCount,
    notes,
  };
}

function deterministicCandidateId(replayKey: string, code: string, idx: number): string {
  return createHash("sha256")
    .update(`${replayKey}:${code}:${idx}`, "utf8")
    .digest("hex")
    .slice(0, 21);
}
