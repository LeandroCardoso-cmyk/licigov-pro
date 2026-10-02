/**
 * NEW-005 — contrato/congelamento do RBAC do `directProcurementRouter` (camada de dados e serviços MOCKADA;
 * complementa o smoke MySQL real `direct-procurement-rbac-mysql-smoke.test.ts`).
 *
 * Contrato verificado:
 *  - TODA procedure registrada no router está classificada em DIRECT_PROCUREMENT_RBAC_MATRIX (e vice-versa):
 *    uma procedure nova sem classificação quebra este teste;
 *  - a classe determina o piso (regra do owner): READ → sem piso; DRAFT/EVIDENCE_WRITE → operator;
 *    WORKFLOW_CONFIGURATION / INSTITUTIONAL_DECISION / PUBLICATION → manager;
 *  - o gate EFETIVO de cada procedure bate com `minRole` para viewer/operator/manager/admin/owner (ranking do
 *    `orgRoleProcedure`): abaixo do piso ⇒ FORBIDDEN com a mensagem pt-BR do orgRoleProcedure; no piso ou
 *    acima ⇒ o handler é alcançado (sem DB mockado, o workspace não existe ⇒ NOT_FOUND neutro);
 *  - em TODA recusa: nenhuma função de dados (db, db/procurement, db/directProcurement, db/institutionalRequests)
 *    nem de serviço (directProcurementService, Document Engine, Institutional Request Engine, orquestrador
 *    multi-copiloto, AIExecutionEngine) é chamada — zero escrita, zero timeline, zero notificação, zero IA;
 *  - admin de plataforma (X-Organization-Id) entra como `owner` do órgão (coerente com orgRoleProcedure);
 *  - `updateStage` (LEG-011) é LEGACY_TO_DISABLE: NÃO recebe gate de papel neste branch (o desligamento governado
 *    de PR-02 recusa todos os papéis com LEGACY_ENDPOINT_DISABLED) — este teste passa com e sem PR-02.
 *
 * `manager` é só o PISO técnico — nada aqui afirma que manager seja a autoridade legalmente competente (PR-07).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tenant = vi.hoisted(() => ({ role: "operator" as string, org: 1 }));

/** Substitui TODA função exportada por um spy inerte: qualquer chamada vira evidência de efeito antes da recusa. */
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
vi.mock("../../db/institutionalRequests", (io) => spyAll(io as never));
vi.mock("../../services/directProcurementService", (io) => spyAll(io as never));
vi.mock("../../services/documentEngineService", (io) => spyAll(io as never));
vi.mock("../../services/institutionalRequestService", (io) => spyAll(io as never));
vi.mock("../../services/workspaceOrchestratorService", (io) => spyAll(io as never));
vi.mock("../../services/aiExecutionEngine", (io) => spyAll(io as never));

import * as db from "../../db";
import * as dbProcurement from "../../db/procurement";
import * as dbDirect from "../../db/directProcurement";
import * as dbRequests from "../../db/institutionalRequests";
import * as directService from "../../services/directProcurementService";
import * as documentEngine from "../../services/documentEngineService";
import * as institutionalRequests from "../../services/institutionalRequestService";
import * as orchestrator from "../../services/workspaceOrchestratorService";
import * as aiEngine from "../../services/aiExecutionEngine";
import { directProcurementRouter } from "../../routers/directProcurementRouter";
import {
  DIRECT_PROCUREMENT_RBAC_MATRIX,
  type DirectProcurementProcedureName,
  type DirectProcurementRbacClass,
} from "../../routers/directProcurementRbacMatrix";

const ROLES = ["viewer", "operator", "manager", "admin", "owner"] as const;
type Role = (typeof ROLES)[number];
/** Espelha ORG_ROLE_RANK de server/_core/trpc.ts (não é um RBAC novo: só a expectativa do teste). */
const RANK: Record<Role, number> = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 };

/** Regra aprovada pelo owner: classe → piso mínimo (null = qualquer membro ativo). */
const FLOOR_BY_CLASS: Record<DirectProcurementRbacClass, "operator" | "manager" | null> = {
  READ: null,
  DRAFT_WRITE: "operator",
  EVIDENCE_WRITE: "operator",
  WORKFLOW_CONFIGURATION: "manager",
  INSTITUTIONAL_DECISION: "manager",
  PUBLICATION: "manager",
  LEGACY_TO_DISABLE: null,
};

