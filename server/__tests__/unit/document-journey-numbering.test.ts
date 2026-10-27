/**
 * Jornada DFD → ETP → TR → Edital BLL — correções observadas na minuta integrada:
 *  - exercício e sequência lidos do número do processo (AAAA/NNNN e NNNN/AAAA), fonte única preparação × fonte canônica;
 *  - exercício renderizado sem separador de milhar ("2026", nunca "2.026");
 *  - marcador interno da data de emissão legível na exportação da MINUTA (conteúdo persistido intacto).
 */
import { describe, it, expect } from "vitest";
import { processNumberParts, processYearOf } from "../../domain/institutionalTemplates/processYear";
import { EXERCISE_YEAR_VARIABLES, formatValue2 } from "../../domain/institutionalTemplates/valueTypes2";
import { LATE_BOUND_DISPLAY_TEXT, displayLateBoundForDraft, lateBoundCounts, lateBoundMarker } from "../../domain/institutionalTemplates/lifecycleLateBound";
import { MODEL_PACKAGES, getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";

describe("processNumberParts — exercício e sequência do número do processo", () => {
  it.each([
    ["2026/253", 2026, "253"],
    ["2026/0001", 2026, "0001"],
    ["45/2026", 2026, "45"],
    [" 045 / 2026 ", 2026, "045"],
    ["2026/2025", 2026, "2025"],   // os dois lados parecem ano ⇒ vale o formato do sistema (AAAA/…)
  ])("%s ⇒ exercício %i, sequência %s", (n, year, seq) => {
    expect(processNumberParts(n)).toEqual({ year, sequence: seq });
    expect(processYearOf(n)).toBe(year);
  });

  it.each(["IJ-123", "123", "12/34", "2026-253", "2026/253/1", "", "1899/10", "abc/2026"])("%s ⇒ sem exercício; sequência = número inteiro (nada inventado)", (n) => {
    expect(processNumberParts(n)).toEqual({ year: null, sequence: n.trim() });
  });

  // Fronteiras do contrato (determinísticas). Fora de 1900–2099 o lado esquerdo não é ano ⇒ NNNN/AAAA sem ambiguidade.
  it.each([
    ["1000/2026", 2026, "1000"],
    ["1899/2026", 2026, "1899"],
    ["2100/2026", 2026, "2100"],
    ["9999/2026", 2026, "9999"],
  ])("%s ⇒ sequência fora da faixa de ano: exercício %i, sequência %s", (n, year, seq) => {
    expect(processNumberParts(n)).toEqual({ year, sequence: seq });
  });

  // ZONA AMBÍGUA: os dois lados parecem ano (1900–2099). Convenção VIGENTE (documentada em processYear.ts): prevalece o formato do
  // sistema AAAA/NNNN. Ex.: "2093/2026" ⇒ exercício 2093. Mudar isso é decisão de convenção (Owner), não correção de teste.
  it.each([
    ["1900/2026", 1900, "2026"],
    ["2000/2026", 2000, "2026"],
    ["2093/2026", 2093, "2026"],
    ["2099/2026", 2099, "2026"],
  ])("%s ⇒ zona ambígua: convenção vigente lê AAAA/NNNN (exercício %i, sequência %s)", (n, year, seq) => {
    expect(processNumberParts(n)).toEqual({ year, sequence: seq });
  });

  it("nulo/indefinido ⇒ sem exercício", () => {
    expect(processNumberParts(null)).toEqual({ year: null, sequence: "" });
    expect(processYearOf(undefined)).toBeNull();
  });
});

describe("formatValue2 — exercício sem separador de milhar", () => {
  const yearDef = { name: "processo.ano", source: "PROCESS", path: "ano", type: "integer", renderable: true, required: true } as never;
  const qtyDef = { name: "x.quantidade", source: "PROCESS", path: "q", type: "integer", renderable: true, required: true } as never;
  it("exercício: 2026 (não 2.026); demais inteiros mantêm o formato pt-BR", () => {
    expect(formatValue2(yearDef, 2026)).toBe("2026");
    expect(formatValue2(qtyDef, 2026)).toBe("2.026");
  });
  it("a lista explícita cobre exatamente os exercícios inteiros dos catálogos BLL publicados (Revisões 1 e 2)", () => {
    for (const cat of [MODEL_PACKAGES[0].catalog, getModelPackageVersion(MODEL_PACKAGES[0].modelKey, "1.0.2-draft")!.catalog]) {
      const exercises = cat.vars.filter((v) => v.type === "integer" && /^Exercício/.test(v.description ?? "")).map((v) => v.name).sort();
      expect(exercises).toEqual([...EXERCISE_YEAR_VARIABLES].sort());
    }
  });
});

describe("displayLateBoundForDraft — minuta legível sem tocar o rascunho", () => {
  it("troca o marcador interno por texto legível; sem marcador, o texto é idêntico", () => {
    const marker = lateBoundMarker("processo.dataEmissaoEdital");
    const draft = `Moreira Sales, ${marker}.\n\nAssinatura`;
    const shown = displayLateBoundForDraft(draft);
    expect(shown).toBe(`Moreira Sales, ${LATE_BOUND_DISPLAY_TEXT}.\n\nAssinatura`);
    expect(shown).not.toContain("SYSTEM_LATE_BOUND");
    expect(lateBoundCounts(draft).get("processo.dataEmissaoEdital")).toBe(1);   // o rascunho continua com o marcador (integridade da emissão)
    expect(displayLateBoundForDraft("sem marcador")).toBe("sem marcador");
  });
});
