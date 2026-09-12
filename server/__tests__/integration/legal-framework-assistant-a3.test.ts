/**
 * A3 — `suggestLegalArticle` (Contratação Direta) pós-fix da 2ª LIVE.
 *
 * Prova: roteia pelo Kernel (DIRECT_PROCUREMENT_REASONING), validação Zod ESTRITA da resposta,
 * casamento SEMÂNTICO contra o catálogo (formatação não é identidade), AUTORIDADE do catálogo
 * (id/type/display), fail-closed em type divergente / não-encontrado, e tenant/correlation/actor
 * preservados. Mocka executeCognitiveTask (sem rede) e db.getLegalArticles (catálogo controlado).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  content: "",
  lastInput: null as unknown as { task: string; tenantId: number; correlationId: string; userId: string },
  catalog: [] as Array<{ id: number; type: string; article: string; inciso: string | null }>,
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
  return { ...actual, getLegalArticles: (async () => h.catalog) as unknown as typeof actual.getLegalArticles };
});

import { suggestLegalArticle } from "../../services/legalFrameworkAssistant";

const META = { organizationId: 990990, correlationId: "corr-direct-a3", userId: 7 };
const PARAMS = {
  situation: "Aquisição pontual de material de expediente de baixo valor.",
  object: "Material de expediente",
  estimatedValue: 1500000,
  urgency: "normal",
  hasExclusiveSupplier: false,
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
  h.catalog = [
    { id: 10, type: "dispensa", article: "Art. 75, I", inciso: "I" },
    { id: 12, type: "inexigibilidade", article: "Art. 74, II", inciso: "II" },
  ];
});

describe("A3 — suggestLegalArticle (Kernel + Zod + catálogo)", () => {
  it("I/J. roteia por DIRECT_PROCUREMENT_REASONING preservando tenant/correlation/actor", async () => {
    h.content = aiResponse();
    await suggestLegalArticle(PARAMS, META);
    expect(h.lastInput.task).toBe("DIRECT_PROCUREMENT_REASONING");
    expect(h.lastInput.tenantId).toBe(990990);
    expect(h.lastInput.correlationId).toBe("corr-direct-a3");
    expect(h.lastInput.userId).toBe("7");
  });

  it("H. casa por semântica e retorna id/type/display do CATÁLOGO (não da IA)", async () => {
    h.content = aiResponse({ articleNumber: "art 75, i" }); // ainda equivalente a Art. 75, I
    const r = await suggestLegalArticle(PARAMS, META);
    expect(r.articleId).toBe(10); // id vem do catálogo
    expect(r.articleType).toBe("dispensa"); // type do catálogo
    expect(r.articleNumber).toBe("Art. 75, I"); // display canônico do catálogo
    expect(r.confidence).toBe(80);
  });

  it("G. articleType divergente do catálogo → fail-closed", async () => {
    h.content = aiResponse({ articleType: "inexigibilidade" }); // catálogo Art. 75, I é dispensa
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/divergente/i);
  });

  it("not_found (Art. 75, II ausente do catálogo) → fail-closed, sem fabricar", async () => {
    h.content = aiResponse({ articleNumber: "Art. 75, II" });
    await expect(suggestLegalArticle(PARAMS, META)).rejects.toThrow(/não encontrado no catálogo/i);
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
