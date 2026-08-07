/**
 * Sprint 5.1 — CATMAT/CATSER Matching
 *
 * Fluxo: pesquisa → matching → ranking → alternativas → SERVIDOR escolhe.
 * NUNCA substitui automaticamente. Sempre permite aceitar/rejeitar/pesquisar de
 * novo/informar manual. Determinístico (sem chamadas reais à API neste domínio).
 */

import { createHash } from "crypto";

export type CATMATDecision = "sugerido" | "aceito" | "rejeitado" | "manual";

/** Proveniência da sugestão (auditável). Aberto a novas fontes sem quebra de contrato. */
export type CATMATSource = "catalogo-interno" | "api-comprasgov" | "sugestao-ia" | "manual" | (string & {});

export interface CATMATMatch {
  readonly id: string;
  readonly itemId: string;
  readonly organizationId: number;
  readonly catmatCode: string;
  readonly catmatDescription: string;
  readonly score: number;
  readonly rank: number;
  readonly decision: CATMATDecision;
  /** PR C — proveniência da sugestão (opcional para compat.; sempre setada pelas fábricas). */
  readonly source?: CATMATSource;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface CATMATSafetyAssessment {
  readonly safe: boolean;
  readonly reason: "safe_match" | "no_candidates" | "below_threshold" | "threshold_not_configured";
  readonly best: CATMATMatch | null;
  readonly minScore: number | null;
}

/**
 * Avalia se há correspondência SEGURA — FAIL-CLOSED. Nunca inventa código e NUNCA declara
 * `safe:true` sem um limiar institucional explicitamente fornecido:
 *   - sem candidatos            → `no_candidates`;
 *   - `minScore` não configurado → `threshold_not_configured` (safe:false);
 *   - melhor score < `minScore` → `below_threshold`;
 *   - melhor score ≥ `minScore` → `safe_match`.
 * Não há default arbitrário: o valor institucional do limiar é decisão de negócio (bloco C.2).
 * A IA/heurística apenas sugere; a decisão final permanece humana.
 */
export function assessMatchSafety(
  matches: readonly CATMATMatch[],
  minScore?: number | null,
): CATMATSafetyAssessment {
  if (matches.length === 0) {
    return { safe: false, reason: "no_candidates", best: null, minScore: minScore ?? null };
  }
  const best = [...matches].sort((a, b) => a.rank - b.rank)[0];
  // Fail-closed: sem limiar institucional configurado, jamais considera seguro.
  if (minScore === undefined || minScore === null || !Number.isFinite(minScore)) {
    return { safe: false, reason: "threshold_not_configured", best, minScore: null };
  }
  if (best.score < minScore) return { safe: false, reason: "below_threshold", best, minScore };
  return { safe: true, reason: "safe_match", best, minScore };
}

/** Similaridade determinística por interseção de tokens (Dice). */
export function scoreMatch(query: string, candidate: string): number {
  const a = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const b = new Set(candidate.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

/**
 * Ranqueia candidatos CATMAT para a descrição de um item. O primeiro é apenas
 * SUGERIDO — o servidor decide. Nunca marca como aceito automaticamente.
 */
export function rankCATMAT(params: {
  itemId: string;
  organizationId: number;
  description: string;
  candidates: Array<{ code: string; description: string; source?: CATMATSource }>;
  correlationId: string;
  createdAt?: string;
  /** Proveniência padrão quando o candidato não declara a sua (auditável). */
  defaultSource?: CATMATSource;
}): CATMATMatch[] {
  const scored = params.candidates
    .map(c => ({ ...c, score: scoreMatch(params.description, c.description) }))
    .sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : 1));

  return scored.map((c, i) => ({
    id: createHash("sha256").update(`cmm:${params.organizationId}:${params.itemId}:${c.code}`).digest("hex").slice(0, 20),
    itemId: params.itemId,
    organizationId: params.organizationId,
    catmatCode: c.code,
    catmatDescription: c.description,
    score: c.score,
    rank: i,
    decision: "sugerido" as CATMATDecision,
    source: c.source ?? params.defaultSource ?? "catalogo-interno",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  }));
}

export function acceptMatch(match: CATMATMatch): CATMATMatch {
  return { ...match, decision: "aceito" };
}

export function rejectMatch(match: CATMATMatch): CATMATMatch {
  return { ...match, decision: "rejeitado" };
}

/** Registra um CATMAT informado manualmente pelo servidor. */
export function manualMatch(params: {
  itemId: string;
  organizationId: number;
  catmatCode: string;
  catmatDescription: string;
  correlationId: string;
  createdAt?: string;
}): CATMATMatch {
  return {
    id: createHash("sha256").update(`cmm:${params.organizationId}:${params.itemId}:${params.catmatCode}`).digest("hex").slice(0, 20),
    itemId: params.itemId,
    organizationId: params.organizationId,
    catmatCode: params.catmatCode,
    catmatDescription: params.catmatDescription,
    score: 1,
    rank: 0,
    decision: "manual",
    source: "manual",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Sugerido = melhor rank; alternativas = os demais. */
export function suggestedAndAlternatives(matches: readonly CATMATMatch[]): { suggested: CATMATMatch | null; alternatives: CATMATMatch[] } {
  if (matches.length === 0) return { suggested: null, alternatives: [] };
  const sorted = [...matches].sort((a, b) => a.rank - b.rank);
  return { suggested: sorted[0], alternatives: sorted.slice(1) };
}
