/**
 * Sprint 3.2 — Performance Optimization Service.
 *
 * Monitoring, optimization utilities, and performance snapshots.
 * Structured JSON logs only — no DB writes.
 *
 * Multi-tenant, correlation-aware, deterministic where specified.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QueryMetrics {
  queryName:       string;
  durationMs:      number;
  rowCount:        number;
  cached:          boolean;
  organizationId:  number;
  correlationId:   string;
  recordedAt:      string;
}

export interface SlowQueryAlert {
  queryName:       string;
  durationMs:      number;
  threshold:       number;
  organizationId:  number;
}

export interface PerformanceSnapshot {
  organizationId:    number;
  period:            string;
  avgQueryMs:        number;
  p95QueryMs:        number;
  p99QueryMs:        number;
  cacheHitRatio:     number;
  totalQueries:      number;
  slowQueries:       number;
  throughputPerMinute: number;
}

// ─── Structured logging ──────────────────────────────────────────────────────

export function recordQueryMetric(metric: QueryMetrics): void {
  console.info(JSON.stringify({
    service: "performance",
    event:   "query_metric",
    ...metric,
    timestamp: new Date().toISOString(),
  }));
}

// ─── Slow query detection ────────────────────────────────────────────────────

export function detectSlowQueries(
  metrics: QueryMetrics[],
  thresholdMs = 1000,
): SlowQueryAlert[] {
  return metrics
    .filter(m => m.durationMs > thresholdMs)
    .map(m => ({
      queryName:      m.queryName,
      durationMs:     m.durationMs,
      threshold:      thresholdMs,
      organizationId: m.organizationId,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

// ─── Performance snapshot ────────────────────────────────────────────────────

export function computePerformanceSnapshot(
  metrics: QueryMetrics[],
  period:  string,
): PerformanceSnapshot {
  if (metrics.length === 0) {
    return {
      organizationId:    0,
      period,
      avgQueryMs:        0,
      p95QueryMs:        0,
      p99QueryMs:        0,
      cacheHitRatio:     0,
      totalQueries:      0,
      slowQueries:       0,
      throughputPerMinute: 0,
    };
  }

  const orgId = metrics[0].organizationId;
  const durations = metrics.map(m => m.durationMs).sort((a, b) => a - b);
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);

  const cacheHits = metrics.filter(m => m.cached).length;
  const cacheHitRatio = cacheHits / metrics.length;

  const slow = metrics.filter(m => m.durationMs > 1000).length;

  // Throughput: total queries divided by period length (assume 1min if not parseable)
  const firstAt = new Date(metrics[0].recordedAt).getTime();
  const lastAt = new Date(metrics[metrics.length - 1].recordedAt).getTime();
  const periodMinutes = Math.max(1, (lastAt - firstAt) / 60000);
  const throughput = metrics.length / periodMinutes;

  return {
    organizationId:    orgId,
    period,
    avgQueryMs:        Math.round(avg * 100) / 100,
    p95QueryMs:        p95,
    p99QueryMs:        p99,
    cacheHitRatio:     Math.round(cacheHitRatio * 10000) / 10000,
    totalQueries:      metrics.length,
    slowQueries:       slow,
    throughputPerMinute: Math.round(throughput * 100) / 100,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Pagination optimization ─────────────────────────────────────────────────

export function paginateOptimized(
  page:        number,
  pageSize:    number,
  maxPageSize  = 100,
): { offset: number; limit: number; page: number; pageSize: number } {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), maxPageSize));
  return {
    offset:   (safePage - 1) * safePageSize,
    limit:    safePageSize,
    page:     safePage,
    pageSize: safePageSize,
  };
}

// ─── Batch by IDs (anti-N+1) ────────────────────────────────────────────────

export async function batchByIds<T>(
  ids:       string[] | number[],
  fetcher:   (batch: (string | number)[]) => Promise<T[]>,
  batchSize  = 50,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const fetched = await fetcher(batch);
    results.push(...fetched);
  }
  return results;
}

// ─── Cache hit ratio ─────────────────────────────────────────────────────────

export function computeCacheHitRatio(hits: number, misses: number): number {
  const total = hits + misses;
  if (total === 0) return 0;
  return Math.round((hits / total) * 10000) / 10000;
}

// ─── Health check ────────────────────────────────────────────────────────────

export function isPerformanceHealthy(snapshot: PerformanceSnapshot): boolean {
  return snapshot.p95QueryMs < 2000 && snapshot.cacheHitRatio >= 0.5 && snapshot.slowQueries <= 5;
}
