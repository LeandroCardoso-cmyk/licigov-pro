# Provider Governance — Sprint 4.5

## Policy System
Policies define constraints per organization:
- `allowedProviders`: Whitelist of provider types
- `blockedModels`: Blocklist of specific models
- `maxTokensPerExecution`: Token cap per call
- `maxCostPerExecution`: Cost cap per call
- `dailyCostLimit`: Daily spending limit
- `approvalThreshold`: Cost threshold requiring human approval
- `requiresHumanApproval`: Force approval for all executions
- `restrictedCapabilities`: Blocked capability types

## Enforcement
`enforcePolicy()` validates against all active policies and returns:
```json
{ "allowed": true/false, "violations": [], "requiresApproval": false }
```

## Approval Flow
When `requiresApproval` is true, execution must be reviewed before proceeding.

## Quota Management
Daily and monthly quota limits prevent runaway costs. `checkQuota()` returns remaining budget.
