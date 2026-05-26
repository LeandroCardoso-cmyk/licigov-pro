import type { Request, Response, NextFunction } from "express";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
    requestId: string;
  }
}

/**
 * Gera e propaga correlationId + requestId em cada request HTTP.
 *
 * correlationId: representa um fluxo de negócio (pode cruzar múltiplos requests).
 *               Propagado pelo cliente via X-Correlation-Id, ou gerado aqui.
 * requestId:    único por request HTTP. Sempre gerado aqui.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId =
    (req.headers["x-correlation-id"] as string | undefined) ||
    crypto.randomUUID();

  const requestId = crypto.randomUUID();

  req.correlationId = correlationId;
  req.requestId = requestId;

  res.setHeader("x-correlation-id", correlationId);
  res.setHeader("x-request-id", requestId);

  next();
}
