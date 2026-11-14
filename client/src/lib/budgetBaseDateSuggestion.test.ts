import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { baseDateSuggestion, BASE_DATE_SUGGESTION_LABEL } from "./budgetBaseDateSuggestion";

describe("sugestão de data-base do orçamento (M8)", () => {
  it("só existe enquanto não há data-base registrada (antes: continuava aparecendo depois do registro)", () => {
    expect(baseDateSuggestion({ baseDate: null, suggestedBaseDate: "2026-10-27" })).toBe("2026-10-27");
    expect(baseDateSuggestion({ baseDate: "2026-10-20", suggestedBaseDate: "2026-10-27" })).toBeNull();
    expect(baseDateSuggestion({ baseDate: null, suggestedBaseDate: null })).toBeNull();
  });
  it("o rótulo diz a origem real (registro no sistema), nunca 'data da pesquisa'", () => {
    expect(BASE_DATE_SUGGESTION_LABEL).toBe("Sugestão: data de registro da pesquisa no sistema");
    const card = fs.readFileSync(path.join(__dirname, "../components/procurement/BudgetDisclosureCard.tsx"), "utf8");
    expect(card).not.toContain("Sugestão: data da pesquisa");
    expect(card).toContain("{baseDateSuggestion(s) && (");
  });
});
