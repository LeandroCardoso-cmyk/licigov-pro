import { createHash } from "crypto";

export interface GroundingResult {
  readonly groundingSessionId: string;
  readonly evidenceGraph: {
    readonly nodes: ReadonlyArray<{
      readonly id: string;
      readonly type: string;
      readonly content: string;
      readonly confidence: number;
      readonly source: string;
    }>;
    readonly edges: ReadonlyArray<{
      readonly from: string;
      readonly to: string;
      readonly relationship: string;
    }>;
  };
  readonly finalPrompt: string;
  readonly groundingScore: number;
  readonly confidenceScore: number;
  readonly replayKey: string;
  readonly correlationId: string;
}

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function orderEvidence(
  evidence: Array<{
    content: string;
    confidence: number;
    source: string;
    type?: string;
  }>
): typeof evidence {
  const legalRank = (item: { source: string; type?: string }): number => {
    const combined = `${item.source} ${item.type ?? ""}`.toLowerCase();
    if (combined.includes("lei")) return 0;
    if (combined.includes("decreto")) return 1;
    if (combined.includes("instrucao")) return 2;
    return 3;
  };

  return [...evidence].sort((a, b) => {
    const rankA = legalRank(a);
    const rankB = legalRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return b.confidence - a.confidence;
  });
}

export function optimizeTokens(prompt: string, maxTokens: number): string {
  if (estimateTokens(prompt) <= maxTokens) return prompt;

  const maxChars = maxTokens * 4;
  const candidate = prompt.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?")
  );

  if (lastSentenceEnd > 0) {
    return candidate.slice(0, lastSentenceEnd + 1);
  }

  return candidate;
}

export function enrichPrompt(
  basePrompt: string,
  context: string,
  evidence: string[],
  legal: string[]
): string {
  return `## CONTEXTO
${context}

## EVIDÊNCIAS
${evidence.map((e, i) => `[${i + 1}] ${e}`).join("\n")}

## LEGISLAÇÃO
${legal.map((l, i) => `[${i + 1}] ${l}`).join("\n")}

## CONSULTA
${basePrompt}`;
}

export function buildLegalHierarchy(
  legalRefs: Array<{ lawRef: string; article: string; text: string }>
): typeof legalRefs {
  const authorityRank = (lawRef: string): number => {
    const lower = lawRef.toLowerCase();
    if (lower.includes("constituicao")) return 0;
    if (lower.includes("lei_complementar")) return 1;
    if (lower.includes("lei")) return 2;
    if (lower.includes("decreto")) return 3;
    if (lower.includes("instrucao_normativa")) return 4;
    return 5;
  };

  return [...legalRefs].sort(
    (a, b) => authorityRank(a.lawRef) - authorityRank(b.lawRef)
  );
}

export function generateReplayKey(inputs: Record<string, unknown>): string {
  const sortedKeys = Object.keys(inputs).sort();
  const serialized = JSON.stringify(inputs, sortedKeys);
  return createHash("sha256").update(serialized).digest("hex");
}

export function buildGrounding(
  query: { id: string; normalizedQuery: string; organizationId: number },
  context: {
    promptContext: string;
    retrievedChunks: Array<{
      id: string;
      content: string;
      similarity: number;
      source: string;
    }>;
    legalReferences: Array<{
      id: string;
      lawRef: string;
      article: string;
      text: string;
      confidence: number;
    }>;
    semanticEvidence: Array<{
      id: string;
      content: string;
      confidence: number;
      source: string;
      type: string;
    }>;
  },
  evidence: Array<{
    id: string;
    content: string;
    confidence: number;
    source: string;
    type?: string;
  }>,
  correlationId: string
): GroundingResult {
  // Build evidence graph
  const nodes = evidence.map((item) => ({
    id: item.id,
    type: item.type ?? "evidence",
    content: item.content,
    confidence: item.confidence,
    source: item.source,
  }));

  const edges: Array<{
    readonly from: string;
    readonly to: string;
    readonly relationship: string;
  }> = [];

  // Create edges between same-source items
  for (let i = 0; i < evidence.length; i++) {
    for (let j = i + 1; j < evidence.length; j++) {
      if (evidence[i].source === evidence[j].source) {
        edges.push({
          from: evidence[i].id,
          to: evidence[j].id,
          relationship: "supports",
        });
      }
    }
  }

  // Order evidence
  const ordered = orderEvidence(evidence);

  // Build enriched prompt
  const evidenceContents = ordered.map((e) => e.content);
  const legalTexts = context.legalReferences.map((l) => l.text);
  const rawPrompt = enrichPrompt(
    context.promptContext,
    context.promptContext,
    evidenceContents,
    legalTexts
  );

  // Optimize prompt tokens
  const finalPrompt = optimizeTokens(rawPrompt, 4096);

  // Calculate groundingScore
  const groundingScore =
    evidence.length > 0
      ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
      : 0;

  // Calculate confidenceScore
  let confidenceScore: number;
  if (context.legalReferences.length > 0) {
    const legalAvg =
      context.legalReferences.reduce((sum, l) => sum + l.confidence, 0) /
      context.legalReferences.length;
    confidenceScore = (groundingScore + legalAvg) / 2;
  } else {
    confidenceScore = groundingScore;
  }

  // Generate replayKey
  const replayKey = generateReplayKey({ query, correlationId });

  // Generate groundingSessionId
  const groundingSessionId = generateId(
    `${query.id}-${correlationId}-${Date.now()}`
  );

  return {
    groundingSessionId,
    evidenceGraph: { nodes, edges },
    finalPrompt,
    groundingScore,
    confidenceScore,
    replayKey,
    correlationId,
  };
}
