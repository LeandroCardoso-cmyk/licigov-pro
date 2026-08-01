/**
 * PR D / AI-014 — Resiliência das chamadas de IA (timeout + retry controlado + observabilidade).
 *
 * Envelopa a chamada ao provider (`provider.generate(...)`) no pipeline oficial do
 * AIExecutionEngine com:
 * - timeout duro (via `withTimeout`, AbortController + corrida);
 * - retry SOMENTE para erros transitórios classificados (`isTransientAiError`), com backoff;
 * - observabilidade (structuredLog) preservando correlationId/provider/model.
 *
 * NÃO decide provider nem toca no fail-closed AI-015 (`selectProvider`): a seleção acontece
 * ANTES, no Provider Adapter. Este módulo só torna a chamada já-selecionada resiliente.
 *
 * Replay safety: o retry ocorre ANTES de qualquer persistência (a persistência do resultado
 * vive uma camada acima, após o retorno válido) — portanto re-tentativas técnicas nunca
 * geram resposta/versão/evento duplicado.
 */
import type { RetryPolicy } from "../../config/retryPolicy";
import { AI_CONFIG } from "../../config/ai";
import { withTimeout, withRetry, TimeoutError } from "../resilience";
import { NoRealAIProviderError } from "./providerAdapter";
import { ProviderNotImplemented, ProviderUnavailable } from "./placeholderProviders";
import { serviceLogger } from "../../services/observabilityService";

const log = serviceLogger("ai");

/** Política de retry para IA, derivada da configuração (AI_TIMEOUT_MS / AI_MAX_ATTEMPTS). */
export function buildAiRetryPolicy(): RetryPolicy {
  return {
    maxAttempts: AI_CONFIG.maxAttempts,
    initialDelayMs: 500,
    backoffMultiplier: 2,
    maxDelayMs: 8_000,
    softTimeoutMs: Math.floor(AI_CONFIG.timeoutMs / 2),
    hardTimeoutMs: AI_CONFIG.timeoutMs,
  };
}

/**
 * Classifica um erro de IA como TRANSITÓRIO (elegível a retry) ou DETERMINÍSTICO (falha imediata).
 *
 * Transitório: timeout, rate limit (429), quota/resource exhausted, 5xx, indisponibilidade,
 * falhas de rede recuperáveis.
 * Determinístico (NUNCA re-tentar): entrada inválida (400/422), auth (401/403), política,
 * provider não implementado, ausência de provider real (fail-closed AI-015), schema inválido.
 *
 * Default conservador: só re-tenta o que é comprovadamente transitório.
 */
export function isTransientAiError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  // Determinísticos explícitos — jamais re-tentar.
  if (error instanceof NoRealAIProviderError) return false;
  if (error instanceof ProviderNotImplemented) return false;
  if (error instanceof ProviderUnavailable) return false;

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const status =
    (error as { status?: unknown })?.status ??
    (error as { statusCode?: unknown })?.statusCode ??
    (error as { code?: unknown })?.code;
  const haystack = `${name} ${message} ${String(status ?? "")}`.toLowerCase();

  // Determinísticos primeiro (têm precedência).
  if (/\b(400|401|403|404|422)\b/.test(haystack)) return false;
  if (/invalid[_ ]?argument|permission[_ ]?denied|unauthenticated|invalid api key|api key not valid|failed[_ ]?precondition|not[_ ]?found|invalidcognitiveresponse/.test(haystack)) {
    return false;
  }

  // Transitórios conhecidos.
  if (/\b(408|409|425|429|500|502|503|504)\b/.test(haystack)) return true;
  if (/rate limit|resource[_ ]?exhausted|quota|too many requests|overloaded|unavailable|deadline|timeout|timed out|econnreset|etimedout|econnrefused|eai_again|enotfound|socket hang up|network|fetch failed|temporarily/.test(haystack)) {
    return true;
  }
  if (typeof status === "number" && status >= 500) return true;

  // Desconhecido → tratar como determinístico (fail-fast).
  return false;
}

export interface AiCallContext {
  readonly provider: string;
  readonly model: string;
  readonly operation: string;
  readonly correlationId?: string;
  readonly task?: string;
}

function errorType(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

/**
 * Executa `generate` com timeout + retry controlado + observabilidade. Retorna exatamente o
 * que `generate` retorna. Em caso de falha definitiva, propaga o erro original (o chamador —
 * ex.: answerConsultation — aplica o fail-closed, registrando `failed` sem persistir resposta).
 */
export async function resilientAiCall<T>(
  generate: (signal: AbortSignal) => Promise<T>,
  ctx: AiCallContext,
): Promise<T> {
  const policy = buildAiRetryPolicy();
  const meta = {
    provider: ctx.provider,
    model: ctx.model,
    correlationId: ctx.correlationId,
    task: ctx.task,
  };

  try {
    return await withRetry(
      () => withTimeout(generate, AI_CONFIG.timeoutMs, ctx.operation),
      {
        policy,
        isTransient: isTransientAiError,
        operation: ctx.operation,
        onRetry: ({ attempt, delayMs, error }) => {
          log.warn("ai_retry", {
            ...meta,
            operation: ctx.operation,
            attempt,
            delayMs,
            errorType: errorType(error),
            timeout: error instanceof TimeoutError,
          });
        },
      },
    );
  } catch (error) {
    const transient = isTransientAiError(error);
    log.error("ai_call_failed", {
      ...meta,
      operation: ctx.operation,
      transient,
      timeout: error instanceof TimeoutError,
      errorType: errorType(error),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
