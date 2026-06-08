# Legal Reasoning Engine

## Overview
The legal reasoning engine performs multi-step syllogistic inference over Brazilian public procurement law (Lei 14.133/2021, Lei 8.666/1993, Lei 10.520/2002).

## Core Concepts
- **Premise**: a legal fact or norm asserted as true for the current context
- **Inference**: a conclusion derived from one or more premises via a named rule
- **Trace**: full record of premises → inferences → recommendations for auditability

## Key Functions
| Function | Purpose |
|---|---|
| `createExtendedLegalReasoningTrace` | Opens a new reasoning session for a document |
| `createLegalPremise` | Registers a factual or normative premise |
| `createExtendedLegalInference` | Derives a legal conclusion from premises |
| `detectPremiseContradictions` | Finds conflicting assertions in the premise set |
| `assessExtendedComplianceScore` | Aggregates compliance signals into a 0-1 score |
| `buildExtendedReasoningExplainability` | Produces a human-readable explanation chain |

## Storage
Table: `legal_reasoning_traces`, `legal_inferences` — see drizzle/0146 and 0147.
