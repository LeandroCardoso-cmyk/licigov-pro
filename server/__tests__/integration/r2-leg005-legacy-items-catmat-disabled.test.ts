/**
 * R2 / LEG-005 — Desligamento GOVERNADO das procedures legadas de itens do TR / CATMAT em
 * `processesRouter` (decisão humana 27/09/2026 = DISABLE).
 *
 * Contrato provado aqui (mocks — sem banco, sem IA):
 *  - as 9 procedures continuam REGISTRADAS (mesmo tipo query/mutation), mas TODA chamada é recusada com
 *    FORBIDDEN + token estável `LEGACY_ENDPOINT_DISABLED`;
 *  - a recusa acontece ANTES de qualquer efeito: zero chamadas a helpers de `server/db`, a
 *    `catmatMatcher.findCatmatMatches`, a `aiUsageTracker.*`, a `invokeLLM` e ao parser `xlsx`
 *    (em especial `generateCatmatSuggestions`, que ANTES chamava IA e o tracker de uso ANTES do
 *    tenant-check — agora nem a IA nem o rastreio de uso podem acontecer);
 *  - o erro é IDÊNTICO para owner / operator / viewer e para ids do próprio tenant, de outro tenant
 *    ou inexistentes (não revela existência de recurso);
 *  - um evento `legacy_endpoint_disabled` é registrado com surfaceId LEG-005, procedure, tenant e ator
 *    do CONTEXTO — e sem nenhum pedaço do input do cliente;
 *  - a autenticação continua exigida (sem usuário → UNAUTHORIZED, antes do guard).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures/mocks de teste */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../db");
vi.mock("../../services/catmatMatcher");
vi.mock("../../services/aiUsageTracker");
vi.mock("../../_core/llm");
vi.mock("xlsx", () => ({
  read: vi.fn(),
  utils: { sheet_to_json: vi.fn() },
  default: { read: vi.fn(), utils: { sheet_to_json: vi.fn() } },
}));

const tenantState = vi.hoisted(() => ({ organizationId: 1, role: "owner" as string }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => ({
    organizationId: tenantState.organizationId,
    membership: {
      id: 1, organizationId: tenantState.organizationId, userId, role: tenantState.role,
      invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date(),
    },
  })),
  getMembership: vi.fn(),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { processesRouter } from "../../routers/processesRouter";
import * as db from "../../db";
import * as catmatMatcher from "../../services/catmatMatcher";
import * as aiUsageTracker from "../../services/aiUsageTracker";
import * as llm from "../../_core/llm";
import * as XLSX from "xlsx";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";
import { makeContext, mockUser } from "../helpers/fixtures";

// ─── Superfície LEG-005 ──────────────────────────────────────────────────────

const SENTINEL = "SENTINELA-PAYLOAD-LEG005-nao-pode-vazar";

type Kind = "query" | "mutation";
type Leg005Proc = { name: string; kind: Kind; input: (ids: { process: number; item: number; suggestion: number }) => any };

const LEG005_PROCEDURES: readonly Leg005Proc[] = [
  { name: "addItemsToTR", kind: "mutation", input: (i) => ({ processId: i.process, items: [{ itemType: "material", description: SENTINEL, unit: "UN", quantity: 3 }] }) },
  { name: "getProcessItems", kind: "query", input: (i) => ({ processId: i.process }) },
  { name: "parseItemsFile", kind: "mutation", input: () => ({ fileContent: SENTINEL, fileName: `${SENTINEL}.xlsx`, columnMapping: { description: 0 }, previewOnly: false }) },
  { name: "generateCatmatSuggestions", kind: "mutation", input: (i) => ({ processItemId: i.item, description: SENTINEL, itemType: "material" }) },
  { name: "getCatmatSuggestions", kind: "query", input: (i) => ({ processItemId: i.item }) },
  { name: "approveCatmatSuggestion", kind: "mutation", input: (i) => ({ suggestionId: i.suggestion, processItemId: i.item }) },
  { name: "rejectCatmatSuggestion", kind: "mutation", input: (i) => ({ suggestionId: i.suggestion }) },
  { name: "updateProcessItem", kind: "mutation", input: (i) => ({ itemId: i.item, description: SENTINEL, catmatCode: "123456" }) },
  { name: "deleteProcessItem", kind: "mutation", input: (i) => ({ itemId: i.item }) },
];

// ids "do próprio tenant", "de outro tenant" e "inexistentes" — o guard não os consulta, então o
// erro precisa ser o mesmo para todos.
const ID_SETS = {
  own: { process: 10, item: 20, suggestion: 30 },
  crossTenant: { process: 910, item: 920, suggestion: 930 },
  missing: { process: 999_999_991, item: 999_999_992, suggestion: 999_999_993 },
} as const;

const ROLES = ["owner", "operator", "viewer"] as const;

function ctxFor(userId = mockUser.id) {
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: "corr-leg005-test" } as any;
}

async function callProc(p: Leg005Proc, ids: { process: number; item: number; suggestion: number }, userId?: number) {
  const caller = processesRouter.createCaller(ctxFor(userId)) as any;
  return caller[p.name](p.input(ids));
}

