/**
 * R9 / SEM-052 · SEM-054 — helpers puros da confirmação de cotações atualizadas e do portão de aprovação.
 * Valores monetários SEMPRE em centavos → `formatCentsBRL` (nunca reais tratados como centavos).
 */
import { describe, it, expect } from "vitest";
import {
  applyInputFromPreview, approveButtonState, isStaleConfirmationError, outlierSummary, sourceUpdateConfirmModel,
  type SourceUpdatePreview,
} from "./itemSourceUpdateView";

const PREVIEW: SourceUpdatePreview = {
  itemId: "i1", description: "Papel A4", status: "aprovado", revokesDecision: "aprovado", statusAfter: "em_analise",
  current: { quoteCount: 2, averageCents: 11000, quotes: [] },
  proposed: { quoteCount: 3, averageCents: 150000, quotes: [] },
  averageDeltaCents: 139000,
  added: [{ quoteId: "c", supplier: "Papelaria C", valueCents: 20000 }, { quoteId: "d", supplier: "", valueCents: null }],
  removed: [{ quoteId: "e", supplier: "Papelaria E", valueCents: 9000 }],
  changed: [{ quoteId: "b", supplier: "Papelaria B", beforeCents: 12000, afterCents: 15000 }],
  expectedStateToken: `sui1.${"a".repeat(32)}.${"b".repeat(32)}`,
};

describe("R9 / SEM-052 — modelo da confirmação (atual × proposto)", () => {
  it("mostra nº de cotações, média em centavos formatada e situação antes/depois", () => {
    const m = sourceUpdateConfirmModel(PREVIEW);
    expect(m.title).toBe("Comparativo de cotações — Papel A4");
    expect(m.rows).toEqual([
      { label: "Cotações válidas", before: "2", after: "3" },
      { label: "Preço médio (referência)", before: "R$ 110,00", after: "R$ 1.500,00" },
      { label: "Situação do item", before: "Aprovado", after: "Em análise" },
    ]);
    expect(m.averageDelta).toBe("+R$ 1.390,00");
    expect(m.added).toEqual(["Papelaria C — R$ 200,00", "Fornecedor não identificado — sem preço"]);
    expect(m.removed).toEqual(["Papelaria E — R$ 90,00"]);
    expect(m.changed).toEqual(["Papelaria B: R$ 120,00 → R$ 150,00"]);
  });

  it("declara EXPLICITAMENTE a revogação da aprovação (e da rejeição); pendente não revoga nada", () => {
    const approved = sourceUpdateConfirmModel(PREVIEW);
    expect(approved.revokes).toBe(true);
    expect(approved.decisionNotice).toMatch(/aprovação humana deste item será REVOGADA/);
    const rejected = sourceUpdateConfirmModel({ ...PREVIEW, status: "rejeitado", revokesDecision: "rejeitado" });
    expect(rejected.decisionNotice).toMatch(/rejeição registrada deste item será REVOGADA/);
    const pending = sourceUpdateConfirmModel({ ...PREVIEW, status: "pendente", revokesDecision: null, statusAfter: "pendente" });
    expect(pending.revokes).toBe(false);
    expect(pending.decisionNotice).toMatch(/nenhuma decisão humana é revogada/);
    expect(sourceUpdateConfirmModel({ ...PREVIEW, averageDeltaCents: -500 }).averageDelta).toBe("-R$ 5,00");
  });

  it("a mutação leva SEMPRE o token da prévia exibida; CONFLICT/SOURCE_UPDATE_STALE = confirmação desatualizada", () => {
    expect(applyInputFromPreview(PREVIEW)).toEqual({ itemId: "i1", expectedStateToken: PREVIEW.expectedStateToken });
    expect(isStaleConfirmationError({ data: { code: "CONFLICT" }, message: "x" })).toBe(true);
    expect(isStaleConfirmationError({ data: null, message: "SOURCE_UPDATE_STALE: mudou" })).toBe(true);
    expect(isStaleConfirmationError({ data: { code: "PRECONDITION_FAILED" }, message: "SOURCE_UPDATE_NOT_PENDING: x" })).toBe(false);
    expect(isStaleConfirmationError(null)).toBe(false);
  });
});

describe("R9 / SEM-054 — estado do botão Aprovar e outliers", () => {
  it("fonte alterada / identidade a revisar ⇒ desabilitado COM motivo; vigente ⇒ habilitado", () => {
    const changed = approveButtonState("source_changed", false);
    expect(changed.disabled).toBe(true);
    expect(changed.block?.code).toBe("ITEM_SOURCE_CHANGED");
    expect(changed.block?.reason).toMatch(/aplique as cotações atualizadas antes de aprovar/);
    const review = approveButtonState("review_required", false);
    expect([review.disabled, review.block?.code]).toEqual([true, "ITEM_IDENTITY_REVIEW_REQUIRED"]);
    expect(approveButtonState("current", false)).toEqual({ disabled: false, block: null });
    expect(approveButtonState("current", true).disabled).toBe(true); // mutação em voo
  });

  it("outliers formatados a partir de CENTAVOS com desvio assinado", () => {
    expect(outlierSummary([{ name: "C", valueCents: 40000, deviationPercent: 100 }, { name: "", valueCents: 1000, deviationPercent: -60 }])).toEqual([
      "C — R$ 400,00 (+100% da média)",
      "Fornecedor não identificado — R$ 10,00 (-60% da média)",
    ]);
    expect(outlierSummary(undefined)).toEqual([]);
  });
});
