# Agent Observability

## Overview

Observability for the AI Execution Engine is structured-log-only (no database writes in this sprint). All traces and metrics are written to `console.info` as JSON and stored in-memory per tenant.

## Traces

`ExecutionObservabilityTrace` captures:
- `correlationId`: unique per execution
- `stageBreakdown`: per-stage duration in ms
- `totalMs`: wall time
- `candidateCount`, `consensusScore`, `requiresReview`
- `parserType`, `organizationId`

## Metrics

`ExecutionObservabilityMetric` captures a named metric with:
- `name`, `value`, `unit` (`ms | count | percent | ratio`)
- `tags` for filtering
- `organizationId`

## Helper functions

| Function | Metric name |
|----------|-------------|
| `executionLatency` | `execution_latency` |
| `approvalLatency` | `approval_latency` |
| `rollbackFrequency` | `rollback_frequency` |
| `safetyBlockRate` | `safety_block_rate` |
| `hallucinationRiskLevel` | `hallucination_risk_level` |
| `orchestrationDepth` | `orchestration_depth` |

## Health computation

`computeExecutionHealth(orgId)` aggregates traces and metrics to produce:
- `healthScore`: 0–1 (1 = fully healthy)
- `status`: `healthy | degraded | critical`
- `alerts`: list of active alert messages

## Service

`server/services/executionObservabilityService.ts`
