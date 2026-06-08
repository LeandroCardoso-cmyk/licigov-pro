# Structured Generation

## Overview
Wraps LLM calls to produce validated, schema-conformant JSON outputs for all AI services in LiciGov Pro, preventing hallucinated fields and enforcing output contracts.

## Core Concepts
- **OutputSchema**: Zod schema describing the required LLM response shape
- **GenerationResult**: typed wrapper containing parsed output, token usage, and latency
- **RetryPolicy**: configurable retry with backoff when parsing or validation fails

## Key Patterns
| Pattern | Description |
|---|---|
| Schema-first | Define Zod schema before prompting; inject schema description into system prompt |
| Parse-and-validate | Parse LLM JSON response, then validate against schema |
| Fallback | On repeated failure, return a safe default and flag for human review |

## Integration Points
- Used by `legalReasoningEngine` to produce structured inferences
- Used by `documentDraftingEngine` for clause generation
- Used by `clauseRecommendationService` for ranked recommendations
- Used by `jurisprudenceCorrelationService` for reference extraction

## Observability
All structured generation calls are recorded in `drafting_observability` with latency, scores, and variable counts — see drizzle/0158.