const WS = "ws-rbac-contract-01";
type Caller = ReturnType<typeof directProcurementRouter.createCaller>;
/** Input VÁLIDO por procedure (a recusa precisa vir do RBAC, nunca do schema). */
const CALLS: Record<DirectProcurementProcedureName, (c: Caller) => Promise<unknown>> = {
  createProcess: (c) => c.createProcess({ processNumber: "DIR-RBAC/1", object: "Objeto", procurementType: "dispensa", startOption: "sem_dfd" }),
  loadProcess: (c) => c.loadProcess({ workspaceId: WS }),
  listProcesses: (c) => c.listProcesses({ limit: 5 }),
  updateStage: (c) => c.updateStage({ workspaceId: WS, stage: "PUBLICATION" }),
  importDFD: (c) => c.importDFD({ workspaceId: WS, source: "pdf", fields: { objeto: "x" } }),
  selectLegalBasis: (c) => c.selectLegalBasis({ workspaceId: WS, legalBasis: "art. 75, II" }),
  characterizeNeed: (c) => c.characterizeNeed({ workspaceId: WS, description: "Necessidade" }),
  // Input compatível com main e com PR-04A (idempotencyKey é ignorada por main: zod não-strict).
  importPriceResearch: (c) => c.importPriceResearch({ workspaceId: WS, source: "colar", text: "Caneta;1;un;1,50", idempotencyKey: "rbac-contract-key-01" } as never),
  configureProcedure: (c) => c.configureProcedure({ workspaceId: WS, procedureType: "eletronico", platform: "compras_gov" }),
  registerProposal: (c) => c.registerProposal({ workspaceId: WS, supplierName: "Fornecedor" }),
  generateJustification: (c) => c.generateJustification({ workspaceId: WS }),
  generatePriceJustification: (c) => c.generatePriceJustification({ workspaceId: WS, source: "manual", justification: "x", referenceValue: 10 }),
  validateDocuments: (c) => c.validateDocuments({ workspaceId: WS }),
  requestLegalOpinion: (c) => c.requestLegalOpinion({ workspaceId: WS }),
  getLegalOpinion: (c) => c.getLegalOpinion({ requestId: "req-1" }),
  ratify: (c) => c.ratify({
    workspaceId: WS, decision: "ratificado", decidedByName: "Autoridade", decidedByRole: "Secretário(a)", decidedAt: "2026-09-30",
    basisReference: "Despacho 1/2026", justification: "Justificativa de teste RBAC.", expectedRevision: 0, idempotencyKey: "rbac-contract-rat-01",
  }),
  getRatificationDecision: (c) => c.getRatificationDecision({ workspaceId: WS }),
  publish: (c) => c.publish({ workspaceId: WS }),
  configureFlags: (c) => c.configureFlags({ workspaceId: WS, requiresLegalOpinion: false }),
};

const SIDE_EFFECT_MODULES = { db, dbProcurement, dbDirect, dbRequests, directService, documentEngine, institutionalRequests, orchestrator, aiEngine };

function allSpyCalls(): Array<{ fn: string; calls: number }> {
  const out: Array<{ fn: string; calls: number }> = [];
  for (const [modName, mod] of Object.entries(SIDE_EFFECT_MODULES)) {
    for (const [k, v] of Object.entries(mod as Record<string, unknown>)) {
      if (vi.isMockFunction(v) && v.mock.calls.length > 0) out.push({ fn: `${modName}.${k}`, calls: v.mock.calls.length });
    }
  }
  return out;
}

function callerFor(role: Role | "platform_admin", correlationId = "corr-new005-contract"): Caller {
  const platformAdmin = role === "platform_admin";
  if (!platformAdmin) tenant.role = role;
  return directProcurementRouter.createCaller({
    user: { id: 77, role: platformAdmin ? "admin" : "user", name: "Ator", email: "ator@teste.local" },
    req: { headers: platformAdmin ? { "x-organization-id": "1" } : {}, ip: "127.0.0.1" },
    res: {},
    correlationId,
  } as unknown as Parameters<typeof directProcurementRouter.createCaller>[0]);
}

async function errOf(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "?", message: x.message ?? "" }; }
  return { code: "RESOLVED", message: "" };
}

const roleDeniedMessage = (min: string) => `Esta ação requer papel mínimo '${min}' na organização.`;

