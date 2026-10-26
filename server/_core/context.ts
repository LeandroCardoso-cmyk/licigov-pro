import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User, OrganizationMember } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { acceptClientCorrelationId } from "../middleware/correlationMiddleware";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  // Sprint 1 — Multi-tenant + Observabilidade
  correlationId: string;
  requestId: string;
  organizationId: number | null;
  orgMembership: OrganizationMember | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  // correlationId: o já validado pelo correlationMiddleware; sem ele, o header X-Correlation-Id do
  // cliente só se tiver formato seguro (SEC-AUD-2026-10); senão, gerado aqui.
  // requestId: sempre gerado por request, único por chamada HTTP
  const correlationId =
    (opts.req as unknown as Record<string, unknown>)["correlationId"] as string ||
    acceptClientCorrelationId(opts.req.headers["x-correlation-id"]) ||
    crypto.randomUUID();

  const requestId =
    (opts.req as unknown as Record<string, unknown>)["requestId"] as string ||
    crypto.randomUUID();

  return {
    req: opts.req,
    res: opts.res,
    user,
    correlationId,
    requestId,
    organizationId: null,
    orgMembership: null,
  };
}
