/**
 * A3 — Sugestões contextuais migradas para o Cognitive Kernel.
 *
 * Prova que as funções de `services/ai/suggestions.ts`:
 *   - roteiam pelo Kernel (`executeCognitiveTask`) — nunca instanciam o SDK Gemini;
 *   - solicitam a Cognitive Task correta, com o Business Domain autorizado;
 *   - propagam tenant (organizationId), correlation e ator (multi-tenant);
 *   - pedem resposta textual (responseType "text", sem responseSchema);
 *   - são fail-closed (conteúdo vazio → erro, sem devolver sugestão fabricada).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../../aiExecutionEngine", () => ({ executeCognitiveTask }));
// RAG determinístico (não toca banco/embeddings nesta prova de fronteira).
vi.mock("../../rag", () => ({
  retrieveRelevantLaw: vi.fn().mockResolvedValue([]),
  formatRetrievedContext: vi.fn().mockReturnValue("[LEI] contexto legal recuperado"),
}));

import {
  suggestModality, suggestRisks, suggestClauses,
  suggestTechnicalRequirements, suggestLegalBasis, improveText,
  type SuggestionMeta,
} from "../suggestions";
import type { ProcessContext } from "../promptBuilder";

const CTX: ProcessContext = {
  name: "Aquisição de material de expediente",
  object: "Canetas, papéis e afins",
  estimatedValue: 5000000,
  modality: null,
  category: null,
  dfdContent: null, etpContent: "ETP...", trContent: null, editalContent: null, contratoContent: "Contrato...",
};
const META: SuggestionMeta = { organizationId: 700, correlationId: "corr-xyz", userId: 9 };

function executionWith(content: string) {
  return { response: { content } };
}

beforeEach(() => {
  executeCognitiveTask.mockReset();
  executeCognitiveTask.mockResolvedValue(executionWith("## Sugestão\n\nConteúdo markdown supervisionado."));
});

describe("A3 — suggestions via Cognitive Kernel", () => {
  it("suggestModality → PROCUREMENT_REASONING (processo_licitatorio), texto, tenant+correlation", async () => {
    await suggestModality(CTX, META);
    expect(executeCognitiveTask).toHaveBeenCalledTimes(1);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("processo_licitatorio");
    expect(arg.tenantId).toBe(700);
    expect(arg.userId).toBe("9");
    expect(arg.correlationId).toBe("corr-xyz");
    expect(arg.responseType).toBe("text");
    expect(arg.responseSchema).toBeUndefined(); // texto: sem structured output
    expect(typeof arg.query).toBe("string");
    expect(typeof arg.groundingBlock).toBe("string"); // contexto legal via groundingBlock
  });

  it("suggestRisks → RISK_ANALYSIS (processo_licitatorio)", async () => {
    await suggestRisks(CTX, META);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("RISK_ANALYSIS");
    expect(arg.businessDomain).toBe("processo_licitatorio");
  });

  it("suggestClauses → CONTRACT_REASONING (contratos)", async () => {
    await suggestClauses(CTX, "penalidades", META);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("CONTRACT_REASONING");
    expect(arg.businessDomain).toBe("contratos");
    expect(arg.query).toContain("penalidades");
  });

  it("suggestTechnicalRequirements → PROCUREMENT_REASONING (processo_licitatorio)", async () => {
    await suggestTechnicalRequirements(CTX, META);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("PROCUREMENT_REASONING");
    expect(arg.businessDomain).toBe("processo_licitatorio");
  });

  it("suggestLegalBasis → LEGAL_REASONING (parecer_juridico)", async () => {
    await suggestLegalBasis(CTX, "Cabe dispensa?", META);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("LEGAL_REASONING");
    expect(arg.businessDomain).toBe("parecer_juridico");
    expect(arg.query).toContain("Cabe dispensa?");
  });

  it("improveText → DOCUMENT_IMPROVEMENT (processo_licitatorio)", async () => {
    await improveText(CTX, "tr", "Texto a melhorar aqui", META);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("DOCUMENT_IMPROVEMENT");
    expect(arg.businessDomain).toBe("processo_licitatorio");
    expect(arg.query).toContain("Texto a melhorar aqui");
  });

  it("multi-tenant: tenants distintos enviam tenantId distinto ao Kernel", async () => {
    await suggestModality(CTX, { organizationId: 111, correlationId: "c", userId: 1 });
    await suggestModality(CTX, { organizationId: 222, correlationId: "c", userId: 1 });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(111);
    expect(executeCognitiveTask.mock.calls[1][0].tenantId).toBe(222);
  });

  it("fail-closed: conteúdo vazio do Kernel → erro (sem sugestão fabricada)", async () => {
    executeCognitiveTask.mockResolvedValue(executionWith("   "));
    await expect(suggestModality(CTX, META)).rejects.toThrow();
  });
});
