# AI Copilots

## Overview

Copilots are role-specific assistant profiles that expose a curated set of capabilities for a given document context.

## Roles

| Role | Focus |
|------|-------|
| `legal_copilot` | Legal analysis and compliance |
| `drafting_copilot` | Document drafting |
| `review_copilot` | Document review |
| `compliance_copilot` | Regulatory compliance |
| `import_copilot` | Import and catalog operations |
| `procurement_copilot` | Procurement processes |
| `general_assistant` | General purpose |

## Profiles

`getDefaultProfile(organizationId, role)` returns a deterministic, pre-defined profile for each role. No database calls; results are constant for the same inputs.

## Capabilities

Each capability has:
- `type`: one of `analyze | draft | review | validate | recommend | explain | search | summarize | compare | classify`
- `confidence`: 0–1 score
- `allowedDocumentTypes`: filter for relevant document types

## Context assembly

`assembleCopilotContext` filters active capabilities by document type and checks restrictions before returning the context summary.

## Service

`server/services/copilotContextService.ts`
