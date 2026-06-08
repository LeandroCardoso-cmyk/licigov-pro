# Clause Intelligence

## Overview
Recommends, scores, and conflict-checks individual contractual clauses based on document type, risk profile, and legal context.

## Core Concepts
- **ClauseRecommendation**: a suggested clause with relevance score and legal justification
- **ClauseConflict**: detected incompatibility between two clauses in the same document
- **ClauseHierarchy**: parent-child structure grouping clauses by section and sub-section

## Key Functions
| Function | Purpose |
|---|---|
| `checkClauseCompatibility` | Determines whether two clauses can coexist |
| `buildClauseHierarchy` | Organises clauses into a tree structure |
| `analyzeClauseRisk` | Computes a risk score (0-1) for a single clause |
| `buildClauseConflictMap` | Returns all conflicting clause pairs in a document |

## Recommendation Pipeline
1. Context extraction from the draft
2. Similarity search over clause library
3. Compatibility check against already-accepted clauses
4. Risk scoring and ranking

## Storage
Tables: `clause_recommendations`, `clause_conflicts` — see drizzle/0154 and 0155.
