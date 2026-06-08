# Rollback Engine

## Overview

The rollback engine generates and validates rollback plans for reversible agent actions. Irreversible or blocked actions cannot have rollback plans.

## RollbackPlan

| Field | Description |
|-------|-------------|
| `steps` | Ordered rollback steps |
| `canAutoRollback` | Whether rollback can proceed without human confirmation |
| `requiresHumanConfirmation` | Whether a human must approve the rollback |
| `estimatedDurationMs` | Estimated time for rollback |

## RollbackStrategy by safety level

| Safety level | Strategy |
|--------------|----------|
| `safe` | `none` |
| `low_risk` | `checkpoint` |
| `medium_risk` | `checkpoint` |
| `high_risk` | `full_rollback` |
| `critical` | `manual` |
| `blocked` | `none` (cannot rollback) |

## Validation

`validateRollbackPlan(plan)` returns `{ valid: boolean; issues: string[] }`. Plans with no steps for reversible actions are considered invalid.

## Domain functions

`server/domain/actionSafety.ts`:
- `buildRollbackPlan(orgId, executionId, classification, checkpoints)`
- `validateRollbackPlan(plan)`

## Router endpoint

`agentExecution.rollbackExecution` — marks an execution as rolled back; the actual rollback steps are returned for the caller to execute.
