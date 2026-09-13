/**
 * A3 — CATMAT/CATSER migrado para o Cognitive Kernel.
 *
 * Prova que `findCatmatMatches`:
 *   - roteia pelo Kernel (`executeCognitiveTask`) — nunca invokeLLM/SDK;
 *   - solicita a task CATMAT_MATCHING com tenant (organizationId) + correlation + responseSchema;
 *   - é multi-tenant (o tenantId enviado ao Kernel é o da organização do pedido);
 *   - é fail-closed (resposta inválida → erro, sem fabricar código/descrição).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../aiExecutionEngine", () => ({ executeCognitiveTask }));

import { findCatmatMatches } from "../catmatMatcher";

function cognitiveExecutionWith(content: string) {
  return { response: { content } };
}

const VALID = JSON.stringify({
  matches: [
    { code: "123456", description: "CANETA ESFEROGRAFICA AZUL", confidence: 85, reasoning: "match exato" },
    { code: "234567", description: "CANETA AZUL PONTA MEDIA", confidence: 70, reasoning: "similar" },
    { code: "345678", description: "CANETA ESCRITA AZUL", confidence: 55, reasoning: "categoria" },
    { code: "456789", description: "EXTRA (deve ser cortada)", confidence: 40, reasoning: "quarta" },
  ],
});

beforeEach(() => {
  executeCognitiveTask.mockReset();
});

describe("A3 — findCatmatMatches via Cognitive Kernel", () => {
  it("roteia pelo Kernel com a task CATMAT_MATCHING, tenant e responseSchema", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(VALID));

    await findCatmatMatches({
      itemDescription: "Caneta esferográfica azul ponta média",
      itemType: "material",
      organizationId: 990990,
      correlationId: "corr-abc",
      userId: 42,
    });

    expect(executeCognitiveTask).toHaveBeenCalledTimes(1);
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("CATMAT_MATCHING");
    expect(arg.tenantId).toBe(990990); // multi-tenant: tenant do pedido
    expect(arg.userId).toBe("42");
    expect(arg.correlationId).toBe("corr-abc");
    expect(arg.businessDomain).toBe("processo_licitatorio");
    expect(arg.responseSchema?.name).toBe("catmat_matches");
    expect(typeof arg.query).toBe("string");
  });

  it("retorna no máximo 3 sugestões (ordem preservada)", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(VALID));
    const matches = await findCatmatMatches({
      itemDescription: "x", organizationId: 1, correlationId: "c", userId: 1,
    });
    expect(matches).toHaveLength(3);
    expect(matches[0].code).toBe("123456");
  });

  it("resultado é ASSISTIVO: todo candidato exige validação humana e NÃO carrega grounding/evidência", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(VALID));
    const matches = await findCatmatMatches({
      itemDescription: "x", organizationId: 1, correlationId: "c", userId: 1,
    });
    for (const m of matches) {
      // Aprovação-aware: marca invariável de que é candidato a validar.
      expect(m.requiresHumanValidation).toBe(true);
      // Nenhuma metadata de evidência/grounding é fabricada.
      expect(m).not.toHaveProperty("evidenceFingerprint");
      expect(m).not.toHaveProperty("grounded");
      expect(m).not.toHaveProperty("evidences");
      expect(m).not.toHaveProperty("sourceScope");
    }
  });

  it("prompt não afirma consulta ao catálogo oficial nem 'descrição oficial' — é assistivo", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(VALID));
    await findCatmatMatches({ itemDescription: "caneta", organizationId: 1, correlationId: "c", userId: 1 });
    const query: string = executeCognitiveTask.mock.calls[0][0].query;
    // Não deve prometer códigos verificados / descrição oficial / busca no catálogo oficial.
    expect(query).not.toMatch(/descrição oficial/i);
    expect(query).not.toMatch(/APENAS códigos reais do catálogo/i);
    // Deve enquadrar como candidato/sugestão a validar.
    expect(query).toMatch(/candidat|sugest/i);
    expect(query).toMatch(/validar|valida[çc]/i);
  });

  it("tenants distintos enviam tenantId distinto ao Kernel (isolamento)", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(VALID));
    await findCatmatMatches({ itemDescription: "x", organizationId: 111, correlationId: "c", userId: 1 });
    await findCatmatMatches({ itemDescription: "x", organizationId: 222, correlationId: "c", userId: 1 });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(111);
    expect(executeCognitiveTask.mock.calls[1][0].tenantId).toBe(222);
  });

  it("fail-closed: conteúdo inválido do provider → erro, sem fabricar", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith("não é json"));
    await expect(
      findCatmatMatches({ itemDescription: "x", organizationId: 1, correlationId: "c", userId: 1 })
    ).rejects.toThrow(/CATMAT/i);
  });

  it("fail-closed: matches vazio → erro", async () => {
    executeCognitiveTask.mockResolvedValue(cognitiveExecutionWith(JSON.stringify({ matches: [] })));
    await expect(
      findCatmatMatches({ itemDescription: "x", organizationId: 1, correlationId: "c", userId: 1 })
    ).rejects.toThrow();
  });
});
