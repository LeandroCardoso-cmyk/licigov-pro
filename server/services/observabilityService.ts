type LogLevel = "info" | "warn" | "error" | "debug";

/** Operações acima deste threshold geram warn automático */
export const SLOW_QUERY_THRESHOLD_MS = 1_000;

export interface SpanResult<T> {
  result:     T;
  durationMs: number;
  slow:       boolean;
}

export type StructuredLogEntry = {
  level: LogLevel;
  service: string;
  operation: string;
  correlationId?: string;
  organizationId?: number;
  userId?: number;
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
};

export function structuredLog(entry: StructuredLogEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export async function timed<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  meta?: { correlationId?: string; organizationId?: number; userId?: number },
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    structuredLog({ level: "debug", service, operation, durationMs: Date.now() - start, ...meta });
    return result;
  } catch (err) {
    structuredLog({
      level: "error",
      service,
      operation,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      ...meta,
    });
    throw err;
  }
}

/**
 * Sprint 1.8 — Named execution span com slow-query detection.
 * Retorna SpanResult com durationMs e flag `slow`.
 */
export async function span<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  meta?: { correlationId?: string; organizationId?: number; userId?: number },
): Promise<SpanResult<T>> {
  const start = Date.now();
  try {
    const result    = await fn();
    const durationMs = Date.now() - start;
    const slow       = durationMs >= SLOW_QUERY_THRESHOLD_MS;
    structuredLog({
      level: slow ? "warn" : "debug",
      service,
      operation,
      durationMs,
      slow,
      ...meta,
    });
    return { result, durationMs, slow };
  } catch (err) {
    const durationMs = Date.now() - start;
    structuredLog({
      level: "error",
      service,
      operation,
      durationMs,
      slow: durationMs >= SLOW_QUERY_THRESHOLD_MS,
      error: err instanceof Error ? err.message : String(err),
      ...meta,
    });
    throw err;
  }
}

export function serviceLogger(service: string) {
  return {
    info: (operation: string, data?: Record<string, unknown>) =>
      structuredLog({ level: "info", service, operation, ...data }),
    warn: (operation: string, data?: Record<string, unknown>) =>
      structuredLog({ level: "warn", service, operation, ...data }),
    error: (operation: string, data?: Record<string, unknown>) =>
      structuredLog({ level: "error", service, operation, ...data }),
    debug: (operation: string, data?: Record<string, unknown>) =>
      structuredLog({ level: "debug", service, operation, ...data }),
    timed: <T>(
      operation: string,
      fn: () => Promise<T>,
      meta?: { correlationId?: string; organizationId?: number; userId?: number },
    ) => timed(service, operation, fn, meta),
    span: <T>(
      operation: string,
      fn: () => Promise<T>,
      meta?: { correlationId?: string; organizationId?: number; userId?: number },
    ) => span(service, operation, fn, meta),
  };
}