describe("NEW-005 — RBAC congelado do directProcurementRouter (mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenant.org = 1;
    tenant.role = "operator";
  });

  it("toda procedure registrada está classificada na matriz (e nenhuma entrada órfã)", () => {
    const registered = Object.keys(directProcurementRouter._def.procedures).sort();
    expect(Object.keys(DIRECT_PROCUREMENT_RBAC_MATRIX).sort()).toEqual(registered);
    expect(Object.keys(CALLS).sort()).toEqual(registered);
  });

  it("classe ⇒ piso mínimo segue a regra aprovada (e nenhuma leitura exige papel)", () => {
    for (const [name, entry] of Object.entries(DIRECT_PROCUREMENT_RBAC_MATRIX)) {
      expect(entry.minRole, name).toBe(FLOOR_BY_CLASS[entry.rbacClass]);
      expect(entry.oldBuilder, name).toBe("tenantProcedure");
    }
    const m = DIRECT_PROCUREMENT_RBAC_MATRIX;
    expect(m.ratify.rbacClass).toBe("INSTITUTIONAL_DECISION");
    expect(m.publish.rbacClass).toBe("PUBLICATION");
    expect(m.configureFlags.rbacClass).toBe("WORKFLOW_CONFIGURATION");
    expect(m.updateStage.rbacClass).toBe("LEGACY_TO_DISABLE");
    // Ressalva obrigatória: piso técnico ≠ autoridade competente (PR-07).
    expect(m.ratify.rationale).toMatch(/PISO técnico/);
    expect(m.ratify.rationale).toMatch(/PR-07/);
  });

  for (const [name, entry] of Object.entries(DIRECT_PROCUREMENT_RBAC_MATRIX) as Array<[DirectProcurementProcedureName, (typeof DIRECT_PROCUREMENT_RBAC_MATRIX)[DirectProcurementProcedureName]]>) {
    if (entry.rbacClass === "LEGACY_TO_DISABLE") continue;
    for (const role of ROLES) {
      const min = entry.minRole;
      const denied = min !== null && RANK[role] < RANK[min];
      it(`${name} [${entry.rbacClass}] × ${role} ⇒ ${denied ? "FORBIDDEN (sem efeito)" : "alcança o handler"}`, async () => {
        const e = await errOf(() => CALLS[name](callerFor(role)));
        if (denied) {
          expect(e.code).toBe("FORBIDDEN");
          expect(e.message).toBe(roleDeniedMessage(min));
          expect(allSpyCalls()).toEqual([]);
        } else {
          expect(e.message).not.toMatch(/papel mínimo/);
          expect(e.code).not.toBe("FORBIDDEN");
        }
      });
    }
  }

  it("admin de plataforma entra como owner do órgão informado (alcança ratify/publish/configureFlags)", async () => {
    vi.mocked(db.getOrganizationById).mockResolvedValue({ id: 1 } as never);
    vi.mocked(db.createAuditLog).mockResolvedValue(undefined as never);
    for (const name of ["ratify", "publish", "configureFlags"] as const) {
      const e = await errOf(() => CALLS[name](callerFor("platform_admin")));
      expect(e.message, name).not.toMatch(/papel mínimo/);
    }
    // Auditoria fail-closed do acesso cross-tenant do admin, com correlationId.
    const details = vi.mocked(db.createAuditLog).mock.calls.map(c => JSON.parse(String((c[0] as { details: string }).details)));
    expect(details.every(d => d.event === "platform_admin_tenant_access" && d.correlationId === "corr-new005-contract")).toBe(true);
  });

  it("recusa de viewer em ratify/publish/configureFlags: sem IA, sem notificação, sem timeline, sem escrita", async () => {
    for (const name of ["ratify", "publish", "configureFlags", "generateJustification", "requestLegalOpinion"] as const) {
      const e = await errOf(() => CALLS[name](callerFor("viewer")));
      expect(e.code, name).toBe("FORBIDDEN");
    }
    expect(vi.mocked(aiEngine.executeCognitiveTask)).not.toHaveBeenCalled();
    expect(vi.mocked(orchestrator.orchestrateMultiCopilot)).not.toHaveBeenCalled();
    expect(vi.mocked(institutionalRequests.requestInstitutionalReview)).not.toHaveBeenCalled();
    expect(vi.mocked(dbProcurement.recordProcessEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(dbDirect.insertRatification)).not.toHaveBeenCalled();
    expect(vi.mocked(dbDirect.insertDirectProcurementWorkspace)).not.toHaveBeenCalled();
    expect(vi.mocked(directService.generatePublications)).not.toHaveBeenCalled();
    // A recusa acontece ANTES da leitura do workspace (não revela existência).
    expect(vi.mocked(dbDirect.getDirectProcurementWorkspace)).not.toHaveBeenCalled();
  });

  it("operator alcança o rascunho (createProcess persiste via camada de dados) mas é barrado em configureFlags/ratify/publish", async () => {
    const created = await CALLS.createProcess(callerFor("operator"));
    expect(created).toHaveProperty("workspace");
    for (const name of ["configureFlags", "ratify", "publish"] as const) {
      const e = await errOf(() => CALLS[name](callerFor("operator")));
      expect(e, name).toEqual({ code: "FORBIDDEN", message: roleDeniedMessage("manager") });
    }
  });

  it("updateStage (LEG-011) não recebe gate de papel neste branch — o desligamento é o de PR-02", async () => {
    for (const role of ROLES) {
      const e = await errOf(() => CALLS.updateStage(callerFor(role)));
      expect(e.message, role).not.toMatch(/papel mínimo/);
    }
  });
});
