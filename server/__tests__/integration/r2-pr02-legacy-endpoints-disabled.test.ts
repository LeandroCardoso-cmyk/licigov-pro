/**
 * R2 / PR-02 — desligamento GOVERNADO das superfícies legadas LEG-006, LEG-008, LEG-010 e LEG-011
 * (inventário R2.1, decisão humana de 27/09/2026) — camada de dados MOCKADA (complementa o smoke MySQL real
 * `r2-pr02-legacy-endpoints-disabled-mysql-smoke.test.ts`).
 *
 * Procedures cobertas (continuam REGISTRADAS e com o MESMO schema de input):
 *  - LEG-006 `processes.updateStatus`                                 → "o fluxo canônico do Processo Licitatório"
 *  - LEG-008 `documents.submitForReview|approveDocument|rejectDocument` → "documentReview.*" (SEM-018)
 *  - LEG-010 `procurementProcess.updateStage`                         → "procurementProcess.issueProcess" (SEM-015)
 *  - LEG-011 `directProcurement.updateStage`                          → transições canônicas (ratify/publish) (FCC-02)
 *
 * Contrato verificado:
 *  - toda chamada é recusada com FORBIDDEN + token estável LEGACY_ENDPOINT_DISABLED;
 *  - ZERO efeito colateral: nenhuma função das camadas de dados (db, db/procurement, db/directProcurement,
 *    db/officialDocumentPromotions), de e-mail (sendStatusChangeEmail), activity log, storage é chamada;
 *  - evento estruturado `legacy_endpoint_disabled` com procedure + surfaceId + tenant/ator/correlationId do
 *    contexto e SEM o input do cliente;
 *  - viewer, operator, owner e chamador de OUTRO tenant recebem o MESMO erro (anti-enumeração: a recusa não
 *    depende de o recurso existir nem de a qual órgão pertence);
 *  - RBAC não é contornado: `procurementProcess.updateStage` segue `orgRoleProcedure("operator")` — o viewer é
 *    barrado ANTES do handler pelo gate de papel (e também sem efeito colateral);
 *  - o schema de input continua validando (input inválido ⇒ BAD_REQUEST, sem efeito).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tenant = vi.hoisted(() => ({ role: "operator" as string, org: 1 }));

/**
 * Substitui TODA função exportada do módulo por um spy inerte (retorna undefined). Qualquer chamada vira
 * evidência de efeito colateral / leitura antes da recusa.
 */
const spyAll = vi.hoisted(() => async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual)) out[k] = typeof v === "function" ? vi.fn() : v;
  return out;
});

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => ({
    organizationId: tenant.org,
    membership: {
      id: 1, organizationId: tenant.org, userId, role: tenant.role, invitedBy: null, ativo: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
  })),
}));
vi.mock("../../db", (io) => spyAll(io as never));
vi.mock("../../db/procurement", (io) => spyAll(io as never));
vi.mock("../../db/directProcurement", (io) => spyAll(io as never));
vi.mock("../../db/officialDocumentPromotions", (io) => spyAll(io as never));
// emailService instancia o cliente de e-mail no import (exige chave): mock explícito de TODAS as exportações.
vi.mock("../../services/emailService", () => ({
  sendEmailNotification: vi.fn(), sendMemberAddedEmail: vi.fn(), sendDocumentEditedEmail: vi.fn(),
  sendCommentAddedEmail: vi.fn(), sendDocumentApprovedEmail: vi.fn(), sendStatusChangeEmail: vi.fn(),
}));
vi.mock("../../services/activityLogService", (io) => spyAll(io as never));
vi.mock("../../storage", (io) => spyAll(io as never));

import * as db from "../../db";
import * as dbProcurement from "../../db/procurement";
import * as dbDirect from "../../db/directProcurement";
import * as dbOfficial from "../../db/officialDocumentPromotions";
import * as emailService from "../../services/emailService";
import * as activityLogService from "../../services/activityLogService";
import * as storage from "../../storage";
import { processesRouter } from "../../routers/processesRouter";
import { documentsRouter } from "../../routers/documentsRouter";
import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { directProcurementRouter } from "../../routers/directProcurementRouter";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";

const ORG_A = 1;
const ORG_B = 2;
const SENTINEL = "SENTINEL-PAYLOAD-R2PR02";
const SENTINEL_ID = 424242;

type Ctx = Parameters<typeof processesRouter.createCaller>[0];
function ctxFor(userId: number, correlationId: string): Ctx {
  return {
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
    req: { headers: {}, ip: "127.0.0.1" },
    res: {},
    correlationId,
  } as unknown as Ctx;
}

interface Surface {
  procedure: string;
  surfaceId: string;
  alternative: string;
  /** o viewer é barrado pelo gate de papel antes do handler (orgRoleProcedure) */
  viewerBlockedByRbac: boolean;
  call: (ctx: Ctx) => Promise<unknown>;
}

