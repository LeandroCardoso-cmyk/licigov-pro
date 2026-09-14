/**
 * A3-RD1 — seleção de enquadramento do wizard (spec §15 G): sugestão IA governada → referência
 * governada no create; dropdown legado → referência legada; nunca os dois; nenhum → fail-closed.
 */
import { describe, it, expect } from "vitest";
import { buildLegalFramingInput } from "./directContractCreateInput";

const governed = { canonicalLocator: "lei-14.133-2021/art-75/inc-I", referenceSetVersion: 1, legalReferenceEntryId: 42 };

describe("buildLegalFramingInput", () => {
  it("sugestão IA governada → envia referência GOVERNADA (sem legalArticleId)", () => {
    const out = buildLegalFramingInput(governed, null);
    expect(out).toEqual({ canonicalLocator: "lei-14.133-2021/art-75/inc-I", referenceSetVersion: 1 });
    expect("legalArticleId" in out).toBe(false);
  });

  it("dropdown legado → envia referência LEGADA (sem canonicalLocator)", () => {
    const out = buildLegalFramingInput(null, 7);
    expect(out).toEqual({ legalArticleId: 7 });
    expect("canonicalLocator" in out).toBe(false);
  });

  it("governado tem precedência quando ambos presentes (nunca mistura IDs no payload)", () => {
    const out = buildLegalFramingInput(governed, 7);
    expect(out).toEqual({ canonicalLocator: "lei-14.133-2021/art-75/inc-I", referenceSetVersion: 1 });
  });

  it("nenhum enquadramento → fail-closed", () => {
    expect(() => buildLegalFramingInput(null, null)).toThrow(/Enquadramento ausente/);
  });
});
