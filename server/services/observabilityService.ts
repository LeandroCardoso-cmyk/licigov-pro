type LogLevel = "info" | "warn" | "error" | "debug";

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
  };
}
