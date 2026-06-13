# Provider Architecture — Sprint 4.5

## Overview
The Provider Activation Layer manages AI provider lifecycle, routing, governance, and observability for LiciGov Pro.

## Core Components
- **AIProvider**: Domain entity with health, circuit breaker, and scoring
- **ProviderRegistry**: In-memory registry per organization
- **ProviderRouting**: Strategy-based provider selection
- **ProviderExecution**: Execution lifecycle with replay support

## Provider Types
| Type | Latency | Reliability | Cost |
|------|---------|-------------|------|
| openai | 0.8 | 0.9 | 0.5 |
| claude | 0.85 | 0.92 | 0.6 |
| gemini | 0.9 | 0.85 | 0.7 |
| mock | 1.0 | 1.0 | 1.0 |

## ID Generation
All provider IDs use `sha256(provider:{orgId}:{type}:{name}).slice(0,20)` for determinism.

## Multi-tenancy
Every provider and execution is scoped to `organizationId`. No cross-org data leakage.
