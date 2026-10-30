/**
 * Pós-homologação (Frente B) — trilha interna dos erros tRPC. A resposta ao cliente é sanitizada (`errorShape.ts`);
 * aqui fica o diagnóstico técnico para a observabilidade autorizada, ligado à resposta pelo correlationId.
 * Só erros INTERNOS (5xx) são registrados — recusas esperadas (4xx) já têm logs próprios nos guards.
 */
import type { TRPCError } from "@trpc/server";
import type { NextFunction, Request, Response } from "express";
import { structuredLog } from "../services/observabilityService";
import { isUnexpectedInternalError, looksLikeDriverLeak, publicInternalMessage, redactForLog } from "./errorShape";

export function logTrpcInternalError(error: TRPCError, path: string | undefined, correlationId: string | null | undefined): void {
  // 4xx com texto de banco (catch de router que repassa `e.message`) também é registrado: a resposta foi sanitizada.
  if (error.code !== "INTERNAL_SERVER_ERROR" && !looksLikeDriverLeak(error.message)) return;
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const driverCode = (cause as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  structuredLog({
    level: "error", service: "trpc", operation: "internal_error",
    procedure: path, correlationId: correlationId ?? undefined,
    code: error.code,
    unexpected: isUnexpectedInternalError(error),
    errorName: cause?.name ?? error.name,
    driverCode: typeof driverCode === "string" ? driverCode : undefined,
    message: redactForLog(error.message, 500),
    stack: redactForLog(cause?.stack ?? error.stack),
  });
}

/**
 * Pós-homologação (Frente B, achado da auditoria) — erro que chega ao Express FORA do tRPC (ex.: JSON malformado ou corpo acima
 * do limite no body-parser, rota HTTP própria). O tratador padrão do Express decide por `NODE_ENV` (ausente no Railway) e devolvia
 * HTML com a stack. Fora de development: resposta genérica com o correlationId; o detalhe vai ao log.
 */
export function expressErrorHandler(exposeDiagnostics: boolean) {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (exposeDiagnostics || res.headersSent) { next(err); return; }
    const e = err as { status?: unknown; statusCode?: unknown; name?: unknown; message?: unknown; stack?: unknown } | null;
    const raw = Number(e?.status ?? e?.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
    const correlationId = (req as unknown as { correlationId?: string }).correlationId;
    structuredLog({
      level: status >= 500 ? "error" : "warn", service: "http", operation: "unhandled_error",
      method: req.method, path: req.path, status, correlationId,
      errorName: typeof e?.name === "string" ? e.name : undefined,
      message: redactForLog(typeof e?.message === "string" ? e.message : undefined, 500),
      stack: status >= 500 ? redactForLog(typeof e?.stack === "string" ? e.stack : undefined) : undefined,
    });
    const message = status >= 500 ? publicInternalMessage(correlationId) : "Requisição inválida.";
    res.status(status).json({ error: { message, status, ...(correlationId ? { correlationId } : {}) } });
  };
}
