/**
 * R9 / SEM-080 — autoridade numérica nos textos de ETP/TR: estimativa redigida pelo servidor; valores da IA fora do
 * quadro autoritativo marcados [REVISAR]; ETP canônico com quadro autoritativo.
 */
import { describe, it, expect } from "vitest";
import { authoritativeAmounts, flagUnverifiedAmounts, parseBRLAmount, serverEstimateProse, UNVERIFIED_AMOUNT_MARK } from "../../domain/aiNumericAuthority";
import { generateStructuredAuthoring } from "../../services/authoring/structuredAuthoringService";
import { buildDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { canonicalSectionsFor } from "../../domain/authoring/authoringSchema";

const est = { itemCount: 1, pricedItemCount: 1, unpricedItemCount: 0, globalTotalCents: 100_000, rows: [{ averagePriceCents: 1_000, estimatedTotalCents: 100_000 }], missingPlannedQuantity: 0, hasAuthoritativeBlock: true };

describe("SEM-080 — regra pura", () => {
  it("parse de valores em reais", () => {
    expect(parseBRLAmount("R$ 1.234,56")).toBe(123_456);
    expect(parseBRLAmount("R$1000")).toBe(100_000);
    expect(parseBRLAmount("R$ 10,5")).toBe(1_050);
  });
  it("só valores do quadro passam sem marca; idempotente", () => {
    const allowed = authoritativeAmounts(est);
    const r = flagUnverifiedAmounts("Total de R$ 1.000,00 e unitário R$ 10,00; outro R$ 2.500,00.", allowed);
    expect(r.flagged).toBe(1);
    expect(r.prose).toContain(`R$ 2.500,00 ${UNVERIFIED_AMOUNT_MARK}`);
    expect(r.prose).not.toContain(`R$ 1.000,00 ${UNVERIFIED_AMOUNT_MARK}`);
    expect(flagUnverifiedAmounts(r.prose, allowed)).toEqual({ prose: r.prose, flagged: 0 });
  });
  it("estimativa do servidor: total calculado; sem quantidade prevista ⇒ [REVISAR] sem inferir valor", () => {
    expect(serverEstimateProse(est)).toContain("R$ 1.000,00");
    expect(serverEstimateProse({ ...est, missingPlannedQuantity: 2 })).toMatch(/^\[REVISAR: 2 item\(ns\) sem quantidade prevista/);
    expect(serverEstimateProse({ ...est, itemCount: 0 })).toContain("[REVISAR");
  });
});

describe("SEM-080 — geração ETP/TR", () => {
  const providerJson = (kind: "etp" | "tr") => JSON.stringify({
    sections: canonicalSectionsFor(kind).map((s) => ({
      key: s.key, contentMode: "provided",
      prose: s.key === "estimativa_valor" ? "A IA estima R$ 999.999,00 para tudo." : `Texto de ${s.key}. Custo aproximado R$ 77,00.`,
      legalReferences: [],
    })),
  });
  for (const kind of ["etp", "tr"] as const) {
    it(`${kind.toUpperCase()}: a prosa da IA para a estimativa é descartada; R$ fora do quadro marcado`, async () => {
      const ctx = buildDocumentAuthoringContext({
        organizationId: 7, processId: "p1", kind, object: "Limpeza", processObject: "Limpeza", processNumber: "1",
        dfd: null, etp: null, approvedItems: [], pendingItemCount: 0,
      });
      const r = await generateStructuredAuthoring({ organizationId: 7, kind, object: "Limpeza", correlationId: "c80", sourceContext: ctx, invoke: async () => providerJson(kind) });
      expect(r.content).not.toContain("R$ 999.999,00");
      expect(r.content).toContain(`R$ 77,00 ${UNVERIFIED_AMOUNT_MARK}`);
      const est = r.structured.sections.find((s) => s.key === "estimativa_valor")!;
      expect(est.prose).toContain("[REVISAR: nenhum Item aprovado");
    });
  }
});
