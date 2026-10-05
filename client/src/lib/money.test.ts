/**
 * NEW-038 (2º passe) — o valor do contrato (`contract_workspaces.value`, DECIMAL 15,2) é em REAIS: o texto digitado
 * vira reais com 2 casas, nunca centavos (o wizard avulso mandava ×100).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseReaisInputToDecimal } from "./money";

describe("parseReaisInputToDecimal (NEW-038)", () => {
  it("texto em reais ⇒ reais com 2 casas (não centavos)", () => {
    expect(parseReaisInputToDecimal("1.234,56")).toBe(1234.56);
    expect(parseReaisInputToDecimal("100")).toBe(100);
    expect(parseReaisInputToDecimal("0,5")).toBe(0.5);
    expect(parseReaisInputToDecimal("10.000,00")).toBe(10000);
  });
  it("vazio/ilegível ⇒ undefined (nunca 0 inventado)", () => {
    expect(parseReaisInputToDecimal("")).toBeUndefined();
    expect(parseReaisInputToDecimal("   ")).toBeUndefined();
    expect(parseReaisInputToDecimal("abc")).toBeUndefined();
  });
  it("o wizard de contrato não multiplica o valor por 100 (guarda do defeito original)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../components/contract-workspace/NewContractWizard.tsx"), "utf8");
    expect(src).not.toMatch(/Math\.round\([^)]*\*\s*100\)\s*:\s*undefined/);
    expect(src).not.toMatch(/valueCents/);
    expect(src).toMatch(/parseReaisInputToDecimal\(valueReais\)/);
  });
});
