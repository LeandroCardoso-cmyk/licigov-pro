/**
 * Sprint 2.95 — Candidate Consensus.
 *
 * Aggregate para resolução determinística de consenso entre candidatos semânticos.
 * Aplica pesos configuráveis e garante replay-safety: mesmos inputs → mesmo output.
 *
 * PRINCÍPIO: consenso é imutável — uma vez gerado, nunca muda para os mesmos inputs.
 * O campo createdAt é o único campo não-determinístico (não afeta scoring).
 */

import { nanoid } from "nanoid";
import {
  type SemanticCandidate,
  type CandidateSource,
} from "./semanticCandidate";
import { parserCapabilityRegistry } from "./parserCapabilities";
import type { ParserType } from "./importTypes";

// ─── Weights ──────────────────────────────────────────────────────────────────

export interface ConsensusWeights {
  lexical:       number; // peso do scoring lexical
  semantic:      number; // peso do scoring semântico
  normalization: number; // peso da normalização de unidades
  parser:        number; // peso da capacidade do parser
}

export const DEFAULT_WEIGHTS: ConsensusWeights = {
  lexical:       0.30,
  semantic:      0.35,
  normalization: 0.20,
  parser:        0.15,
};

// ─── Source priority (deterministic tiebreak) ─────────────────────────────────

const SOURCE_PRIORITY: Record<CandidateSource, number> = {
  exact_match:   0,
  alias_match:   1,
  catmat_lookup: 2,
  rule_based:    3,
  prefix_match:  4,
  token_match:   5,
  ngram_match:   6,
  fuzzy_match:   7,
};

// ─── Consensus types ──────────────────────────────────────────────────────────

export interface ConfidenceBreakdown {
  lexical:       number; // 0–1
  semantic:      number; // 0–1
  normalization: number; // 0–1
  parser:        number; // 0–1
}

export interface RankingMetadata {
  strategy:         string;
  tiebreakApplied:  boolean;
  deterministic:    true;
}

export interface RejectedCandidateWithReason extends SemanticCandidate {
  rejectionReason: string;
}

export interface CandidateConsensus {
  id:                  string;
  stagingItemId:       string;
  importSessionId:     number;
  organizationId:      number;
  winningCandidate:    SemanticCandidate | null;
  alternatives:        SemanticCandidate[];
  consensusScore:      number; // 0–1
  consensusReasoning:  string;
  rejectedCandidates:  RejectedCandidateWithReason[];
  evidenceSummary:     string;
  confidenceBreakdown: ConfidenceBreakdown;
  rankingMetadata:     RankingMetadata;
  createdAt:           string; // ISO 8601 (only non-deterministic field)
}

// ─── Weight normalization ─────────────────────────────────────────────────────

export function normalizeWeights(weights: ConsensusWeights): ConsensusWeights {
  const total = weights.lexical + weights.semantic + weights.normalization + weights.parser;
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  return {
    lexical:       weights.lexical       / total,
    semantic:      weights.semantic      / total,
    normalization: weights.normalization / total,
    parser:        weights.parser        / total,
  };
}

// ─── Blended score computation ────────────────────────────────────────────────

interface BlendedResult {
  blendedScore:       number;
  confidenceBreakdown: ConfidenceBreakdown;
}

function computeBlendedScore(
  candidate:     SemanticCandidate,
  weights:       ConsensusWeights,
  context:       { canonicalUnit: string | null; parserType: string },
): BlendedResult {
  // Lexical component: candidate.score * (1 + tokenMatchBonus)
  const tokenMatchBonus = candidate.explanation.bonus;
  const lexicalComponent = candidate.score * (1 + tokenMatchBonus);

  // Semantic component: candidate.score directly
  const semanticComponent = candidate.score;

  // Normalization component: boost if canonical unit present
  const normalizationComponent = context.canonicalUnit != null
    ? Math.min(1.0, candidate.score + 0.10)
    : Math.max(0.0, candidate.score - 0.05);

  // Parser component: descriptionConfidence from registry
  const parserCap = parserCapabilityRegistry.get(context.parserType as ParserType);
  const parserComponent = parserCap ? parserCap.descriptionConfidence : 0.5;

  // Final blended score
  const blendedScore =
    lexicalComponent    * weights.lexical +
    semanticComponent   * weights.semantic +
    normalizationComponent * weights.normalization +
    parserComponent     * weights.parser;

  const clamped = Math.min(1.0, Math.max(0.0, blendedScore));

  return {
    blendedScore: clamped,
    confidenceBreakdown: {
      lexical:       Math.min(1.0, Math.max(0.0, lexicalComponent)),
      semantic:      Math.min(1.0, Math.max(0.0, semanticComponent)),
      normalization: Math.min(1.0, Math.max(0.0, normalizationComponent)),
      parser:        Math.min(1.0, Math.max(0.0, parserComponent)),
    },
  };
}

// ─── Rejection reasoning ──────────────────────────────────────────────────────

