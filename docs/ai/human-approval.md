# Human Approval Workflow

## Overview

High-risk or critical agent actions require human approval before proceeding. The approval workflow is immutable: decisions are appended to an ever-growing chain and never mutated.

## Workflow states

```
pending → approved | rejected | escalated | delegated | expired | overridden
```

## Decision chain

Each `recordApprovalDecision` call returns a **new** workflow object with the decision appended. The original object is never modified.

Status resolution rules:
- Any `reject` decision → `rejected`
- All required approvers have `approve` decisions → `approved`
- Otherwise → `pending`

## Operations

| Operation | Function |
|-----------|----------|
| Record decision | `recordApprovalDecision` |
| Escalate | `escalateWorkflow` |
| Delegate | `delegateWorkflow` |
| Emergency override | `overrideWorkflow` |
| Check expiry | `isWorkflowExpired` |

## Service

`server/services/humanApprovalService.ts` — `createApprovalRequest`, `recordDecision`, `escalateApproval`, `delegateApproval`, `getApprovalHistory`, `getPendingApprovals`.

## Multi-tenancy

All approval workflows are scoped to `organizationId`. `getPendingApprovals(orgId)` returns only pending workflows for that tenant.
