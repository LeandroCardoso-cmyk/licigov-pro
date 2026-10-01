/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-04 (preparação) — FCC-03 / LEG-013 (SEM-005): guard SERVER-SIDE de `procurementProcess.importPriceResearch`
 * acoplado a `FF_CANONICAL_INGESTION` por tenant. Sem DB: serviços mockados. Prova que:
 *   - flag LIGADA para o tenant do contexto ⇒ FORBIDDEN `LEGACY_ENDPOINT_DISABLED`, ANTES de ler o processo e sem
 *     nenhuma escrita (pesquisa/cotações/Itens Inteligentes), sem log de atividade; exatamente 1 evento
 *     `legacy_endpoint_disabled` (LEG-013) sem o input do cliente;
 *   - flag DESLIGADA ⇒ caminho legado inalterado (importManualPriceResearch chamado com o org do contexto);
 *   - erro ao AVALIAR a flag ⇒ recusa INTERNAL_SERVER_ERROR sem nenhuma escrita (nunca "vira" desligada);
 *   - viewer continua recusado pelo RBAC (antes do guard: a flag nem é avaliada);
 *   - a flag é avaliada SEMPRE para o tenant do contexto (A ligada não afeta B e vice-versa);
 *   - o contrato de entrada (`.input`) não mudou.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "operator" as string, org: 1 }));
const flags = vi.hoisted(() => ({ on: new Set<number>(), throwFor: new Set<number>() }));
const guardLog = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: role.org,
    membership: { id: 1, organizationId: role.org, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn(async (flag: string, org: number) => {
    if (flags.throwFor.has(org)) throw new Error("flag store indisponível");
    return flag === "FF_CANONICAL_INGESTION" && flags.on.has(org);
  }),
}));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/observabilityService", async (orig) => {
  const actual = await orig<typeof import("../../services/observabilityService")>();
  return { ...actual, serviceLogger: (name: string) => (name === "legacyEndpointGuard" ? guardLog : actual.serviceLogger(name)) };
});
vi.mock("../../services/itemMaterializationService", async (orig) => {
  const actual = await orig<typeof import("../../services/itemMaterializationService")>();
  return {
    ...actual,
    importManualPriceResearch: vi.fn(async (p: any) => ({
      research: { id: "r1", processId: p.processId, organizationId: p.organizationId, itemCount: 1 },
      quoteCount: 1,
      result: { items: [{ id: "i1" }], created: [{}], updated: [], unchanged: [], preserved: [], sourceChanged: [], reconciled: [], reviewRequired: [] },
    })),
  };
});
vi.mock("../../db/procurement", async (orig) => {
  const actual = await orig<typeof import("../../db/procurement")>();
  return {
    ...actual,
    getProcess: vi.fn(async (id: string, orgId: number) => ({ id, organizationId: orgId })),
    listIntelligentItems: vi.fn(async () => [{ id: "i1", description: "Detergente", suggestedCATMAT: null }]),
    insertResearch: vi.fn(), insertResearchItem: vi.fn(), insertResearchWithItems: vi.fn(), insertIntelligentItem: vi.fn(),
  };
});

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import { isFeatureEnabled } from "../../services/featureFlagService";
import { importManualPriceResearch } from "../../services/itemMaterializationService";
import { logActivity } from "../../services/activityLogService";
import * as procDb from "../../db/procurement";

const ORG_A = 101;
const ORG_B = 202;
const INPUT = { processId: "p1", source: "colar" as const, text: "Detergente neutro;10;UN;12,50;Fornecedor A" };
const caller = () => procurementProcessRouter.createCaller({ ...makeContext(mockUser), correlationId: "corr-pr04" } as any);

async function outcome(p: Promise<unknown>): Promise<{ code: string | null; message: string }> {
  try { await p; return { code: null, message: "" }; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}

function expectNoWrites() {
  expect(importManualPriceResearch).not.toHaveBeenCalled();
  expect(procDb.getProcess).not.toHaveBeenCalled(); // nem leitura do processo (não revela existência)
  expect(procDb.insertResearch).not.toHaveBeenCalled();
  expect(procDb.insertResearchItem).not.toHaveBeenCalled();
  expect(procDb.insertResearchWithItems).not.toHaveBeenCalled();
  expect(procDb.insertIntelligentItem).not.toHaveBeenCalled();
  expect(procDb.listIntelligentItems).not.toHaveBeenCalled();
  expect(logActivity).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "operator"; role.org = ORG_A;
  flags.on = new Set(); flags.throwFor = new Set();
});

