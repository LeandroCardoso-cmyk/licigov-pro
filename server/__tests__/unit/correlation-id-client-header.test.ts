/**
 * SEC-AUD-2026-10 — X-Correlation-Id do cliente só é aceito em formato seguro (≤ 36 caracteres,
 * [A-Za-z0-9._:-]). Valor ausente, longo ou com caracteres arbitrários é descartado e um UUID é gerado,
 * tanto no middleware Express quanto no createContext do tRPC (que antes preferia o header cru).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(async () => { throw new Error("sem sessão"); }) },
}));

import { acceptClientCorrelationId, correlationMiddleware } from "../../middleware/correlationMiddleware";
import { createContext } from "../../_core/context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function runMiddleware(header: unknown) {
  const req = { headers: header === undefined ? {} : { "x-correlation-id": header } } as any;
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
  const next = vi.fn();
  correlationMiddleware(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  return { req, headers };
}

describe("acceptClientCorrelationId", () => {
  it("aceita UUID e identificadores simples usados pelos clientes atuais", () => {
    expect(acceptClientCorrelationId("3f2b8c1e-9d4a-4f6b-8e2a-1c3d5e7f9a0b")).not.toBeNull();
    expect(acceptClientCorrelationId("homolog-mabc123-x9y8z7")).not.toBeNull();
    expect(acceptClientCorrelationId("corr-123")).not.toBeNull();
  });

  it("recusa ausente, vazio, longo, array e caracteres arbitrários", () => {
    expect(acceptClientCorrelationId(undefined)).toBeNull();
    expect(acceptClientCorrelationId("")).toBeNull();
    expect(acceptClientCorrelationId("a".repeat(37))).toBeNull();
    expect(acceptClientCorrelationId(["a", "b"])).toBeNull();
    expect(acceptClientCorrelationId("x' OR 1=1 --")).toBeNull();
    expect(acceptClientCorrelationId("<script>")).toBeNull();
    expect(acceptClientCorrelationId("-começa-com-hífen")).toBeNull();
  });
});

describe("correlationMiddleware", () => {
  it("propaga o id válido do cliente no request e no header de resposta", () => {
    const { req, headers } = runMiddleware("corr-abc");
    expect(req.correlationId).toBe("corr-abc");
    expect(headers["x-correlation-id"]).toBe("corr-abc");
    expect(headers["x-request-id"]).toMatch(UUID_RE);
  });

  it("substitui id inválido por UUID gerado", () => {
    const { req, headers } = runMiddleware("z".repeat(500));
    expect(req.correlationId).toMatch(UUID_RE);
    expect(headers["x-correlation-id"]).toBe(req.correlationId);
  });
});

describe("createContext (tRPC)", () => {
  it("usa o correlationId já validado pelo middleware, nunca o header cru", async () => {
    const req = { headers: { "x-correlation-id": "y".repeat(200) }, correlationId: "validado-1", requestId: "r1" } as any;
    const ctx = await createContext({ req, res: {} as any, info: {} as any });
    expect(ctx.correlationId).toBe("validado-1");
  });

  it("sem middleware: header inválido é descartado e um UUID é gerado", async () => {
    const req = { headers: { "x-correlation-id": "y".repeat(200) } } as any;
    const ctx = await createContext({ req, res: {} as any, info: {} as any });
    expect(ctx.correlationId).toMatch(UUID_RE);
  });

  it("sem middleware: header válido é aceito", async () => {
    const req = { headers: { "x-correlation-id": "corr-ok" } } as any;
    const ctx = await createContext({ req, res: {} as any, info: {} as any });
    expect(ctx.correlationId).toBe("corr-ok");
  });
});
