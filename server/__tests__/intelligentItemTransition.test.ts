import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createIntelligentItem, approveItem, rejectItem, canTransitionItem,
  ItemTransitionError, isItemTransitionError, type IntelligentProcurementItem,
} from "../domain/intelligentItem";

/**
 * F2 (homologação V1) — Fronteira de erro das transições de Item Inteligente.
 *
 * Uma transição inválida (aprovar item já aprovado/rejeitado, estado desatualizado, clique
 * duplicado) DEVE lançar um erro de domínio DETERMINÍSTICO e TIPADO (`ItemTransitionError`),
 * nunca um `Error` genérico que o tRPC serializaria como INTERNAL_SERVER_ERROR (500). O router
 * mapeia esse erro para `CONFLICT` (4xx tratável) — pinado aqui pela conversão explícita.
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

  it("o router converte ItemTransitionError em TRPCError CONFLICT (4xx, não 500)", () => {
    // Replica o mapeamento do router: catch(isItemTransitionError) → CONFLICT.
    const mapToTrpc = (fn: () => unknown): TRPCError => {
      try { fn(); throw new Error("não lançou"); }
      catch (err) {
        if (isItemTransitionError(err)) return new TRPCError({ code: "CONFLICT", message: err.message });
        throw err;
      }
    };
    const trpcErr = mapToTrpc(() => approveItem(baseItem({ status: "aprovado" }), 7));
    expect(trpcErr).toBeInstanceOf(TRPCError);
    expect(trpcErr.code).toBe("CONFLICT");
    expect(trpcErr.code).not.toBe("INTERNAL_SERVER_ERROR");
  });
});
