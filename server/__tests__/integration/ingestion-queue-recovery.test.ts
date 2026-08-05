/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.2.1 — Recuperação replay-safe da fila de ingestão + dedup de enqueue.
 * Cobre: skip por feature flag (fail-closed por tenant), retry esgotado → DLQ/falha terminal,
 * claim atômico (impede execução concorrente duplicada), e dedup in-flight do enqueue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/fileIngestionService", () => ({
  listStuckImportSessions: vi.fn().mockResolvedValue([]),
  claimSessionForRecovery: vi.fn().mockResolvedValue(true),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
  getImportSession: vi.fn().mockResolvedValue(null),
}));

// Worker inerte (a fila drena de forma assíncrona; nada de S3/parse real).
vi.mock("../../storage", () => ({
  storageGetBytes: vi.fn().mockResolvedValue(Buffer.from("x")),
}));
vi.mock("../../services/importStagingService", () => ({
  persistStagingItems: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../parsers/parserRegistry", () => ({
  parserRegistry: { resolve: () => ({ safeParse: async () => ({ items: [], warnings: [], errors: [], summary: {} }) }) },
}));

import {
  recoverStuckImportSessions,
  enqueueImport,
  MAX_RETRIES,
} from "../../services/importQueueService";
import * as flags from "../../services/featureFlagService";
import * as ingestion from "../../services/fileIngestionService";

function stuck(over: Record<string, unknown> = {}) {
  return {
    id: 10, organizationId: 1, sourceFileId: "imports/1/f.xlsx",
    correlationId: "corr-123", retryCount: 0, status: "queued", stage: "queued",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flags.isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(ingestion.claimSessionForRecovery).mockResolvedValue(true);
  // Sessão válida por padrão: jobs reenfileirados drenam rápido no worker inerte (sem retries/sleeps).
  vi.mocked(ingestion.getImportSession).mockResolvedValue({
    id: 10, organizationId: 1, sourceFileId: "imports/1/f.xlsx", sourceFileName: "f.xlsx",
    sourceMimeType: "text/csv", parserType: "csv", checksum: null,
  } as any);
});

describe("recoverStuckImportSessions", () => {
  it("pula (skip) quando a feature flag está desabilitada para o tenant", async () => {
    vi.mocked(ingestion.listStuckImportSessions).mockResolvedValue([stuck()] as any);
    vi.mocked(flags.isFeatureEnabled).mockResolvedValue(false);
    const r = await recoverStuckImportSessions();
    expect(r.skipped).toBe(1);
    expect(r.recovered).toBe(0);
    expect(ingestion.claimSessionForRecovery).not.toHaveBeenCalled();
  });

  it("retry esgotado → falha terminal + DLQ (não reprocessa em loop)", async () => {
    vi.mocked(ingestion.listStuckImportSessions).mockResolvedValue([stuck({ retryCount: MAX_RETRIES })] as any);
    const r = await recoverStuckImportSessions();
    expect(r.dlq).toBe(1);
    expect(r.recovered).toBe(0);
    expect(ingestion.updateSessionStatus).toHaveBeenCalledWith(10, 1, "failed", expect.any(Object));
    expect(ingestion.claimSessionForRecovery).not.toHaveBeenCalled();
  });

  it("claim perdido (outro recuperador ganhou) → skip, sem execução duplicada", async () => {
    vi.mocked(ingestion.listStuckImportSessions).mockResolvedValue([stuck()] as any);
    vi.mocked(ingestion.claimSessionForRecovery).mockResolvedValue(false);
    const r = await recoverStuckImportSessions();
    expect(r.skipped).toBe(1);
    expect(r.recovered).toBe(0);
  });

  it("claim ganho → recupera (reenfileira) preservando o vínculo", async () => {
    vi.mocked(ingestion.listStuckImportSessions).mockResolvedValue([stuck()] as any);
    const r = await recoverStuckImportSessions();
    expect(r.recovered).toBe(1);
    expect(ingestion.claimSessionForRecovery).toHaveBeenCalledWith(10, 1);
    // deixa a fila drenar (worker inerte) para não vazar entre testes
    await new Promise(res => setImmediate(res));
  });
});

describe("enqueueImport — dedup in-flight (job sem Buffer)", () => {
  it("não enfileira a mesma sessão duas vezes concorrentemente", () => {
    const first = enqueueImport(9999, 1, "imports/1/dedup.xlsx", { correlationId: "c" });
    const second = enqueueImport(9999, 1, "imports/1/dedup.xlsx");
    expect(typeof first).toBe("string");
    expect(second).toBeNull();
  });
});
