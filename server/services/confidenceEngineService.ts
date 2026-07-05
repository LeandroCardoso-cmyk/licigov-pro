export interface ConsolidatedConfidence {
  readonly retrieval: number;
  readonly evidence: number;
  readonly legal: number;
  readonly grounding: number;
  readonly response: number;
  readonly consolidated: number;
  readonly weights: Record<string, number>;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  retrieval: 0.25,
  evidence: 0.25,
  legal: 0.20,
  grounding: 0.15,
  response: 0.15,
};

export function retrievalConfidence(
  chunks: Array<{ similarity: number }>,
): number {
  if (chunks.length === 0) return 0;
  const sum = chunks.reduce((acc, c) => acc + c.similarity, 0);
  return sum / chunks.length;
}

export function evidenceConfidence(
  evidence: Array<{ confidence: number }>,
): number {
  if (evidence.length === 0) return 0;
  const sum = evidence.reduce((acc, e) => acc + e.confidence, 0);
  return sum / evidence.length;
}

export function legalConfidence(
  legalRefs: Array<{ confidence: number }>,
): number {
  if (legalRefs.length === 0) return 0;
  const sum = legalRefs.reduce((acc, r) => acc + r.confidence, 0);
  return sum / legalRefs.length;
}

export function groundingConfidence(score: number): number {
  return Math.max(0, Math.min(1, score));
}

export function responseConfidence(
  validation: { confidence: number; groundingCoverage: number },
): number {
  return (validation.confidence + validation.groundingCoverage) / 2;
}

export function consolidateScores(
  scores: Record<string, number>,
  weights?: Record<string, number>,
): number {
  const w = weights ?? DEFAULT_WEIGHTS;
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(w)) {
    const score = scores[key] ?? 0;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

export function computeConfidence(params: {
  retrievalChunks: Array<{ similarity: number }>;
  evidence: Array<{ confidence: number }>;
  legalRefs: Array<{ confidence: number }>;
  groundingScore: number;
  validationResult: { confidence: number; groundingCoverage: number };
  weights?: Record<string, number>;
}): ConsolidatedConfidence {
  const w = params.weights ?? DEFAULT_WEIGHTS;
  const scores = {
    retrieval: retrievalConfidence(params.retrievalChunks),
    evidence: evidenceConfidence(params.evidence),
    legal: legalConfidence(params.legalRefs),
    grounding: groundingConfidence(params.groundingScore),
    response: responseConfidence(params.validationResult),
  };

  const consolidated = consolidateScores(scores, w);

  return {
    ...scores,
    consolidated,
    weights: w,
  };
}
