import { eq, and } from "drizzle-orm";
import { getDb } from "../db/connection";
import { featureFlags, tenantFeatureFlags } from "../../drizzle/schema";

// Cache em memória simples (TTL 60s) para reduzir queries em hot path
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
 * 1. Flag global desabilitada (Ops flag) → false, sempre (overrides tudo)
 * 2. Override por tenant (tenant_feature_flags) → valor do tenant
 * 3. Flag global → valor global
 * 4. Default → false (safe default)
 *
 * Para flags do tipo Ops (desabilitação de emergência):
 * se flag global = true (desabilitada) → a feature está DESLIGADA independente do tenant.
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

  // 1. Verificar flag global
  const [globalFlag] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  // Flags de emergência (FF_*_DISABLE): se enabled=true → feature está DESLIGADA
  const isDisableFlag = flagName.includes("_DISABLE") || flagName === "FF_OUTBOX_DISPATCHER_PAUSE";
  if (isDisableFlag && globalFlag?.enabled === true) {
    cacheSet(cacheKey, false);
    return false;
  }

  // 2. Override por tenant
  const [tenantFlag] = await db
    .select()
    .from(tenantFeatureFlags)
    .where(and(
      eq(tenantFeatureFlags.organizationId, organizationId),
      eq(tenantFeatureFlags.flagName, flagName),
    ))
    .limit(1);

  if (tenantFlag) {
    // Verificar expiração
    if (tenantFlag.expiresAt && tenantFlag.expiresAt < new Date()) {
      // Flag expirada → cair para global
    } else {
      // Suporte a rollout gradual via percentage
      const pct = tenantFlag.percentage ?? 100;
      const enabled = tenantFlag.enabled && (pct >= 100 || Math.random() * 100 < pct);
      cacheSet(cacheKey, enabled);
      return enabled;
    }
  }

  // 3. Valor global (não-Ops flags)
  const globalEnabled = globalFlag?.enabled ?? false;
  cacheSet(cacheKey, globalEnabled);
  return globalEnabled;
}

/**
 * Invalida o cache de feature flags para uma organização.
 * Chamar após atualizar flags via admin.
 */
export function invalidateFlagCache(flagName?: string, organizationId?: number): void {
  if (flagName && organizationId) {
    cache.delete(`${flagName}:${organizationId}`);
  } else {
    cache.clear();
  }
}

/**
 * Verifica flags de Ops (emergência global).
 * Mais simples: não verifica tenant override — é global.
 */
export async function isGlobalFlagEnabled(flagName: string): Promise<boolean> {
  const cached = cacheGet(`global:${flagName}`);
  if (cached !== undefined) return cached;

  const db = await getDb();
  if (!db) return false;

  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.name, flagName))
    .limit(1);

  const enabled = row?.enabled ?? false;
  cacheSet(`global:${flagName}`, enabled);
  return enabled;
}
