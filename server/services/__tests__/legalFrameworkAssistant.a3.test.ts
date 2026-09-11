/**
 * A3 — Enquadramento legal (contratação direta) migrado para o Cognitive Kernel.
 *
 * Prova que `suggestLegalArticle` e `generateJustification`:
 *   - roteiam pelo Kernel (`executeCognitiveTask`) — nunca invokeLLM;
 *   - solicitam DIRECT_PROCUREMENT_REASONING no domínio contratacao_direta, com tenant;
 *   - `suggestLegalArticle` declara responseSchema e casa o artigo com o banco;
 *   - `generateJustification` produz texto e mantém a validação de citações (fail-closed);
 *   - são multi-tenant (tenantId = organização do pedido).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../aiExecutionEngine", () => ({ executeCognitiveTask }));

const { getLegalArticles, getLegalArticleById } = vi.hoisted(() => ({
  getLegalArticles: vi.fn(),
  getLegalArticleById: vi.fn(),
}));
vi.mock("../../db", () => ({ getLegalArticles, getLegalArticleById }));

import { suggestLegalArticle, generateJustification, type LegalFrameworkMeta } from "../legalFrameworkAssistant";

const META: LegalFrameworkMeta = { organizationId: 8080, correlationId: "corr-direct", userId: 3 };

const ARTICLE = {
  id: 42, article: "Art. 75", inciso: "I", summary: "Dispensa por valor",
  description: "Dispensa de licitação por baixo valor", valueLimit: "R$ 50.000", examples: "Material de expediente",
};

function executionWith(content: string) {
  return { response: { content } };
}

beforeEach(() => {
  executeCognitiveTask.mockReset();
  getLegalArticles.mockReset();
  getLegalArticleById.mockReset();
  getLegalArticles.mockResolvedValue([ARTICLE]);
  getLegalArticleById.mockResolvedValue(ARTICLE);
});

describe("A3 — suggestLegalArticle via Cognitive Kernel", () => {
  it("roteia DIRECT_PROCUREMENT_REASONING / contratacao_direta, tenant + responseSchema", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(JSON.stringify({
      articleNumber: "Art. 75 I", articleType: "dispensa", confidence: 90,
      reasoning: "baixo valor", warnings: [], requiredDocuments: [],
    })));
    const res = await suggestLegalArticle(
      { situation: "Compra pequena de material de expediente", object: "Canetas", estimatedValue: 100000 },
      META,
    );
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("contratacao_direta");
    expect(arg.tenantId).toBe(8080);
    expect(arg.userId).toBe("3");
    expect(arg.correlationId).toBe("corr-direct");
    expect(arg.responseSchema?.name).toBe("legal_article_suggestion");
    // Casa o artigo sugerido com o registro do banco (multi-tenant seguro).
    expect(res.articleId).toBe(42);
    expect(res.articleNumber).toBe("Art. 75 I");
  });

  it("fail-closed: artigo sugerido inexistente no banco → erro", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(JSON.stringify({
      articleNumber: "Art. 999", articleType: "dispensa", confidence: 50,
      reasoning: "x", warnings: [], requiredDocuments: [],
    })));
    await expect(
      suggestLegalArticle({ situation: "x".repeat(20), object: "y".repeat(10), estimatedValue: 1000 }, META)
    ).rejects.toThrow();
  });
});

describe("A3 — generateJustification via Cognitive Kernel", () => {
  it("roteia DIRECT_PROCUREMENT_REASONING / contratacao_direta como texto, tenant", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(
      "## Justificativa\n\nContratação direta fundamentada no Art. 75 da Lei 14.133/2021."
    ));
    const out = await generateJustification(
      { articleId: 42, object: "Canetas", situation: "Compra pequena", estimatedValue: 100000 },
      META,
    );
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("contratacao_direta");
    expect(arg.tenantId).toBe(8080);
    expect(arg.responseType).toBe("text");
    expect(out).toContain("Art. 75");
  });

  it("fail-closed: justificativa com artigo inexistente é rejeitada", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(
      "Fundamentado no Art. 999 da Lei 14.133/2021." // 194 artigos apenas
    ));
    await expect(
      generateJustification({ articleId: 42, object: "o", situation: "s", estimatedValue: 1000 }, META)
    ).rejects.toThrow();
  });

  it("multi-tenant: tenantId do pedido flui ao Kernel", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith("Válido nos termos do Art. 74."));
    await generateJustification({ articleId: 42, object: "o", situation: "s", estimatedValue: 1 }, { organizationId: 555, correlationId: "c", userId: 1 });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(555);
  });
});
