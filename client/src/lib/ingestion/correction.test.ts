/**
 * PR B.2.2 — Testes puros da lógica de correção no cliente (original × efetivo × patch).
 */
import { describe, it, expect } from "vitest";
import {
  CORRECTABLE_FIELDS, isCorrectable, originalValue, effectiveValue, isCorrected, buildCorrectionPatch,
} from "./correction";
import type { StagingItem } from "./staging";

const item = (over: Partial<StagingItem> = {}): StagingItem => ({
  id: 1, rawDescription: "orig", rawQuantity: "10", rawUnit: "UN", rawUnitPrice: "5", rawTotalPrice: "50",
  sourceLocation: null, confidenceMetadata: null, extractionWarnings: null,
  reviewStatus: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null,
  correctionRevision: 0, correctedPayload: null,
  ...over,
});

describe("isCorrectable", () => {
  it("price_research é corrigível; generic não", () => {
    expect(isCorrectable("price_research")).toBe(true);
    expect(isCorrectable("generic")).toBe(false);
    expect(isCorrectable(undefined)).toBe(false);
  });
});

describe("original × efetivo", () => {
  const fields = CORRECTABLE_FIELDS.price_research;
  const unitPrice = fields.find(f => f.logical === "unitPrice")!;
  const desc = fields.find(f => f.logical === "description")!;

  it("sem overlay: efetivo = original (raw)", () => {
    const it = item();
    expect(originalValue(it, unitPrice)).toBe("5");
    expect(effectiveValue(it, unitPrice)).toBe("5");
    expect(isCorrected(it)).toBe(false);
  });
  it("com overlay: efetivo = overlay, original preservado", () => {
    const it = item({ correctionRevision: 1, correctedPayload: { unitPrice: "7", description: "novo" } });
    expect(originalValue(it, unitPrice)).toBe("5");     // raw preservado
    expect(effectiveValue(it, unitPrice)).toBe("7");    // overlay vence
    expect(effectiveValue(it, desc)).toBe("novo");
    expect(isCorrected(it)).toBe(true);
  });
});

describe("buildCorrectionPatch", () => {
  const fields = CORRECTABLE_FIELDS.price_research;
  it("só inclui campos alterados vs. o efetivo atual", () => {
    const it = item({ correctedPayload: { unitPrice: "7" } });
    // efetivo: description=orig, quantity=10, unit=UN, unitPrice=7, totalPrice=50
    const patch = buildCorrectionPatch(it, fields, {
      description: "orig", quantity: "10", unit: "UN", unitPrice: "9", totalPrice: "50",
    });
    expect(patch).toEqual({ unitPrice: "9" });
  });
  it("patch vazio quando nada muda", () => {
    const it = item();
    const patch = buildCorrectionPatch(it, fields, {
      description: "orig", quantity: "10", unit: "UN", unitPrice: "5", totalPrice: "50",
    });
    expect(Object.keys(patch)).toHaveLength(0);
  });
});
