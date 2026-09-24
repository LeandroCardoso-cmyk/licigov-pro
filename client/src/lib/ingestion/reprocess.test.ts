/**
 * Layout v2 — a ação "Reprocessar extração" só aparece quando é segura (nenhuma decisão humana).
 */
import { describe, it, expect } from "vitest";
import { describeReprocess, isValidReprocessReason, REPROCESS_NOTICE } from "./reprocess";

describe("describeReprocess — ação governada", () => {
  it("elegível ⇒ mostra a ação", () => {
    expect(describeReprocess({ eligible: true, inProgress: false, blockers: [] })).toEqual({ showAction: true, inProgress: false, blockedReason: null });
  });
  it("reprocessamento em andamento ⇒ sem ação (aguardar)", () => {
    expect(describeReprocess({ eligible: false, inProgress: true, blockers: ["REPROCESS_IN_PROGRESS"] })).toMatchObject({ showAction: false, inProgress: true });
  });
  it("qualquer decisão humana (revisado/corrigido/promovido) ⇒ ação NÃO aparece e o motivo é explicado", () => {
    for (const b of ["ITEMS_REVIEWED", "ITEMS_CORRECTED", "PROMOTED"]) {
      const v = describeReprocess({ eligible: false, blockers: [b], message: "Há itens já revisados." });
      expect(v.showAction).toBe(false);
      expect(v.blockedReason).toBe("Há itens já revisados.");
    }
  });
  it("estado não aplicável (fora de revisão) ⇒ silêncio", () => {
    expect(describeReprocess({ eligible: false, blockers: ["NOT_AWAITING_REVIEW"] })).toEqual({ showAction: false, inProgress: false, blockedReason: null });
    expect(describeReprocess(null).showAction).toBe(false);
  });
  it("motivo obrigatório (mín. 10 caracteres) e aviso institucional", () => {
    expect(isValidReprocessReason("curto")).toBe(false);
    expect(isValidReprocessReason("Nova versão do leitor de tabelas")).toBe(true);
    expect(REPROCESS_NOTICE).toBe("Reprocessar substitui apenas a extração ainda não revisada. Nenhuma decisão humana será sobrescrita.");
  });
});
