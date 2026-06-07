import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReasoningStageType =
  | "premise_extraction"
  | "evidence_linking"
  | "contradiction_check"
  | "inference"
  | "conclusion"
  | "validation"
  | "citation";

export type ReasoningConfidence = "certain" | "probable" | "possible" | "uncertain" | "unknown";

export interface ReasoningPremise {
  id: string;
  content: string;
  sourceRef: string;
  confidence: number;
  legalBasis: string | null;
}

export interface ReasoningStage {
  id: string;
  organizationId: number;
  stageType: ReasoningStageType;
  input: string;
  output: string;
  premises: ReasoningPremise[];
  confidence: ReasoningConfidence;
  confidenceScore: number;
  contradictions: string[];
  ambiguities: string[];
  citations: string[];
  evidenceRefs: string[];
  durationMs: number;
  replayKey: string;
  createdAt: string;
}

export interface ReasoningTrace {
  id: string;
  organizationId: number;
  sessionId: string;
  stages: ReasoningStage[];
  finalConclusion: string;
  overallConfidence: number;
  contradictionsFound: number;
  ambiguitiesFound: number;
  citationCount: number;
  replayKey: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

function scoreToConfidence(score: number): ReasoningConfidence {
  if (score >= 0.9) return "certain";
  if (score >= 0.7) return "probable";
  if (score >= 0.5) return "possible";
  if (score >= 0.3) return "uncertain";
  return "unknown";
}

// ─── Core functions ───────────────────────────────────────────────────────────

export function createReasoningStage(params: {
  organizationId: number;
  stageType: ReasoningStageType;
  input: string;
  output: string;
  premises?: ReasoningPremise[];
  confidenceScore?: number;
  citations?: string[];
  evidenceRefs?: string[];
  durationMs?: number;
}): ReasoningStage {
  const now = new Date().toISOString();
  const confidenceScore = params.confidenceScore ?? 0;
  const replayKey = sha256(`${params.organizationId}${params.stageType}${params.input}`);

  // Build a partial stage so detectContradictions and detectAmbiguities can work
  const partialStage: ReasoningStage = {
    id:              genId(replayKey),
    organizationId:  params.organizationId,
    stageType:       params.stageType,
    input:           params.input,
    output:          params.output,
    premises:        params.premises ?? [],
    confidence:      scoreToConfidence(confidenceScore),
    confidenceScore,
    contradictions:  [],
    ambiguities:     [],
    citations:       params.citations ?? [],
    evidenceRefs:    params.evidenceRefs ?? [],
    durationMs:      params.durationMs ?? 0,
    replayKey,
    createdAt:       now,
  };

  return {
    ...partialStage,
    contradictions: detectContradictions([partialStage]),
    ambiguities:    detectAmbiguities(partialStage),
  };
}

export function createReasoningTrace(
  organizationId: number,
  sessionId: string,
  stages: ReasoningStage[],
): ReasoningTrace {
  const now = new Date().toISOString();

  // replayKey = sha256(sessionId + sorted stage replayKeys)
  const sortedReplayKeys = [...stages.map(s => s.replayKey)].sort().join("");
  const replayKey = sha256(`${sessionId}${sortedReplayKeys}`);

  // Overall confidence: weighted average — later stages have higher weight
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < stages.length; i++) {
    const weight = i + 1; // weight increases with position
    weightedSum += stages[i].confidenceScore * weight;
    totalWeight += weight;
  }
  const overallConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const contradictionsFound = stages.reduce((sum, s) => sum + s.contradictions.length, 0);
  const ambiguitiesFound = stages.reduce((sum, s) => sum + s.ambiguities.length, 0);
  const citationCount = stages.reduce((sum, s) => sum + s.citations.length, 0);

  const finalConclusion = stages.length > 0 ? (stages[stages.length - 1].output) : "";

  return {
    id:                  genId(replayKey),
    organizationId,
    sessionId,
    stages,
    finalConclusion,
    overallConfidence,
    contradictionsFound,
    ambiguitiesFound,
    citationCount,
    replayKey,
    createdAt:           now,
  };
}

export function detectContradictions(stages: ReasoningStage[]): string[] {
  const contradictions: string[] = [];

  for (let i = 0; i < stages.length; i++) {
    for (let j = i + 1; j < stages.length; j++) {
      const outputA = stages[i].output.toLowerCase();
      const outputB = stages[j].output.toLowerCase();

      const tokensA = outputA.split(/\s+/).filter(t => t.length > 0);
      const tokensB = outputB.split(/\s+/).filter(t => t.length > 0);

      // Find negation patterns: "não" + word in stage A that also appears in stage B
      for (let k = 0; k < tokensA.length - 1; k++) {
        if (tokensA[k] === "não") {
          const nextWord = tokensA[k + 1];
          if (nextWord && tokensB.includes(nextWord)) {
            contradictions.push(
              `Possível contradição entre stage '${stages[i].id}' e stage '${stages[j].id}': ` +
              `stage ${i} nega '${nextWord}' mas stage ${j} afirma o termo`,
            );
          }
        }
      }

      // Also check inverse: "não" in B negates word from A
      for (let k = 0; k < tokensB.length - 1; k++) {
        if (tokensB[k] === "não") {
          const nextWord = tokensB[k + 1];
          if (nextWord && tokensA.includes(nextWord)) {
            contradictions.push(
              `Possível contradição entre stage '${stages[j].id}' e stage '${stages[i].id}': ` +
              `stage ${j} nega '${nextWord}' mas stage ${i} afirma o termo`,
            );
          }
        }
      }
    }
  }

  return contradictions;
}

