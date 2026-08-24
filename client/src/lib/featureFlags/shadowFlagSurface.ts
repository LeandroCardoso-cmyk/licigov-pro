/**
 * C.3A-OPS.1 — Lógica pura da superfície operacional de feature flags (platform admin).
 *
 * Sem React, sem rede: só regras de UI (validação, rótulos, resumo de confirmação, permissão de
 * escrita). Toda ESCRITA real passa por `trpc.featureFlagAdmin.setTenantFlag`; toda LEITURA por
 * `trpc.featureFlagAdmin.getTenantFlag`. A UI só opera a única flag governável presente hoje em
 * `GOVERNABLE_TENANT_FLAGS` do backend.
 */

/** Única flag governável exposta pela UI (espelha o allowlist do backend). */
export const SHADOW_FLAG = "FF_DIRECT_CONTRACT_SHADOW" as const;

export type BackendEnvironment = "development" | "staging" | "production";

/** Forma mínima do retorno de `getTenantFlag` que a UI consome. */
export interface TenantFlagViewLike {
  flagName: string;
  organizationId: number;
  effectiveValue: boolean;
  origin: "tenant" | "global" | "default";
  environment: BackendEnvironment;
  writeAllowed: boolean;
  override: { enabled: boolean; percentage: number; expiresAt: string | Date | null } | null;
}

export function environmentLabel(env: BackendEnvironment): string {
  switch (env) {
    case "production": return "Produção";
    case "staging": return "Staging";
    case "development": return "Desenvolvimento";
    default: return env;
  }
}

/**
 * Autoridade de escrita: a UI NUNCA decide pelo hostname — usa `writeAllowed` do backend
 * (derivado de IS_PRODUCTION). Em produção → false → controles desabilitados.
 */
export function canOperate(view: Pick<TenantFlagViewLike, "writeAllowed"> | null | undefined): boolean {
  return !!view?.writeAllowed;
}

export const PRODUCTION_WRITE_BLOCKED_MESSAGE =
  "Alterações de feature flag estão bloqueadas em produção.";

export interface ActivationInput {
  reason: string;
  /** valor do input datetime-local (string) ou Date; obrigatório para ativação. */
  expiresAt: string | Date | null | undefined;
}

export interface ValidationResult {
  valid: boolean;
  errors: { reason?: string; expiresAt?: string };
}

function parseFuture(expiresAt: string | Date | null | undefined, now: number): { ok: boolean; date: Date | null } {
  if (expiresAt == null || expiresAt === "") return { ok: false, date: null };
  const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return { ok: false, date: null };
  if (d.getTime() <= now) return { ok: false, date: d };
  return { ok: true, date: d };
}

/** Validação de ATIVAÇÃO (enable=true): reason obrigatório + expiry futura obrigatória nesta fase. */
export function validateActivation(input: ActivationInput, now: number = Date.now()): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  if (!input.reason?.trim()) {
    errors.reason = "Justificativa obrigatória.";
  }
  const exp = parseFuture(input.expiresAt, now);
  if (input.expiresAt == null || input.expiresAt === "") {
    errors.expiresAt = "Expiração obrigatória para ativação (safety net).";
  } else if (!exp.ok) {
    errors.expiresAt = "A expiração deve ser uma data/hora futura.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Validação de DESATIVAÇÃO (enable=false): apenas reason obrigatório. */
export function validateDeactivation(input: { reason: string }): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  if (!input.reason?.trim()) {
    errors.reason = "Justificativa obrigatória.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export const DEFAULT_ACTIVATION_REASON =
  "Homologação operacional C.3A — shadow DIRECT_PROCUREMENT_REASONING em staging";
export const DEFAULT_DEACTIVATION_REASON =
  "Encerramento da homologação operacional C.3A em staging";

export const ACTIVATION_NOTICE =
  "Esta ação habilitará a execução shadow do Kernel Cognitivo somente para esta organização neste " +
  "ambiente. O resultado legado continuará sendo o resultado oficial.";

export interface ConfirmationSummary {
  environment: string;
  organization: string;
  flag: string;
  reason: string;
  expiry: string | null;
}

export function buildConfirmationSummary(params: {
  environment: BackendEnvironment;
  organizationName: string;
  reason: string;
  expiresAt?: string | Date | null;
}): ConfirmationSummary {
  const expiry =
    params.expiresAt == null || params.expiresAt === ""
      ? null
      : (params.expiresAt instanceof Date ? params.expiresAt : new Date(params.expiresAt)).toLocaleString("pt-BR");
  return {
    environment: environmentLabel(params.environment),
    organization: params.organizationName,
    flag: SHADOW_FLAG,
    reason: params.reason.trim(),
    expiry,
  };
}
