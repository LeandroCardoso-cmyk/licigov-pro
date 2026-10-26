/**
 * SECURITY HOTFIX — GHSA-27r3-jxmh-p828 (body-parser < 1.20.9) e GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6).
 *
 * Regressões da MESMA cadeia de parsing do servidor (`server/_core/index.ts`: express.json/urlencoded com limite de 10mb +
 * tRPC com o `appRouter` real), em processo local efêmero (127.0.0.1, porta aleatória) — nenhum serviço real:
 *  - versões efetivamente resolvidas (express → body-parser ≥ 1.20.9; zod ≥ 4.6.6);
 *  - JSON, urlencoded e JSON gzip continuam aceitos; gzip com bytes extras é recusado sem derrubar o processo;
 *  - corpo acima de 10mb ⇒ 413 (JSON e urlencoded);
 *  - tRPC: entrada inválida ⇒ BAD_REQUEST com as issues do Zod no MESMO formato (code/path), antes de qualquer acesso ao banco;
 *  - zod: coleção com limite de tamanho não acumula uma issue por elemento (correção da advisory).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../../routers";
import { createContext } from "../../_core/context";

const require_ = createRequire(import.meta.url);
const semverGte = (v: string, min: string) => {
  const a = v.split(".").map(Number); const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

let server: http.Server;
let base = "";
const uncaught: unknown[] = [];
const onUncaught = (e: unknown) => { uncaught.push(e); };

type Res = { status: number; body: string };
function post(p: string, body: Buffer, headers: Record<string, string>, tail?: Buffer): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method: "POST", headers: { ...headers, ...(tail ? { "transfer-encoding": "chunked" } : { "content-length": String(body.length) }) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: d }));
    });
    req.on("error", reject);
    if (tail) { req.write(body); setTimeout(() => { req.write(tail); req.end(); }, 50); } else req.end(body);
  });
}

beforeAll(async () => {
  process.on("uncaughtException", onUncaught);
  const app = express();
  // Mesma configuração de parsing do servidor (verificada abaixo contra o código-fonte).
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.post("/echo", (req, res) => { res.json({ body: req.body }); });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  app.use((err: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ type: err.type ?? "error" });
  });
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  process.off("uncaughtException", onUncaught);
  await new Promise<void>((r) => server?.close(() => r()));
});

describe("versões resolvidas (hotfix de segurança)", () => {
  it("express resolve body-parser ≥ 1.20.9 e o zod do projeto é ≥ 4.6.6", () => {
    const expressDir = path.dirname(require_.resolve("express/package.json"));
    const bpVersion = (createRequire(path.join(expressDir, "index.js"))("body-parser/package.json") as { version: string }).version;
    const zodVersion = (require_("zod/package.json") as { version: string }).version;
    expect(semverGte(bpVersion, "1.20.9"), `body-parser ${bpVersion}`).toBe(true);
    expect(semverGte(zodVersion, "4.6.6"), `zod ${zodVersion}`).toBe(true);
  });

  it("o teste espelha a configuração de parsing do servidor (limite de 10mb em JSON e urlencoded)", () => {
    const src = readFileSync(path.resolve("server/_core/index.ts"), "utf8");
    expect(src).toContain('app.use(express.json({ limit: "10mb" }));');
    expect(src).toContain('app.use(express.urlencoded({ limit: "10mb", extended: true }));');
  });
});

describe("body-parser — corpos JSON, urlencoded e gzip", () => {
  it("JSON e urlencoded (extended) continuam aceitos", async () => {
    const j = await post("/echo", Buffer.from(JSON.stringify({ a: 1, b: ["x"] })), { "content-type": "application/json" });
    expect(j.status).toBe(200);
    expect(JSON.parse(j.body)).toEqual({ body: { a: 1, b: ["x"] } });
    const u = await post("/echo", Buffer.from("a=1&b[c]=2"), { "content-type": "application/x-www-form-urlencoded" });
    expect(u.status).toBe(200);
    expect(JSON.parse(u.body)).toEqual({ body: { a: "1", b: { c: "2" } } });
  });

  it("JSON gzip válido continua aceito", async () => {
    const r = await post("/echo", zlib.gzipSync(Buffer.from('{"ok":true}')), { "content-type": "application/json", "content-encoding": "gzip" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ body: { ok: true } });
  });

  it("gzip seguido de bytes extras é recusado (4xx) sem exceção não tratada — o processo continua atendendo", async () => {
    const gz = zlib.gzipSync(Buffer.from('{"a":1}'));
    const inline = await post("/echo", Buffer.concat([gz, Buffer.from("garbage")]), { "content-type": "application/json", "content-encoding": "gzip" });
    expect(inline.status).toBeGreaterThanOrEqual(400);
    expect(inline.status).toBeLessThan(500);
    const late = await post("/echo", gz, { "content-type": "application/json", "content-encoding": "gzip" }, Buffer.from("garbage-after-frame"));
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(late.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(uncaught).toEqual([]);
    const after = await post("/echo", Buffer.from('{"vivo":true}'), { "content-type": "application/json" });
    expect(after.status).toBe(200);
  });

  it("corpo acima de 10mb ⇒ 413 (JSON e urlencoded)", async () => {
    const big = "x".repeat(10 * 1024 * 1024 + 1024);
    const j = await post("/echo", Buffer.from(JSON.stringify({ big })), { "content-type": "application/json" });
    expect(j.status).toBe(413);
    expect(JSON.parse(j.body).type).toBe("entity.too.large");
    const u = await post("/echo", Buffer.from(`big=${big}`), { "content-type": "application/x-www-form-urlencoded" });
    expect(u.status).toBe(413);
  });
});

describe("tRPC × Zod — formato de erro de validação", () => {
  it("auth.login com entrada inválida ⇒ BAD_REQUEST com as issues do Zod (code/path) — sem tocar no banco", async () => {
    const r = await post("/api/trpc/auth.login", Buffer.from(JSON.stringify({ json: { email: "nao-e-email", password: "" } })), { "content-type": "application/json" });
    expect(r.status).toBe(400);
    const err = JSON.parse(r.body).error.json;
    expect(err.data.code).toBe("BAD_REQUEST");
    const issues = JSON.parse(err.message) as Array<{ code: string; path: string[]; message: string; format?: string }>;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_format", format: "email", path: ["email"], message: "E-mail inválido" }),
      expect.objectContaining({ code: "too_small", path: ["password"], message: "Informe a senha" }),
    ]));
  });
});

describe("zod — correção GHSA-mrhx-c7xc-m3w5", () => {
  it("array com limite de tamanho recusa sem acumular uma issue por elemento", () => {
    const r = z.array(z.number()).max(10).safeParse(Array(50_000).fill("x"));
    expect(r.success).toBe(false);
    expect(r.error!.issues.length).toBeLessThanOrEqual(1);
    expect(r.error!.issues[0].code).toBe("too_big");
  });
});
