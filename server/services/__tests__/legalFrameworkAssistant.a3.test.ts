/**
 * A3-RD1 — Enquadramento legal (contratação direta) sobre o REFERENCE SET GOVERNADO.
 *
 * Prova que:
 *   - `suggestLegalArticle` consome o catálogo GOVERNADO (`getGovernedCatalog`), roteia pelo Kernel
 *     (`executeCognitiveTask`) e retorna a IDENTIDADE governada (legalReferenceEntryId/canonicalLocator/
 *     referenceSetVersion) — nunca o `articleId` legado; fail-closed contra artigo fora do set;
 *   - `generateJustification` resolve autoridade em DOIS DOMÍNIOS DISJUNTOS: governado (canonicalLocator
 *     via `resolveGovernedReference`) ou legado (articleId via `getLegalArticleById`), sem misturar IDs;
 *     mantém a validação de citações fail-closed;
 *   - `validateGovernedValue` usa o value override governado (nunca limite hardcoded);
 *   - tudo é multi-tenant (tenantId = organização do pedido).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../aiExecutionEngine", () => ({ executeCognitiveTask }));

const { getGovernedCatalog, resolveGovernedReference, getLegalArticleById } = vi.hoisted(() => ({
  getGovernedCatalog: vi.fn(),
  resolveGovernedReference: vi.fn(),
  getLegalArticleById: vi.fn(),
}));
vi.mock("../../db", () => ({ getGovernedCatalog, resolveGovernedReference, getLegalArticleById }));

import {
  suggestLegalArticle, generateJustification, validateGovernedValue, type LegalFrameworkMeta,
} from "../legalFrameworkAssistant";

const META: LegalFrameworkMeta = { organizationId: 8080, correlationId: "corr-direct", userId: 3 };

const GOVERNED_CATALOG = {
  referenceSetVersion: 1,
  setId: 10,
  items: [
    {
      canonicalLocator: "lei-14.133-2021/art-75/inc-I",
      canonicalDisplay: "Art. 75, I",
      procurementType: "dispensa" as const,
      hypothesisSummary: "Dispensa por baixo valor (obras/serviços de engenharia).",
      valueCents: 13098420,
      legalReferenceEntryId: 42,
    },
    {
      canonicalLocator: "lei-14.133-2021/art-74/inc-I",
      canonicalDisplay: "Art. 74, I",
      procurementType: "inexigibilidade" as const,
      hypothesisSummary: "Fornecedor exclusivo com atestado de exclusividade.",
      valueCents: null,
      legalReferenceEntryId: 51,
    },
  ],
};

const LEGACY_ARTICLE = {
  id: 42, type: "dispensa", article: "Art. 75", inciso: "I", summary: "Dispensa por valor",
  description: "Dispensa de licitação por baixo valor", valueLimit: "R$ 50.000", examples: "Material de expediente",
};

function executionWith(content: string) {
  return { response: { content } };
}

beforeEach(() => {
  executeCognitiveTask.mockReset();
  getGovernedCatalog.mockReset();
  resolveGovernedReference.mockReset();
  getLegalArticleById.mockReset();
  getGovernedCatalog.mockResolvedValue(GOVERNED_CATALOG);
  getLegalArticleById.mockResolvedValue(LEGACY_ARTICLE);
});

describe("A3-RD1 — suggestLegalArticle sobre reference set GOVERNADO", () => {
  it("roteia DIRECT_PROCUREMENT_REASONING / contratacao_direta, tenant + responseSchema; retorna identidade governada", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(JSON.stringify({
      articleNumber: "Art. 75, I", articleType: "dispensa", confidence: 90,
      reasoning: "baixo valor", warnings: [], requiredDocuments: ["Pesquisa de preços"],
    })));
    const res = await suggestLegalArticle(
      { situation: "Compra pequena de material de expediente", object: "Canetas", estimatedValue: 100000, asOfDate: "2026-06-01" },
      META,
    );
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("contratacao_direta");
    expect(arg.tenantId).toBe(8080);
    expect(arg.userId).toBe("3");
    expect(arg.correlationId).toBe("corr-direct");
    expect(arg.responseSchema?.name).toBe("legal_article_suggestion");
    // Data de resolução explícita propagada ao catálogo governado (nunca "hoje" implícito).
    expect(getGovernedCatalog).toHaveBeenCalledWith("2026-06-01");
    // Identidade GOVERNADA (nunca articleId legado); autoridade vem do registro governado.
    expect(res.legalReferenceEntryId).toBe(42);
    expect(res.canonicalLocator).toBe("lei-14.133-2021/art-75/inc-I");
    expect(res.referenceSetVersion).toBe(1);
    expect(res.articleType).toBe("dispensa");
    expect(res.articleNumber).toBe("Art. 75, I");
    expect(res.resolvedValueCents).toBe(13098420);
    expect(res.requiresHumanValidation).toBe(true);
    expect(res.suggestedDocuments).toEqual(["Pesquisa de preços"]);
    // Nunca expõe identidade legada.
    expect((res as Record<string, unknown>).articleId).toBeUndefined();
  });

  it("fail-closed: artigo sugerido fora do reference set → erro", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(JSON.stringify({
      articleNumber: "Art. 999", articleType: "dispensa", confidence: 50,
      reasoning: "x", warnings: [], requiredDocuments: [],
    })));
    await expect(
      suggestLegalArticle({ situation: "x".repeat(20), object: "y".repeat(10), estimatedValue: 1000, asOfDate: "2026-06-01" }, META)
    ).rejects.toThrow(/fora do reference set/i);
  });

  it("fail-closed: tipo divergente do registro governado → erro", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(JSON.stringify({
      articleNumber: "Art. 75, I", articleType: "inexigibilidade", confidence: 50,
      reasoning: "x", warnings: [], requiredDocuments: [],
    })));
    await expect(
      suggestLegalArticle({ situation: "x".repeat(20), object: "y".repeat(10), estimatedValue: 1000, asOfDate: "2026-06-01" }, META)
    ).rejects.toThrow(/tipo divergente/i);
  });

  it("fail-closed via readiness: catálogo governado indisponível (set não aprovado) propaga erro", async () => {
    getGovernedCatalog.mockRejectedValue(new Error("LEGAL_REFERENCE_SET_MISSING"));
    await expect(
      suggestLegalArticle({ situation: "x".repeat(20), object: "y".repeat(10), estimatedValue: 1000, asOfDate: "2026-06-01" }, META)
    ).rejects.toThrow();
    expect(executeCognitiveTask).not.toHaveBeenCalled();
  });
});

describe("A3-RD1 — generateJustification (dual-domínio governado/legado)", () => {
  it("GOVERNADO: resolve por canonicalLocator, roteia como texto ao Kernel", async () => {
    resolveGovernedReference.mockResolvedValue({
      referenceSetVersion: 1, setId: 10, valueCents: 13098420,
      entry: {
        canonicalDisplay: "Art. 75, I", canonicalLocator: "lei-14.133-2021/art-75/inc-I",
        hypothesisSummary: "Dispensa por baixo valor.", procurementType: "dispensa",
      },
    });
    executeCognitiveTask.mockResolvedValue(executionWith(
      "## Justificativa\n\nContratação direta fundamentada no Art. 75 da Lei 14.133/2021."
    ));
    const out = await generateJustification(
      { canonicalLocator: "lei-14.133-2021/art-75/inc-I", asOfDate: "2026-06-01", object: "Canetas", situation: "Compra pequena", estimatedValue: 100000 },
      META,
    );
    expect(resolveGovernedReference).toHaveBeenCalledWith("lei-14.133-2021/art-75/inc-I", "2026-06-01");
    expect(getLegalArticleById).not.toHaveBeenCalled(); // domínio legado NUNCA consultado no caminho governado
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("contratacao_direta");
    expect(arg.tenantId).toBe(8080);
    expect(arg.responseType).toBe("text");
    expect(out).toContain("Art. 75");
  });

  it("LEGADO: resolve por articleId via catálogo legado, sem tocar domínio governado", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(
      "Contratação direta fundamentada no Art. 75 da Lei 14.133/2021."
    ));
    const out = await generateJustification(
      { articleId: 42, object: "Canetas", situation: "Compra pequena", estimatedValue: 100000 },
      META,
    );
    expect(getLegalArticleById).toHaveBeenCalledWith(42);
    expect(resolveGovernedReference).not.toHaveBeenCalled(); // governado NUNCA consultado no caminho legado
    expect(out).toContain("Art. 75");
  });

  it("fail-closed: justificativa com artigo inexistente é rejeitada (governado)", async () => {
    resolveGovernedReference.mockResolvedValue({
      referenceSetVersion: 1, setId: 10, valueCents: null,
      entry: { canonicalDisplay: "Art. 74, I", canonicalLocator: "lei-14.133-2021/art-74/inc-I", hypothesisSummary: "Fornecedor exclusivo.", procurementType: "inexigibilidade" },
    });
    executeCognitiveTask.mockResolvedValue(executionWith(
      "Fundamentado no Art. 999 da Lei 14.133/2021." // artigo inexistente
    ));
    await expect(
      generateJustification({ canonicalLocator: "lei-14.133-2021/art-74/inc-I", object: "o", situation: "s", estimatedValue: 1000 }, META)
    ).rejects.toThrow();
  });

  it("multi-tenant: tenantId do pedido flui ao Kernel (legado)", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith("Válido nos termos do Art. 74."));
    await generateJustification({ articleId: 42, object: "o", situation: "s", estimatedValue: 1 }, { organizationId: 555, correlationId: "c", userId: 1 });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(555);
  });
});

describe("A3-RD1 — validateGovernedValue (limite via value override governado)", () => {
  it("dentro do limite vigente → válido", async () => {
    resolveGovernedReference.mockResolvedValue({
      referenceSetVersion: 1, setId: 10, valueCents: 13098420,
      entry: { canonicalDisplay: "Art. 75, I", canonicalLocator: "lei-14.133-2021/art-75/inc-I", hypothesisSummary: "x", procurementType: "dispensa" },
    });
    const r = await validateGovernedValue({ canonicalLocator: "lei-14.133-2021/art-75/inc-I", estimatedValue: 10000000, asOfDate: "2026-06-01" });
    expect(r.isValid).toBe(true);
    expect(r.limitCents).toBe(13098420);
    expect(r.referenceSetVersion).toBe(1);
  });

  it("acima do limite vigente → inválido (limite governado, nunca hardcoded)", async () => {
    resolveGovernedReference.mockResolvedValue({
      referenceSetVersion: 1, setId: 10, valueCents: 13098420,
      entry: { canonicalDisplay: "Art. 75, I", canonicalLocator: "lei-14.133-2021/art-75/inc-I", hypothesisSummary: "x", procurementType: "dispensa" },
    });
    const r = await validateGovernedValue({ canonicalLocator: "lei-14.133-2021/art-75/inc-I", estimatedValue: 20000000, asOfDate: "2026-06-01" });
    expect(r.isValid).toBe(false);
    expect(r.limitCents).toBe(13098420);
  });

  it("sem override governado (valueCents null) → sem restrição de valor", async () => {
    resolveGovernedReference.mockResolvedValue({
      referenceSetVersion: 1, setId: 10, valueCents: null,
      entry: { canonicalDisplay: "Art. 74, I", canonicalLocator: "lei-14.133-2021/art-74/inc-I", hypothesisSummary: "x", procurementType: "inexigibilidade" },
    });
    const r = await validateGovernedValue({ canonicalLocator: "lei-14.133-2021/art-74/inc-I", estimatedValue: 999999999, asOfDate: "2026-06-01" });
    expect(r.isValid).toBe(true);
    expect(r.limitCents).toBeNull();
  });

  it("fail-closed: readiness falha (set ausente) propaga erro", async () => {
    resolveGovernedReference.mockRejectedValue(new Error("LEGAL_REFERENCE_SET_MISSING"));
    await expect(
      validateGovernedValue({ canonicalLocator: "lei-14.133-2021/art-75/inc-I", estimatedValue: 1, asOfDate: "2026-06-01" })
    ).rejects.toThrow();
  });
});
