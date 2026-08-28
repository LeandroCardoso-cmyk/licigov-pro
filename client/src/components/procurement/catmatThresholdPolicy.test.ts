import { describe, it, expect } from "vitest";
import { parseThresholdInput } from "./catmatThresholdPolicy";

/**
 * F1 (homologação V1) — Política de entrada do limiar CATMAT/CATSER (fail-closed).
 * Garante que a UI só produz payload para o backend canônico com entrada válida e NUNCA
 * assume um default silencioso.
 */
describe("F1 — parseThresholdInput (fail-closed, sem default silencioso)", () => {
  it("converte percentual válido (0–100) para score 0–1", () => {
    const r = parseThresholdInput("70", "Padrão institucional do órgão");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.minScore).toBeCloseTo(0.7, 6);
      expect(r.value.reason).toBe("Padrão institucional do órgão");
    }
  });

  it("aceita os limites 0 e 100", () => {
    expect(parseThresholdInput("0", "zero").ok).toBe(true);
    expect(parseThresholdInput("100", "cem").ok).toBe(true);
  });

  it("recusa entrada vazia (não há default)", () => {
    expect(parseThresholdInput("", "justificativa ok").ok).toBe(false);
  });

  it("recusa fora da faixa 0–100", () => {
    expect(parseThresholdInput("-1", "abaixo").ok).toBe(false);
    expect(parseThresholdInput("101", "acima").ok).toBe(false);
  });

  it("recusa justificativa curta (mín. 3)", () => {
    const r = parseThresholdInput("70", "ok");
    expect(r.ok).toBe(false);
  });

  it("recusa valor não numérico", () => {
    expect(parseThresholdInput("abc", "justificativa ok").ok).toBe(false);
  });
});
