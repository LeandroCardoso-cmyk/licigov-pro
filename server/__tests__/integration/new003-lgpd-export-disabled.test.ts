/**
 * NEW-003 (P1 SECURITY) — `lgpd.exportMyData` NÃO pode devolver segredos nem dados institucionais.
 *
 * Contrato:
 *  - a procedure continua registrada (mutation, sem input), mas a PRIMEIRA instrução recusa com
 *    FORBIDDEN + token estável LGPD_EXPORT_DISABLED — para usuário sem órgão, viewer, operator, manager,
 *    owner, admin de plataforma, membership ativa ou inativa;
 *  - `db.exportUserData` NUNCA é chamado; nenhuma leitura de banco ocorre (zero DB read após o guard);
 *  - erro idêntico para qualquer ator (determinístico) e SEM payload (zero leak) — inclusive no fio HTTP
 *    com superjson;
 *  - evento `lgpd_export_refused` com actorUserId + correlationId, sem PII;
 *  - freeze estático: nenhuma rota do servidor referencia `exportUserData`;
 *  - guarda de reativação: se um dia `exportMyData` voltar a devolver dados, o JSON NUNCA pode conter
 *    `LGPD_EXPORT_FORBIDDEN_KEYS` (passwordHash, signaturePassword, tokenVersion, openId, s3Key, fileUrl).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import superjson from "superjson";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../db");
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => { throw new Error("NEW-003: nenhum acesso a banco é permitido"); }) }));

import { lgpdRouter } from "../../routers/lgpdRouter";
import { router } from "../../_core/trpc";
import * as db from "../../db";
import { getDb } from "../../db/connection";
import {
  LGPD_EXPORT_DISABLED,
  LGPD_EXPORT_DISABLED_MESSAGE,
  LGPD_EXPORT_FORBIDDEN_KEYS,
} from "../../services/lgpdExportGuard";
import { mockUser, mockAdmin } from "../helpers/fixtures";

type Role = "user" | "admin";
type OrgRole = "viewer" | "operator" | "manager" | "admin" | "owner" | null;

const SERVER_ROOT = join(__dirname, "..", "..");
const PII_EMAIL = "titular.pii@orgao.gov.br";
const PII_NAME = "Titular Com Nome Pessoal";
const FORBIDDEN_RE = new RegExp(LGPD_EXPORT_FORBIDDEN_KEYS.join("|"));
const BCRYPT_RE = /\$2[aby]\$\d{2}\$/;
/** Código sem comentários (freeze estático sobre código executável, não sobre documentação). */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// Linha COMPLETA de `users` como o caminho antigo devolvia (valores fictícios, formato bcrypt).
const FULL_USER_ROW = {
  ...mockUser, id: 101, email: PII_EMAIL, name: PII_NAME,
  openId: "open-id-subject", passwordHash: "$2b$10$abcdefghijklmnopqrstuuFAKEFAKEFAKEFAKEFAKEFAKEFAKEFA",
  signaturePassword: "$2b$10$zyxwvutsrqponmlkjihgfeSIGNSIGNSIGNSIGNSIGNSIGNSIGNSIG", tokenVersion: 7,
};

function ctxFor(id: number, role: Role, orgRole: OrgRole, correlationId: string, active = true) {
  return {
    user: { ...(role === "admin" ? mockAdmin : mockUser), id, role, email: PII_EMAIL, name: PII_NAME },
    req: { headers: { "x-organization-id": "4242" }, ip: "127.0.0.1" },
    res: { cookie: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() },
    correlationId,
    requestId: `req-${correlationId}`,
    organizationId: orgRole ? 4242 : null,
    orgMembership: orgRole
      ? { id: 1, organizationId: 4242, userId: id, role: orgRole, invitedBy: null, ativo: active, createdAt: new Date(), updatedAt: new Date() }
      : null,
  } as unknown as Parameters<typeof lgpdRouter.createCaller>[0];
}

const ACTORS: Array<{ label: string; id: number; role: Role; orgRole: OrgRole; active?: boolean }> = [
  { label: "usuário autenticado sem órgão", id: 100, role: "user", orgRole: null },
  { label: "viewer", id: 101, role: "user", orgRole: "viewer" },
  { label: "operator", id: 102, role: "user", orgRole: "operator" },
  { label: "manager", id: 103, role: "user", orgRole: "manager" },
  { label: "admin do órgão", id: 104, role: "user", orgRole: "admin" },
  { label: "owner do órgão", id: 105, role: "user", orgRole: "owner" },
  { label: "admin de plataforma", id: 106, role: "admin", orgRole: null },
  { label: "membership INATIVA (servidor desligado)", id: 107, role: "user", orgRole: "operator", active: false },
];

async function errOf(fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    return { code: "RESOLVED", message: "", result: r };
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { code: x.code, message: x.message };
  }
}

function captureWarn() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
}

function refusedEvents(lines: string[]) {
  return lines
    .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
    .filter((e): e is Record<string, unknown> => !!e && e.operation === "lgpd_export_refused");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Se o handler (indevidamente) chamasse o caminho antigo, receberia a linha completa com segredos.
  vi.mocked(db.exportUserData).mockResolvedValue({
    user: FULL_USER_ROW, processes: [], documents: [{ id: 1, s3Key: "k", fileUrl: "u" }], comments: [],
    notifications: [], consents: [], activities: [], exportedAt: new Date().toISOString(),
  } as never);
});