export function getRejectionReason(
  candidate: SemanticCandidate,
  winner:    SemanticCandidate | null,
): string {
  if (!winner) return "Nenhum candidato vencedor foi selecionado.";

  const scoreDiff = winner.score - candidate.score;
  const sourcePriorityWinner = SOURCE_PRIORITY[winner.source] ?? 99;
  const sourcePriorityCandidate = SOURCE_PRIORITY[candidate.source] ?? 99;

  if (scoreDiff > 0.10) {
    return `Candidato com score inferior (${candidate.score.toFixed(3)} vs ${winner.score.toFixed(3)} do vencedor).`;
  }
  if (scoreDiff > 0) {
    return `Score ligeiramente inferior ao vencedor (${candidate.score.toFixed(3)} vs ${winner.score.toFixed(3)}). Desempate por score.`;
  }
  if (sourcePriorityWinner < sourcePriorityCandidate) {
    return `Mesmo score (${candidate.score.toFixed(3)}), mas fonte "${winner.source}" tem prioridade maior que "${candidate.source}".`;
  }
  return `Mesmo score e fonte — desempate lexicográfico pelo ID do candidato (${candidate.id} > ${winner.id}).`;
}

// ─── Build consensus ──────────────────────────────────────────────────────────

export function buildConsensus(
  candidates: SemanticCandidate[],
  weights: ConsensusWeights = DEFAULT_WEIGHTS,
  context: { canonicalUnit: string | null; parserType: string } = {
    canonicalUnit: null,
    parserType:    "xlsx",
  },
): CandidateConsensus {
  // Use the first candidate's stagingItemId/importSessionId/organizationId
  // (all candidates belong to same staging item)
  const stagingItemId   = candidates[0]?.stagingItemId   ?? "";
  const importSessionId = candidates[0]?.importSessionId ?? 0;
  const organizationId  = candidates[0]?.organizationId  ?? 0;

  const normalizedWeights = normalizeWeights(weights);

  if (candidates.length === 0) {
    return {
      id:                  nanoid(),
      stagingItemId,
      importSessionId,
      organizationId,
      winningCandidate:    null,
      alternatives:        [],
      consensusScore:      0,
      consensusReasoning:  "Nenhum candidato disponível para análise de consenso.",
      rejectedCandidates:  [],
      evidenceSummary:     "0 candidatos avaliados.",
      confidenceBreakdown: { lexical: 0, semantic: 0, normalization: 0, parser: 0 },
      rankingMetadata: {
        strategy:        "weighted_blend",
        tiebreakApplied: false,
        deterministic:   true,
      },
      createdAt: new Date().toISOString(),
    };
  }

  // Compute blended scores for all candidates
  const scored = candidates.map(c => {
    const blended = computeBlendedScore(c, normalizedWeights, context);
    return { candidate: c, ...blended };
  });

  // Sort deterministically: blendedScore DESC → source priority ASC → id ASC
  const sorted = [...scored].sort((a, b) => {
    if (Math.abs(a.blendedScore - b.blendedScore) > 1e-9) {
      return b.blendedScore - a.blendedScore;
    }
    const pa = SOURCE_PRIORITY[a.candidate.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.candidate.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.candidate.id.localeCompare(b.candidate.id);
  });

  const winnerEntry = sorted[0];
  const winner = winnerEntry.candidate;
  const tiebreakApplied =
    sorted.length > 1 &&
    Math.abs(sorted[0].blendedScore - sorted[1].blendedScore) < 1e-9;

  const alternatives: SemanticCandidate[] = sorted.slice(1).map(e => e.candidate);

  const rejectedCandidates: RejectedCandidateWithReason[] = sorted.slice(1).map(e => ({
    ...e.candidate,
    rejectionReason: getRejectionReason(e.candidate, winner),
  }));

  const consensusScore = winnerEntry.blendedScore;
  const totalCandidates = candidates.length;

  const consensusReasoning =
    `Candidato "${winner.proposedDescription}" selecionado com score ponderado ${consensusScore.toFixed(4)} ` +
    `(lexical: ${winnerEntry.confidenceBreakdown.lexical.toFixed(3)}, ` +
    `semântico: ${winnerEntry.confidenceBreakdown.semantic.toFixed(3)}, ` +
    `normalização: ${winnerEntry.confidenceBreakdown.normalization.toFixed(3)}, ` +
    `parser: ${winnerEntry.confidenceBreakdown.parser.toFixed(3)}). ` +
    `${totalCandidates} candidato(s) avaliado(s).`;

  const evidenceSummary =
    `${totalCandidates} candidato(s); vencedor via fonte "${winner.source}"; ` +
    `unidade canônica ${context.canonicalUnit ? `"${context.canonicalUnit}"` : "ausente"}; ` +
    `parser "${context.parserType}".`;

  return {
    id:                  nanoid(),
    stagingItemId,
    importSessionId,
    organizationId,
    winningCandidate:    winner,
    alternatives,
    consensusScore,
    consensusReasoning,
    rejectedCandidates,
    evidenceSummary,
    confidenceBreakdown: winnerEntry.confidenceBreakdown,
    rankingMetadata: {
      strategy:        "weighted_blend",
      tiebreakApplied,
      deterministic:   true,
    },
    createdAt: new Date().toISOString(),
  };
}
