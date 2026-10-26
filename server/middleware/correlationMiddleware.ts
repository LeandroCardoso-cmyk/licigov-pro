import type { Request, Response, NextFunction } from "express";

/**
 * SEC-AUD-2026-10 — o X-Correlation-Id vem do CLIENTE e é gravado em auditoria/ledger (colunas de
 * 36–64 caracteres), em logs e no header de resposta. Antes era aceito sem validação: valor longo
 * quebrava a gravação da auditoria ("Data too long") e valor arbitrário poluía logs/rastreabilidade.
 * Só é aceito um identificador simples de até 36 caracteres (cabe num UUID: o frontend envia
 * crypto.randomUUID()); qualquer outro valor é descartado e um UUID novo é gerado.
 */
const CLIENT_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/;

export function acceptClientCorrelationId(raw: unknown): string | null {
  return typeof raw === "string" && CLIENT_CORRELATION_ID.test(raw) ? raw : null;
}

/**
 * Gera e propaga correlationId + requestId em cada request HTTP.
 *
 * correlationId: representa um fluxo de negócio (pode cruzar múltiplos requests).
 *               Propagado pelo cliente via X-Correlation-Id (validado), ou gerado aqui.
 * requestId:    único por request HTTP. Sempre gerado aqui.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId =
    acceptClientCorrelationId(req.headers["x-correlation-id"]) ||
    crypto.randomUUID();

  const requestId = crypto.randomUUID();

  (req as unknown as Record<string, unknown>)["correlationId"] = correlationId;
  (req as unknown as Record<string, unknown>)["requestId"] = requestId;

  res.setHeader("x-correlation-id", correlationId);
  res.setHeader("x-request-id", requestId);

  next();
}
