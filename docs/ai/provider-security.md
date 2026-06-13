# Provider Security — Sprint 4.5

## Tenant Isolation
- All operations require `organizationId`
- In-memory registries keyed by `organizationId`
- No cross-tenant provider access
- Replay snapshots validated against org ownership

## Policy Enforcement
Before any execution:
1. Check `allowedProviders` whitelist
2. Check `blockedModels` blocklist
3. Validate token and cost limits
4. Verify capability permissions
5. Require approval if threshold exceeded

## Circuit Breaker
Prevents cascading failures by automatically isolating unhealthy providers. The `open` state blocks all requests until recovery.

## Deterministic IDs
All entity IDs are derived from `sha256` of deterministic inputs — no random IDs that could be guessed or enumerated.

## Audit Trail
- All failover events recorded with timestamp
- Execution history maintained per org
- Policy violations logged in enforcement results
- Replay snapshots provide immutable execution records
