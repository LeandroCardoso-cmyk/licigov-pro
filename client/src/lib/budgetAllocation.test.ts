/**
 * LICIGOV-FAST PR-2 — lógica pura da tela dos Dados orçamentários do processo (dotação/fonte).
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { BUDGET_STATUS_HINT, BUDGET_STATUS_LABEL, budgetAllocationPlan, budgetPendingItems, type BudgetAllocationState } from "./budgetAllocation";

const state = (dotacao: string | null, fonte: string | null, srp: boolean | null = false): BudgetAllocationState => ({
  dotacao: { value: dotacao, status: dotacao ? "DECLARED" : srp ? "NOT_APPLICABLE" : "PENDING" },
  fonte: { value: fonte, status: fonte ? "DECLARED" : srp ? "NOT_APPLICABLE" : "PENDING" },
  srp, catalogVersion: "bll-1",
});

describe("status visível: Pendente × Declarado × Não aplicável (declarado nunca é 'verificado')", () => {
  it("rótulos e explicações", () => {
    expect(BUDGET_STATUS_LABEL).toEqual({ DECLARED: "Declarado", PENDING: "Pendente", NOT_APPLICABLE: "Não aplicável" });
    expect(BUDGET_STATUS_HINT.DECLARED).toMatch(/não verificado/);
    expect(BUDGET_STATUS_HINT.PENDING).toMatch(/Não impede gerar nem emitir/);
    expect(BUDGET_STATUS_HINT.NOT_APPLICABLE).toMatch(/regulamento aplicável ao órgão/);
    expect(Object.values(BUDGET_STATUS_HINT).join(" ")).not.toMatch(/Decreto|11\.462/);
  });
  it("só o que está PENDENTE vira aviso; declarado e não aplicável não aparecem", () => {
    expect(budgetPendingItems(state(null, null))).toEqual([{ key: "dotacao", label: "Dotação orçamentária" }, { key: "fonte", label: "Fonte de recursos" }]);
    expect(budgetPendingItems(state("02.001", null))).toEqual([{ key: "fonte", label: "Fonte de recursos" }]);
    expect(budgetPendingItems(state(null, null, true))).toEqual([]);
    expect(budgetPendingItems(null)).toEqual([]);
  });
});

describe("plano de gravação: só o que mudou; substituição é sempre explícita", () => {
  it("primeiro registro: envia o valor normalizado, sem substituição", () => {
    expect(budgetAllocationPlan(state(null, null), { dotacao: "  02.001   — 3.3.90.30 " })).toEqual({ payload: { dotacaoOrcamentaria: "02.001 — 3.3.90.30" }, replaces: [], changed: true });
  });
  it("mesmo valor ou campo vazio: nada a gravar (nunca apaga por campo em branco)", () => {
    expect(budgetAllocationPlan(state("02.001", "Livre"), { dotacao: "02.001", fonte: "   " })).toEqual({ payload: {}, replaces: [], changed: false });
  });
  it("valor diferente de um JÁ registrado ⇒ marcado como substituição (exige confirmação explícita)", () => {
    expect(budgetAllocationPlan(state("02.001", "Livre"), { dotacao: "02.002" })).toEqual({ payload: { dotacaoOrcamentaria: "02.002" }, replaces: ["dotacao"], changed: true });
  });
});

describe("fiação da tela (varredura de fonte; o repositório não tem jsdom)", () => {
  const read = (f: string) => readFileSync(path.resolve(__dirname, f), "utf8");
  it("o card grava pelo escritor único, com confirmReplace só quando há substituição, e invalida TR/Edital", () => {
    const card = read("../components/procurement/BudgetDisclosureCard.tsx");
    expect(card).toContain("trpc.institutionalTemplates.governed.recordBudgetAllocation.useMutation()");
    expect(card).toContain("...(plan.replaces.length > 0 ? { confirmReplace: true } : {})");
    expect(card).toContain("utils.procurementProcess.editalTemplatePreparation.invalidate()");
    expect(card).toContain("utils.procurementProcess.trStructuredParams.invalidate()");
  });
  it("o aviso aparece no TR e no Edital (elaboração e emissão) e nunca desabilita ações", () => {
    const tr = read("../components/procurement/TRWorkspace.tsx");
    const ed = read("../components/procurement/EditalWorkspace.tsx");
    for (const src of [tr, ed]) {
      expect(src).toMatch(/<BudgetPendingNotice processId=\{processId\} documentLabel="(TR|Edital)" variant="drafting" \/>/);
      expect(src).toMatch(/<BudgetPendingNotice processId=\{processId\} documentLabel="(TR|Edital)" variant="finalizing"( draftBudgetDigest=\{[^}]+\})? \/>/);
    }
    expect(tr).toContain("draftBudgetDigest={reviewable.data.draft.budgetDigest}");   // TR desatualizado ⇒ aviso informativo
    const notice = read("../components/procurement/BudgetPendingNotice.tsx");
    expect(notice).not.toMatch(/disabled=|onBlock|canEmit/);
  });
});

describe("TR gerado com dados orçamentários anteriores: aviso informativo (nunca bloqueio)", () => {
  it("digest diferente ⇒ desatualizado; igual, ausente no rascunho ou sem estado ⇒ nada a avisar", async () => {
    const { budgetOutdatedInDraft } = await import("./budgetAllocation");
    const a = { ...state("02.001", "Livre"), digest: "d2" };
    expect(budgetOutdatedInDraft(a, "d1")).toBe(true);
    expect(budgetOutdatedInDraft(a, "d2")).toBe(false);
    expect(budgetOutdatedInDraft(a, null)).toBe(false);
    expect(budgetOutdatedInDraft(null, "d1")).toBe(false);
  });
});
