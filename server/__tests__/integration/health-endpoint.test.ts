import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";

// Controla a disponibilidade do banco por teste (mock da camada de dados — não abre conexão real).
const execute = vi.fn();
let dbAvailable = true;

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => (dbAvailable ? { execute } : null)),
}));

import { registerHealthRoutes } from "../../_core/health";

function startApp(): Promise<{ server: Server; base: string }> {
  const app = express();
  registerHealthRoutes(app);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let ctx: { server: Server; base: string };

beforeEach(async () => {
  dbAvailable = true;
  execute.mockReset();
  execute.mockResolvedValue([]);
  ctx = await startApp();
});

afterEach(() => {
  ctx.server.close();
});

describe("/health (readiness)", () => {
  it("retorna 200 e status ok quando o banco está saudável", async () => {
    const res = await fetch(`${ctx.base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "licigov-pro",
      checks: { database: "ok" },
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("retorna 503 quando o banco está indisponível (getDb null)", async () => {
    dbAvailable = false;
    const res = await fetch(`${ctx.base}/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unavailable");
    expect(body.checks.database).toBe("unavailable");
  });

  it("retorna 503 quando o SELECT 1 lança (conexão quebrada)", async () => {
    execute.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await fetch(`${ctx.base}/health`);
    expect(res.status).toBe(503);
  });

  it("resposta JSON é estável e NÃO expõe secrets nem infraestrutura", async () => {
    const res = await fetch(`${ctx.base}/health`);
    const raw = await res.text();
    expect(raw).not.toMatch(/DATABASE_URL|password|secret|mysql:\/\/|JWT|token/i);
    const body = JSON.parse(raw);
    expect(Object.keys(body).sort()).toEqual(["checks", "service", "status", "timestamp"]);
    expect(Object.keys(body.checks)).toEqual(["database"]);
  });
});

describe("/livez (liveness)", () => {
  it("retorna 200 mesmo com o banco indisponível (não checa dependências)", async () => {
    dbAvailable = false;
    const res = await fetch(`${ctx.base}/livez`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("licigov-pro");
  });

  it("não expõe secrets", async () => {
    const raw = await (await fetch(`${ctx.base}/livez`)).text();
    expect(raw).not.toMatch(/DATABASE_URL|password|secret|mysql:\/\/|JWT/i);
  });
});
