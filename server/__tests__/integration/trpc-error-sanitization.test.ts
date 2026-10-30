/**
 * Pós-homologação (Frente B) — resposta HTTP de erro tRPC sanitizada fora de development.
 *
 * Reproduz o achado da homologação (`data.stack` na resposta de staging) por HTTP real (adaptador fetch do tRPC) com o MESMO
 * `t` do servidor, em ambiente equivalente a staging e a produção (APP_ENV), e prova:
 *  - sem `data.stack` / caminhos internos / texto SQL na resposta;
 *  - erro interno não intencional ⇒ mensagem genérica com o correlationId; o detalhe vai ao log interno com o MESMO id;
 *  - contratos preservados: códigos tRPC, status HTTP, mensagens intencionais (validação, FORBIDDEN, UNAUTHORIZED, CONFLICT).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const env = vi.hoisted(() => ({ app: "staging" as "development" | "staging" | "production" }));
vi.mock("../../config/env", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    get APP_ENV() { return env.app; },
    get IS_DEVELOPMENT() { return env.app === "development"; },
    get IS_STAGING() { return env.app === "staging"; },
    get IS_PRODUCTION() { return env.app === "production"; },
  };
});
const logs = vi.hoisted(() => ({ entries: [] as Array<Record<string, unknown>> }));
vi.mock("../../services/observabilityService", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  structuredLog: (e: Record<string, unknown>) => { logs.entries.push(e); },
}));

const MYSQL_MESSAGES = [
  "Data too long for column 'password_hash' at row 1",
  "Cannot add or update a child row: a foreign key constraint fails (`licigov`.`contracts`, CONSTRAINT `fk_org` FOREIGN KEY (`organizationId`) REFERENCES `organizations` (`id`))",
  "Lock wait timeout exceeded; try restarting transaction",
  "Deadlock found when trying to get lock; try restarting transaction",
  "Column 'organizationId' cannot be null",
  "Field 'tenantId' doesn't have a default value",
  "Incorrect datetime value: '2026-13-01' for column 'createdAt' at row 1",
  "Out of range value for column 'valor' at row 1",
  "Cannot delete or update a parent row: a foreign key constraint fails",
  "Unknown column 'segredo' in 'field list'",
  "Table 'licigov.tabela_interna' doesn't exist",
  "Too many connections",
  "Can't add new command when connection is in closed state",
  "Connection lost: The server closed the connection.",
];
const SQL_LEAK = "Failed query: select * from users where email = ? params: fulano@prefeitura.gov.br";

async function loadServer() {
  // Configuração fictícia SÓ do teste: fora de development o boot exige segredo JWT (nenhuma credencial real).
  vi.stubEnv("JWT_SECRET", "segredo-ficticio-de-teste-com-mais-de-32-caracteres");
  vi.resetModules();
  const trpc = await import("../../_core/trpc");
  const { logTrpcInternalError } = await import("../../_core/errorLogging");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const router = trpc.router({
    boom: trpc.publicProcedure.query(() => { throw new Error(SQL_LEAK); }),
    intentionalInternal: trpc.publicProcedure.query(() => {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — emissão oficial recusada (nenhuma versão emitida)." });
    }),
    forbidden: trpc.publicProcedure.query(() => { throw new TRPCError({ code: "FORBIDDEN", message: "Este ato institucional exige vínculo ativo com o órgão (INSTITUTIONAL_AUTHORITY_REQUIRED)." }); }),
    conflict: trpc.publicProcedure.query(() => { throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde a revisão." }); }),
    // catch de router que converte QUALQUER erro em 4xx repassando `e.message` (achado da auditoria)
    leakyBadRequest: trpc.publicProcedure.query(() => { throw new TRPCError({ code: "BAD_REQUEST", message: "Duplicate entry 'fulano@prefeitura.gov.br' for key 'users.email'" }); }),
    // Revisão pré-merge: mensagens reais do servidor MySQL convertidas em 4xx por `catch` que repassa `e.message` (sem `cause`).
    mysqlText: trpc.publicProcedure.input(z.object({ i: z.number() })).query(({ input }) => {
      throw new TRPCError({ code: input.i === 2 ? "CONFLICT" : "BAD_REQUEST", message: MYSQL_MESSAGES[input.i] });
    }),
    // Mesmo padrão, COM `cause` = erro do driver (mysql2: errno/sqlState/sqlMessage) — texto desconhecido do catálogo.
    driverCause: trpc.publicProcedure.query(() => {
      const driver = Object.assign(new Error("Unexpected server answer 'xyz' on table licitacoes_internas"), { errno: 1105, code: "ER_UNKNOWN_ERROR", sqlState: "HY000", sqlMessage: "Unexpected server answer 'xyz' on table licitacoes_internas" });
      throw new TRPCError({ code: "NOT_FOUND", message: driver.message, cause: driver });
    }),
    // Mensagem FUNCIONAL legítima de domínio (com cause de domínio) segue intacta.
    domainBadRequest: trpc.publicProcedure.query(() => {
      const domain = new Error("Transição inválida: o contrato encerrado não pode voltar a vigente.");
      throw new TRPCError({ code: "BAD_REQUEST", message: domain.message, cause: domain });
    }),
    me: trpc.protectedProcedure.query(() => "ok"),
    validated: trpc.publicProcedure.input(z.object({ n: z.number() })).query(({ input }) => input.n),
  });
  const call = async (path: string, input?: unknown) => {
    const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc", req: new Request(`http://local/api/trpc/${path}${qs}`), router,
      createContext: () => ({ user: null, req: { headers: {} }, res: {}, correlationId: "corr-frente-b", requestId: "req-1" }) as never,
      onError: ({ error, path: p, ctx }) => logTrpcInternalError(error, p, (ctx as { correlationId?: string } | undefined)?.correlationId),
    });
    const body = await res.json() as { error: { json: { message: string; code: number; data: Record<string, unknown> } } };
    return { status: res.status, err: body.error.json };
  };
  return { call };
}

beforeEach(() => { logs.entries.length = 0; });

describe.each(["staging", "production"] as const)("APP_ENV=%s — resposta sanitizada", (appEnv) => {
  beforeEach(() => { env.app = appEnv; });

  it("erro interno não intencional: sem stack, sem SQL/dados; mensagem genérica com correlationId; detalhe no log interno", async () => {
    const { call } = await loadServer();
    const { status, err } = await call("boom");
    expect(status).toBe(500);
    expect(err.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.data.stack).toBeUndefined();
    const serialized = JSON.stringify(err);
    expect(serialized).not.toMatch(/Failed query|fulano@|\.ts:\d+|node_modules|\/app\//);
    expect(err.message).toContain("corr-frente-b");
    expect(err.data.correlationId).toBe("corr-frente-b");
    const entry = logs.entries.find((e) => e.operation === "internal_error");
    expect(entry).toMatchObject({ correlationId: "corr-frente-b", procedure: "boom", unexpected: true });
    expect(String(entry!.message)).toContain("Failed query");
    expect(String(entry!.message)).not.toContain("fulano@"); // parâmetros SQL redigidos também no log
  });

  it("erro interno INTENCIONAL mantém a mensagem pt-BR (sem stack)", async () => {
    const { call } = await loadServer();
    const { status, err } = await call("intentionalInternal");
    expect(status).toBe(500);
    expect(err.message).toMatch(/^Persistência indisponível/);
    expect(err.data.stack).toBeUndefined();
  });

  it("FORBIDDEN, UNAUTHORIZED, CONFLICT e validação: código, status e mensagem preservados; sem stack", async () => {
    const { call } = await loadServer();
    const f = await call("forbidden");
    expect([f.status, f.err.data.code]).toEqual([403, "FORBIDDEN"]);
    expect(f.err.message).toContain("INSTITUTIONAL_AUTHORITY_REQUIRED");
    const u = await call("me");
    expect([u.status, u.err.data.code]).toEqual([401, "UNAUTHORIZED"]);
    const c = await call("conflict");
    expect([c.status, c.err.data.code, c.err.message]).toEqual([409, "CONFLICT", "O rascunho mudou desde a revisão."]);
    const v = await call("validated", { n: "x" });
    expect([v.status, v.err.data.code]).toEqual([400, "BAD_REQUEST"]);
    for (const e of [f.err, u.err, c.err, v.err]) {
      expect(e.data.stack).toBeUndefined();
      expect(e.data.correlationId).toBe("corr-frente-b");
    }
    expect(logs.entries.filter((e) => e.operation === "internal_error")).toEqual([]); // 4xx não poluem o log de erro interno
  });

  it("4xx que carrega texto de banco (catch que repassa e.message): código preservado, texto cortado, detalhe redigido no log", async () => {
    const { call } = await loadServer();
    const { status, err } = await call("leakyBadRequest");
    expect([status, err.data.code]).toEqual([400, "BAD_REQUEST"]);
    expect(JSON.stringify(err)).not.toMatch(/Duplicate entry|fulano@/);
    expect(err.message).toContain("corr-frente-b");
    const entry = logs.entries.find((e) => e.operation === "internal_error");
    expect(entry).toMatchObject({ code: "BAD_REQUEST", correlationId: "corr-frente-b" });
    expect(String(entry!.message)).not.toContain("fulano@");
  });

  it("4xx com mensagens REAIS do MySQL (sem cause): código/status preservados, texto do banco cortado, correlationId e log redigido", async () => {
    const { call } = await loadServer();
    for (let i = 0; i < MYSQL_MESSAGES.length; i++) {
      logs.entries.length = 0;
      const { status, err } = await call("mysqlText", { i });
      expect([status, err.data.code], MYSQL_MESSAGES[i]).toEqual(i === 2 ? [409, "CONFLICT"] : [400, "BAD_REQUEST"]);
      expect(err.message, MYSQL_MESSAGES[i]).toBe("Erro interno ao processar a solicitação. Informe ao suporte o código de correlação corr-frente-b.");
      expect(JSON.stringify(err)).not.toMatch(/password_hash|foreign key|Lock wait|organizationId|licigov|segredo|connection/i);
      expect(err.data.correlationId).toBe("corr-frente-b");
      expect(logs.entries.find((e) => e.operation === "internal_error"), MYSQL_MESSAGES[i]).toMatchObject({ correlationId: "corr-frente-b", procedure: "mysqlText" });
      expect(String(logs.entries.find((e) => e.operation === "internal_error")!.message)).not.toContain("2026-13-01"); // valor redigido no log
    }
  });

  it("4xx cuja CAUSA é erro do driver (texto fora do catálogo): sanitizado pela cadeia de causa; driverCode no log", async () => {
    const { call } = await loadServer();
    const { status, err } = await call("driverCause");
    expect([status, err.data.code]).toEqual([404, "NOT_FOUND"]);
    expect(JSON.stringify(err)).not.toMatch(/licitacoes_internas|xyz/);
    expect(err.data.correlationId).toBe("corr-frente-b");
    expect(logs.entries.find((e) => e.operation === "internal_error")).toMatchObject({ code: "NOT_FOUND", driverCode: "ER_UNKNOWN_ERROR", correlationId: "corr-frente-b" });
  });

  it("mensagem FUNCIONAL legítima (domínio, mesmo com cause) NÃO é suprimida e não polui o log interno", async () => {
    const { call } = await loadServer();
    const { status, err } = await call("domainBadRequest");
    expect(status).toBe(400);
    expect(err.message).toBe("Transição inválida: o contrato encerrado não pode voltar a vigente.");
    expect(logs.entries.filter((e) => e.operation === "internal_error")).toEqual([]);
  });

  it("erro do Express FORA do tRPC (JSON malformado no body-parser): sem stack/caminhos, status e correlationId preservados", async () => {
    vi.resetModules();
    const express = (await import("express")).default;
    const { correlationMiddleware } = await import("../../middleware/correlationMiddleware");
    const { expressErrorHandler } = await import("../../_core/errorLogging");
    const { IS_DEVELOPMENT } = await import("../../config/env");
    const app = express();
    app.use(correlationMiddleware);
    app.use(express.json({ limit: "10mb" }));
    app.post("/api/trpc/x", (_req, res) => { res.json({ ok: true }); });
    app.use(expressErrorHandler(IS_DEVELOPMENT));
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/trpc/x`, {
        method: "POST", headers: { "content-type": "application/json", "x-correlation-id": "corr-express" }, body: "{malformado",
      });
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(text).not.toMatch(/node_modules|body-parser|\.js:\d+|at /);
      expect(JSON.parse(text)).toEqual({ error: { message: "Requisição inválida.", status: 400, correlationId: "corr-express" } });
      expect(logs.entries.find((e) => e.operation === "unhandled_error")).toMatchObject({ status: 400, correlationId: "corr-express" });
    } finally {
      server.close();
    }
  });
});

describe("APP_ENV=development — diagnóstico mantido para o desenvolvedor", () => {
  it("stack e mensagem original continuam disponíveis em development", async () => {
    env.app = "development";
    const { call } = await loadServer();
    const { err } = await call("boom");
    expect(typeof err.data.stack).toBe("string");
    expect(err.message).toBe(SQL_LEAK);
  });
});

describe("caminhos concretos que convertem QUALQUER erro em 4xx com `e.message`", () => {
  it("todos repassam o erro original como `cause` (o formatador central reconhece o erro do driver na cadeia)", () => {
    const dir = path.join(process.cwd(), "server/routers");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
        const catchAll = /new TRPCError\(\{[^}]*message: (?:\((?:e|err|error) as Error\)\.message|(?:e|err|error) instanceof Error \? (?:e|err|error)\.message)/.test(line);
        if (catchAll && !/cause: (?:e|err|error)\b/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
