/**
 * A3 — Parecer jurídico migrado para o Cognitive Kernel.
 *
 * Prova que `generateLegalOpinion`:
 *   - roteia pelo Kernel (`executeCognitiveTask`) — nunca invokeLLM;
 *   - solicita a task LEGAL_ANALYSIS no domínio parecer_juridico, com tenant + correlation;
 *   - declara o structured output (`responseSchema` legal_opinion);
 *   - preserva a validação de citações legais (fail-closed em artigo inexistente);
 *   - é multi-tenant (tenantId = organização do pedido).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../aiExecutionEngine", () => ({ executeCognitiveTask }));

import { generateLegalOpinion, type LegalOpinionMeta } from "../legalOpinionService";

const META: LegalOpinionMeta = { organizationId: 4242, correlationId: "corr-parecer", userId: 7 };

function executionWith(payload: unknown) {
  return { response: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } };
}

const VALID_OPINION = {
  opinion: "## Conclusão\n\nParecer favorável nos termos do Art. 75 da Lei 14.133/2021.",
  conclusion: "favorable",
  citedArticles: ["Art. 75"],
  jurisprudence: [{ court: "TCU", number: "Acórdão 1/2024", summary: "Resumo" }],
};

beforeEach(() => {
  executeCognitiveTask.mockReset();
  executeCognitiveTask.mockResolvedValue(executionWith(VALID_OPINION));
});

describe("A3 — generateLegalOpinion via Cognitive Kernel", () => {
  it("roteia pelo Kernel: LEGAL_ANALYSIS / parecer_juridico, tenant + correlation + responseSchema", async () => {
    await generateLegalOpinion({
      title: "Parecer X", legalQuestion: "Cabe dispensa?", sourceType: "process", meta: META,
    });
    expect(executeCognitiveTask).toHaveBeenCalledTimes(1);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("LEGAL_ANALYSIS");
    expect(arg.businessDomain).toBe("parecer_juridico");
    expect(arg.tenantId).toBe(4242);
    expect(arg.userId).toBe("7");
    expect(arg.correlationId).toBe("corr-parecer");
    expect(arg.responseSchema?.name).toBe("legal_opinion");
    expect(arg.query).toContain("194 artigos");
  });

  it("retorna o parecer estruturado quando as citações são válidas", async () => {
    const result = await generateLegalOpinion({
      title: "Parecer X", legalQuestion: "Cabe dispensa?", sourceType: "process", meta: META,
    });
    expect(result.conclusion).toBe("favorable");
    expect(result.citedArticles).toContain("Art. 75");
  });

  it("multi-tenant: tenantId do pedido flui ao Kernel", async () => {
    await generateLegalOpinion({ title: "t", legalQuestion: "q", sourceType: "other", meta: { organizationId: 111, correlationId: "c", userId: 1 } });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(111);
  });

  it("fail-closed: parecer com artigo inexistente é rejeitado", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith({
      ...VALID_OPINION,
      opinion: "Fundamentado no Art. 999 da Lei 14.133/2021.", // 194 artigos apenas
      citedArticles: ["Art. 999"],
    }));
    await expect(
      generateLegalOpinion({ title: "t", legalQuestion: "q", sourceType: "other", meta: META })
    ).rejects.toThrow();
  });

  it("fail-closed: conteúdo vazio do Kernel → erro", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith(""));
    await expect(
      generateLegalOpinion({ title: "t", legalQuestion: "q", sourceType: "other", meta: META })
    ).rejects.toThrow();
  });
});
