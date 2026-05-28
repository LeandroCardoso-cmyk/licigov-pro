# Semantic Engine — Pipeline Stages, Scoring Weights & Replay-Safety

## Overview

The LiciGov Pro semantic engine is a 9-stage pipeline that transforms raw imported item
descriptions into ranked, explainable, and auditable semantic candidates. Each stage is
isolated, idempotent, and contributes to a deterministic consensus score.

## Pipeline Stages

| Stage | Name | Description |
|-------|------|-------------|
| 1 | `candidate_retrieval` | Search global in-memory semantic index with minScore=0.30, topK=5 |
| 2 | `lexical_scoring` | Token intersection ratio (Jaccard similarity) between query and entry |
| 3 | `semantic_scoring` | `scoreAgainstEntry` using exact/alias/token/prefix/fuzzy strategies |
| 4 | `parser_influence` | Load `descriptionConfidence` from `parserCapabilityRegistry` |
| 5 | `normalization_influence` | 1.0 if canonicalUnit is present, 0.5 if absent |
| 6 | `confidence_blending` | Weighted blend using DEFAULT_WEIGHTS |
| 7 | `consensus_generation` | `buildConsensus()` — deterministic winner selection |
| 8 | `explainability_generation` | `buildExplainability()` for every candidate |
| 9 | `review_preparation` | Determine if human review is required |

**Note:** All 9 stages always execute — `skipSemanticStage` is NOT available in this engine.

## Scoring Weights (DEFAULT_WEIGHTS)

```typescript
const DEFAULT_WEIGHTS = {
  lexical:       0.30,  // 30% — token intersection ratio
  semantic:      0.35,  // 35% — semantic index score
  normalization: 0.20,  // 20% — unit normalization boost/penalty
  parser:        0.15,  // 15% — parser capability confidence
};
```

Weights must sum to 1.0. The `normalizeWeights()` function enforces this automatically.

## Blended Score Formula

```
blendedScore = lexicalScore * w.lexical
             + semanticScore * w.semantic
             + normalizationScore * w.normalization
             + parserConfidence * w.parser
```

Where:
- `lexicalScore = baseScore * (1 + tokenMatchBonus)` (bonus = Jaccard ratio)
- `semanticScore = candidate.score` directly from index
- `normalizationScore = score + 0.10 if canonicalUnit present, else score - 0.05`
- `parserConfidence = parserCapabilityRegistry.get(parserType).descriptionConfidence`

## Replay-Safety

The engine guarantees: **same inputs → same blended scores → same winner**.

- `createdAt` is the ONLY non-deterministic field (wall clock)
- `nanoid()` for `id` fields does NOT affect scoring
- Tiebreak order: blendedScore DESC → SOURCE_PRIORITY ASC → candidate.id ASC (lexicographic)
- `replayKey = sha256(JSON.stringify(sortedInputFields))` — unique per input combination

## Review Threshold

A review is required when:
- `consensusScore < 0.85`, OR
- `candidates.length === 0`

## Source Priority (for deterministic tiebreak)

```
exact_match=0, alias_match=1, catmat_lookup=2, rule_based=3,
prefix_match=4, token_match=5, ngram_match=6, fuzzy_match=7
```
