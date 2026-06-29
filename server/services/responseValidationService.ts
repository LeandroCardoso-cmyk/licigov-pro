export interface ValidationResult {
  readonly confidence: number;
  readonly hallucinationRisk: "none" | "low" | "medium" | "high" | "critical";
  readonly unsupportedClaims: string[];
  readonly contradictions: string[];
  readonly validationResult:
    | "approved"
    | "needs_review"
    | "rejected"
    | "insufficient_evidence";
  readonly requiresHumanApproval: boolean;
  readonly groundingCoverage: number;
  readonly evidenceUtilization: number;
  readonly validationExplanation: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function getSignificantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function sentenceHasEvidenceSupport(
  sentence: string,
  evidence: string[],
): boolean {
  const sentenceWords = getSignificantWords(sentence);
  if (sentenceWords.size === 0) return true;
  for (const ev of evidence) {
    const evWords = getSignificantWords(ev);
    let overlap = 0;
    for (const w of sentenceWords) {
      if (evWords.has(w)) overlap++;
    }
    if (overlap / sentenceWords.size > 0.3) return true;
  }
  return false;
}

export function detectHallucinations(
  response: string,
  evidence: string[],
): { risk: ValidationResult["hallucinationRisk"]; unsupportedClaims: string[] } {
  const sentences = splitSentences(response);
  if (sentences.length === 0)
    return { risk: "none", unsupportedClaims: [] };

  const unsupported: string[] = [];
  for (const s of sentences) {
    if (!sentenceHasEvidenceSupport(s, evidence)) {
      unsupported.push(s);
    }
  }

  const coverage = 1 - unsupported.length / sentences.length;
  let risk: ValidationResult["hallucinationRisk"];
  if (coverage > 0.8) risk = "none";
  else if (coverage > 0.6) risk = "low";
  else if (coverage > 0.4) risk = "medium";
  else if (coverage > 0.2) risk = "high";
  else risk = "critical";

  return { risk, unsupportedClaims: unsupported };
}

export function analyzeContradictions(
  response: string,
  evidence: string[],
): string[] {
  const sentences = splitSentences(response);
  const contradictions: string[] = [];
  const negationPatterns = /\b(não|nunca|nenhum|jamais|impossível|incorreto|falso)\b/i;

  for (const sentence of sentences) {
    if (!negationPatterns.test(sentence)) continue;
    const sWords = getSignificantWords(
      sentence.replace(negationPatterns, ""),
    );
    for (const ev of evidence) {
      if (negationPatterns.test(ev)) continue;
      const evWords = getSignificantWords(ev);
      let overlap = 0;
      for (const w of sWords) {
        if (evWords.has(w)) overlap++;
      }
      if (sWords.size > 0 && overlap / sWords.size > 0.4) {
        contradictions.push(sentence);
        break;
      }
    }
  }

  return contradictions;
}

export function measureGroundingCoverage(
  response: string,
  evidence: string[],
): number {
  const sentences = splitSentences(response);
  if (sentences.length === 0) return 1;
  let supported = 0;
  for (const s of sentences) {
    if (sentenceHasEvidenceSupport(s, evidence)) supported++;
  }
  return supported / sentences.length;
}

export function measureEvidenceUtilization(
  response: string,
  evidence: string[],
): number {
  if (evidence.length === 0) return 1;
  const responseWords = getSignificantWords(response);
  let used = 0;
  for (const ev of evidence) {
    const evWords = getSignificantWords(ev);
    let overlap = 0;
    for (const w of evWords) {
      if (responseWords.has(w)) overlap++;
    }
    if (evWords.size > 0 && overlap / evWords.size > 0.2) used++;
  }
  return used / evidence.length;
}

export function determineApproval(
  risk: string,
  coverage: number,
  score: number,
): boolean {
  return risk === "high" || risk === "critical" || coverage < 0.5 || score < 0.5;
}

export function validateResponse(
  response: string,
  evidence: string[],
  grounding: { groundingScore: number; confidenceScore: number },
): ValidationResult {
  const { risk, unsupportedClaims } = detectHallucinations(response, evidence);
  const contradictions = analyzeContradictions(response, evidence);
  const groundingCoverage = measureGroundingCoverage(response, evidence);
  const evidenceUtilization = measureEvidenceUtilization(response, evidence);
  const confidence =
    (grounding.groundingScore + grounding.confidenceScore + groundingCoverage) / 3;
  const requiresHumanApproval = determineApproval(
    risk,
    groundingCoverage,
    grounding.confidenceScore,
  );

  let validationResult: ValidationResult["validationResult"];
  if (risk === "critical" || risk === "high") validationResult = "rejected";
  else if (evidence.length === 0) validationResult = "insufficient_evidence";
  else if (requiresHumanApproval) validationResult = "needs_review";
  else validationResult = "approved";

  const explanationParts: string[] = [];
  explanationParts.push(`Risco de alucinação: ${risk}`);
  explanationParts.push(
    `Cobertura de grounding: ${(groundingCoverage * 100).toFixed(1)}%`,
  );
  explanationParts.push(
    `Utilização de evidências: ${(evidenceUtilization * 100).toFixed(1)}%`,
  );
  if (unsupportedClaims.length > 0)
    explanationParts.push(
      `${unsupportedClaims.length} afirmação(ões) sem suporte`,
    );
  if (contradictions.length > 0)
    explanationParts.push(`${contradictions.length} contradição(ões) detectada(s)`);

  return {
    confidence,
    hallucinationRisk: risk,
    unsupportedClaims,
    contradictions,
    validationResult,
    requiresHumanApproval,
    groundingCoverage,
    evidenceUtilization,
    validationExplanation: explanationParts.join(". "),
  };
}
