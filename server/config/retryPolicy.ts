/**
 * Sprint 1.8 — Políticas oficiais de timeout e retry do LiciGov Pro.
 *
 * Todo serviço assíncrono deve usar o RetryPolicy correspondente para:
 * backoff exponencial, detecção de soft/hard timeout e fail-fast.
 */

export interface RetryPolicy {
  /** Número máximo de tentativas antes de mover para DLQ ou falhar */
  maxAttempts: number;
  /** Delay inicial antes da primeira re-tentativa (ms) */
  initialDelayMs: number;
  /** Multiplicador para backoff exponencial */
  backoffMultiplier: number;
  /** Teto do delay entre tentativas (ms) */
  maxDelayMs: number;
  /** Aviso de operação lenta — logar warn mas continuar */
  softTimeoutMs: number;
  /** Timeout hard — cancelar e considerar falha */
  hardTimeoutMs: number;
  /** Se true: falha imediatamente sem retry (útil para logging) */
  failFast?: boolean;
}

/**
 * Calcula o delay de backoff para a tentativa N (1-indexed).
 * Respeita maxDelayMs como teto.
 */
export function calculateBackoffMs(policy: RetryPolicy, attempt: number): number {
  const raw = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * Retorna true se ainda há tentativas disponíveis após `attempt` falhas.
 */
export function isRetryable(policy: RetryPolicy, attempt: number): boolean {
  if (policy.failFast) return false;
  return attempt < policy.maxAttempts;
}

/**
 * Políticas oficiais — uma por contexto de serviço.
 */
export const RETRY_POLICIES = {
  /** Outbox dispatcher: pode ter até 5 tentativas com backoff longo */
  OUTBOX: {
    maxAttempts:       5,
    initialDelayMs:    1_000,
    backoffMultiplier: 2,
    maxDelayMs:        60_000,
    softTimeoutMs:     30_000,
    hardTimeoutMs:     120_000,
  },
  /** Feature flags: curtas re-tentativas, usa cache como fallback */
  FEATURE_FLAG: {
    maxAttempts:       3,
    initialDelayMs:    500,
    backoffMultiplier: 2,
    maxDelayMs:        5_000,
    softTimeoutMs:     2_000,
    hardTimeoutMs:     10_000,
  },
  /** Activity log: fail-fast — auditoria nunca deve bloquear o fluxo */
  ACTIVITY_LOG: {
    maxAttempts:       2,
    initialDelayMs:    200,
    backoffMultiplier: 2,
    maxDelayMs:        2_000,
    softTimeoutMs:     1_000,
    hardTimeoutMs:     5_000,
    failFast:          true,
  },
  /** Tenant resolution: tolerante a falhas temporárias de DB */
  TENANT: {
    maxAttempts:       3,
    initialDelayMs:    500,
    backoffMultiplier: 2,
    maxDelayMs:        5_000,
    softTimeoutMs:     2_000,
    hardTimeoutMs:     10_000,
  },
  /** Idempotency keys: rápido, sem retry longo */
  IDEMPOTENCY: {
    maxAttempts:       3,
    initialDelayMs:    300,
    backoffMultiplier: 2,
    maxDelayMs:        3_000,
    softTimeoutMs:     2_000,
    hardTimeoutMs:     8_000,
  },
} as const satisfies Record<string, RetryPolicy>;

export type RetryPolicyName = keyof typeof RETRY_POLICIES;
