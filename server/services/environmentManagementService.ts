/**
 * Sprint 3.4 — Environment Management Service.
 *
 * Gerenciamento de multiplos ambientes (dev, staging, production) por organizacao.
 * Suporta configuracoes isoladas, promocao entre ambientes e auditoria de mudancas.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EnvironmentType = "development" | "staging" | "production";

export type EnvironmentStatus = "active" | "inactive" | "maintenance" | "deprecated";

export interface EnvironmentConfig {
  maxUsers:              number;
  maxProcesses:          number;
  features:              Record<string, boolean>;
  rateLimit:             { requestsPerMinute: number; burstLimit: number };
  dataRetentionDays:     number;
  allowExternalWebhooks: boolean;
}

export interface Environment {
  id:             string;
  organizationId: number;
  name:           string;
  type:           EnvironmentType;
  status:         EnvironmentStatus;
  config:         EnvironmentConfig;
  version:        string;
  promotedFrom:   string | null;
  createdBy:      number;
  createdAt:      string;
  updatedAt:      string;
}

export interface EnvironmentPromotion {
  id:             string;
  organizationId: number;
  fromEnvId:      string;
  toEnvId:        string;
  promotedBy:     number;
  changes:        string[];
  promotedAt:     string;
}

export interface EnvironmentHealthCheck {
  environmentId: string;
  healthy:       boolean;
  checks:        Array<{ name: string; status: "ok" | "warn" | "fail"; detail: string }>;
  checkedAt:     string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _environments: Environment[]          = [];
const _promotions:   EnvironmentPromotion[] = [];
let   _envCounter = 0;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++_envCounter}`;
}

const DEFAULT_CONFIG: EnvironmentConfig = {
  maxUsers:              100,
  maxProcesses:          1000,
  features:              {},
  rateLimit:             { requestsPerMinute: 60, burstLimit: 100 },
  dataRetentionDays:     365,
  allowExternalWebhooks: false,
};

const PRODUCTION_CONFIG: EnvironmentConfig = {
  maxUsers:              500,
  maxProcesses:          10000,
  features:              {},
  rateLimit:             { requestsPerMinute: 300, burstLimit: 500 },
  dataRetentionDays:     1825,
  allowExternalWebhooks: true,
};

// ─── Create ───────────────────────────────────────────────────────────────────

export function createEnvironment(params: {
  organizationId: number;
  name:           string;
  type:           EnvironmentType;
  createdBy:      number;
  config?:        Partial<EnvironmentConfig>;
}): Environment {
  const now    = new Date().toISOString();
  const base   = params.type === "production" ? PRODUCTION_CONFIG : DEFAULT_CONFIG;
  const config = { ...base, ...(params.config ?? {}), features: { ...base.features, ...(params.config?.features ?? {}) } };

  const env: Environment = {
    id:             genId("env"),
    organizationId: params.organizationId,
    name:           params.name,
    type:           params.type,
    status:         "active",
    config,
    version:        "1.0.0",
    promotedFrom:   null,
    createdBy:      params.createdBy,
    createdAt:      now,
    updatedAt:      now,
  };
  _environments.push(env);
  return env;
}

// ─── Update config ────────────────────────────────────────────────────────────

export function updateEnvironmentConfig(
  envId:          string,
  organizationId: number,
  updates:        Partial<EnvironmentConfig>,
): Environment {
  const env = _environments.find(e => e.id === envId && e.organizationId === organizationId);
  if (!env) throw new Error(`Ambiente "${envId}" nao encontrado.`);

  const parts   = env.version.split(".").map(Number);
  const newVer  = `${parts[0]}.${parts[1]}.${(parts[2] ?? 0) + 1}`;
  Object.assign(env, {
    config:    { ...env.config, ...updates, features: { ...env.config.features, ...(updates.features ?? {}) } },
    version:   newVer,
    updatedAt: new Date().toISOString(),
  });
  return env;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function setEnvironmentStatus(
  envId:          string,
  organizationId: number,
  status:         EnvironmentStatus,
): Environment {
  const env = _environments.find(e => e.id === envId && e.organizationId === organizationId);
  if (!env) throw new Error(`Ambiente "${envId}" nao encontrado.`);
  env.status    = status;
  env.updatedAt = new Date().toISOString();
  return env;
}

// ─── Promote ──────────────────────────────────────────────────────────────────

export function promoteEnvironment(
  fromEnvId:      string,
  toEnvId:        string,
  organizationId: number,
  promotedBy:     number,
): EnvironmentPromotion {
  const from = _environments.find(e => e.id === fromEnvId && e.organizationId === organizationId);
  const to   = _environments.find(e => e.id === toEnvId   && e.organizationId === organizationId);

  if (!from) throw new Error(`Ambiente de origem "${fromEnvId}" nao encontrado.`);
  if (!to)   throw new Error(`Ambiente de destino "${toEnvId}" nao encontrado.`);
  if (from.type === "production") throw new Error("Nao e possivel promover A PARTIR de producao.");

  const changes: string[] = [];
  if (JSON.stringify(from.config.features) !== JSON.stringify(to.config.features)) {
    changes.push("features");
  }
  if (from.config.maxProcesses !== to.config.maxProcesses) changes.push("maxProcesses");
  if (from.config.rateLimit.requestsPerMinute !== to.config.rateLimit.requestsPerMinute) changes.push("rateLimit");

  const promotion: EnvironmentPromotion = {
    id:             genId("promo"),
    organizationId,
    fromEnvId,
    toEnvId,
    promotedBy,
    changes,
    promotedAt:     new Date().toISOString(),
  };
  _promotions.push(promotion);

  // Copy features from source to destination
  to.config     = { ...to.config, features: { ...from.config.features } };
  to.promotedFrom = fromEnvId;
  to.updatedAt    = promotion.promotedAt;

  return promotion;
}

// ─── Health check ─────────────────────────────────────────────────────────────

export function checkEnvironmentHealth(
  envId:          string,
  organizationId: number,
): EnvironmentHealthCheck {
  const env       = _environments.find(e => e.id === envId && e.organizationId === organizationId);
  const checkedAt = new Date().toISOString();

  if (!env) {
    return {
      environmentId: envId,
      healthy:       false,
      checks:        [{ name: "existence", status: "fail", detail: "Ambiente nao encontrado." }],
      checkedAt,
    };
  }

  const checks: EnvironmentHealthCheck["checks"] = [
    { name: "status",     status: env.status === "active" ? "ok" : "warn",    detail: `Status: ${env.status}` },
    { name: "config",     status: env.config.maxUsers > 0 ? "ok" : "fail",    detail: `maxUsers: ${env.config.maxUsers}` },
    { name: "version",    status: "ok",                                         detail: `v${env.version}` },
    { name: "retention",  status: env.config.dataRetentionDays >= 90 ? "ok" : "warn", detail: `${env.config.dataRetentionDays} dias` },
  ];

  return {
    environmentId: envId,
    healthy:       checks.every(c => c.status !== "fail"),
    checks,
    checkedAt,
  };
}

// ─── Query ────────────────────────────────────────────────────────────────────

export function getEnvironments(organizationId: number): Environment[] {
  return _environments.filter(e => e.organizationId === organizationId);
}

export function getEnvironmentById(envId: string, organizationId: number): Environment | null {
  return _environments.find(e => e.id === envId && e.organizationId === organizationId) ?? null;
}

export function getPromotionHistory(organizationId: number): EnvironmentPromotion[] {
  return _promotions.filter(p => p.organizationId === organizationId);
}

export function compareEnvironments(
  envIdA:         string,
  envIdB:         string,
  organizationId: number,
): { field: string; valueA: unknown; valueB: unknown }[] {
  const a = _environments.find(e => e.id === envIdA && e.organizationId === organizationId);
  const b = _environments.find(e => e.id === envIdB && e.organizationId === organizationId);
  if (!a || !b) return [];

  const diffs: { field: string; valueA: unknown; valueB: unknown }[] = [];
  if (a.type    !== b.type)   diffs.push({ field: "type",    valueA: a.type,    valueB: b.type });
  if (a.status  !== b.status) diffs.push({ field: "status",  valueA: a.status,  valueB: b.status });
  if (a.version !== b.version) diffs.push({ field: "version", valueA: a.version, valueB: b.version });
  if (a.config.maxUsers      !== b.config.maxUsers)      diffs.push({ field: "config.maxUsers",              valueA: a.config.maxUsers,      valueB: b.config.maxUsers });
  if (a.config.maxProcesses  !== b.config.maxProcesses)  diffs.push({ field: "config.maxProcesses",          valueA: a.config.maxProcesses,  valueB: b.config.maxProcesses });
  if (a.config.dataRetentionDays !== b.config.dataRetentionDays) diffs.push({ field: "config.dataRetentionDays", valueA: a.config.dataRetentionDays, valueB: b.config.dataRetentionDays });
  return diffs;
}
