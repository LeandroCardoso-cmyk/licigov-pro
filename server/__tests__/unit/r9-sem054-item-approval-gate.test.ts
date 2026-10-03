/**
 * R9 / SEM-054 — portão de aprovação do Item Inteligente (regra pura + orquestrador com persistência mockada).
 *
 *   G1. `itemApprovalBlock`: current ⇒ livre; source_changed / review_required / desconhecido ⇒ código estável;
 *   G2. `findPriceOutliers` ≡ `detectPriceOutlier` (mesma regra >50%, limite estrito), em centavos inteiros;
 *   G3. `applyGovernedItemTransition` RECUSA aprovar com fonte não vigente (PRECONDITION_FAILED + código),
 *       inclusive item já aprovado (sem "replay" silencioso), sem tocar no CAS;
 *   G4. aprovar com fonte vigente condiciona o CAS a `source_state = 'current'`; perder o CAS porque a fonte
 *       mudou no meio ⇒ recusa explícita (não "convergiu"); rejeitar não é bloqueado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findPriceOutliers, itemApprovalBlock, itemApprovalBlockMessage, ITEM_APPROVAL_BLOCK_CODES,
} from "@shared/itemApprovalGate";
import { detectPriceOutlier } from "../../domain/itemRecommendation";

const m = vi.hoisted(() => ({
  item: null as null | { id: string; processId: string; description: string; status: string },
  freshStatus: "pendente",
  sourceStates: [] as string[],
  casApplied: true,
  casCalls: [] as Array<Record<string, unknown>>,
  events: 0,
}));

vi.mock("../../db/procurement", async (orig) => {
  const actual = await orig<typeof import("../../db/procurement")>();
  let reads = 0;
  return {
    ...actual,
    getIntelligentItem: vi.fn(async () => {
      reads += 1;
      if (!m.item) return null;
      return reads === 1 ? { ...m.item } : { ...m.item, status: m.freshStatus };
    }),
    getIntelligentItemSourceState: vi.fn(async () => {
      const s = m.sourceStates.length > 1 ? m.sourceStates.shift()! : m.sourceStates[0];
      return { sourceState: s, sourceStateReason: null };
    }),
    transitionItemStatusCAS: vi.fn(async (p: Record<string, unknown>) => { m.casCalls.push(p); return { applied: m.casApplied }; }),
    recordProcessEvent: vi.fn(async () => { m.events += 1; return null; }),
    __resetReads: () => { reads = 0; },
  };
});
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}) })),
}));

import * as procurementDb from "../../db/procurement";
import { applyGovernedItemTransition } from "../../services/itemIntelligenceService";

const approve = () => applyGovernedItemTransition({
  itemId: "it-1", orgId: 960520, target: "aprovado", approvedBy: 7, actorUserId: 7, correlationId: "c",
  eventType: "approval", summary: (d) => `Item aprovado: ${d}.`,
});

describe("R9 / SEM-054 — regra pura do portão de aprovação", () => {
  it("G1) current livre; source_changed / review_required / desconhecido bloqueiam com código estável", () => {
    expect(itemApprovalBlock("current")).toBeNull();
    expect(itemApprovalBlock(null)).toBeNull(); // coluna NOT NULL default 'current'; ausência = vigente
    expect(itemApprovalBlock("source_changed")?.code).toBe(ITEM_APPROVAL_BLOCK_CODES.sourceChanged);
    expect(itemApprovalBlock("review_required")?.code).toBe(ITEM_APPROVAL_BLOCK_CODES.identityReview);
    expect(itemApprovalBlock("algo_novo")?.code).toBe(ITEM_APPROVAL_BLOCK_CODES.sourceNotCurrent);
    expect(itemApprovalBlockMessage(itemApprovalBlock("source_changed")!)).toMatch(/^ITEM_SOURCE_CHANGED: /);
  });

  it("G2) findPriceOutliers ≡ detectPriceOutlier (limite >50% estrito), centavos inteiros", () => {
    const samples: number[][] = [
      [10000, 10000, 40000], // média 200: C +100% (outlier); A/B −50% exatos (não)
      [10000, 11000, 9000],
      [10000],
      [10000, 30001],
      [10000, 30000], // média 200: ±50% exatos ⇒ nenhum
      [5000, 5000, 5000, 100000],
    ];
    for (const s of samples) {
      const out = findPriceOutliers(s.map((v, i) => ({ name: `F${i}`, valueCents: v })));
      expect(out.length > 0).toBe(detectPriceOutlier(s.map((v) => v / 100)).outlier);
    }
    expect(findPriceOutliers([10000, 10000, 40000].map((v, i) => ({ name: `F${i}`, valueCents: v })))).toEqual([
      { name: "F2", valueCents: 40000, deviationPercent: 100 },
    ]);
    // Sem preço não entra na média nem é outlier.
    expect(findPriceOutliers([{ name: "A", valueCents: 10000 }, { name: "B", valueCents: null }, { name: "C", valueCents: 0 }])).toEqual([]);
  });
});

describe("R9 / SEM-054 — applyGovernedItemTransition recusa fonte não vigente", () => {
  beforeEach(() => {
    m.item = { id: "it-1", processId: "p-1", description: "Papel A4", status: "pendente" };
    m.freshStatus = "pendente";
    m.sourceStates = ["current"];
    m.casApplied = true;
    m.casCalls = [];
    m.events = 0;
    (procurementDb as unknown as { __resetReads: () => void }).__resetReads();
  });

  it("G3) source_changed ⇒ PRECONDITION_FAILED ITEM_SOURCE_CHANGED, sem CAS nem evento", async () => {
    m.sourceStates = ["source_changed"];
    await expect(approve()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^ITEM_SOURCE_CHANGED: /) });
    expect(m.casCalls).toHaveLength(0);
    expect(m.events).toBe(0);
  });

  it("G3) review_required ⇒ ITEM_IDENTITY_REVIEW_REQUIRED", async () => {
    m.sourceStates = ["review_required"];
    await expect(approve()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^ITEM_IDENTITY_REVIEW_REQUIRED: /) });
    expect(m.casCalls).toHaveLength(0);
  });

  it("G3) item JÁ aprovado com fonte alterada ⇒ recusa (sem sucesso idempotente silencioso)", async () => {
    m.item!.status = "aprovado";
    m.sourceStates = ["source_changed"];
    await expect(approve()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("G4) fonte vigente ⇒ CAS condicionado a source_state='current'; 1 evento", async () => {
    await expect(approve()).resolves.toMatchObject({ success: true, status: "aprovado" });
    expect(m.casCalls[0]).toMatchObject({ toStatus: "aprovado", requireSourceState: "current" });
    expect(m.events).toBe(1);
  });

  it("G4) perdeu o CAS porque a fonte mudou no meio ⇒ recusa explícita, nunca 'convergiu'", async () => {
    m.casApplied = false;
    m.sourceStates = ["current", "source_changed"];
    await expect(approve()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^ITEM_SOURCE_CHANGED/) });
    expect(m.events).toBe(0);
  });

  it("G4) rejeitar NÃO é bloqueado pela fonte (decisão negativa continua possível) e o CAS não exige source_state", async () => {
    m.sourceStates = ["source_changed"];
    const r = await applyGovernedItemTransition({
      itemId: "it-1", orgId: 960520, target: "rejeitado", approvedBy: null, actorUserId: 7, correlationId: "c",
      eventType: "decision", summary: (d) => `Item rejeitado: ${d}.`,
    });
    expect(r.status).toBe("rejeitado");
    expect(m.casCalls[0]).not.toHaveProperty("requireSourceState");
  });
});
