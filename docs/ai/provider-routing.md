# Provider Routing — Sprint 4.5

## Routing Strategies
- `lowest_latency`: Select provider with highest `latencyScore`
- `lowest_cost`: Select provider with highest `costScore`
- `highest_reliability`: Select provider with highest `reliabilityScore`
- `deterministic_priority`: Follow `preferredProviders` list, then priority
- `capability_match`: Map capability to specific provider via `capabilityRouting`

## Fallback Strategies
- `next_provider`: Try next in chain
- `mock_fallback`: Fall back to mock provider
- `fail_fast`: Return error immediately
- `degraded_mode`: Enter degraded operation

## Selection Algorithm
1. Filter providers by `isProviderAvailable` (enabled + circuit closed + not unavailable)
2. Filter by required capability if specified
3. Apply routing strategy to rank
4. Return top provider

## Fallback Chain
Built by `getFallbackChain()` — all available providers sorted by priority, excluding the failed one.