const SURFACES: Surface[] = [
  {
    procedure: "processes.updateStatus", surfaceId: "LEG-006", alternative: "o fluxo canônico do Processo Licitatório",
    viewerBlockedByRbac: false,
    call: (c) => processesRouter.createCaller(c).updateStatus({ id: SENTINEL_ID, status: "concluido" }),
  },
  {
    procedure: "documents.submitForReview", surfaceId: "LEG-008", alternative: "documentReview.*", viewerBlockedByRbac: false,
    call: (c) => documentsRouter.createCaller(c).submitForReview({ documentId: SENTINEL_ID }),
  },
  {
    procedure: "documents.approveDocument", surfaceId: "LEG-008", alternative: "documentReview.*", viewerBlockedByRbac: false,
    call: (c) => documentsRouter.createCaller(c).approveDocument({ documentId: SENTINEL_ID }),
  },
  {
    procedure: "documents.rejectDocument", surfaceId: "LEG-008", alternative: "documentReview.*", viewerBlockedByRbac: false,
    call: (c) => documentsRouter.createCaller(c).rejectDocument({ documentId: SENTINEL_ID, reason: SENTINEL }),
  },
  {
    procedure: "procurementProcess.updateStage", surfaceId: "LEG-010", alternative: "procurementProcess.issueProcess",
    viewerBlockedByRbac: true,
    call: (c) => procurementProcessRouter.createCaller(c).updateStage({ processId: SENTINEL, stage: "ISSUED" }),
  },
  {
    procedure: "directProcurement.updateStage", surfaceId: "LEG-011", alternative: "as transições canônicas (ratify/publish)",
    viewerBlockedByRbac: false,
    call: (c) => directProcurementRouter.createCaller(c).updateStage({ workspaceId: SENTINEL, stage: "PUBLICATION" }),
  },
];

const SIDE_EFFECT_MODULES: Array<[string, Record<string, unknown>]> = [
  ["db", db], ["db/procurement", dbProcurement], ["db/directProcurement", dbDirect],
  ["db/officialDocumentPromotions", dbOfficial], ["emailService", emailService],
  ["activityLogService", activityLogService], ["storage", storage],
];