async function captureError(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("esperava recusa, mas a procedure retornou com sucesso");
}

/** Todas as funções exportadas por um módulo automockado (vi.fn). */
function mockedFns(mod: Record<string, unknown>): [string, ReturnType<typeof vi.fn>][] {
  return Object.entries(mod).filter(([, v]) => vi.isMockFunction(v)) as [string, ReturnType<typeof vi.fn>][];
}

function calledFns(mod: Record<string, unknown>): string[] {
  return mockedFns(mod).filter(([, fn]) => fn.mock.calls.length > 0).map(([k]) => k);
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("R2 / LEG-005 — itens do TR / CATMAT legados desativados (governado)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.organizationId = 1;
    tenantState.role = "owner";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  function disabledEvents(): any[] {
    return warnSpy.mock.calls
      .map((args: unknown[]) => { try { return JSON.parse(String(args[0])); } catch { return null; } })
      .filter((e: any) => e && e.operation === "legacy_endpoint_disabled");
  }

  function allConsoleOutput(): string {
    return [warnSpy, infoSpy, errorSpy, logSpy]
      .flatMap((s) => s.mock.calls.map((args: unknown[]) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")))
      .join("\n");
  }

  it("a superfície LEG-005 são exatamente 9 procedures, todas ainda registradas com o mesmo tipo", () => {
    const procs = (processesRouter as any)._def.procedures as Record<string, any>;
    expect(LEG005_PROCEDURES).toHaveLength(9);
    for (const p of LEG005_PROCEDURES) {
      expect(procs[p.name], `processes.${p.name} deve continuar registrada`).toBeDefined();
      expect(procs[p.name]._def.type, `processes.${p.name} mantém o tipo`).toBe(p.kind);
    }
  });

  for (const p of LEG005_PROCEDURES) {
    describe(`processes.${p.name}`, () => {
      it("recusa com FORBIDDEN + LEGACY_ENDPOINT_DISABLED e aponta a alternativa canônica", async () => {
        const err = await captureError(() => callProc(p, ID_SETS.own));
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain(LEGACY_ENDPOINT_DISABLED);
        expect(err.message).toContain("itemIntelligence");
      });

      it("não toca banco, IA, rastreio de uso nem parser (zero chamadas)", async () => {
        await captureError(() => callProc(p, ID_SETS.own));
        expect(calledFns(db as any), "helpers de server/db chamados").toEqual([]);
        expect(calledFns(catmatMatcher as any), "catmatMatcher chamado").toEqual([]);
        expect(calledFns(aiUsageTracker as any), "aiUsageTracker chamado").toEqual([]);
        expect(calledFns(llm as any), "invokeLLM/llm chamado").toEqual([]);
        expect(vi.mocked(XLSX.read)).not.toHaveBeenCalled();
      });

      it("erro idêntico para owner/operator/viewer e para ids próprios, cross-tenant e inexistentes", async () => {
        const seen = new Set<string>();
        for (const role of ROLES) {
          tenantState.role = role;
          for (const ids of Object.values(ID_SETS)) {
            const err = await captureError(() => callProc(p, ids));
            seen.add(JSON.stringify({ code: err.code, message: err.message }));
          }
        }
        // Outro tenant chamando com os ids do tenant 1 → mesmo erro.
        tenantState.organizationId = 2;
        tenantState.role = "owner";
        const errOtherOrg = await captureError(() => callProc(p, ID_SETS.own, 2));
        seen.add(JSON.stringify({ code: errOtherOrg.code, message: errOtherOrg.message }));

        expect(seen.size, `respostas distintas: ${[...seen].join(" | ")}`).toBe(1);
        expect(calledFns(db as any)).toEqual([]);
      });

      it("registra evento legacy_endpoint_disabled (LEG-005) com contexto, sem o input do cliente", async () => {
        tenantState.organizationId = 7;
        await captureError(() => callProc(p, ID_SETS.crossTenant, 42));
        const events = disabledEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          level: "warn",
          service: "legacyEndpointGuard",
          operation: "legacy_endpoint_disabled",
          procedure: `processes.${p.name}`,
          surfaceId: "LEG-005",
          organizationId: 7,
          actorUserId: 42,
          correlationId: "corr-leg005-test",
        });
        // Nenhuma chave de input e nenhum valor do payload no evento (nem em qualquer saída de log).
        const keys = Object.keys(events[0]).sort();
        expect(keys).toEqual(["actorUserId", "correlationId", "level", "operation", "organizationId", "procedure", "service", "surfaceId", "ts"]);
        expect(allConsoleOutput()).not.toContain(SENTINEL);
        const { ts: _ts, ...withoutTs } = events[0];
        const serialized = JSON.stringify(withoutTs);
        for (const id of Object.values(ID_SETS.crossTenant)) {
          expect(serialized).not.toContain(String(id));
        }
      });
    });
  }

  it("generateCatmatSuggestions: nem IA nem rastreio de uso acontecem, mesmo com matcher 'pronto' para responder", async () => {
    // Antes do LEG-005 o handler chamava findCatmatMatches e trackCATMATMatching ANTES do tenant-check.
    vi.mocked(catmatMatcher.findCatmatMatches).mockResolvedValue([
      { code: "CAT-1", description: "x", confidence: 90, reasoning: "r", requiresHumanValidation: true },
    ]);
    const p = LEG005_PROCEDURES.find((x) => x.name === "generateCatmatSuggestions")!;
    for (const role of ROLES) {
      tenantState.role = role;
      const err = await captureError(() => callProc(p, ID_SETS.crossTenant));
      expect(err.code).toBe("FORBIDDEN");
    }
    expect(catmatMatcher.findCatmatMatches).not.toHaveBeenCalled();
    expect(aiUsageTracker.trackCATMATMatching).not.toHaveBeenCalled();
    expect(llm.invokeLLM).not.toHaveBeenCalled();
    expect(db.createCatmatSuggestionForOrganization).not.toHaveBeenCalled();
    expect(db.trackAIUsage).not.toHaveBeenCalled();
  });

  it("autenticação continua exigida: sem usuário → UNAUTHORIZED (antes do guard, sem evento)", async () => {
    for (const p of LEG005_PROCEDURES) {
      const caller = processesRouter.createCaller(makeContext(null)) as any;
      const err = await captureError(() => caller[p.name](p.input(ID_SETS.own)));
      expect(err.code).toBe("UNAUTHORIZED");
    }
    expect(disabledEvents()).toHaveLength(0);
    expect(calledFns(db as any)).toEqual([]);
  });

  it("procedures fora do escopo LEG-005 mantêm o comportamento da main (list/search/getById vivas; updateStatus segue LEG-006)", async () => {
    vi.mocked(db.listProcessesForOrganization).mockResolvedValue([] as any);
    vi.mocked(db.searchProcessesForOrganization).mockResolvedValue([] as any);
    const caller = processesRouter.createCaller(ctxFor()) as any;
    await expect(caller.list()).resolves.toEqual([]);
    await expect(caller.search({ query: "x" })).resolves.toEqual([]);
    vi.mocked(db.getProcessByIdForOrganization).mockResolvedValue(undefined as any);
    await expect(caller.getById({ id: 1 })).rejects.toThrow(/não encontrado/i);
    expect(disabledEvents()).toHaveLength(0);

    // R2 / PR-02: processes.updateStatus já está desativada pela LEG-006 — o LEG-005 não a revive.
    const err = await captureError(() => caller.updateStatus({ id: 1, status: "em_etp" }));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain(LEGACY_ENDPOINT_DISABLED);
    expect(disabledEvents().map((e) => [e.procedure, e.surfaceId])).toEqual([["processes.updateStatus", "LEG-006"]]);
    expect(db.updateProcessStatusForOrganization).not.toHaveBeenCalled();
  });
});

