import { createHash } from "crypto";
import type { ContextFragment, ContextPriority } from "../domain/contextAssembly";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextRankInput {
  organizationId: number;
  fragments: ContextFragment[];
  workflowStage: string;
  role: string;
  legalWeight: number;
  recencyWeight: number;
  confidenceWeight: number;
}

export interface RankedFragment {
  fragment: ContextFragment;
  rankScore: number;
  rankPosition: number;
  scoreBreakdown: {
    priorityScore: number;
    relevanceScore: number;
    legalScore: number;
    recencyScore: number;
    confidenceScore: number;
  };
  replayKey: string;
}

export interface ContextRankResult {
  organizationId: number;
  rankedFragments: RankedFragment[];
  totalFragments: number;
  processingMs: number;
  replayKey: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const PRIORITY_SCORES: Record<ContextPriority, number> = {
  critical:   1.0,
  high:       0.8,
  medium:     0.6,
  low:        0.4,
  background: 0.2,
};

// ─── Service functions ────────────────────────────────────────────────────────

export function computeRecencyScore(temporalContext: string, now: string): number {
  const fragmentTime = new Date(temporalContext).getTime();
  const nowTime = new Date(now).getTime();

  if (isNaN(fragmentTime) || isNaN(nowTime)) return 0.2;

  const diffMs = nowTime - fragmentTime;
  const ONE_HOUR  = 60 * 60 * 1000;
  const ONE_DAY   = 24 * ONE_HOUR;
  const SEVEN_DAY = 7 * ONE_DAY;
  const THIRTY_DAY = 30 * ONE_DAY;

  if (diffMs < ONE_HOUR)   return 1.0;
  if (diffMs < ONE_DAY)    return 0.8;
  if (diffMs < SEVEN_DAY)  return 0.6;
  if (diffMs < THIRTY_DAY) return 0.4;
  return 0.2;
}

export function computeLegalScore(fragment: ContextFragment): number {
  if (fragment.legalBasis !== null && fragment.legalBasis !== undefined) return 1.0;
  if (fragment.source === "legal") return 0.8;
  return 0.3;
}

export function rankFragments(input: ContextRankInput): ContextRankResult {
  const {
    organizationId,
    fragments,
    legalWeight,
    recencyWeight,
    confidenceWeight,
  } = input;

  const start = Date.now();
  const now = new Date().toISOString();

  const scored = fragments.map((fragment) => {
    const priorityScore  = PRIORITY_SCORES[fragment.priority] ?? 0.2;
    const relevanceScore = fragment.relevanceScore;
    const legalScore     = computeLegalScore(fragment);
    const recencyScore   = computeRecencyScore(fragment.temporalContext, now);
    const confidenceScore = fragment.confidence;

    const rankScore =
      priorityScore   * 0.30 +
      relevanceScore  * 0.25 +
      legalScore      * legalWeight +
      recencyScore    * recencyWeight +
      confidenceScore * confidenceWeight;

    return {
      fragment,
      rankScore,
      scoreBreakdown: {
        priorityScore,
        relevanceScore,
        legalScore,
        recencyScore,
        confidenceScore,
      },
    };
  });

  // Sort descending by rankScore, then by fragment.id for determinism
  scored.sort((a, b) => {
    const diff = b.rankScore - a.rankScore;
    if (diff !== 0) return diff;
    return a.fragment.id.localeCompare(b.fragment.id);
  });

  const sortedFragmentIds = [...fragments.map(f => f.id)].sort().join(",");
  const weightsStr = `${legalWeight}:${recencyWeight}:${confidenceWeight}`;
  const replayKey = sha256(`${sortedFragmentIds}${weightsStr}`);

  const rankedFragments: RankedFragment[] = scored.map((item, index) => ({
    fragment:       item.fragment,
    rankScore:      item.rankScore,
    rankPosition:   index + 1,
    scoreBreakdown: item.scoreBreakdown,
    replayKey:      sha256(`${item.fragment.id}${replayKey}`),
  }));

  const processingMs = Date.now() - start;

  return {
    organizationId,
    rankedFragments,
    totalFragments: fragments.length,
    processingMs,
    replayKey,
  };
}
