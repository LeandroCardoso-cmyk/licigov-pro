# Action Safety Classification

## Overview

Every agent action is classified deterministically before execution. The safety level determines whether the action proceeds automatically, requires approval, or is blocked entirely.

## Safety levels

| Level | Description | Requires Approval | Auto-proceed |
|-------|-------------|-------------------|--------------|
| `safe` | No risk | No | Yes |
| `low_risk` | Minor risk | No | Yes |
| `medium_risk` | Moderate risk | No | Yes (with logging) |
| `high_risk` | Significant risk | Yes | No |
| `critical` | Severe risk | Yes | No |
| `blocked` | Never allowed | Yes | No |

## Blocked actions

The following action types are permanently blocked regardless of confidence score:

`delete_all`, `drop_table`, `mass_update`, `mass_delete`, `truncate_table`, `drop_database`, `irreversible_publish`, `external_api_write`, `send_mass_notification`

## Hallucination risk assessment

`assessHallucinationRisk` examines the action input text for indicators such as:
- Monetary values (`R$`, `valor`)
- Absolute language ("definitivamente", "certamente", "sempre")
- Large date ranges
- Unknown legal references
- Excessively long inputs

## Domain functions

`server/domain/actionSafety.ts`:
- `classifyAction(orgId, actionType, input)` → `ActionClassification`
- `performSafetyCheck(orgId, actionType, executionId, confidenceScore)` → `SafetyCheck`
- `assessHallucinationRisk(orgId, executionId, inputText, context)` → `HallucinationRisk`
- `isActionBlocked(classification)` → `boolean`
- `requiresHumanApproval(classification)` → `boolean`
