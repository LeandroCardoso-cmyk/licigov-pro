/**
 * PR B.2.2 — Testes puros dos helpers de staging (confidence, provenance, advertências).
 */
import { describe, it, expect } from "vitest";
import {
  extractConfidence, formatProvenance, extractItemWarnings, REVIEW_STATUS_LABEL,
} from "./staging";

describe("extractConfidence", () => {
  it("lê averageConfidence/score/confidence quando 0–1", () => {
    expect(extractConfidence({ averageConfidence: 0.9 })).toBe(0.9);
    expect(extractConfidence({ score: 0.5 })).toBe(0.5);
    expect(extractConfidence({ confidence: 0 })).toBe(0);
  });
  it("retorna null para ausente/ inválido", () => {
    expect(extractConfidence(null)).toBeNull();
    expect(extractConfidence({})).toBeNull();
    expect(extractConfidence({ score: 1.5 })).toBeNull();
    expect(extractConfidence("x")).toBeNull();
  });
});

describe("formatProvenance", () => {
  it("formata planilha/linha/página/célula", () => {
    expect(formatProvenance({ sheet: "Plan1", row: 12 })).toBe('planilha "Plan1", linha 12');
    expect(formatProvenance({ page: 3, line: 4 })).toBe("página 3, linha 4");
    expect(formatProvenance({ cell: "B2" })).toBe("célula B2");
  });
  it("retorna null quando não há origem reconhecível", () => {
    expect(formatProvenance(null)).toBeNull();
    expect(formatProvenance({})).toBeNull();
  });
});

describe("extractItemWarnings", () => {
  it("normaliza strings e objetos {message|code}", () => {
    expect(extractItemWarnings(["a", { message: "b" }, { code: "C" }, 1])).toEqual(["a", "b", "C"]);
  });
  it("retorna [] para não-array", () => {
    expect(extractItemWarnings(undefined)).toEqual([]);
  });
});

describe("REVIEW_STATUS_LABEL", () => {
  it("rótulos institucionais pt-BR", () => {
    expect(REVIEW_STATUS_LABEL.pending).toBe("Pendente");
    expect(REVIEW_STATUS_LABEL.approved).toBe("Aceito");
    expect(REVIEW_STATUS_LABEL.rejected).toBe("Rejeitado");
    expect(REVIEW_STATUS_LABEL.skipped).toBe("Pulado");
  });
});
