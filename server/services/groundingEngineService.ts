import { createHash } from "crypto";

export interface GroundingEvidence {
  id: string;
  organizationId: number;
  sourceRef: string;
  content: string;
  relevanceScore: number;
  evidenceType:
    | "document"
    | "regulation"
    | "precedent"
    | "knowledge_base"
    | "user_input";
  legalBasis: string | null;
  citationKey: string;
  verified: boolean;
  verifiedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GroundingResult {
  id: string;
  organizationId: number;
  sessionId: string;
  aiContent: string;
  groundedContent: string;
  evidenceRefs: GroundingEvidence[];
  hallucination_risk: "low" | "medium" | "high";
  confidence: number;
  ungroundedClaims: string[];
  groundedClaims: string[];
  replayKey: string;
  processedAt: string;
}

const _evidenceStore = new Map<number, GroundingEvidence[]>();

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function groundContent(params: {
  organizationId: number;
  sessionId: string;
  aiContent: string;
  evidenceRefs: GroundingEvidence[];
  replayKey: string;
}): GroundingResult {
  const { organizationId, sessionId, aiContent, evidenceRefs, replayKey } = params;

  const sentences = splitSentences(aiContent);

  const groundedClaims: string[] = [];
  const ungroundedClaims: string[] = [];

  let groundedContent = aiContent;

  for (const sentence of sentences) {
    const isComplex = sentence.includes(".");
    if (!isComplex) {
      ungroundedClaims.push(sentence);
      continue;
    }

    const matchingEvidence = evidenceRefs.find(
      (ev) =>
        ev.relevanceScore >= 0.5 &&
        (sentence.toLowerCase().includes(ev.content.slice(0, 20).toLowerCase()) ||
          ev.relevanceScore >= 0.8)
    );

    if (matchingEvidence) {
      groundedClaims.push(sentence);
      groundedContent = groundedContent.replace(
        sentence,
        `${sentence} [ref: ${matchingEvidence.citationKey}]`
      );
    } else if (evidenceRefs.length > 0) {
      groundedClaims.push(sentence);
    } else {
      ungroundedClaims.push(sentence);
    }
  }

  const avgRelevance =
    evidenceRefs.length > 0
      ? evidenceRefs.reduce((sum, e) => sum + e.relevanceScore, 0) / evidenceRefs.length
      : 0;

  const penaltyDivisor = ungroundedClaims.length * 0.1 + 1;
  const confidence = Math.min(1, Math.max(0, avgRelevance / penaltyDivisor));

  const hallucinationRisk: "low" | "medium" | "high" =
    confidence >= 0.8 ? "low" : confidence >= 0.5 ? "medium" : "high";

  const id = generateId(`${organizationId}:${sessionId}:${replayKey}`);

  return {
    id,
    organizationId,
    sessionId,
    aiContent,
    groundedContent,
    evidenceRefs,
    hallucination_risk: hallucinationRisk,
    confidence,
    ungroundedClaims,
    groundedClaims,
    replayKey,
    processedAt: new Date().toISOString(),
  };
}

export function createEvidence(params: {
  organizationId: number;
  sourceRef: string;
  content: string;
  relevanceScore: number;
  evidenceType: GroundingEvidence["evidenceType"];
  legalBasis?: string;
}): GroundingEvidence {
  const { organizationId, sourceRef, content, relevanceScore, evidenceType, legalBasis } =
    params;

  const now = new Date().toISOString();
  const id = generateId(`${organizationId}:${sourceRef}:${content.slice(0, 64)}:${now}`);
  const citationKey = `cite-${id.slice(0, 8)}`;

  const evidence: GroundingEvidence = {
    id,
    organizationId,
    sourceRef,
    content,
    relevanceScore: Math.min(1, Math.max(0, relevanceScore)),
    evidenceType,
    legalBasis: legalBasis ?? null,
    citationKey,
    verified: false,
    verifiedAt: null,
    metadata: {},
    createdAt: now,
  };

  const existing = _evidenceStore.get(organizationId) ?? [];
  existing.push(evidence);
  _evidenceStore.set(organizationId, existing);

  return evidence;
}

export function verifyEvidence(evidence: GroundingEvidence): GroundingEvidence {
  return {
    ...evidence,
    verified: true,
    verifiedAt: new Date().toISOString(),
  };
}

export function assessHallucinationRisk(
  result: GroundingResult
): "low" | "medium" | "high" {
  return result.hallucination_risk;
}

export function buildCitation(evidence: GroundingEvidence): string {
  return `[${evidence.citationKey}] ${evidence.sourceRef}`;
}
