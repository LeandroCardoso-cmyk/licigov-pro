/**
 * PR D — Resiliência operacional compartilhada (timeout + retry controlado).
 *
 * Núcleo reutilizável para envelopar chamadas externas (IA, dependências) com:
 * - timeout via AbortController (cancelamento cooperativo) + corrida de tempo (mecanismo
 *   equivalente, garante o limite mesmo quando o SDK subjacente ignora o signal);
 * - retry SOMENTE para falhas transitórias classificadas pelo chamador, com backoff
 *   exponencial já definido nas políticas oficiais (`server/config/retryPolicy.ts`).
 *
 * NÃO decide o que é transitório — isso é responsabilidade do chamador (`isTransient`),
 * para que erros determinísticos (entrada inválida, auth, política) nunca sejam re-tentados.
 */
import { type RetryPolicy, calculateBackoffMs, isRetryable } from "../config/retryPolicy";

/** Erro lançado quando uma operação excede o timeout configurado. */
export class TimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly operation?: string,
  ) {
    super(`Operação${operation ? ` "${operation}"` : ""} excedeu o timeout de ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Não segura o event loop no shutdown.
    (timer as { unref?: () => void }).unref?.();
  });
}

/**
 * Executa `fn` com um limite de tempo. Passa um `AbortSignal` para permitir cancelamento
 * cooperativo; se `fn` não respeitar o signal, a corrida ainda rejeita com `TimeoutError`
 * ao atingir `timeoutMs`. Nunca deixa o timer segurar o processo.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation?: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejeita ANTES de abortar: garante que o TimeoutError sempre vença a corrida, mesmo
      // que `fn` reaja ao abort resolvendo de forma síncrona.
      reject(new TimeoutError(timeoutMs, operation));
      controller.abort();
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  /** Política oficial (maxAttempts, backoff, delays). */
  policy: RetryPolicy;
  /**
   * Classifica um erro como transitório (elegível a retry). Erros determinísticos
   * (entrada inválida, auth, política, schema) devem retornar `false`.
   */
  isTransient: (error: unknown) => boolean;
  /** Nome da operação, para observabilidade. */
  operation?: string;
  /** Callback observável a cada re-tentativa (antes de aguardar o backoff). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Executa `fn` com re-tentativas controladas. Só re-tenta quando o erro é classificado
 * como transitório E a política ainda permite (`isRetryable`). Caso contrário, propaga o
 * erro original imediatamente (fail-fast para erros determinísticos).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (error) {
      const transient = opts.isTransient(error);
      if (!transient || !isRetryable(opts.policy, attempt)) {
        throw error;
      }
      const delayMs = calculateBackoffMs(opts.policy, attempt);
      opts.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
