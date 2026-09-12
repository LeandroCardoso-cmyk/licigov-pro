/**
 * A3-RD1 — `suggestLegalArticle` (Contratação Direta) sobre o REFERENCE SET GOVERNADO.
 *
 * Prova: roteia pelo Kernel (DIRECT_PROCUREMENT_REASONING), validação Zod ESTRITA da resposta,
 * casamento SEMÂNTICO contra o catálogo GOVERNADO (formatação não é identidade), AUTORIDADE do
 * registro governado (legalReferenceEntryId/type/display/valor), fail-closed em type divergente /
 * fora do set, e tenant/correlation/actor preservados. Mocka executeCognitiveTask (sem rede) e
 * db.getGovernedCatalog (catálogo governado controlado).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  content: "",
  lastInput: null as unknown as { task: string; tenantId: number; correlationId: string; userId: string },
  catalog: null as unknown as {
    referenceSetVersion: number; setId: number;
    items: Array<{ canonicalLocator: string; canonicalDisplay: string; procurementType: "dispensa" | "inexigibilidade"; hypothesisSummary: string; valueCents: number | null; legalReferenceEntryId: number }>;
  },
}));

vi.mock("../../services/aiExecutionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/aiExecutionEngine")>();
  return {
    ...actual,
    executeCognitiveTask: (async (input: unknown) => {
      h.lastInput = input as typeof h.lastInput;
      return { response: { content: h.content } };
    }) as unknown as typeof actual.executeCognitiveTask,
  };
});

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getGovernedCatalog: (async () => h.catalog) as unknown as typeof actual.getGovernedCatalog };
});

import { suggestLegalArticle } from "../../services/legalFrameworkAssistant";

const META = { organizationId: 990990, correlationId: "corr-direct-a3", userId: 7 };
const PARAMS = {
  situation: "Aquisição pontual de material de expediente de baixo valor.",
  object: "Material de expediente",
  estimatedValue: 1500000,
  urgency: "normal",
  hasExclusiveSupplier: false,
  asOfDate: "2026-06-01",
};

function aiResponse(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    articleNumber: "Art. 75 I", // formatação diferente do catálogo ("Art. 75, I") de propósito
    articleType: "dispensa",
    confidence: 80,
    reasoning: "Compra de baixo valor.",
    warnings: ["Observar limite de valor."],
    requiredDocuments: ["Justificativa de preço"],
    ...over,
  });
}

beforeEach(() => {
  h.catalog = {
    referenceSetVersion: 1,
    setId: 5,
    items: [
      { canonicalLocator: "lei-14.133-2021/art-75/inc-I", canonicalDisplay: "Art. 75, I", procurementType: "dispensa", hypothesisSummary: "Baixo valor.", valueCents: 13098420, legalReferenceEntryId: 10 },
      { canonicalLocator: "lei-14.133-2021/art-74/inc-II", canonicalDisplay: "Art. 74, II", procurementType: "inexigibilidade", hypothesisSummary: "Exclusividade.", valueCents: null, legalReferenceEntryId: 12 },
    ],
  };
});

describe("A3-RD1 — suggestLegalArticle (Kernel + Zod + catálogo GOVERNADO)", () => {
  it("I/J. roteia por DIRECT_PROCUREMENT_REASONING preservando tenant/correlation/actor", async () => {
    h.content = aiResponse();
    await suggestLegalArticle(PARAMS, META);
    expect(h.lastInput.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(h.lastInput.tenantId).toBe(990990);
    expect(h.lastInput.correlationId).toBe("corr-direct-a3");
    expect(h.lastInput.userId).toBe("7");
  });

  it("H. casa por semântica e retorna identidade/type/display/valor do REGISTRO GOVERNADO (não da IA)", async () => {
    h.content = aiResponse({ articleNumber: "art 75, i" }); // ainda equivalente a Art. 75, I
    const r = await suggestLegalArticle(PARAMS, META);
    expect(r.legalReferenceEntryId).toBe(10); // identidade vem do set governado
    expect(r.canonicalLocator).toBe("lei-14.133-2021/art-75/inc-I");
    expect(r.referenceSetVersion).toBe(1);
    expect(r.articleType).toBe("dispensa"); // type do registro governado
    expect(r.articleNumber).toBe("Art. 75, I"); // display canônico governado
    expect(r.resolvedValueCents).toBe(13098420); // valor resolvido do value override governado
    expect(r.confidence).toBe(80);
  });

  it("G. articleType divergente do registro governado → fail-closed", async () => {
    h.content = aiResponse({ articleType: "inexigibilidade" }); // Art. 75, I governado é dispensa
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/divergente/i);
  });

  it("fora do set (Art. 75, II ausente do reference set) → fail-closed, sem fabricar", async () => {
    h.content = aiResponse({ articleNumber: "Art. 75, II" });
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/fora do reference set/i);
  });

  it("F. Zod estrito rejeita respostas fora do contrato", async () => {
    h.content = JSON.stringify({ articleNumber: "Art. 75, I", articleType: "dispensa", confidence: 80, warnings: [], requiredDocuments: [] }); // falta reasoning
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/inválida/i);

    h.content = aiResponse({ confidence: 150 }); // fora de 0–100
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/inválida/i);

    h.content = aiResponse({ articleType: "outra_coisa" }); // enum inválido
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/inválida/i);

    h.content = aiResponse({ extraneo: true }); // campo extra (strict)
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/inválida/i);
  });
});
