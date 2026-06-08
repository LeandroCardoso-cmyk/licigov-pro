# Autonomous Workflows

## Overview

Autonomous workflows execute a sequence of named steps with automatic safety classification. Steps that require human approval are paused; blocked steps halt the workflow immediately.

## Workflow lifecycle

```
created → running → completed | failed | awaiting_approval
```

## AutonomousStage

Each stage has a `safetyLevel` and `requiresApproval` flag. Stages are added to any workflow object via `addAutonomousStageToWorkflow`.

## Safety integration

Before each step executes, `classifyAction` determines the safety level:

| Level | Behaviour |
|-------|-----------|
| `safe` / `low_risk` | Proceed automatically |
| `medium_risk` | Proceed with logging |
| `high_risk` | Pause, notify approvers |
| `critical` / `blocked` | Halt workflow |

## Service

`server/services/autonomousWorkflowService.ts` — `runAutonomousWorkflow`, `getWorkflowHistory`.

## Domain extension

`server/domain/aiWorkflow.ts` exports `createAutonomousStage` and `addAutonomousStageToWorkflow` to attach stages to any existing workflow aggregate.
