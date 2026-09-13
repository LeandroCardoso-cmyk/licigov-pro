/**
 * A3-RD1 — Manifesto V1 (fonte única) + hashing canônico.
 */
import { describe, it, expect } from "vitest";
import {
  LEGAL_REFERENCE_V1_ENTRIES, LEGAL_REFERENCE_V1_OVERRIDES, LEGAL_REFERENCE_V1_META,
  computeManifestHashes, coverageManifestObject,
} from "../manifestV1";

describe("A3-RD1 — manifestV1 (conteúdo VERIFIED)", () => {
  it("7 entries (Art. 74 I–V; Art. 75 I–II) e 2 value overrides", () => {
    expect(LEGAL_REFERENCE_V1_ENTRIES).toHaveLength(7);
    expect(LEGAL_REFERENCE_V1_OVERRIDES).toHaveLength(2);
    const locators = LEGAL_REFERENCE_V1_ENTRIES.map((e) => e.canonicalLocator);
    for (const inc of ["I", "II", "III", "IV", "V"]) expect(locators).toContain(`lei-14.133-2021/art-74/inc-${inc}`);
    for (const inc of ["I", "II"]) expect(locators).toContain(`lei-14.133-2021/art-75/inc-${inc}`);
  });

  it("Art. 74, IV usa procurementType=inexigibilidade (enum não ampliado); credenciamento só na hipótese", () => {
    const e = LEGAL_REFERENCE_V1_ENTRIES.find((x) => x.canonicalLocator === "lei-14.133-2021/art-74/inc-IV")!;
    expect(e.procurementType).toBe("inexigibilidade");
    expect(e.hypothesisSummary.toLowerCase()).toContain("credenciamento");
  });

  it("value overrides 2026 (Decreto 12.807/2025): 75,I=13098420 e 75,II=6549211 (centavos inteiros)", () => {
    const byLoc = Object.fromEntries(LEGAL_REFERENCE_V1_OVERRIDES.map((o) => [o.canonicalLocator, o.valueCents]));
    expect(byLoc["lei-14.133-2021/art-75/inc-I"]).toBe(13098420);
    expect(byLoc["lei-14.133-2021/art-75/inc-II"]).toBe(6549211);
    for (const o of LEGAL_REFERENCE_V1_OVERRIDES) expect(Number.isInteger(o.valueCents)).toBe(true);
  });

  it("cobertura temporal a partir de 2026-01-01 (aberto)", () => {
    expect(LEGAL_REFERENCE_V1_META.effectiveFrom).toBe("2026-01-01");
    expect(LEGAL_REFERENCE_V1_META.effectiveTo).toBeNull();
    expect(coverageManifestObject().supportedLocators).toHaveLength(7);
  });

  it("hashes reprodutíveis e estáveis (byte-a-byte)", () => {
    const a = computeManifestHashes();
    const b = computeManifestHashes();
    expect(a).toEqual(b);
    expect(a.referenceSetContentHash).toBe("332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832");
    expect(a.coverageManifestHash).toBe("48ed92dc83799a9d70b94a3f70fd85abf03d76c9cde4ff36682e95d17e8e131c");
    expect(a.entryHashes["lei-14.133-2021/art-74/inc-IV"]).toBe("e725972fe075069005d65bcd723d9e624ed966f5f3b60a3879c1efef2c5682de");
  });

  it("nenhum valor monetário embutido na hypothesisSummary estrutural", () => {
    for (const e of LEGAL_REFERENCE_V1_ENTRIES) {
      expect(e.hypothesisSummary).not.toMatch(/R\$\s*\d/);
      expect(e.hypothesisSummary).not.toMatch(/130\.984|65\.492|13098420|6549211/);
    }
  });
});
