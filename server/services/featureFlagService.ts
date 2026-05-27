import { eq, and } from "drizzle-orm";
import { getDb } from "../db/connection";
import { featureFlags, tenantFeatureFlags } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("FeatureFlagService");

type CacheEntry = { value: boolean; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cacheGet(key: string): boolean | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: boolean): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Avalia se uma feature flag está habilitada para uma organização.
 *
 * Ordem de prioridade:
 * 1. Ops flag global ativada (kill-switch) → false sempre (overrides tudo)
 * 2. Override por tenant com percentage + expiry
 * 3. Valor global
 * 4. Default → false (safe default)
 */
export async function isFeatureEnabled(
  flagName: string,
  organizationId: number,
): Promise<boolean> {
  const cacheKey = `${flagName}:${organizationId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const db = await getDb();
  if (!db) return false;

  const [globalFlag] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  const isKillSwitch = flagName.includes("_DISABLE") || flagName === "FF_OUTBOX_DISPATCHER_PAUSE";
  if (isKillSwitch && globalFlag?.enabled === true) {
    log.info("flag_kill_switch_active", { flagName, organizationId });
    cacheSet(cacheKey, false);
    return false;
  }

  const [tenantFlag] = await db
    .select()
    .from(tenantFeatureFlags)
    .where(
      and(
        eq(tenantFeatureFlags.organizationId, organizationId),
        eq(tenantFeatureFlags.flagName, flagName),
      ),
    )
    .limit(1);

  if (tenantFlag) {
    if (!tenantFlag.expiresAt || tenantFlag.expiresAt >= new Date()) {
      const pct = tenantFlag.percentage ?? 100;
      const enabled = tenantFlag.enabled && (pct >= 100 || Math.random() * 100 < pct);
      cacheSet(cacheKey, enabled);
      log.debug("flag_resolved_tenant", { flagName, organizationId, enabled, percentage: pct });
      return enabled;
    }
    log.info("flag_tenant_override_expired", { flagName, organizationId });
  }

  const globalEnabled = globalFlag?.enabled ?? false;
  cacheSet(cacheKey, globalEnabled);
  log.debug("flag_resolved_global", { flagName, organizationId, enabled: globalEnabled });
  return globalEnabled;
}

/**
 * Invalida cache de feature flags.
 *
 * - invalidateFlagCache()                → limpa todo o cache
 * - invalidateFlagCache(flagName)        → limpa flag em todos os tenants
 * - invalidateFlagCache(flagName, orgId) → limpa flag de um tenant específico
 */
export function invalidateFlagCache(flagName?: string, organizationId?: number): void {
  if (flagName && organizationId !== undefined) {
    cache.delete(`${flagName}:${organizationId}`);
    log.info("flag_cache_invalidated", { flagName, organizationId, scope: "tenant" });
  } else if (flagName) {
    for (const key of cache.keys()) {
      if (key.startsWith(`${flagName}:`)) cache.delete(key);
    }
    log.info("flag_cache_invalidated", { flagName, scope: "all_tenants" });
  } else {
    cache.clear();
    log.info("flag_cache_invalidated", { scope: "global" });
  }
}

/**
 * Invalida todas as flags de um tenant específico.
 */
export function invalidateAllFlagsForTenant(organizationId: number): void {
  const suffix = `:${organizationId}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key);
  }
  log.info("flag_cache_invalidated", { organizationId, scope: "all_flags_for_tenant" });
}

/**
 * Verifica flags de Ops (emergência global — sem tenant override).
 */
export async function isGlobalFlagEnabled(flagName: string): Promise<boolean> {
  const cacheKey = `global:${flagName}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const db = await getDb();
  if (!db) return false;

  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  const enabled = row?.enabled ?? false;
  cacheSet(cacheKey, enabled);
  return enabled;
}

/**
 * Snapshot do estado do cache (para observabilidade/debug).
 */
export function getFlagCacheSnapshot(): Record<string, { value: boolean; ttlMs: number }> {
  const now = Date.now();
  const snapshot: Record<string, { value: boolean; ttlMs: number }> = {};
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt > now) {
      snapshot[key] = { value: entry.value, ttlMs: entry.expiresAt - now };
    }
  }
  return snapshot;
}
