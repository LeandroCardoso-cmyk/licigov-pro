/**
 * Sprint 3.2 — Distributed Cache Service.
 *
 * Enterprise in-memory cache with tenant isolation, TTL enforcement,
 * LRU-like eviction, and snapshot-aware invalidation.
 * Foundation for future Redis migration.
 *
 * Multi-tenant: keys are prefixed with `org:${orgId}:`.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  key:             string;
  value:           T;
  organizationId:  number;
  ttlMs:           number;
  createdAt:       number;
  expiresAt:       number;
  snapshotVersion: string | null;
}

export interface CacheConfig {
  defaultTtlMs:    number;
  maxEntries:      number;
  tenantIsolation: boolean;
}

export interface CacheMetrics {
  hits:      number;
  misses:    number;
  evictions: number;
  size:      number;
  hitRatio:  number;
}

// ─── Default config ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CacheConfig = {
  defaultTtlMs:    300000, // 5 minutes
  maxEntries:      10000,
  tenantIsolation: true,
};

// ─── CacheService interface ──────────────────────────────────────────────────

export interface CacheService {
  get<T>(key: string, orgId: number): T | null;
  set<T>(key: string, value: T, orgId: number, ttlMs?: number, snapshotVersion?: string): void;
  invalidate(key: string, orgId: number): boolean;
  invalidateByPrefix(prefix: string, orgId: number): number;
  invalidateBySnapshot(snapshotVersion: string, orgId: number): number;
  clear(orgId: number): void;
  clearAll(): void;
  getMetrics(orgId?: number): CacheMetrics;
  prune(): number;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export function createCacheService(config?: Partial<CacheConfig>): CacheService {
  const cfg: CacheConfig = { ...DEFAULT_CONFIG, ...config };
  const store = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  function tenantKey(key: string, orgId: number): string {
    return cfg.tenantIsolation ? `org:${orgId}:${key}` : key;
  }

  function isExpired(entry: CacheEntry): boolean {
    return Date.now() >= entry.expiresAt;
  }

  function evictIfNeeded(): void {
    if (store.size < cfg.maxEntries) return;

    // Evict oldest entry (LRU-like: earliest createdAt)
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of store.entries()) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      store.delete(oldestKey);
      evictions++;
    }
  }

  return {
    get<T>(key: string, orgId: number): T | null {
      const tk = tenantKey(key, orgId);
      const entry = store.get(tk);
      if (!entry) {
        misses++;
        return null;
      }
      if (isExpired(entry)) {
        store.delete(tk);
        misses++;
        return null;
      }
      hits++;
      return entry.value as T;
    },

    set<T>(key: string, value: T, orgId: number, ttlMs?: number, snapshotVersion?: string): void {
      evictIfNeeded();
      const tk = tenantKey(key, orgId);
      const now = Date.now();
      const ttl = ttlMs ?? cfg.defaultTtlMs;
      store.set(tk, {
        key,
        value,
        organizationId: orgId,
        ttlMs: ttl,
        createdAt: now,
        expiresAt: now + ttl,
        snapshotVersion: snapshotVersion ?? null,
      });
    },

    invalidate(key: string, orgId: number): boolean {
      const tk = tenantKey(key, orgId);
      return store.delete(tk);
    },

    invalidateByPrefix(prefix: string, orgId: number): number {
      const fullPrefix = cfg.tenantIsolation ? `org:${orgId}:${prefix}` : prefix;
      let count = 0;
      for (const k of Array.from(store.keys())) {
        if (k.startsWith(fullPrefix)) {
          store.delete(k);
          count++;
        }
      }
      return count;
    },

    invalidateBySnapshot(snapshotVersion: string, orgId: number): number {
      let count = 0;
      for (const [k, v] of Array.from(store.entries())) {
        if (v.organizationId === orgId && v.snapshotVersion === snapshotVersion) {
          store.delete(k);
          count++;
        }
      }
      return count;
    },

    clear(orgId: number): void {
      const prefix = `org:${orgId}:`;
      for (const k of Array.from(store.keys())) {
        if (k.startsWith(prefix)) {
          store.delete(k);
        }
      }
    },

    clearAll(): void {
      store.clear();
      hits = 0;
      misses = 0;
      evictions = 0;
    },

    getMetrics(orgId?: number): CacheMetrics {
      let size: number;
      if (orgId !== undefined) {
        const prefix = `org:${orgId}:`;
        size = Array.from(store.keys()).filter(k => k.startsWith(prefix)).length;
      } else {
        size = store.size;
      }
      const total = hits + misses;
      return {
        hits,
        misses,
        evictions,
        size,
        hitRatio: total > 0 ? Math.round((hits / total) * 10000) / 10000 : 0,
      };
    },

    prune(): number {
      let pruned = 0;
      const now = Date.now();
      for (const [k, v] of Array.from(store.entries())) {
        if (now >= v.expiresAt) {
          store.delete(k);
          pruned++;
        }
      }
      return pruned;
    },
  };
}
