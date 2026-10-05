/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R10 / SEM-037 — `writePlannedQuantity` grava no ledger SOMENTE pela porta única `recordContextAssertions`
 * (checagem de política fonte × caminho), não mais por `appendContextFacts` direto.
 *  - escrita válida: inalterada (mesmos fatos no ledger: fonte "user", confirmada, ator humano, base de superação);
 *  - violação de política (fonte não autorizada para o caminho): RECUSADA com CONTEXT_SOURCE_NOT_ALLOWED, nada gravado
 *    no ledger e a transação é abortada (falha propaga; chave de idempotência liberada).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ allowed: { value: true }, tx: {} as any }));

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => ({ transaction: async (fn: (tx: any) => Promise<unknown>) => fn(h.tx) })) }));
vi.mock("../../db/procurement", () => ({
  listIntelligentItems: vi.fn(async () => []), getGeneratedDocumentByKind: vi.fn(async () => null), recordProcessEvent: vi.fn(async () => undefined),
}));
vi.mock("../../db/officialDocumentPromotions", () => ({ getLatestOfficialPromotion: vi.fn(async () => null) }));
vi.mock("../../db/procurementItems", () => ({
  listProcurementItems: vi.fn(async () => []), listProcurementLots: vi.fn(async () => []), listItemSourceLinks: vi.fn(async () => []),
  listPriceResearchProvenance: vi.fn(async () => ({ researches: [], sessionsAwaitingPromotion: 0 })),
  lockItem: vi.fn(), lockLot: vi.fn(), lockLotsByCodeKey: vi.fn(async () => []), nextItemOrdinal: vi.fn(async () => 1), nextLotOrdinal: vi.fn(async () => 1),
  insertItemIfAbsent: vi.fn(async () => true), insertLotIfAbsent: vi.fn(async () => true), updateItemCAS: vi.fn(async () => true), updateLotCAS: vi.fn(async () => true),
  insertSourceLinkIfAbsent: vi.fn(async () => true), appendItemEvents: vi.fn(async () => undefined),
}));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })), saveIdempotencyResult: vi.fn(async () => undefined), failIdempotencyKey: vi.fn(async () => undefined),
}));
vi.mock("../../db/procurementContext", () => ({ appendContextFacts: vi.fn(async (_o: number, _p: string, f: unknown[]) => f.length), listContextFacts: vi.fn(async () => []) }));
// Política real, exceto quando o teste a fecha para plannedQuantity.
vi.mock("../../domain/canonicalProcurementContext", async (orig) => {
  const real = await orig<typeof import("../../domain/canonicalProcurementContext")>();
  return { ...real, isSourceAllowed: (path: string, src: any) => (h.allowed.value ? real.isSourceAllowed(path, src) : false) };
});
vi.mock("../../services/canonicalContextService", async (orig) => {
  const real = await orig<typeof import("../../services/canonicalContextService")>();
  return { ...real, resolveProcurementContext: vi.fn(async () => ({ version: 1, digest: "d".repeat(64), items: [] })), recordContextAssertions: vi.fn(real.recordContextAssertions) };
});

import { createManualItem } from "../../services/procurementItemsService";
import * as ctxDb from "../../db/procurementContext";
import * as ctxSvc from "../../services/canonicalContextService";
import * as idem from "../../services/idempotencyService";
import * as itemsDb from "../../db/procurementItems";

const A = { organizationId: 1, processId: "p1", actorUserId: 7, correlationId: "corr-37" };

beforeEach(() => { vi.clearAllMocks(); h.allowed.value = true; });

describe("SEM-037 — quantidade prevista passa pela política do ledger", () => {
  it("escrita válida (inalterada): via recordContextAssertions → appendContextFacts com os mesmos fatos", async () => {
    await createManualItem({ ...A, description: "Rodo", unit: "UN", plannedQuantity: "12", idempotencyKey: "k-ok" });
    expect(ctxSvc.recordContextAssertions).toHaveBeenCalledTimes(1);
    expect(ctxDb.appendContextFacts).toHaveBeenCalledTimes(1);
    const [org, pid, facts, corr, exec] = vi.mocked(ctxDb.appendContextFacts).mock.calls[0] as any[];
    expect([org, pid, corr]).toEqual([1, "p1", "corr-37"]);
    expect(exec).toBe(h.tx); // mesma transação do chamador
    expect(facts).toEqual([expect.objectContaining({
      path: expect.stringMatching(/^items\.[a-f0-9]+\.plannedQuantity$/), value: 12, sourceType: "user", sourceId: "items-area",
      sourceVersion: "r1:informed", status: "confirmed", actorUserId: 7, basisValueHash: null,
    })]);
  });

  it("violação de política ⇒ CONTEXT_SOURCE_NOT_ALLOWED, NADA no ledger, chave de idempotência liberada (transação não confirma)", async () => {
    h.allowed.value = false;
    await expect(createManualItem({ ...A, description: "Rodo", unit: "UN", plannedQuantity: "12", idempotencyKey: "k-bad" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("CONTEXT_SOURCE_NOT_ALLOWED") });
    expect(ctxSvc.recordContextAssertions).toHaveBeenCalledTimes(1);
    expect(ctxDb.appendContextFacts).not.toHaveBeenCalled();
    expect(idem.saveIdempotencyResult).not.toHaveBeenCalled(); // resultado não é confirmado ⇒ a transação real faz rollback
    expect(itemsDb.appendItemEvents).not.toHaveBeenCalled();
    expect(idem.failIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("sem quantidade informada: o ledger não é tocado (nada a afirmar)", async () => {
    await createManualItem({ ...A, description: "Rodo", unit: "UN", idempotencyKey: "k-none" });
    expect(ctxSvc.recordContextAssertions).not.toHaveBeenCalled();
    expect(ctxDb.appendContextFacts).not.toHaveBeenCalled();
  });
});
