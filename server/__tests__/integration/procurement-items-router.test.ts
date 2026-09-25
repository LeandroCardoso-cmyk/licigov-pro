/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Itens da Contratação — ROUTER: RBAC (viewer só lê; operator+ escreve), tenant (processo de outra
 * organização ⇒ NOT_FOUND sem efeito), organização/ator SEMPRE do ctx e validação de entrada (ids
 * opacos, fontes permitidas). A persistência real é coberta pelo smoke MySQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = { value: "owner" as string };
vi.mock("../../db/procurement");
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
  getMembership: vi.fn(async () => ({ id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../services/procurementItemsService", () => {
  const ok = (r: unknown) => vi.fn(async () => ({ result: r, replayed: false }));
  return {
    getProcurementItemsWorkspace: vi.fn(async () => ({ items: [], lots: [], stats: { itemCount: 0 } })),
    prepareItemCandidates: vi.fn(async () => ({ candidates: [], sourceDigest: "0".repeat(32), counts: {} })),
    confirmItemCandidates: ok({ created: [], linked: [], skipped: 0, lotsCreated: [] }),
    createManualItem: ok({ itemId: "a".repeat(24) }),
    setPlannedQuantities: ok({ updated: [] }),
    updateProcurementItem: ok({ itemId: "a".repeat(24), revision: 2 }),
    withdrawProcurementItem: ok({ itemId: "a".repeat(24) }),
    createProcurementLot: ok({ lotId: "b".repeat(24) }),
    updateProcurementLot: ok({ lotId: "b".repeat(24) }),
    archiveProcurementLot: ok({ lotId: "b".repeat(24) }),
    assignItemToLot: ok({ itemId: "a".repeat(24), revision: 2 }),
    moveProcurementItem: ok({ itemId: "a".repeat(24) }),
    moveProcurementLot: ok({ lotId: "b".repeat(24) }),
  };
});

import { procurementItemsRouter } from "../../routers/procurementItemsRouter";
import * as procDb from "../../db/procurement";
import * as svc from "../../services/procurementItemsService";
import { makeContext, mockUser } from "../helpers/fixtures";

const caller = () => procurementItemsRouter.createCaller(makeContext(mockUser));
const ITEM = "a".repeat(24);
const LOT = "b".repeat(24);

const writes: Array<[string, () => Promise<unknown>, keyof typeof svc]> = [
  ["confirmCandidates", () => caller().confirmCandidates({ processId: "p1", source: "price_research", expectedSourceDigest: "0".repeat(32), decisions: [{ candidateKey: ITEM, action: "skip" }], idempotencyKey: "k" }), "confirmItemCandidates"],
  ["createManual", () => caller().createManual({ processId: "p1", description: "Rodo", unit: "UN", idempotencyKey: "k" }), "createManualItem"],
  ["setQuantities", () => caller().setQuantities({ processId: "p1", idempotencyKey: "k", changes: [{ itemId: ITEM, expectedRevision: 1, mode: "informed", quantity: "35" }] }), "setPlannedQuantities"],
  ["updateItem", () => caller().updateItem({ processId: "p1", itemId: ITEM, expectedRevision: 1, description: "X", idempotencyKey: "k" }), "updateProcurementItem"],
  ["withdrawItem", () => caller().withdrawItem({ processId: "p1", itemId: ITEM, expectedRevision: 1, reason: "duplicado", idempotencyKey: "k" }), "withdrawProcurementItem"],
  ["assignLot", () => caller().assignLot({ processId: "p1", itemId: ITEM, expectedRevision: 1, lotId: LOT, idempotencyKey: "k" }), "assignItemToLot"],
  ["moveItem", () => caller().moveItem({ processId: "p1", itemId: ITEM, expectedRevision: 1, direction: "up", idempotencyKey: "k" }), "moveProcurementItem"],
  ["createLot", () => caller().createLot({ processId: "p1", code: "01", name: "Limpeza", idempotencyKey: "k" }), "createProcurementLot"],
  ["updateLot", () => caller().updateLot({ processId: "p1", lotId: LOT, expectedRevision: 1, name: "Outro", idempotencyKey: "k" }), "updateProcurementLot"],
  ["archiveLot", () => caller().archiveLot({ processId: "p1", lotId: LOT, expectedRevision: 1, reason: "vazio", idempotencyKey: "k" }), "archiveProcurementLot"],
  ["moveLot", () => caller().moveLot({ processId: "p1", lotId: LOT, expectedRevision: 1, direction: "down", idempotencyKey: "k" }), "moveProcurementLot"],
];

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "owner";
  vi.mocked(procDb.getProcess).mockImplementation(async (id: string, org: number) => (id === "p1" && org === 1 ? { id: "p1", organizationId: 1 } : null) as any);
});

describe("Itens da contratação — RBAC", () => {
  it("viewer lê a área e os candidatos, mas TODA escrita é FORBIDDEN (sem chamar o serviço)", async () => {
    role.value = "viewer";
    await expect(caller().workspace({ processId: "p1" })).resolves.toBeDefined();
    await expect(caller().candidates({ processId: "p1", source: "price_research" })).resolves.toBeDefined();
    for (const [name, run, fn] of writes) {
      await expect(run(), name).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(svc[fn], name).not.toHaveBeenCalled();
    }
  });

  it("operator executa toda escrita; organização e ator vêm do ctx", async () => {
    role.value = "operator";
    for (const [name, run, fn] of writes) {
      await run();
      expect(vi.mocked(svc[fn] as any).mock.calls[0][0], name).toMatchObject({ organizationId: 1, processId: "p1", actorUserId: mockUser.id });
    }
  });
});

describe("Itens da contratação — tenant e validação de entrada", () => {
  it("processo de outro tenant ⇒ NOT_FOUND em leitura e escrita, sem efeito", async () => {
    await expect(caller().workspace({ processId: "outro" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().candidates({ processId: "outro", source: "dfd" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().createManual({ processId: "outro", description: "X", unit: "UN", idempotencyKey: "k" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(svc.createManualItem).not.toHaveBeenCalled();
    expect(svc.getProcurementItemsWorkspace).not.toHaveBeenCalled();
  });

  it("ids opacos e fontes permitidas: entrada fora do contrato ⇒ BAD_REQUEST", async () => {
    await expect(caller().assignLot({ processId: "p1", itemId: "../x", expectedRevision: 1, lotId: null, idempotencyKey: "k" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().candidates({ processId: "p1", source: "ocr_staging" as any })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().setQuantities({ processId: "p1", idempotencyKey: "k", changes: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().createManual({ processId: "p1", description: "", unit: "UN", idempotencyKey: "k" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // organizationId enviado pelo browser é ignorado (não faz parte do contrato)
    await caller().createManual({ processId: "p1", description: "Rodo", unit: "UN", idempotencyKey: "k", organizationId: 999 } as any);
    expect(vi.mocked(svc.createManualItem).mock.calls[0][0]).toMatchObject({ organizationId: 1 });
  });
});
