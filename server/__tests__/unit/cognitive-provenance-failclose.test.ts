/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 PRE-PILOT CLOSURE — Fase A1 (final) — PROVENANCE OBRIGATÓRIA, FAIL-CLOSED (sem DB real).
 *
 * Prova a semântica do fechamento #1:
 *   - execução NOVA bem-sucedida cuja proveniência OBRIGATÓRIA não persiste em staging/produção →
 *     FAIL-CLOSED (CognitiveProvenancePersistenceError); nunca mascara como sucesso;
 *   - dev: comportamento controlado (não finge persistência; não derruba o pipeline);
 *   - captura da FALHA é best-effort e NUNCA lança (preserva a exceção original da execução).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Ambiente controlável por teste (isDevelopment mutável) + persistência mockada. `vi.hoisted` garante
// que estes objetos existam ANTES das factories de `vi.mock` (que são içadas ao topo do arquivo).
const { appConfig, insertMock } = vi.hoisted(() => ({
  appConfig: { isDevelopment: false, isStaging: true, isProduction: false, appEnv: "staging" },
  insertMock: vi.fn(),
}));
vi.mock("../../config/app", () => ({ APP_CONFIG: appConfig }));
vi.mock("../../db/cognitiveProvenance", () => ({
  insertCognitiveProvenance: (...a: unknown[]) => insertMock(...a),
  getOriginalProvenanceByIdempotencyKey: vi.fn(async () => null),
}));

import { createExecutionContext, type AIExecutionContext } from "../../domain/aiExecutionContext";
import type { CognitiveResponse } from "../../domain/cognitiveResponse";
import {
  captureCognitiveProvenance, captureCognitiveFailure, CognitiveProvenancePersistenceError,
} from "../../services/cognitive/cognitiveProvenanceService";

function ctx(): AIExecutionContext {
  return createExecutionContext({
    request: { tenantId: 5, userId: "u", task: "GENERATE_DOCUMENT" as any, prompt: "P", correlationId: "corr" },
    grounding: { groundingApplied: false, ragApplied: false, knowledgeGraphApplied: false, documentsUsed: [], lawsUsed: [], knowledgeGraphNodes: [], copilot: "agente_contratacao" as any },
    outcome: { provider: "gemini", model: "m", latencyMs: 1, tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, confidence: 0.7, reasoning: "r", finishReason: "stop" },
  });
}
const resp = { content: "ok", contractVersion: "rc-4.0.1" } as unknown as CognitiveResponse;
const successArgs = () => ({ context: ctx(), response: resp, query: "q", documentRefs: [], lawRefs: [], usesGrounding: false, usesRAG: false, finishReason: "stop" });

describe("A1 (final) — proveniência obrigatória / fail-closed", () => {
  beforeEach(() => {
    insertMock.mockReset();
    appConfig.isDevelopment = false; // default: staging/prod
  });

  it("staging/prod + persistência LANÇA → FAIL-CLOSED (CognitiveProvenancePersistenceError), não mascara sucesso", async () => {
    insertMock.mockRejectedValueOnce(new Error("db down: mysql://root:pw@h/db"));
    await expect(captureCognitiveProvenance(successArgs())).rejects.toBeInstanceOf(CognitiveProvenancePersistenceError);
  });

  it("staging/prod + persistência retorna NULL (sem DB) → FAIL-CLOSED", async () => {
    insertMock.mockResolvedValueOnce(null);
    await expect(captureCognitiveProvenance(successArgs())).rejects.toBeInstanceOf(CognitiveProvenancePersistenceError);
  });

  it("a mensagem do erro é SANITIZADA (sem URL de conexão/segredo)", async () => {
    insertMock.mockRejectedValueOnce(new Error("connect mysql://root:senha@db:3306/x failed"));
    await captureCognitiveProvenance(successArgs()).then(
      () => { throw new Error("deveria ter lançado"); },
      (e: Error) => {
        expect(e).toBeInstanceOf(CognitiveProvenancePersistenceError);
        expect(e.message).not.toContain("mysql://");
        expect(e.message).not.toContain("senha");
      },
    );
  });

  it("dev + persistência LANÇA → NÃO fail-closed (comportamento controlado, retorna null)", async () => {
    appConfig.isDevelopment = true;
    insertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(captureCognitiveProvenance(successArgs())).resolves.toBeNull();
  });

  it("sucesso → retorna o envelope (persistido)", async () => {
    insertMock.mockResolvedValueOnce("prov-id");
    const env = await captureCognitiveProvenance(successArgs());
    expect(env).not.toBeNull();
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("captura da FALHA é BEST-EFFORT: NUNCA lança mesmo com persistência quebrada (preserva a exceção original)", async () => {
    appConfig.isDevelopment = false;
    insertMock.mockRejectedValueOnce(new Error("db down: secret token=ABCDEFGHIJKLMNOPQRSTUVWX"));
    await expect(captureCognitiveFailure({
      organizationId: 5, executionId: "e", correlationId: "c", task: "LEGAL_ANALYSIS",
      provider: "gemini", model: "m", replayHash: "rh", usesGrounding: true, usesRAG: false,
      semanticInput: { tenantId: 5, task: "LEGAL_ANALYSIS", query: "q" },
      error: new Error("provider timeout"),
    })).resolves.toBeNull(); // não lança
  });
});