// ─── Freeze de fonte: o guard é a primeira instrução e nada mais roda ─────────

describe("R2 / LEG-005 — freeze de fonte do processesRouter", () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), "server/routers/processesRouter.ts"), "utf8");

  function handlerBody(name: string): string {
    const start = SRC.indexOf(`\n  ${name}: tenantProcedure`);
    expect(start, `${name} não encontrado no fonte`).toBeGreaterThan(-1);
    const rest = SRC.slice(start + 1);
    const next = rest.search(/\n {2}[A-Za-z]+: tenantProcedure/);
    const block = next === -1 ? rest : rest.slice(0, next);
    const open = block.search(/\.(query|mutation)\(async \(/);
    expect(open, `${name} sem handler`).toBeGreaterThan(-1);
    return block.slice(open);
  }

  for (const { name } of LEG005_PROCEDURES) {
    it(`${name}: primeira instrução é throwLegacyEndpointDisabled("processes.${name}", LEG-005) e não há efeito`, () => {
      const body = handlerBody(name);
      const statements = body
        .slice(body.indexOf("=> {") + "=> {".length)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//"));
      expect(statements[0]).toBe(`throwLegacyEndpointDisabled("processes.${name}", LEG005, ctx, LEG005_ALTERNATIVE);`);
      expect(body).not.toMatch(/\bawait\b|\bdb\.|import\(|createActivityLog|findCatmatMatches|trackCATMATMatching|invokeLLM|XLSX/);
    });
  }

  it("LEG005 = 'LEG-005' e o guard compartilhado é importado logo após TRPCError", () => {
    expect(SRC).toContain('const LEG005 = "LEG-005";');
    expect(SRC).toMatch(
      /import \{ TRPCError \} from "@trpc\/server";\nimport \{ throwLegacyEndpointDisabled \} from "\.\.\/services\/legacyEndpointGuard";\n/,
    );
    // Nenhuma importação em runtime da IA de CATMAT ou do tracker de uso permanece no router.
    expect(SRC).not.toMatch(/import\(["']\.\.\/services\/(catmatMatcher|aiUsageTracker)["']\)/);
    expect(SRC).not.toMatch(/^import (?!type)[^\n]*services\/(catmatMatcher|aiUsageTracker)/m);
  });
});
