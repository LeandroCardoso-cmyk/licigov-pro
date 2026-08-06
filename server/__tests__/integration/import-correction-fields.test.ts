/**
 * PR B.2.2 — Testes puros do contrato de correção por importType (allowlist + normalização +
 * conteúdo efetivo). Executável, sem DB.
 */
import { describe, it, expect } from "vitest";
import {
  validateCorrections, computeEffectiveContent, normalizeDecimal,
  isImportTypeCorrectable,
} from "../../domain/importCorrectionFields";

describe("validateCorrections", () => {
  it("aceita campos permitidos e normaliza texto", () => {
    const r = validateCorrections("price_research", { description: "  cabo  HDMI  " });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.overlay.description).toBe("cabo HDMI"); expect(r.changedFields).toEqual(["description"]); }
  });
  it("normaliza decimal pt-BR e en-US", () => {
    const a = validateCorrections("price_research", { unitPrice: "1.234,56" });
    expect(a.ok && a.overlay.unitPrice).toBe("1234.56");
    const b = validateCorrections("price_research", { quantity: "1234.5" });
    expect(b.ok && b.overlay.quantity).toBe("1234.5");
  });
  it("rejeita número inválido", () => {
    const r = validateCorrections("price_research", { unitPrice: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_NUMBER");
  });
  it("rejeita campo desconhecido (incl. raw/provenance)", () => {
    for (const bad of ["foo", "rawDescription", "sourceLocation", "id"]) {
      const r = validateCorrections("price_research", { [bad]: "x" });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.code).toBe("UNKNOWN_FIELD");
    }
  });
  it("rejeita patch vazio", () => {
    const r = validateCorrections("price_research", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EMPTY");
  });
  it("importType sem contrato → capability indisponível", () => {
    expect(isImportTypeCorrectable("generic")).toBe(false);
    const r = validateCorrections("generic", { description: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CAPABILITY_UNAVAILABLE");
  });
  it("campo obrigatório não pode ser vazio", () => {
    const r = validateCorrections("price_research", { description: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_NULLABLE");
  });
});

describe("normalizeDecimal", () => {
  it("cobre formatos comuns", () => {
    expect(normalizeDecimal("1.234,56")).toBe("1234.56");
    expect(normalizeDecimal("1,234.56")).toBe("1234.56");
    expect(normalizeDecimal("10")).toBe("10");
    expect(normalizeDecimal("R$ 2.500,00")).toBe("2500");
    expect(normalizeDecimal("abc")).toBeNull();
    expect(normalizeDecimal("")).toBeNull();
  });
});

describe("computeEffectiveContent", () => {
  it("overlay vence sobre raw; sem overlay usa raw", () => {
    const item = {
      rawDescription: "orig", rawQuantity: "10", rawUnit: "UN", rawUnitPrice: "5", rawTotalPrice: "50",
      correctedPayload: { unitPrice: "7", description: "corrigido" },
    };
    const eff = computeEffectiveContent(item, "price_research");
    expect(eff.description).toBe("corrigido");
    expect(eff.unitPrice).toBe("7");
    expect(eff.quantity).toBe("10"); // sem overlay → raw
  });
  it("sem correctedPayload retorna raw", () => {
    const eff = computeEffectiveContent({ rawUnit: "KG" }, "price_research");
    expect(eff.unit).toBe("KG");
  });
});