export function detectAmbiguities(stage: ReasoningStage): string[] {
  const ambiguousWords = ["pode", "talvez", "possivelmente", "eventual", "provável", "incerto"];
  const ambiguities: string[] = [];

  const sentences = stage.output.split(/[.!?;]/);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase().trim();
    if (lower.length === 0) continue;

    for (const word of ambiguousWords) {
      if (lower.includes(word)) {
        ambiguities.push(sentence.trim());
        break; // one entry per sentence even if multiple ambiguous words
      }
    }
  }

  return ambiguities;
}

export function propagateConfidence(stages: ReasoningStage[]): ReasoningStage[] {
  if (stages.length === 0) return [];

  const result: ReasoningStage[] = [stages[0]];

  for (let i = 1; i < stages.length; i++) {
    const prev = result[i - 1];
    const current = stages[i];
    // confidence decay: current * prev * 0.9 blended with direct score
    const decayed = current.confidenceScore * prev.confidenceScore * 0.9;
    const newScore = Math.min(current.confidenceScore, decayed + current.confidenceScore * 0.1);
    result.push({
      ...current,
      confidenceScore: parseFloat(newScore.toFixed(4)),
      confidence:      scoreToConfidence(newScore),
    });
  }

  return result;
}

export function buildExplainabilityTree(trace: ReasoningTrace): Record<string, unknown> {
  return {
    traceId:           trace.id,
    organizationId:    trace.organizationId,
    sessionId:         trace.sessionId,
    overallConfidence: trace.overallConfidence,
    finalConclusion:   trace.finalConclusion,
    metrics: {
      contradictionsFound: trace.contradictionsFound,
      ambiguitiesFound:    trace.ambiguitiesFound,
      citationCount:       trace.citationCount,
      stageCount:          trace.stages.length,
    },
    stages: trace.stages.map((stage, index) => ({
      index,
      id:              stage.id,
      stageType:       stage.stageType,
      confidence:      stage.confidence,
      confidenceScore: stage.confidenceScore,
      input:           stage.input,
      output:          stage.output,
      premises:        stage.premises.map(p => ({
        id:         p.id,
        content:    p.content,
        sourceRef:  p.sourceRef,
        confidence: p.confidence,
        legalBasis: p.legalBasis,
      })),
      evidence:        stage.evidenceRefs,
      citations:       stage.citations,
      contradictions:  stage.contradictions,
      ambiguities:     stage.ambiguities,
      durationMs:      stage.durationMs,
    })),
    createdAt: trace.createdAt,
  };
}

export function formatReasoningForHuman(trace: ReasoningTrace): string {
  const lines: string[] = [];

  lines.push(`# Raciocínio — Sessão \`${trace.sessionId}\``);
  lines.push("");
  lines.push(`**Confiança geral:** ${(trace.overallConfidence * 100).toFixed(1)}%`);
  lines.push(`**Etapas:** ${trace.stages.length}`);
  lines.push(`**Contradições detectadas:** ${trace.contradictionsFound}`);
  lines.push(`**Ambiguidades:** ${trace.ambiguitiesFound}`);
  lines.push(`**Citações:** ${trace.citationCount}`);
  lines.push("");

  for (let i = 0; i < trace.stages.length; i++) {
    const stage = trace.stages[i];
    lines.push(`## Etapa ${i + 1}: ${stage.stageType}`);
    lines.push("");
    lines.push(`**Confiança:** ${stage.confidence} (${(stage.confidenceScore * 100).toFixed(1)}%)`);
    lines.push(`**Duração:** ${stage.durationMs}ms`);
    lines.push("");
    lines.push("**Entrada:**");
    lines.push(`> ${stage.input}`);
    lines.push("");
    lines.push("**Saída:**");
    lines.push(`> ${stage.output}`);
    lines.push("");

    if (stage.premises.length > 0) {
      lines.push("**Premissas:**");
      for (const premise of stage.premises) {
        lines.push(`- ${premise.content} *(confiança: ${(premise.confidence * 100).toFixed(0)}%)*`);
        if (premise.legalBasis) lines.push(`  - Base legal: ${premise.legalBasis}`);
      }
      lines.push("");
    }

    if (stage.citations.length > 0) {
      lines.push("**Citações:**");
      for (const citation of stage.citations) {
        lines.push(`- ${citation}`);
      }
      lines.push("");
    }

    if (stage.evidenceRefs.length > 0) {
      lines.push("**Evidências:**");
      for (const ev of stage.evidenceRefs) {
        lines.push(`- ${ev}`);
      }
      lines.push("");
    }

    if (stage.contradictions.length > 0) {
      lines.push("**Contradições:**");
      for (const c of stage.contradictions) {
        lines.push(`- [!] ${c}`);
      }
      lines.push("");
    }

    if (stage.ambiguities.length > 0) {
      lines.push("**Ambiguidades:**");
      for (const a of stage.ambiguities) {
        lines.push(`- [?] *${a}*`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("## Conclusão Final");
  lines.push("");
  lines.push(trace.finalConclusion);
  lines.push("");

  return lines.join("\n");
}