describe("PR-04 prep — FCC-03: guard server-side de procurementProcess.importPriceResearch (LEG-013)", () => {
  it("flag LIGADA para o tenant ⇒ FORBIDDEN LEGACY_ENDPOINT_DISABLED, zero escrita, 1 evento governado", async () => {
    flags.on.add(ORG_A);
    const r = await outcome(caller().importPriceResearch(INPUT));
    expect(r.code).toBe("FORBIDDEN");
    expect(r.message).toContain("LEGACY_ENDPOINT_DISABLED");
    expect(r.message).toContain("a ingestão supervisionada de pesquisa de preços");
    expect(r.message).not.toContain(INPUT.text);
    expect(r.message).not.toContain(INPUT.processId);
    expectNoWrites();
    expect(isFeatureEnabled).toHaveBeenCalledWith("FF_CANONICAL_INGESTION", ORG_A);
    expect(guardLog.warn).toHaveBeenCalledTimes(1);
    const [event, data] = guardLog.warn.mock.calls[0];
    expect(event).toBe("legacy_endpoint_disabled");
    expect(data).toEqual({
      procedure: "procurementProcess.importPriceResearch", surfaceId: "LEG-013",
      organizationId: ORG_A, actorUserId: mockUser.id, correlationId: "corr-pr04",
    });
    expect(JSON.stringify(data)).not.toContain(INPUT.text);
  });

  it("flag DESLIGADA (estado de produção documentado) ⇒ caminho legado inalterado", async () => {
    const res = await caller().importPriceResearch(INPUT);
    expect(importManualPriceResearch).toHaveBeenCalledTimes(1);
    expect(importManualPriceResearch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_A, processId: "p1", source: "colar", text: INPUT.text, actorUserId: mockUser.id,
    }));
    expect(procDb.getProcess).toHaveBeenCalledWith("p1", ORG_A);
    expect(res.intelligentItems).toEqual([{ id: "i1", description: "Detergente", suggestedCATMAT: null }]);
    expect(res.materialization.created).toBe(1);
    expect(guardLog.warn).not.toHaveBeenCalled();
  });

  it("erro ao AVALIAR a flag ⇒ recusa INTERNAL_SERVER_ERROR sem escrita (erro nunca libera o legado)", async () => {
    flags.throwFor.add(ORG_A);
    const r = await outcome(caller().importPriceResearch(INPUT));
    expect(r.code).toBe("INTERNAL_SERVER_ERROR");
    expect(r.message).toContain("Nada foi gravado");
    expect(r.message).not.toContain("flag store indisponível");
    expectNoWrites();
    expect(guardLog.warn).not.toHaveBeenCalled(); // não é desligamento governado; é falha de avaliação
  });

  it("viewer continua recusado pelo RBAC (antes do guard: a flag nem é avaliada), com a flag ligada ou desligada", async () => {
    role.value = "viewer";
    expect((await outcome(caller().importPriceResearch(INPUT))).code).toBe("FORBIDDEN");
    flags.on.add(ORG_A);
    const r = await outcome(caller().importPriceResearch(INPUT));
    expect(r.code).toBe("FORBIDDEN");
    expect(r.message).not.toContain("LEGACY_ENDPOINT_DISABLED");
    expect(isFeatureEnabled).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("cross-tenant: A ligada NÃO afeta B (B importa); B ligada NÃO afeta A (A importa)", async () => {
    flags.on = new Set([ORG_A]);
    role.org = ORG_B;
    await caller().importPriceResearch(INPUT);
    expect(importManualPriceResearch).toHaveBeenLastCalledWith(expect.objectContaining({ organizationId: ORG_B }));
    expect(isFeatureEnabled).toHaveBeenLastCalledWith("FF_CANONICAL_INGESTION", ORG_B);
    role.org = ORG_A;
    expect((await outcome(caller().importPriceResearch(INPUT))).message).toContain("LEGACY_ENDPOINT_DISABLED");
    expect(importManualPriceResearch).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    flags.on = new Set([ORG_B]);
    role.org = ORG_A;
    await caller().importPriceResearch(INPUT);
    expect(importManualPriceResearch).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
    role.org = ORG_B;
    const r = await outcome(caller().importPriceResearch(INPUT));
    expect(r.code).toBe("FORBIDDEN");
    expect(r.message).toContain("LEGACY_ENDPOINT_DISABLED");
    expect(importManualPriceResearch).toHaveBeenCalledTimes(1);
    expect(guardLog.warn).toHaveBeenCalledWith("legacy_endpoint_disabled", expect.objectContaining({ organizationId: ORG_B }));
  });

  it("validação de entrada continua ANTES do guard e o contrato de input não mudou", async () => {
    flags.on.add(ORG_A);
    expect((await outcome(caller().importPriceResearch({ ...INPUT, text: "" }))).code).toBe("BAD_REQUEST");
    expect((await outcome(caller().importPriceResearch({ ...INPUT, source: "doc" as any }))).code).toBe("BAD_REQUEST");
    expect(isFeatureEnabled).not.toHaveBeenCalled();
    const def = (procurementProcessRouter as any)._def.procedures.importPriceResearch._def;
    expect(def.type).toBe("mutation");
    const shape = def.inputs[0].shape;
    expect(Object.keys(shape).sort()).toEqual(["processId", "source", "text"]);
    expect(shape.source.options).toEqual(["pdf", "docx", "xlsx", "csv", "colar", "manual"]);
  });
});