describe("NEW-003 — lgpd.exportMyData desativado (zero leak)", () => {
  for (const a of ACTORS) {
    it(`${a.label} ⇒ FORBIDDEN LGPD_EXPORT_DISABLED; exportUserData e getDb NUNCA chamados`, async () => {
      const cap = captureWarn();
      let err;
      try {
        err = await errOf(() => lgpdRouter.createCaller(ctxFor(a.id, a.role, a.orgRole, `corr-${a.id}`, a.active ?? true)).exportMyData());
      } finally {
        cap.restore();
      }
      expect(err).toEqual({ code: "FORBIDDEN", message: LGPD_EXPORT_DISABLED_MESSAGE });
      expect(err?.message).toContain(LGPD_EXPORT_DISABLED);
      expect(JSON.stringify(err)).not.toMatch(FORBIDDEN_RE);
      expect(JSON.stringify(err)).not.toMatch(BCRYPT_RE);
      expect(db.exportUserData).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
      for (const fn of Object.values(db)) {
        if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
      }
      const events = refusedEvents(cap.lines);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: "warn", service: "lgpdExportGuard", operation: "lgpd_export_refused",
        actorUserId: a.id, correlationId: `corr-${a.id}`,
      });
      const raw = JSON.stringify(events[0]);
      expect(raw).not.toContain(PII_EMAIL);
      expect(raw).not.toContain(PII_NAME);
    });
  }

  it("erro determinístico: idêntico para todos os atores e em chamadas repetidas", async () => {
    const cap = captureWarn();
    const errors: unknown[] = [];
    try {
      for (let round = 0; round < 3; round++) {
        for (const a of ACTORS) {
          errors.push(await errOf(() => lgpdRouter.createCaller(ctxFor(a.id, a.role, a.orgRole, `r${round}-${a.id}`, a.active ?? true)).exportMyData()));
        }
      }
    } finally {
      cap.restore();
    }
    expect(new Set(errors.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(db.exportUserData).not.toHaveBeenCalled();
  });

  it("sem sessão ⇒ UNAUTHORIZED (o guard de autenticação continua precedendo)", async () => {
    const ctx = { ...ctxFor(1, "user", null, "anon"), user: null } as unknown as Parameters<typeof lgpdRouter.createCaller>[0];
    const err = await errOf(() => lgpdRouter.createCaller(ctx).exportMyData());
    expect(err.code).toBe("UNAUTHORIZED");
    expect(db.exportUserData).not.toHaveBeenCalled();
  });

  it("fio HTTP (fetch adapter + superjson): corpo de erro sem chaves proibidas nem hash bcrypt", async () => {
    const app = router({ lgpd: lgpdRouter });
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/lgpd.exportMyData", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: null }),
      }),
      router: app,
      createContext: () => ctxFor(102, "user", "operator", "wire") as never,
      onError: () => {},
    });
    const body = await res.text();
    expect(res.status).toBe(403);
    expect(body).toContain(LGPD_EXPORT_DISABLED);
    expect(body).not.toMatch(FORBIDDEN_RE);
    expect(body).not.toMatch(BCRYPT_RE);
    expect(body).not.toContain(PII_EMAIL);
    expect(superjson.parse(JSON.stringify((JSON.parse(body) as { error: unknown }).error))).toBeTruthy();
    expect(db.exportUserData).not.toHaveBeenCalled();
  });
});

describe("NEW-003 — freeze estático e guarda de reativação", () => {
  it("exportMyData continua registrado como mutation sem input (contrato da API não some)", () => {
    const def = (lgpdRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; inputs: unknown[] } }> } })._def.procedures;
    expect(Object.keys(def)).toContain("exportMyData");
    expect(def.exportMyData._def.type).toBe("mutation");
    expect(def.exportMyData._def.inputs).toHaveLength(0);
  });

  it("a PRIMEIRA instrução do handler é o guard e o router não referencia exportUserData", () => {
    const src = readFileSync(join(SERVER_ROOT, "routers", "lgpdRouter.ts"), "utf8");
    const handler = src.split("exportMyData: protectedProcedure")[1].split("}),")[0];
    const body = handler.split("=> {")[1].trim();
    expect(body.startsWith("throwLgpdExportDisabled(ctx);")).toBe(true);
    expect(stripComments(src)).not.toMatch(/exportUserData/);
  });

  it("nenhuma rota/serviço do servidor referencia exportUserData (só a definição deprecada em db/lgpd.ts)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f === "__tests__" || f === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && /\bexportUserData\b/.test(stripComments(readFileSync(p, "utf8")))) hits.push(relative(SERVER_ROOT, p));
      }
    };
    walk(SERVER_ROOT);
    expect(hits.sort()).toEqual(["db/lgpd.ts"]);
  });

  it("guarda de reativação: qualquer resultado de exportMyData NUNCA contém chaves proibidas", async () => {
    // Hoje recusa. Se um dia for reativado, este teste passa a validar o PAYLOAD real: allowlist obrigatória.
    const out = await errOf(() => lgpdRouter.createCaller(ctxFor(102, "user", "operator", "reactivation")).exportMyData());
    if (out.code === "RESOLVED") {
      const json = JSON.stringify(superjson.serialize((out as { result: unknown }).result));
      expect(json).not.toMatch(FORBIDDEN_RE);
      expect(json).not.toMatch(BCRYPT_RE);
    } else {
      expect(out).toEqual({ code: "FORBIDDEN", message: LGPD_EXPORT_DISABLED_MESSAGE });
    }
    expect(LGPD_EXPORT_FORBIDDEN_KEYS).toEqual(expect.arrayContaining(["passwordHash", "signaturePassword", "tokenVersion", "openId"]));
  });
});
