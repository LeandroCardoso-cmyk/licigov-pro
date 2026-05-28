# Review Workflow — 9 Operations, Actor Types & Immutability Rules

## Overview

The review workflow is built around the `ReviewContract` aggregate — an append-only record
of all decisions made for a staging item. No decision can ever be modified or deleted.
This ensures full auditability for compliance with Lei 14.133/2021.

## ReviewContract Lifecycle

```
createContract() → addDecision()* → finalizeContract()
                 (append-only)       (sets isFinalized=true)
```

Once a contract is finalized, no new decisions can be added (throws an error).

## 9 Review Operations

| Operation | Description | Required Fields |
|-----------|-------------|-----------------|
| `compare_candidates` | Side-by-side comparison of candidates | candidateIds (evidenceRefs) |
| `approve_candidate` | Accept a specific candidate | candidateId |
| `reject_candidate` | Reject a specific candidate | candidateId |
| `override_candidate` | Replace candidate with manual values | overrideValue |
| `request_manual_entry` | Request full manual data entry | justification |
| `request_new_search` | Trigger a new semantic search | justification |
| `attach_evidence` | Attach evidence references | evidenceRefs |
| `justify_decision` | Add standalone justification | justification |
| `escalate_review` | Forward to higher-level reviewer | escalateTo (userId) |

## Actor Types

| Type | Description | Restrictions |
|------|-------------|--------------|
| `human` | Human reviewer via UI | Can approve, reject, override, escalate |
| `ai_assist` | AI-assisted suggestion | Can suggest, compare; cannot finalize |
| `system` | Automated system | Cannot approve or correct; can normalize |

## Justification Requirements

All decisions require a justification string:
- Minimum 5 characters after trimming whitespace
- Cannot be empty or whitespace-only
- Validated by `validateJustification()` before acceptance

## Immutability Rules

1. `decisions` array is append-only — no deletion or modification
2. `finalizeContract()` sets `isFinalized = true` permanently
3. Any attempt to `addDecision()` on a finalized contract throws an error
4. `createdAt` of each decision is wall-clock at creation time (not modifiable)

## Contract Finalization

`finalizeContract(contract, actor, justification)`:
- Validates justification (min 5 chars)
- Appends a `justify_decision` operation as the final decision
- Sets `isFinalized = true` and `finalizedAt` to current timestamp
- Returns NEW contract (original remains unchanged — immutable pattern)

## Query Helpers

- `getLastDecision(contract)` — last decision in the append-only log
- `getDecisionsByOperation(contract, op)` — filter by operation type
- `hasOperation(contract, op)` — boolean check if operation was ever used

## Multi-Tenancy

Every `ReviewDecision` carries `organizationId` — enforced at creation.
`ReviewContract` also carries `organizationId` from `createContract()`.
