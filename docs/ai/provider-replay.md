# Provider Replay — Sprint 4.5

## Overview
Deterministic replay enables re-execution of past provider calls with identical inputs/outputs.

## Snapshot Creation
Every completed execution automatically creates a `ReplaySnapshot` with:
- `snapshotKey`: `sha256(snapshot:{execId}:{promptHash})`
- `originalExecutionId`: Reference to source execution
- `requestPayload`: Original inputs
- `responsePayload`: Original outputs

## Replay Process
1. Retrieve snapshot by `snapshotKey`
2. Validate org ownership
3. Return stored response (no new provider call)
4. Record in replay history

## Validation
`validateReplay()` checks `snapshotKeyMatch` and `payloadMatch` for integrity verification.

## Use Cases
- Debugging: Re-run failed workflows with same inputs
- Testing: Verify deterministic behavior
- Audit: Reproduce past AI decisions
