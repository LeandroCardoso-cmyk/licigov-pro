# Provider Observability — Sprint 4.5

## Recorded Metrics
- **Latency**: Per-execution latency in ms, per provider+model
- **Token Usage**: Prompt and completion tokens per call
- **Errors**: Error messages and correlation IDs
- **Fallbacks**: From/to provider transitions

## Health Scoring
```
healthScore = max(0, 1 - errorRate - fallbackRate * 0.5)
```

## Execution Lineage
`getExecutionLineage(orgId, correlationId)` returns all observability records for a correlation ID across latency, token, error, and fallback records.

## Metrics Aggregation
`getProviderMetrics(orgId)` returns:
- `totalRequests`: Total latency records
- `totalErrors`: Total error records
- `totalFallbacks`: Total fallback events
- `avgLatencyMs`: Average latency across all requests

## Reliability Score
`computeReliabilityScore(orgId, providerId)` returns the health score (0-1) for a given provider.
