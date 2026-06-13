# Provider Failover — Sprint 4.5

## Circuit Breaker Pattern
Three states:
- `closed`: Normal operation
- `open`: Provider unavailable, all requests rejected
- `half_open`: Testing recovery, limited requests allowed

## Failover Trigger
`triggerFailover(orgId, failedProviderId, reason)`:
1. Opens circuit breaker on failed provider
2. Updates health status to `unavailable`
3. Builds fallback chain excluding failed provider
4. Returns next available provider
5. Records failover event for audit

## Degraded Mode
`enterDegradedMode(orgId)` registers the mock provider as last resort, ensuring the system never fully fails.

## Recovery
`exitDegradedMode(orgId)` removes the org from degraded state when primary providers recover.

## Failover Chain Priority
openai → claude → gemini → mock (by default priority)
