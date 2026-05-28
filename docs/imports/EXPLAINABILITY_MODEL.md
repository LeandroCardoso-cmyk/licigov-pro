# Explainability Model — Evidence Chain, Juridical Rationale & PT-BR Focus

## Principles

Every semantic candidate must carry a complete explainability record. This enables:
1. Human reviewers to understand why a candidate was suggested
2. Auditors to verify that matching decisions follow documented criteria
3. Legal contestation support under Lei 14.133/2021 (transparency principle)

## CandidateExplainability Structure

| Field | Purpose |
|-------|---------|
| `whySuggested` | Human-readable reason why the candidate was generated |
| `whyRanked` | Explanation of the candidate's position in the ranking |
| `whyRejected` | Why this candidate lost (null if rank=1 / not rejected) |
| `influencingTokens` | Tokens from the query that matched the candidate |
| `aliasesUsed` | Aliases that contributed to alias_match source |
| `parserInfluence` | Parser type, confidence contribution, notes |
| `normalizationInfluence` | Unit match details from extraction evidence chain |
| `semanticInfluence` | Index score, match strategy, top tokens |
| `rankingRationale` | Sentence explaining rank position |
| `consensusRationale` | Why this candidate won/lost in consensus (null if no consensus) |
| `confidenceRationale` | Score level with actionable guidance |

## Evidence Chain Integration

`buildExplainability()` reads from `ExtractionEvidence.chain` to populate:
- `normalizationInfluence.unitMatch` — from `unit_normalization` entries
- `normalizationInfluence.quantityParsed` — from `quantity_parse` entries
- `normalizationInfluence.unitSource` — from `EvidenceEntry.ruleCode`

This connects every explainability record to the immutable evidence chain,
ensuring end-to-end traceability from raw file to final decision.

## Confidence Levels (PT-BR)

| Level | Score | Guidance |
|-------|-------|---------|
| Alta | ≥ 0.85 | Campo claramente estruturado, revisão opcional |
| Média | 0.60 – 0.84 | Campo reconhecível mas ambíguo, revisão recomendada |
| Baixa | 0.35 – 0.59 | Campo com incerteza significativa, revisão obrigatória |
| Incerta | < 0.35 | Campo não confiável, revisão obrigatória |

## Parser Influence

The `parserInfluence` block documents how the parser type affects confidence:
- XLSX parsers: `descriptionConfidence=0.78` (merged cells can cause misalignment)
- CSV parsers: `descriptionConfidence=0.72` (no structure, pure text)
- Unknown parsers: default `confidenceContribution=0.5`

## Juridical Rationale

Every `formatForHuman()` output is designed to be intelligible to a non-technical
legal auditor. The output is markdown-formatted and includes:
- Source of the suggestion (Portuguese description)
- Position in ranking with exact score
- Whether the unit was normalized
- Whether the item requires mandatory review

## compareExplainabilities()

Used for side-by-side analysis of two candidates:
- Produces a markdown diff table
- Shows score difference, strategy difference, unit match difference
- Designed for use in `compare_candidates` ReviewOperation
