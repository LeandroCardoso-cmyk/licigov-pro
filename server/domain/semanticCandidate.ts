/**
 * Sprint 2.9 — Semantic Candidate.
 *
 * Representa um candidato de normalização semântica para um item extraído.
 * Cada candidato tem ranking, explicabilidade e ordering determinístico.
 *
 * PRINCÍPIO: candidatos nunca são aplicados automaticamente — sempre passam
 * por revisão humana ou AI-assistida antes de serem promovidos ao domínio.
 */

import { nanoid } from "nanoid";

// ─── Candidate source ─────────────────────────────────────────────────────────

export type CandidateSource =
  | "exact_match"       // correspondência exata no índice semântico
  | "alias_match"       // match via alias/sinônimo registrado
  | "fuzzy_match"       // distância de edição (Levenshtein ≤ 2)
  | "prefix_match"      // correspondência por prefixo
  | "token_match"       // interseção de tokens significativos
  | "ngram_match"       // n-gram similarity
  | "rule_based"        // regra de negócio explícita
  | "catmat_lookup";    // consulta ao catálogo CATMAT (futuro)

export type CandidateStatus =
  | "pending"    // aguardando avaliação
  | "accepted"   // aceito pelo revisor/sistema
  | "rejected"   // rejeitado pelo revisor
  | "superseded" // substituído por candidato melhor
  | "expired";   // expirou sem avaliação

// ─── Match explanation ────────────────────────────────────────────────────────

export interface MatchExplanation {
  reason:      string;   // texto legível
  matchedOn:   string[]; // tokens/campos que fizeram o match
  penalty:     number;   // 0–1, penalidade aplicada ao score
  bonus:       number;   // 0–1, bônus aplicado ao score
}

// ─── Semantic candidate ───────────────────────────────────────────────────────

export interface SemanticCandidate {
  id:              string;
  stagingItemId:   string;
  importSessionId: number;
  organizationId:  number;

  // O que foi proposto
  proposedDescription: string;
  proposedUnit:        string | null;
  proposedQuantity:    number | null;
  proposedUnitPrice:   number | null;

  // Ranking e qualidade
  score:           number;        // 0–1 score composto
  rank:            number;        // posição entre candidatos (1 = melhor)
  source:          CandidateSource;
  status:          CandidateStatus;

  // Explicabilidade
  explanation:     MatchExplanation;
  originalRaw:     string;        // texto bruto que originou o candidato

  // Metadados
  catmatCode?:     string;        // código CATMAT vinculado (se disponível)
  catmatDesc?:     string;        // descrição CATMAT oficial
  catmatGroup?:    string;        // grupo/classe CATMAT
  indexEntryId?:   string;        // FK para SemanticSearchEntry

  generatedAt:     string;        // ISO 8601
  evaluatedAt?:    string;        // quando foi aceito/rejeitado
  evaluatedBy?:    number;        // userId que avaliou
}

// ─── Candidate set ────────────────────────────────────────────────────────────

export interface CandidateSet {
  stagingItemId:   string;
  candidates:      SemanticCandidate[];
  bestCandidate:   SemanticCandidate | null;
  hasHighConfidence: boolean; // true se top-1 score ≥ 0.85
  requiresReview:  boolean;   // true se score < 0.85 ou ambiguidade
  generatedAt:     string;
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createSemanticCandidate(
  stagingItemId:   string,
  importSessionId: number,
  organizationId:  number,
  params: {
    proposedDescription: string;
    proposedUnit?:       string | null;
    proposedQuantity?:   number | null;
    proposedUnitPrice?:  number | null;
    score:               number;
    source:              CandidateSource;
    explanation:         MatchExplanation;
    originalRaw:         string;
    catmatCode?:         string;
    catmatDesc?:         string;
    catmatGroup?:        string;
    indexEntryId?:       string;
  },
): SemanticCandidate {
  return {
    id:                  nanoid(),
    stagingItemId,
    importSessionId,
    organizationId,
    proposedDescription: params.proposedDescription,
    proposedUnit:        params.proposedUnit ?? null,
    proposedQuantity:    params.proposedQuantity ?? null,
    proposedUnitPrice:   params.proposedUnitPrice ?? null,
    score:               clampScore(params.score),
    rank:                1,  // será reordenado em rankCandidates()
    source:              params.source,
    status:              "pending",
    explanation:         params.explanation,
    originalRaw:         params.originalRaw,
    catmatCode:          params.catmatCode,
    catmatDesc:          params.catmatDesc,
    catmatGroup:         params.catmatGroup,
    indexEntryId:        params.indexEntryId,
    generatedAt:         new Date().toISOString(),
  };
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

/**
 * Ordena candidatos por score DESC, depois por source (determinístico).
 * Tie-breaking por source priority para garantir ordering estável.
 */
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

export function rankCandidates(candidates: SemanticCandidate[]): SemanticCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id); // determinístico: por ID como tiebreaker final
  });

  return sorted.map((c, idx) => ({ ...c, rank: idx + 1 }));
}

export function buildCandidateSet(
  stagingItemId: string,
  candidates:    SemanticCandidate[],
): CandidateSet {
  const ranked = rankCandidates(candidates);
  const best   = ranked[0] ?? null;
  return {
    stagingItemId,
    candidates:        ranked,
    bestCandidate:     best,
    hasHighConfidence: best !== null && best.score >= 0.85,
    requiresReview:    best === null || best.score < 0.85 || ranked.length > 1 && ranked[1].score >= 0.70,
    generatedAt:       new Date().toISOString(),
  };
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

export function acceptCandidate(
  candidate: SemanticCandidate,
  userId:    number,
): SemanticCandidate {
  return {
    ...candidate,
    status:      "accepted",
    evaluatedAt: new Date().toISOString(),
    evaluatedBy: userId,
  };
}

export function rejectCandidate(
  candidate: SemanticCandidate,
  userId:    number,
): SemanticCandidate {
  return {
    ...candidate,
    status:      "rejected",
    evaluatedAt: new Date().toISOString(),
    evaluatedBy: userId,
  };
}

export function supersedeCandidates(
  candidates: SemanticCandidate[],
  exceptId:   string,
): SemanticCandidate[] {
  return candidates.map(c =>
    c.id !== exceptId && c.status === "pending"
      ? { ...c, status: "superseded" as CandidateStatus }
      : c,
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampScore(score: number): number {
  return Math.min(1, Math.max(0, score));
}

export function buildExplanation(
  reason:    string,
  matchedOn: string[],
  penalty    = 0,
  bonus      = 0,
): MatchExplanation {
  return { reason, matchedOn, penalty, bonus };
}

export function adjustedScore(candidate: SemanticCandidate): number {
  const { score, explanation: { penalty, bonus } } = candidate;
  return clampScore(score - penalty + bonus);
}
