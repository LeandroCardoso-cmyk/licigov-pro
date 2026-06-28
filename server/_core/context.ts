import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User, OrganizationMember } from "../../drizzle/schema";
import { sdk } from "./sdk";

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

  // correlationId: propagado pelo cliente (header X-Correlation-Id) ou gerado aqui
  // requestId: sempre gerado por request, único por chamada HTTP
  const correlationId =
    (opts.req.headers["x-correlation-id"] as string | undefined) ||
    (opts.req as unknown as Record<string, unknown>)["correlationId"] as string ||
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
