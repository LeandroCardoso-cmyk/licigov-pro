/**
 * A3-RD1 — readiness/resolução temporal PURA (fail-closed, exatamente-um).
 */
import { describe, it, expect } from "vitest";
import {
  windowContains, resolveExactlyOne, isLocatorSupported, LegalReferenceError,
} from "../readiness";

describe("A3-RD1 — janela temporal semiaberta [from, to)", () => {
  it("inclui from, exclui to; to=null é aberto", () => {
    const w = { effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01" };
    expect(windowContains(w, "2025-12-31")).toBe(false);
    expect(windowContains(w, "2026-01-01")).toBe(true); // corte pertence ao novo período
    expect(windowContains(w, "2026-06-15")).toBe(true);
    expect(windowContains(w, "2027-01-01")).toBe(false); // exclusivo
    expect(windowContains({ effectiveFrom: "2026-01-01", effectiveTo: null }, "2099-01-01")).toBe(true);
  });
});

describe("A3-RD1 — resolveExactlyOne (0→gap, 1→ok, ≥2→overlap)", () => {
  const gap = "LEGAL_REFERENCE_VERSION_GAP" as const;
  const overlap = "LEGAL_REFERENCE_TEMPORAL_OVERLAP" as const;

  it("exatamente 1 vigente → retorna", () => {
    const items = [
      { id: "a", effectiveFrom: "2025-01-01", effectiveTo: "2026-01-01" },
      { id: "b", effectiveFrom: "2026-01-01", effectiveTo: null },
    ];
    expect(resolveExactlyOne(items, "2026-06-01", gap, overlap).id).toBe("b");
    expect(resolveExactlyOne(items, "2025-06-01", gap, overlap).id).toBe("a");
  });

  it("0 vigentes → gap fail-closed", () => {
    const items = [{ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01" }];
    try { resolveExactlyOne(items, "2028-01-01", gap, overlap); throw new Error("não lançou"); }
    catch (e) { expect(e).toBeInstanceOf(LegalReferenceError); expect((e as LegalReferenceError).code).toBe(gap); }
  });

  it("≥2 vigentes → overlap fail-closed (nunca 'mais próximo')", () => {
    const items = [
      { id: "a", effectiveFrom: "2026-01-01", effectiveTo: null },
      { id: "b", effectiveFrom: "2026-01-01", effectiveTo: null },
    ];
    try { resolveExactlyOne(items, "2026-06-01", gap, overlap); throw new Error("não lançou"); }
    catch (e) { expect((e as LegalReferenceError).code).toBe(overlap); }
  });
});

describe("A3-RD1 — cobertura (unsupported vs supported)", () => {
  it("distingue dentro/fora da cobertura declarada", () => {
    const cov = { supportedLocators: ["lei-14.133-2021/art-75/inc-I"], temporal: { effectiveFrom: "2026-01-01", effectiveTo: null } };
    expect(isLocatorSupported(cov, "lei-14.133-2021/art-75/inc-I")).toBe(true);
    expect(isLocatorSupported(cov, "lei-14.133-2021/art-75/inc-III")).toBe(false);
    expect(isLocatorSupported(null, "x")).toBe(false);
  });
});
