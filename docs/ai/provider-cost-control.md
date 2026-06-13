# Provider Cost Control — Sprint 4.5

## Cost Estimation
Per-provider token rates:
| Provider | Prompt ($/token) | Completion ($/token) |
|----------|-----------------|---------------------|
| openai | 0.001 | 0.002 |
| claude | 0.0008 | 0.0024 |
| gemini | 0.0005 | 0.0015 |
| mock | 0 | 0 |

## Usage Tracking
`recordUsage()` stores cost records with timestamp for daily/monthly aggregation.

## Quota System
- `getTodayUsage()`: All records for current UTC day
- `getMonthlyUsage()`: All records for current UTC month
- `checkQuota(orgId, dailyLimit)`: Returns `{ allowed, remaining, exceeded }`

## Anomaly Detection
`detectAnomaly()` flags when today's spending exceeds 2x the historical average.

## Usage Summary
`getUsageSummary()` returns `totalRecords`, `totalCost`, `todayCost`, `monthCost`.
