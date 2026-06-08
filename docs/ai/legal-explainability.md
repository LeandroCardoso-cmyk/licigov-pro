# Legal Explainability

## Overview
Makes every AI decision in LiciGov Pro auditable by producing natural-language explanations, premise chains, and confidence breakdowns that procurement officers can review and challenge.

## Core Concepts
- **ExplainabilityChain**: ordered list of reasoning steps from input context to final conclusion
- **ConfidenceBreakdown**: per-step confidence scores with contributing factors
- **AuditTrail**: immutable record linking a decision to its trace, inferences, and evidence

## Key Functions
| Function | Purpose |
|---|---|
| `buildExtendedReasoningExplainability` | Generates a natural-language explanation from a trace |
| `prioritizeExtendedRisks` | Orders legal risks by severity with justification |
| `assessExtendedComplianceScore` | Provides score with per-rule contribution breakdown |

## Explanation Levels
- **Summary**: one-paragraph overview for non-technical users
- **Detailed**: step-by-step premise → inference chain
- **Full audit**: all premises, inferences, scores, and referenced law articles

## Regulatory Alignment
Explainability output is designed to satisfy LGPD Art. 20 (automated decision transparency) and TCU guidance on AI use in public procurement.