/** Lista "modulo.funcao" de toda função mockada que foi chamada. */
function calledFunctions(): string[] {
  const called: string[] = [];
  for (const [name, mod] of SIDE_EFFECT_MODULES) {
    for (const [k, v] of Object.entries(mod)) {
      if (vi.isMockFunction(v) && v.mock.calls.length > 0) called.push(`${name}.${k}`);
    }
  }
  return called;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
function legacyEvents(): Array<{ raw: string; entry: Record<string, unknown> }> {
  return warnSpy.mock.calls
    .map((args) => String(args[0]))
    .filter((raw) => raw.includes("legacy_endpoint_disabled"))
    .map((raw) => ({ raw, entry: JSON.parse(raw) as Record<string, unknown> }));
}

async function errOf(p: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  try { await p; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
  return { code: "RESOLVED", message: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  tenant.role = "operator";
  tenant.org = ORG_A;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); });

describe("R2 / PR-02 — superfícies legadas desativadas (dados mockados)", () => {
  it("sanidade: as funções de efeito colateral usadas pelos handlers antigos estão sob spy", () => {
    for (const f of [
      db.getProcessByIdForOrganization, db.updateProcessStatusForOrganization, db.createActivityLog,
      db.getDocumentByIdForOrganization, db.updateDocumentStatusForOrganization,
      dbProcurement.getProcess, dbProcurement.updateProcessStage, dbProcurement.recordProcessEvent,
      dbDirect.getDirectProcurementWorkspace, dbDirect.updateDirectProcurementStage, emailService.sendStatusChangeEmail,
    ]) expect(vi.isMockFunction(f)).toBe(true);
  });

  it.each(SURFACES.map((s) => [s.procedure, s] as const))(
    "%s: FORBIDDEN + LEGACY_ENDPOINT_DISABLED, zero efeito colateral, evento sem payload",
    async (_name, s) => {
      tenant.role = "operator";
      const err = await errOf(s.call(ctxFor(10, `corr-${s.surfaceId}`)));
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toContain(LEGACY_ENDPOINT_DISABLED);
      expect(err.message).toContain(s.alternative);
      // a mensagem não ecoa o input nem identificadores
      expect(err.message).not.toContain(SENTINEL);
      expect(err.message).not.toContain(String(SENTINEL_ID));

      // zero leitura/escrita/e-mail/activity log/storage antes da recusa
      expect(calledFunctions()).toEqual([]);
      expect(emailService.sendStatusChangeEmail).not.toHaveBeenCalled();
      expect(db.createActivityLog).not.toHaveBeenCalled();

      const events = legacyEvents();
      expect(events).toHaveLength(1);
      expect(events[0].entry).toMatchObject({
        level: "warn", service: "legacyEndpointGuard", operation: "legacy_endpoint_disabled",
        procedure: s.procedure, surfaceId: s.surfaceId, organizationId: ORG_A, actorUserId: 10,
        correlationId: `corr-${s.surfaceId}`,
      });
      // sem o input do cliente (nem chaves, nem valores)
      expect(events[0].raw).not.toContain(SENTINEL);
      expect(events[0].raw).not.toContain(String(SENTINEL_ID));
      for (const key of ["input", "status", "stage", "reason", "documentId", "processId", "workspaceId", "email"]) {
        expect(Object.keys(events[0].entry)).not.toContain(key);
      }
    },
  );

  it.each(SURFACES.map((s) => [s.procedure, s] as const))(
    "%s: viewer, operator, owner e outro tenant recebem o MESMO erro governado (RBAC preservado)",
    async (_name, s) => {
      const actors: Array<{ label: string; role: string; org: number; user: number }> = [
        { label: "operator", role: "operator", org: ORG_A, user: 11 },
        { label: "owner", role: "owner", org: ORG_A, user: 12 },
        { label: "cross-tenant", role: "owner", org: ORG_B, user: 13 },
      ];
      const results: Array<{ code?: string; message?: string }> = [];
      for (const a of actors) {
        tenant.role = a.role; tenant.org = a.org;
        results.push(await errOf(s.call(ctxFor(a.user, "corr-matrix"))));
      }
      for (const r of results) expect(r).toEqual(results[0]);
      expect(results[0].code).toBe("FORBIDDEN");
      expect(results[0].message).toContain(LEGACY_ENDPOINT_DISABLED);

      tenant.role = "viewer"; tenant.org = ORG_A;
      const viewer = await errOf(s.call(ctxFor(14, "corr-matrix")));
      expect(viewer.code).toBe("FORBIDDEN");
      if (s.viewerBlockedByRbac) {
        // gate de papel (orgRoleProcedure("operator")) continua ANTES do handler — RBAC não é contornado
        expect(viewer.message).not.toContain(LEGACY_ENDPOINT_DISABLED);
        expect(viewer.message).toMatch(/papel mínimo 'operator'/);
      } else {
        expect(viewer).toEqual(results[0]);
      }

      expect(calledFunctions()).toEqual([]);
      // um evento por chamada que alcançou o handler; o evento carrega o tenant do CONTEXTO, nunca o do recurso
      const events = legacyEvents();
      expect(events).toHaveLength(s.viewerBlockedByRbac ? 3 : 4);
      expect(events.map((e) => e.entry.organizationId)).toEqual(
        s.viewerBlockedByRbac ? [ORG_A, ORG_A, ORG_B] : [ORG_A, ORG_A, ORG_B, ORG_A],
      );
    },
  );

  it("schemas de input preservados: input inválido ainda é rejeitado pela validação (BAD_REQUEST), sem efeito", async () => {
    const c = ctxFor(10, "corr-schema");
    const invalid: Array<Promise<unknown>> = [
      processesRouter.createCaller(c).updateStatus({ id: 1, status: "invalido" } as never),
      documentsRouter.createCaller(c).submitForReview({} as never),
      documentsRouter.createCaller(c).approveDocument({ documentId: "x" } as never),
      documentsRouter.createCaller(c).rejectDocument({ documentId: 1, reason: 7 } as never),
      procurementProcessRouter.createCaller(c).updateStage({ processId: "", stage: "ISSUED" } as never),
      directProcurementRouter.createCaller(c).updateStage({ workspaceId: "w1", stage: "NOPE" } as never),
    ];
    for (const p of invalid) expect((await errOf(p)).code).toBe("BAD_REQUEST");
    expect(calledFunctions()).toEqual([]);
  });

  it("contrato estático: o guard é a PRIMEIRA instrução de cada handler desativado", () => {
    const files: Record<string, string> = {
      processes: "processesRouter.ts", documents: "documentsRouter.ts",
      procurementProcess: "procurementProcessRouter.ts", directProcurement: "directProcurementRouter.ts",
    };
    for (const s of SURFACES) {
      const [routerName, proc] = s.procedure.split(".");
      const src = readFileSync(resolve(__dirname, "../../routers", files[routerName]), "utf8");
      const start = src.indexOf(`\n  ${proc}: `);
      expect(start, s.procedure).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n    }),", start));
      const body = block.slice(block.indexOf(".mutation(async ({ ctx }) => {") + ".mutation(async ({ ctx }) => {".length);
      expect(block, s.procedure).toContain(".mutation(async ({ ctx }) => {");
      const statements = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
      expect(statements, s.procedure).toEqual([
        `throwLegacyEndpointDisabled("${s.procedure}", "${s.surfaceId}", ctx, "${s.alternative}");`,
      ]);
    }
  });
});
