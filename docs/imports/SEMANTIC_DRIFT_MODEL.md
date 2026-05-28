# Semantic Drift Model — Metrics, Alert Thresholds & Detection Logic

## Overview

Semantic drift refers to the gradual degradation of matching quality over time.
Drift can be caused by changes in import file formats, new terminology, parser upgrades,
or changes in the semantic index composition.

The `semanticDriftService` monitors 8 key metrics, detects alerts, and provides
trend analysis between time periods.

## Drift Metrics

| Metric | Computation | Interpretation |
|--------|-------------|----------------|
| `avgConfidence` | Mean of all item confidence scores | Higher = better overall quality |
| `avgSemanticMatchRate` | % items with candidateScore ≥ 0.85 | Higher = better semantic matching |
| `avgUnitNormRate` | % items with canonicalUnit != null | Higher = better unit normalization |
| `parserAccuracyByType` | Avg confidence per parser type | Monitors parser-specific regression |
| `candidateInstabilityRate` | % items with confidence < 0.60 | Lower = more stable |
| `rankingInconsistencies` | Count of items with score < 0.50 | Lower = better |
| `normalizationAnomalies` | Count of items without canonical unit | Lower = better |
| `semanticVolatility` | Standard deviation of confidence scores | Lower = more consistent |

## Alert Thresholds

### Confidence Degradation
- **Warning**: avg confidence drops > 10% from baseline
- **Critical**: avg confidence drops > 20% from baseline

### Normalization Anomaly
- **Warning**: unit normalization rate drops > 15% from baseline

### Semantic Volatility
- **Warning**: semanticVolatility > 0.20
- **Critical**: semanticVolatility > 0.35

### Ranking Inconsistency
- **Warning**: rankingInconsistencies > 10% of total items

## Trend Analysis

`compareDriftSnapshots(a, b)` produces a `DriftTrend[]` array with:
- `direction`: "up" | "down" | "stable" (based on 0.0001 threshold)
- `delta`: numerical change (can be positive or negative)
- Metrics tracked: avgConfidence, avgSemanticMatchRate, avgUnitNormRate,
  candidateInstabilityRate, rankingInconsistencies, normalizationAnomalies, semanticVolatility

## Health Assessment

`isHealthy(current, baseline)` returns `true` if there are NO critical alerts.
Warning-level alerts do not fail the health check.

## Standard Deviation Computation

`computeStdDev(values)` uses population standard deviation (not sample):
```
σ = sqrt(Σ(xi - μ)² / N)
```

Useful for `semanticVolatility` — high stddev indicates inconsistent matching across items.

## Integration Points

Drift snapshots are computed from:
- `StagingItemAnalyticsData[]` — from `importAnalyticsService`
- `SessionAnalyticsData[]` — from `importAnalyticsService`
- Period `{start, end}` — ISO 8601 timestamps

Alerts are emitted via `semanticObservabilityService.driftAlert()` for log aggregation.

## Snapshot Persistence

Snapshots are stored in `semantic_drift_snapshots` table (migration 0064).
Recommended frequency: compute after each import session completes.
Baseline: use the most recent snapshot from the previous period as comparison.
