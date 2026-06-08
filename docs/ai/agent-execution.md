# Agent Execution Engine

## Overview

The Agent Execution Engine runs multi-stage pipelines for AI agents. Every execution is deterministic, multi-tenant, and replay-safe.

## Key concepts

- **AgentExecution**: the top-level aggregate representing one run.
- **ExecutionStage**: each named step within an execution.
- **ExecutionCheckpoint**: saved snapshot after a stage completes.
- **replayKey**: SHA-256 of `{organizationId, sessionId, agentType, sortedStageNames}` — same input always produces the same key.

## Stage lifecycle

```
pending → running → completed | failed
```

Blocked safety checks transition the stage directly to `failed` and halt the pipeline.

## Services

| Service | File |
|---------|------|
| Engine | `server/services/agentExecutionEngine.ts` |
| Planning | `server/services/agentPlanningService.ts` |
| Simulation | `server/services/taskSimulationService.ts` |

## Replay

Call `replayExecution(original)` to re-run with the same inputs. The `replayKey` field on the output confirms determinism.

## Multi-tenancy

All stores are keyed by `organizationId`. History queries never cross tenant boundaries.
