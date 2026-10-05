/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R9 / SEM-050 (fechamento da LEITURA) — governança de Itens FAIL-CLOSED também quando a LEITURA falha:
 *  - escritas: erro ao ler emissões/documentos aprovados ⇒ a escrita é RECUSADA (a exceção propaga, nunca vira
 *    "define"/"sem restrição") e NADA é gravado (zero escrita no ledger, itens, eventos, timeline, idempotência);
 *  - workspace: a tela renderiza, mas a governança sai `unknown` + `locked` (nunca "sem restrição") e
 *    `officialEmittedKinds` não é apresentado como "nada emitido".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: { value: null as any },
  tx: {} as any,
}));

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => h.db.value) }));
vi.mock("../../db/procurement", () => ({
  listIntelligentItems: vi.fn(async () => []),
  getGeneratedDocumentByKind: vi.fn(async () => null),
  recordProcessEvent: vi.fn(async () => undefined),
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
vi.mock("../../services/canonicalContextService", () => ({
  resolveProcurementContext: vi.fn(), recordContextAssertions: vi.fn(async () => 1),
}));

import { getProcurementItemsWorkspace, readGovernanceForDisplay, updateProcurementItem, setPlannedQuantities, withdrawProcurementItem, createManualItem, GOVERNANCE_UNKNOWN_REASON } from "../../services/procurementItemsService";
import * as procDb from "../../db/procurement";
import * as promo from "../../db/officialDocumentPromotions";
import * as itemsDb from "../../db/procurementItems";
import * as idem from "../../services/idempotencyService";
import * as ctxSvc from "../../services/canonicalContextService";

const ITEM = "a".repeat(24);
const A = { organizationId: 1, processId: "p1", actorUserId: 7, correlationId: "corr-1" };
const emptyCtx = (items: any[] = []) => ({ version: 3, digest: "d".repeat(64), items }) as any;
const dbItem = (extra: Record<string, unknown> = {}) => ({
  id: ITEM, organizationId: 1, processId: "p1", description: "Detergente", unit: "UN", lotId: null, ordinal: 1, status: "active", fingerprint: "f",
  origin: "manual", provenance: { description: { source: "manual" }, unit: { source: "manual" }, lot: {}, manual: null }, revision: 1, createdBy: 7, updatedBy: 7,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...extra,
});

const WRITE_SPIES = () => [
  itemsDb.updateItemCAS, itemsDb.insertItemIfAbsent, itemsDb.insertLotIfAbsent, itemsDb.insertSourceLinkIfAbsent, itemsDb.appendItemEvents,
  ctxSvc.recordContextAssertions, procDb.recordProcessEvent, idem.saveIdempotencyResult,
];

beforeEach(() => {
  vi.clearAllMocks();
  h.db.value = { transaction: async (fn: (tx: any) => Promise<unknown>) => fn(h.tx) };
  vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
  vi.mocked(promo.getLatestOfficialPromotion).mockResolvedValue(null);
  vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(emptyCtx());
  vi.mocked(itemsDb.lockItem).mockResolvedValue(dbItem() as any);
  vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "new" } as any);
});

describe("SEM-050 — leitura do workspace: governança DESCONHECIDA ≠ sem restrição", () => {
  it("baseline: leituras ok ⇒ state known, destravada; TR emitido ⇒ known e travada pela regra (não por falha)", async () => {
    let w = await getProcurementItemsWorkspace({ organizationId: 1, processId: "p1", correlationId: "c" });
    expect(w.governance).toMatchObject({ state: "known", locked: false, reason: null, unknownReason: null, officialEmittedKinds: [] });
    vi.mocked(promo.getLatestOfficialPromotion).mockImplementation((async (_o: number, _p: string, k: string) => (k === "tr" ? { officialDocumentId: "x" } : null)) as any);
    w = await getProcurementItemsWorkspace({ organizationId: 1, processId: "p1", correlationId: "c" });
    expect(w.governance.state).toBe("known");
    expect(w.governance.locked).toBe(true);
    expect(w.governance.reason).toMatch(/formalizada/);
    expect(w.governance.officialEmittedKinds).toEqual(["tr"]);
  });

  it("erro ao ler emissões oficiais ⇒ unknown + locked (a tela ainda renderiza os itens)", async () => {
    vi.mocked(itemsDb.listProcurementItems).mockResolvedValue([dbItem() as any]);
    vi.mocked(promo.getLatestOfficialPromotion).mockRejectedValue(new Error("db timeout"));
    const w = await getProcurementItemsWorkspace({ organizationId: 1, processId: "p1", correlationId: "c" });
    expect(w.items).toHaveLength(1);
    expect(w.governance).toMatchObject({ state: "unknown", locked: true, reason: GOVERNANCE_UNKNOWN_REASON, unknownReason: "GOVERNANCE_READ_FAILED" });
  });

  it("erro ao ler documento aprovado (ETP) ⇒ unknown + locked", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockImplementation((async (_p: string, _o: number, k: string) => {
      if (k === "etp") throw new Error("boom");
      return null;
    }) as any);
    const w = await getProcurementItemsWorkspace({ organizationId: 1, processId: "p1", correlationId: "c" });
    expect(w.governance).toMatchObject({ state: "unknown", locked: true, unknownReason: "GOVERNANCE_READ_FAILED" });
  });

  it("contexto canônico ilegível ⇒ unknown (CONTEXT_UNAVAILABLE): o consumo por documento aprovado depende dele", async () => {
    vi.mocked(ctxSvc.resolveProcurementContext).mockRejectedValue(new Error("ctx down"));
    const w = await getProcurementItemsWorkspace({ organizationId: 1, processId: "p1", correlationId: "c" });
    expect(w.governance).toMatchObject({ state: "unknown", locked: true, unknownReason: "CONTEXT_UNAVAILABLE" });
  });

  it("persistência indisponível (camada de dados devolve null) ⇒ unknown, nunca 'nada emitido'", async () => {
    h.db.value = null;
    const g = await readGovernanceForDisplay(1, "p1", emptyCtx());
    expect(g.known).toBe(false);
    expect(g.state.officialEmittedKinds).toEqual([]);
  });

  it("não vaza entre tenants: leituras sempre com a organização do contexto", async () => {
    await getProcurementItemsWorkspace({ organizationId: 42, processId: "p9", correlationId: "c" });
    for (const call of vi.mocked(promo.getLatestOfficialPromotion).mock.calls) expect(call.slice(0, 2)).toEqual([42, "p9"]);
    for (const call of vi.mocked(procDb.getGeneratedDocumentByKind).mock.calls) expect(call.slice(0, 2)).toEqual(["p9", 42]);
  });
});

