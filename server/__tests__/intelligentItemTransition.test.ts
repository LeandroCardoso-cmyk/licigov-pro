import { describe, it, expect } from "vitest";
import {
  createIntelligentItem, approveItem, rejectItem, canTransitionItem, itemTransitionSources,
  ItemTransitionError, isItemTransitionError, type IntelligentProcurementItem, type ItemStatus,
} from "../domain/intelligentItem";

/**
 * F2 (homologação V1) — Regras DETERMINÍSTICAS de transição de Item Inteligente (camada de domínio).
 *
 * Uma transição inválida (aprovar item já aprovado/rejeitado, estado desatualizado) é um erro de
 * domínio ESPERADO e TIPADO (`ItemTransitionError`), nunca um `Error` genérico que viraria 500.
 * A produção NÃO usa mais o mutator na borda: a escrita é um compare-and-set atômico no banco cujas
 * ORIGENS válidas vêm de `itemTransitionSources` (testado aqui). A concorrência-segurança real
 * (single-winner, exatamente um evento, CONFLICT em estado incompatível) é coberta pelo smoke MySQL
 * `item-transition-concurrency-mysql-smoke.test.ts`.
 */
function baseItem(overrides?: Partial<IntelligentProcurementItem>): IntelligentProcurementItem {
  const it = createIntelligentItem({
    processId: "proc-1", organizationId: 1, sourceResearchId: "res-1",
    description: "Notebook i7", quantity: 10, unit: "un", correlationId: "corr-1",
  });
  return { ...it, ...overrides };
}

describe("F2 — transições de Item Inteligente (erro tipado, nunca 500)", () => {
  it("aprovar um item pendente funciona (happy path)", () => {
    const approved = approveItem(baseItem({ status: "pendente" }), 7);
    expect(approved.status).toBe("aprovado");
    expect(approved.approvedBy).toBe(7);
  });

  it("aprovar item já APROVADO lança ItemTransitionError (não Error genérico)", () => {
    const item = baseItem({ status: "aprovado" });
    expect(() => approveItem(item, 7)).toThrow(ItemTransitionError);
    try {
      approveItem(item, 7);
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(isItemTransitionError(err)).toBe(true);
      expect((err as ItemTransitionError).code).toBe("ITEM_TRANSITION_INVALID");
      expect((err as ItemTransitionError).from).toBe("aprovado");
      expect((err as ItemTransitionError).to).toBe("aprovado");
      // não é o Error genérico anterior
      expect((err as Error).message).not.toMatch(/estado aprovado$/);
    }
  });

  it("rejeitar item já REJEITADO lança ItemTransitionError tipado", () => {
    const item = baseItem({ status: "rejeitado" });
    expect(() => rejectItem(item)).toThrow(ItemTransitionError);
    try { rejectItem(item); } catch (err) { expect(isItemTransitionError(err)).toBe(true); }
  });

  it("transição rejeitado→aprovado é inválida e tipada (estado desatualizado)", () => {
    expect(canTransitionItem("rejeitado", "aprovado")).toBe(false);
    expect(() => approveItem(baseItem({ status: "rejeitado" }), 7)).toThrow(ItemTransitionError);
  });

  it("itemTransitionSources deriva as ORIGENS válidas do compare-and-set (consumidor de produção)", () => {
    // A escrita real (CAS no banco) aplica a transição apenas se o status atual estiver nestas origens.
    const approveSources = itemTransitionSources("aprovado").sort();
    const rejectSources = itemTransitionSources("rejeitado").sort();
    expect(approveSources).toEqual(["em_analise", "pendente"]);
    expect(rejectSources).toEqual(["em_analise", "pendente"]);
    // Coerência com canTransitionItem: toda origem listada é uma transição válida; o alvo nunca é origem.
    for (const s of approveSources) expect(canTransitionItem(s as ItemStatus, "aprovado")).toBe(true);
    expect(approveSources).not.toContain("aprovado");
    expect(rejectSources).not.toContain("rejeitado");
  });
});
