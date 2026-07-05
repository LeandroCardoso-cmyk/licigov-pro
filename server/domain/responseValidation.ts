import { createHash } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type HallucinationRisk = "none" | "low" | "medium" | "high" | "critical";

export type ValidationResult =
  | "approved"
  | "needs_review"
  | "rejected"
  | "insufficient_evidence";

export interface ResponseValidation {
  readonly id: string;
  readonly organizationId: number;
  readonly responseId: string;
  readonly confidence: number;
  readonly hallucinationRisk: HallucinationRisk;
  readonly unsupportedClaims: readonly string[];
  readonly contradictions: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly validationResult: ValidationResult;
  readonly requiresHumanApproval: boolean;
  readonly validationExplanation: string;
  readonly groundingCoverage: number;
  readonly evidenceUtilization: number;
  readonly createdAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function getWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
}

function sentenceHasEvidenceSupport(sentence: string, evidence: readonly string[]): boolean {
  const sentenceWords = getWords(sentence);
  if (sentenceWords.length === 0) return true;
  for (const ev of evidence) {
    const evWords = new Set(getWords(ev));
    let matchCount = 0;
    for (const word of sentenceWords) {
      if (evWords.has(word)) matchCount++;
    }
    if (matchCount / sentenceWords.length >= 0.3) return true;
  }
  return false;
}

// ─── Functions ──────────────────────────────────────────────────────────────

export function createValidation(params: {
  organizationId: number;
  responseId: string;
  confidence: number;
  hallucinationRisk: HallucinationRisk;
  unsupportedClaims?: string[];
  contradictions?: string[];
  missingEvidence?: string[];
  validationResult: ValidationResult;
  validationExplanation: string;
  groundingCoverage?: number;
  evidenceUtilization?: number;
}): ResponseValidation {
  const id = createHash("sha256")
    .update(`rv:${params.organizationId}:${params.responseId}`)
    .digest("hex").slice(0, 20);

  const hallucinationRisk = params.hallucinationRisk;
  const validationResult = params.validationResult;

  const requiresHumanApproval = determineApprovalRequirement({
    hallucinationRisk,
    validationResult,
  });

  return {
    id,
    organizationId: params.organizationId,
    responseId: params.responseId,
    confidence: params.confidence,
    hallucinationRisk,
    unsupportedClaims: params.unsupportedClaims ?? [],
    contradictions: params.contradictions ?? [],
    missingEvidence: params.missingEvidence ?? [],
    validationResult,
    requiresHumanApproval,
    validationExplanation: params.validationExplanation,
    groundingCoverage: params.groundingCoverage ?? 0,
    evidenceUtilization: params.evidenceUtilization ?? 0,
    createdAt: new Date().toISOString(),
  };
}

export function assessHallucinationRisk(
  response: string,
  evidence: readonly string[],
): HallucinationRisk {
  const sentences = splitSentences(response);
  if (sentences.length === 0) return "none";

  let supportedCount = 0;
  for (const sentence of sentences) {
    if (sentenceHasEvidenceSupport(sentence, evidence)) {
      supportedCount++;
    }
  }

  const coverage = supportedCount / sentences.length;
  if (coverage > 0.8) return "none";
  if (coverage > 0.6) return "low";
  if (coverage > 0.4) return "medium";
  if (coverage > 0.2) return "high";
  return "critical";
}

export function detectUnsupportedClaims(
  response: string,
  evidence: readonly string[],
): string[] {
  const sentences = splitSentences(response);
  const unsupported: string[] = [];
  for (const sentence of sentences) {
    if (!sentenceHasEvidenceSupport(sentence, evidence)) {
      unsupported.push(sentence);
    }
  }
  return unsupported;
}

export function detectContradictions(
  response: string,
  evidence: readonly string[],
): string[] {
  const sentences = splitSentences(response);
  const contradictions: string[] = [];

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    const hasNegation = /\b(não|nunca|nenhum|jamais)\b/.test(sentenceLower);
    if (!hasNegation) continue;

    // Check if any evidence contains an assertion that contradicts the negation
    for (const ev of evidence) {
      const evLower = ev.toLowerCase();
      const evHasNegation = /\b(não|nunca|nenhum|jamais)\b/.test(evLower);

      // Contradiction: sentence negates but evidence affirms (or vice versa)
      if (!evHasNegation) {
        // Check word overlap to see if they're about the same topic
        const sentenceWords = getWords(sentenceLower.replace(/\b(não|nunca|nenhum|jamais)\b/g, ""));
        const evWords = new Set(getWords(evLower));
        let overlap = 0;
        for (const word of sentenceWords) {
          if (evWords.has(word)) overlap++;
        }
        if (sentenceWords.length > 0 && overlap / sentenceWords.length >= 0.4) {
          contradictions.push(sentence);
          break;
        }
      }
    }
  }

  return contradictions;
}

export function determineApprovalRequirement(validation: {
  hallucinationRisk: HallucinationRisk;
  validationResult?: ValidationResult;
}): boolean {
  if (validation.hallucinationRisk === "high" || validation.hallucinationRisk === "critical") {
    return true;
  }
  if (
    validation.validationResult === "needs_review" ||
    validation.validationResult === "insufficient_evidence"
  ) {
    return true;
  }
  return false;
}