describe("SEM-050 — escritas: leitura de governança falha ⇒ RECUSA e ZERO escrita", () => {
  const writes: Array<[string, () => Promise<unknown>]> = [
    ["updateProcurementItem (descrição)", () => updateProcurementItem({ ...A, itemId: ITEM, expectedRevision: 1, description: "Outro", idempotencyKey: "k1" })],
    ["setPlannedQuantities (informar)", () => setPlannedQuantities({ ...A, changes: [{ itemId: ITEM, expectedRevision: 1, mode: "informed", quantity: "10" }], idempotencyKey: "k2" })],
    ["withdrawProcurementItem", () => withdrawProcurementItem({ ...A, itemId: ITEM, expectedRevision: 1, reason: "duplicado", idempotencyKey: "k3" })],
    ["createManualItem", () => createManualItem({ ...A, description: "Rodo", unit: "UN", idempotencyKey: "k4" })],
  ];

  it.each(writes)("%s: emissão oficial ilegível ⇒ rejeita com o erro de leitura (não GOVERNED_CHANGE_REQUIRED nem sucesso) e nada é gravado", async (_n, run) => {
    vi.mocked(promo.getLatestOfficialPromotion).mockRejectedValue(new Error("db timeout"));
    await expect(run()).rejects.toThrow("db timeout");
    for (const spy of WRITE_SPIES()) expect(spy).not.toHaveBeenCalled();
    expect(idem.failIdempotencyKey).toHaveBeenCalledTimes(1); // chave liberada para nova tentativa
  });

  it.each(writes)("%s: documento aprovado ilegível ⇒ rejeita e nada é gravado", async (_n, run) => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockRejectedValue(new Error("doc read failed"));
    await expect(run()).rejects.toThrow("doc read failed");
    for (const spy of WRITE_SPIES()) expect(spy).not.toHaveBeenCalled();
  });

  it("controle positivo: com leituras ok a mesma escrita (descrição) é gravada — a recusa acima é pela falha de leitura", async () => {
    await expect(updateProcurementItem({ ...A, itemId: ITEM, expectedRevision: 1, description: "Outro", idempotencyKey: "k1" })).resolves.toMatchObject({ result: { itemId: ITEM, revision: 2 } });
    expect(itemsDb.updateItemCAS).toHaveBeenCalledTimes(1);
    expect(itemsDb.appendItemEvents).toHaveBeenCalledTimes(1);
  });

  it("falha de leitura NÃO é classificada como 'define' (mudança de quantidade de item consumido por aprovado continua recusada pela regra, não pela falha)", async () => {
    // item com quantidade já definida consumida por documento aprovado ⇒ GOVERNED_CHANGE_REQUIRED (leitura ok)
    vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(emptyCtx([{ key: ITEM, plannedQuantity: { value: 5, status: "confirmed", valueHash: "h", conflict: null } }]));
    vi.mocked(procDb.getGeneratedDocumentByKind).mockImplementation((async (_p: string, _o: number, k: string) => (k === "etp" ? { status: "aprovado", sources: ["qtd:prevista"], content: "" } : null)) as any);
    await expect(setPlannedQuantities({ ...A, changes: [{ itemId: ITEM, expectedRevision: 1, mode: "informed", quantity: "9" }], idempotencyKey: "k5" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("GOVERNED_CHANGE_REQUIRED") });
    for (const spy of WRITE_SPIES()) expect(spy).not.toHaveBeenCalled();
  });

  it("persistência indisponível dentro da governança (getDb null depois do início) ⇒ recusa", async () => {
    let calls = 0;
    const db = h.db.value;
    const { getDb } = await import("../../db/connection");
    vi.mocked(getDb).mockImplementation((async () => (++calls <= 1 ? db : null)) as any);
    await expect(updateProcurementItem({ ...A, itemId: ITEM, expectedRevision: 1, description: "Outro", idempotencyKey: "k1" })).rejects.toThrow(/GOVERNANCE_UNAVAILABLE/);
    for (const spy of WRITE_SPIES()) expect(spy).not.toHaveBeenCalled();
  });
});
