# Execution Replay

## Overview

Every agent execution produces a `replayKey` — a SHA-256 hash of the deterministic inputs. Replaying an execution with the same key always produces the same simulated outputs.

## replayKey computation

```ts
replayKey = sha256(JSON.stringify({
  organizationId,
  sessionId,
  agentType,
  stageNames: stageNames.sort(),
}))
```

## Replay API

```ts
import { replayExecution, getExecutionHistory } from "../services/agentExecutionEngine";

const history = getExecutionHistory(orgId, sessionId);
const last = history[history.length - 1];
const replayed = replayExecution(last);
```

## Guarantees

1. Same `replayKey` → same simulated stage outputs (deterministic hash per stage).
2. Safety checks run again on replay — a replay of a blocked execution is also blocked.
3. Checkpoints are regenerated; history is accumulated (not overwritten).

## Domain functions

- `isExecutionReplayable(execution)`: returns `true` if the execution can be replayed.
- `createExecutionReplay(execution, triggerStage)`: creates an `ExecutionReplay` aggregate.

## Use cases

- Audit: verify that a past execution would produce the same result today.
- Debugging: reproduce a failed execution without side effects.
- Compliance: demonstrate deterministic behaviour to auditors.
