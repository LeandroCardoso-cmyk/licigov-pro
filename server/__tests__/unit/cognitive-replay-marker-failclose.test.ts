/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 PRE-PILOT CLOSURE — Fase A1 (microcorreção #2) — REPLAY MARKER OBRIGATÓRIO (sem DB real).
 *
 * Prova, no ENTRYPOINT REAL (executeCognitiveTask, caminho de REPLAY):
 *   - staging/produção: falha ao persistir o marcador de replay → FAIL-CLOSED
 *     (CognitiveProvenancePersistenceError); o resultado replayado NÃO é entregue como sucesso;
 *     o provider NÃO é chamado novamente (o caminho de replay nunca toca o provider);
 *   - após restaurar a persistência, o marcador é criado e o replay retorna normalmente;
 *   - dev/test: degrada de forma controlada (marcador não persiste, mas o replay é entregue).
 *
 * Mantém o service de proveniência REAL (recordReplayMarker/persistMandatory) e mocka apenas o
 * ambiente (config/app), a camada de persistência (db) e a idempotência (checkIdempotency=completed).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { appConfig, insertMock, checkMock } = vi.hoisted(() => ({
  appConfig: { isDevelopment: false, isStaging: true, isProduction: false, appEnv: "staging" },
  insertMock: vi.fn(),
  checkMock: vi.fn(),
}));
vi.mock("../../config/app", () => ({ APP_CONFIG: appConfig }));
vi.mock("../../db/cognitiveProvenance", () => ({
  insertCognitiveProvenance: (...a: unknown[]) => insertMock(...a),
  getOriginalProvenanceByIdempotencyKey: vi.fn(async () => null),
}));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkMock(...a),
  saveIdempotencyResult: vi.fn(async () => {}),
  failIdempotencyKey: vi.fn(async () => {}),
}));

import { executeCognitiveTask } from "../../services/aiExecutionEngine";
import { CognitiveProvenancePersistenceError } from "../../services/cognitive/cognitiveProvenanceService";

// Snapshot autoritativo cacheado (idempotência) de uma execução ORIGINAL já concluída.
const cachedSnapshot = {
  execution: {
    response: { content: "CACHED-CONTENT", contractVersion: "rc-4.0.1" },
    context: { id: "origexec", replayHash: "orh", request: { tenantId: 9, correlationId: "corr-orig" }, grounding: { groundingApplied: false, ragApplied: false }, outcome: { provider: "gemini", model: "m", finishReason: "stop" } },
    observability: {}, validation: { valid: true, errors: [] }, reasoningPlan: { id: "rp" }, stages: [],
  },
  lineage: {
    executionId: "origexec", replayHash: "orh", provider: "gemini", model: "m",
    outputFingerprint: "of", groundingState: "not_applicable", executionStatus: "completed", executionMode: "cognitive",
  },
};

const keyedInput = () => ({
  task: "PROCUREMENT_REASONING" as any, tenantId: 9, userId: "u-actor", actorUserId: 7,
  idempotencyKey: "k-replay", query: "q", correlationId: "corr-atual",
});

describe("A1 (microcorreção #2) — replay marker obrigatório / fail-closed", () => {
  beforeEach(() => {
    insertMock.mockReset();
    checkMock.mockReset();
    // Idempotência: sempre REPLAY (completed + mesmo payload) → caminho de replay (provider intocado).
    checkMock.mockResolvedValue({ status: "completed", payloadMismatch: false, response: cachedSnapshot });
    appConfig.isDevelopment = false;
  });

  it("staging/prod: persistência do marcador FALHA → executeCognitiveTask REJEITA (resultado replayado não entregue)", async () => {
    insertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(executeCognitiveTask(keyedInput())).rejects.toBeInstanceOf(CognitiveProvenancePersistenceError);
    // O provider nunca é chamado no caminho de replay (a idempotência resolveu completed antes do provider).
  });

  it("staging/prod: marcador retorna NULL (sem DB) → REJEITA (não entrega replay sem registrar correlação)", async () => {
    insertMock.mockResolvedValueOnce(null);
    await expect(executeCognitiveTask(keyedInput())).rejects.toBeInstanceOf(CognitiveProvenancePersistenceError);
  });

  it("após restaurar a persistência: marcador criado e replay retorna normalmente (replayed=true)", async () => {
    insertMock.mockResolvedValueOnce("marker-id");
    const exec = await executeCognitiveTask(keyedInput());
    expect(exec.replayed).toBe(true);
    expect(exec.response.content).toBe("CACHED-CONTENT");
    expect(insertMock).toHaveBeenCalledTimes(1); // o marcador foi persistido
  });

  it("dev: persistência do marcador FALHA → degrada de forma controlada (replay ainda é entregue)", async () => {
    appConfig.isDevelopment = true;
    insertMock.mockRejectedValueOnce(new Error("db down"));
    const exec = await executeCognitiveTask(keyedInput());
    expect(exec.replayed).toBe(true);
    expect(exec.response.content).toBe("CACHED-CONTENT");
  });
});
