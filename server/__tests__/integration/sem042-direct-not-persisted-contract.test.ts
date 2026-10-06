/**
 * R9 / SEM-042 — `characterizeNeed` / `importDFD` da Contratação Direta NÃO têm registro persistido: a recusa é estável
 * (NOT_IMPLEMENTED + token) e acontece sem NENHUM efeito (nenhuma escrita, evento de timeline, documento, IA). Camada de
 * dados MOCKADA (complementa o smoke MySQL real `sem042-sem064-direct-mysql-smoke.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tenant = vi.hoisted(() => ({ role: "operator" as string, org: 1 }));
const spyAll = vi.hoisted(() => async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual)) out[k] = typeof v === "function" ? vi.fn() : v;
  return out;
});

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../db", (io) => spyAll(io as never));
vi.mock("../../db/procurement", (io) => spyAll(io as never));
vi.mock("../../db/directProcurement", (io) => spyAll(io as never));
vi.mock("../../services/directProcurementService", (io) => spyAll(io as never));
vi.mock("../../services/documentEngineService", (io) => spyAll(io as never));
vi.mock("../../services/workspaceOrchestratorService", (io) => spyAll(io as never));
vi.mock("../../services/aiExecutionEngine", (io) => spyAll(io as never));

import * as db from "../../db";
import * as dbProcurement from "../../db/procurement";
import * as dbDirect from "../../db/directProcurement";
import * as directService from "../../services/directProcurementService";
import * as documentEngine from "../../services/documentEngineService";
import * as orchestrator from "../../services/workspaceOrchestratorService";
import * as aiEngine from "../../services/aiExecutionEngine";
import { directProcurementRouter } from "../../routers/directProcurementRouter";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";

const MODS = { db, dbProcurement, dbDirect, directService, documentEngine, orchestrator, aiEngine };
/** Todo spy chamado, exceto a leitura do workspace (única chamada permitida antes da recusa). */
function sideEffects(): string[] {
  const out: string[] = [];
  for (const [name, mod] of Object.entries(MODS)) {
    for (const [k, v] of Object.entries(mod as Record<string, unknown>)) {
      if (vi.isMockFunction(v) && v.mock.calls.length > 0 && !(name === "dbDirect" && k === "getDirectProcurementWorkspace")) out.push(`${name}.${k}`);
    }
  }
  return out;
}
const caller = () => directProcurementRouter.createCaller({
  user: { id: 77, role: "user", name: "Ator", email: "a@t.local" }, req: { headers: {}, ip: "127.0.0.1" }, res: {}, correlationId: "corr-sem042-contract",
} as unknown as Parameters<typeof directProcurementRouter.createCaller>[0]);
const errOf = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message ?? "" }; } return { code: "RESOLVED", message: "" }; };

const ws = createDirectProcurementWorkspace({ organizationId: 1, processNumber: "P-1", object: "o", procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: 1, correlationId: "c" });

describe("SEM-042 — characterizeNeed / importDFD: recusa estável, sem efeito (mock)", () => {
  beforeEach(() => { vi.clearAllMocks(); tenant.org = 1; tenant.role = "operator"; });

  it("operator em workspace do órgão ⇒ NOT_IMPLEMENTED com token estável e ZERO efeito (nenhuma escrita/evento/documento/IA)", async () => {
    vi.mocked(dbDirect.getDirectProcurementWorkspace).mockResolvedValue(ws);
    const need = await errOf(() => caller().characterizeNeed({ workspaceId: ws.id, description: "Necessidade", estimatedValue: 10 }));
    expect(need.code).toBe("NOT_IMPLEMENTED");
    expect(need.message).toContain("DIRECT_NEED_NOT_PERSISTED");
    const dfd = await errOf(() => caller().importDFD({ workspaceId: ws.id, source: "pdf", fields: { objeto: "x" } }));
    expect(dfd.code).toBe("NOT_IMPLEMENTED");
    expect(dfd.message).toContain("DIRECT_DFD_IMPORT_NOT_PERSISTED");
    expect(sideEffects()).toEqual([]);
    expect(vi.mocked(dbProcurement.recordProcessEvent)).not.toHaveBeenCalled();
  });

  it("o tenant vem do contexto: workspace de outro órgão ⇒ NOT_FOUND neutro (a leitura é escopada pelo órgão do contexto) e zero efeito", async () => {
    vi.mocked(dbDirect.getDirectProcurementWorkspace).mockResolvedValue(null);
    tenant.org = 2;
    const e = await errOf(() => caller().characterizeNeed({ workspaceId: ws.id }));
    expect(e).toEqual({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
    expect(vi.mocked(dbDirect.getDirectProcurementWorkspace)).toHaveBeenCalledWith(ws.id, 2);
    expect(sideEffects()).toEqual([]);
  });

  it("viewer ⇒ FORBIDDEN (piso operator) antes de qualquer leitura", async () => {
    tenant.role = "viewer";
    const e = await errOf(() => caller().importDFD({ workspaceId: ws.id, source: "pdf" }));
    expect(e.code).toBe("FORBIDDEN");
    expect(vi.mocked(dbDirect.getDirectProcurementWorkspace)).not.toHaveBeenCalled();
    expect(sideEffects()).toEqual([]);
  });
});
