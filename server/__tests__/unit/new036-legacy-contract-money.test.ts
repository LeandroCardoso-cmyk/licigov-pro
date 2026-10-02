/**
 * NEW-036 — minuta/termos do contrato LEGADO pelo formatador monetário único, com unidade explícita (REAIS no
 * legado) e a ponte centavos ⇄ reais do formulário legado (prefill de processo/contratação direta).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateContractMinuta, generateRescissionTerm, formatLegacyReais } from "../../services/contractDocuments";
import { centsToLegacyReaisInput, parseLegacyReaisInput } from "../../../client/src/lib/money";

const base = {
  number: "12", year: 2026, object: "Fornecimento de papel", type: "fornecimento" as const,
  contractorName: "Papelaria Exemplo Ltda", value: 1500.5, currentValue: 1750.25,
  startDate: new Date("2026-01-10T12:00:00Z"), endDate: new Date("2026-12-31T12:00:00Z"),
};

describe("NEW-036 — dinheiro do contrato legado", () => {
  it("formatLegacyReais usa o formatador único (sem NBSP, sem Intl direto)", () => {
    expect(formatLegacyReais(1500.5)).toBe("R$ 1.500,50");
    expect(formatLegacyReais(0)).toBe("R$ 0,00");
    expect(formatLegacyReais(1234567.891)).toBe("R$ 1.234.567,89");
  });

  it("minuta: valor em reais formatado uma vez; nenhum 'por extenso' fabricado", () => {
    const md = generateContractMinuta(base);
    expect(md).toContain("**R$ 1.500,50** ([VALOR POR EXTENSO — REVISAR])");
    expect(md).not.toMatch(/\d reais\)/);
    expect(md).not.toContain(" ");
  });

  it("rescisão: valor original/atual pelo mesmo formatador", () => {
    const md = generateRescissionTerm(base, { type: "bilateral", reason: "Acordo", effectiveDate: new Date("2026-06-01T12:00:00Z") });
    expect(md).toContain("**R$ 1.500,50**");
    expect(md).toContain("**R$ 1.750,25**");
  });

  it("serviço legado não usa Intl.NumberFormat/toLocaleString para dinheiro", () => {
    const src = readFileSync(resolve(__dirname, "../../services/contractDocuments.ts"), "utf8");
    expect(src).not.toMatch(/style:\s*"currency"/);
    expect(src).not.toMatch(/\.toLocaleString\(/);
  });

  it("prefill: centavos do processo/contratação direta chegam ao formulário legado como os MESMOS reais", () => {
    for (const cents of [0, 1, 150000, 150050, 123456789]) {
      expect(parseLegacyReaisInput(centsToLegacyReaisInput(cents))).toBeCloseTo(cents / 100, 2);
    }
    expect(centsToLegacyReaisInput(150050)).toBe("1500,50");
    expect(centsToLegacyReaisInput(null)).toBe("0,00");
    // regressões: "1500.5" (ponto) virava 15005; centavos crus "150000" viravam R$ 150.000,00
    expect(parseLegacyReaisInput("1.500,50")).toBe(1500.5);
  });

  it("ProcessDetails e DirectContractDetails usam a ponte (sem centavos crus nem toString com ponto)", () => {
    const pd = readFileSync(resolve(__dirname, "../../../client/src/pages/ProcessDetails.tsx"), "utf8");
    const dc = readFileSync(resolve(__dirname, "../../../client/src/pages/DirectContractDetails.tsx"), "utf8");
    expect(pd).toContain("centsToLegacyReaisInput(process.estimatedValue)");
    expect(pd).not.toContain("String(process.estimatedValue");
    expect(dc).toContain("centsToLegacyReaisInput(contract.value)");
    expect(dc).not.toContain("(contract.value / 100).toString()");
  });
});
