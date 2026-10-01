/**
 * NEW-002 — `lgpd.deleteMyAccount` NÃO pode mais apagar fisicamente a conta e os dados do usuário.
 *
 * Contrato:
 *  - a procedure continua registrada (mutation, sem input), mas a PRIMEIRA instrução recusa com
 *    FORBIDDEN + token estável ACCOUNT_HARD_DELETE_DISABLED — para usuário comum, admin/owner de órgão e
 *    admin de plataforma;
 *  - `db.deleteUserData` (cascata física) NUNCA é chamado; nenhuma leitura/escrita de banco ocorre;
 *  - erro idêntico para qualquer ator (determinístico);
 *  - evento `account_hard_delete_refused` com actorUserId + correlationId, sem PII;
 *  - freeze estático: nenhuma rota do servidor referencia `deleteUserData`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../db");

import { lgpdRouter } from "../../routers/lgpdRouter";
import * as db from "../../db";
import {
  ACCOUNT_HARD_DELETE_DISABLED,
  ACCOUNT_HARD_DELETE_DISABLED_MESSAGE,
  throwAccountHardDeleteDisabled,
} from "../../services/accountRemovalGuard";
import { mockUser, mockAdmin } from "../helpers/fixtures";

type Role = "user" | "admin";
type OrgRole = "operator" | "admin" | "owner" | null;

const SERVER_ROOT = join(__dirname, "..", "..");
const PII_EMAIL = "titular.pii@orgao.gov.br";
const PII_NAME = "Titular Com Nome Pessoal";

function ctxFor(id: number, role: Role, orgRole: OrgRole, correlationId: string) {
  return {
    user: { ...(role === "admin" ? mockAdmin : mockUser), id, role, email: PII_EMAIL, name: PII_NAME },
    req: { headers: { "x-organization-id": "4242" }, ip: "127.0.0.1" },
    res: { cookie: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() },
    correlationId,
    requestId: `req-${correlationId}`,
    organizationId: orgRole ? 4242 : null,
    orgMembership: orgRole
      ? { id: 1, organizationId: 4242, userId: id, role: orgRole, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }
      : null,
  } as unknown as Parameters<typeof lgpdRouter.createCaller>[0];
}

const ACTORS: Array<{ label: string; id: number; role: Role; orgRole: OrgRole }> = [
  { label: "usuário comum", id: 101, role: "user", orgRole: "operator" },
  { label: "admin do órgão", id: 102, role: "user", orgRole: "admin" },
  { label: "owner do órgão", id: 103, role: "user", orgRole: "owner" },
  { label: "admin de plataforma", id: 104, role: "admin", orgRole: null },
];

async function errOf(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { code: x.code, message: x.message };
  }
  return { code: "RESOLVED", message: "" };
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
    .filter((e): e is Record<string, unknown> => !!e && e.operation === "account_hard_delete_refused");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NEW-002 — lgpd.deleteMyAccount desativado (sem exclusão física)", () => {
  for (const a of ACTORS) {
    it(`${a.label} ⇒ FORBIDDEN com ACCOUNT_HARD_DELETE_DISABLED e deleteUserData NUNCA chamado`, async () => {
      const cap = captureWarn();
      let err;
      try {
        err = await errOf(() => lgpdRouter.createCaller(ctxFor(a.id, a.role, a.orgRole, `corr-${a.id}`)).deleteMyAccount());
      } finally {
        cap.restore();
      }
      expect(err).toEqual({ code: "FORBIDDEN", message: ACCOUNT_HARD_DELETE_DISABLED_MESSAGE });
      expect(err?.message).toContain(ACCOUNT_HARD_DELETE_DISABLED);
      expect(db.deleteUserData).not.toHaveBeenCalled();
      // nenhuma outra operação de banco foi disparada pelo handler
      for (const fn of Object.values(db)) {
        if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
      }
      const events = refusedEvents(cap.lines);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: "warn",
        service: "accountRemovalGuard",
        operation: "account_hard_delete_refused",
        actorUserId: a.id,
        correlationId: `corr-${a.id}`,
      });
    });
  }

  it("erro determinístico: idêntico para todos os atores e em chamadas repetidas", async () => {
    const cap = captureWarn();
    const errors = [];
    try {
      for (const a of ACTORS) {
        const c = lgpdRouter.createCaller(ctxFor(a.id, a.role, a.orgRole, `corr-det-${a.id}`));
        errors.push(await errOf(() => c.deleteMyAccount()));
        errors.push(await errOf(() => c.deleteMyAccount()));
      }
    } finally {
      cap.restore();
    }
    expect(new Set(errors.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(db.deleteUserData).not.toHaveBeenCalled();
  });

  it("mensagem pt-BR orienta a procurar administrador / encarregado (DPO) por processo governado", () => {
    expect(ACCOUNT_HARD_DELETE_DISABLED).toBe("ACCOUNT_HARD_DELETE_DISABLED");
    expect(ACCOUNT_HARD_DELETE_DISABLED_MESSAGE).toMatch(/exclusão de conta por autoatendimento não está disponível/);
    expect(ACCOUNT_HARD_DELETE_DISABLED_MESSAGE).toMatch(/administrador/);
    expect(ACCOUNT_HARD_DELETE_DISABLED_MESSAGE).toMatch(/encarregado/);
    expect(ACCOUNT_HARD_DELETE_DISABLED_MESSAGE).toMatch(/DPO/);
    expect(ACCOUNT_HARD_DELETE_DISABLED_MESSAGE).toMatch(/processo governado/);
  });

  it("evento de recusa não contém PII (e-mail, nome) nem campos além de actorUserId/correlationId", async () => {
    const cap = captureWarn();
    try {
      await errOf(() => lgpdRouter.createCaller(ctxFor(101, "user", "operator", "corr-pii")).deleteMyAccount());
    } finally {
      cap.restore();
    }
    const all = cap.lines.join("\n");
    expect(all).not.toContain(PII_EMAIL);
    expect(all).not.toContain(PII_NAME);
    const [e] = refusedEvents(cap.lines);
    expect(Object.keys(e).sort()).toEqual(["actorUserId", "correlationId", "level", "operation", "service", "ts"]);
  });

  it("guard é seguro sem contexto (null) e ainda assim recusa", () => {
    const cap = captureWarn();
    try {
      expect(() => throwAccountHardDeleteDisabled(null)).toThrow(ACCOUNT_HARD_DELETE_DISABLED);
    } finally {
      cap.restore();
    }
    expect(refusedEvents(cap.lines)[0]).toMatchObject({ actorUserId: null, correlationId: null });
  });

  it("não autenticado continua UNAUTHORIZED (protectedProcedure preservado) e nada é chamado", async () => {
    const c = lgpdRouter.createCaller({ ...(ctxFor(1, "user", null, "x") as object), user: null } as never);
    expect((await errOf(() => c.deleteMyAccount())).code).toBe("UNAUTHORIZED");
    expect(db.deleteUserData).not.toHaveBeenCalled();
  });
});

describe("NEW-002 — freeze estático", () => {
  it("deleteMyAccount continua registrado como mutation sem input", () => {
    const def = (lgpdRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; inputs: unknown[] } }> } })._def.procedures;
    expect(Object.keys(def).sort()).toEqual(["checkConsent", "deleteMyAccount", "exportMyData", "recordConsent"]);
    expect(def.deleteMyAccount._def.type).toBe("mutation");
    expect(def.deleteMyAccount._def.inputs).toHaveLength(0);
  });

  it("a PRIMEIRA instrução do handler é o guard e o router não referencia deleteUserData", () => {
    const src = readFileSync(join(SERVER_ROOT, "routers", "lgpdRouter.ts"), "utf8");
    expect(src).not.toMatch(/deleteUserData\s*\(/);
    expect(src).toMatch(/deleteMyAccount: protectedProcedure\s*\.mutation\(async \(\{ ctx \}\) => \{\s*throwAccountHardDeleteDisabled\(ctx\);\s*\}\)/);
  });

  it("nenhum arquivo .ts do servidor chama deleteUserData (só resta a definição em db/lgpd.ts)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "node_modules" || name === "__tests__") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name)) {
          const matches = readFileSync(p, "utf8").match(/^.*\bdeleteUserData\s*\(.*$/gm) ?? [];
          for (const m of matches) hits.push(`${relative(SERVER_ROOT, p).split("\\").join("/")}: ${m.trim()}`);
        }
      }
    };
    walk(SERVER_ROOT);
    expect(hits).toEqual(["db/lgpd.ts: export async function deleteUserData(userId: number) {"]);
  });
});
