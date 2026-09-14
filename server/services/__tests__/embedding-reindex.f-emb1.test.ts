import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "../embeddings";
import {
  runEmbeddingReindex,
  type EmbeddingReindexRepository,
  type EmbeddingReindexRunState,
  type StaleLawChunk,
} from "../embeddingReindex";

type FakeChunk = StaleLawChunk & {
  current: boolean;
  embedding?: number[];
};

class FakeRepository implements EmbeddingReindexRepository {
  readonly chunks: FakeChunk[];
  readonly runs = new Map<string, EmbeddingReindexRunState>();
  readonly committedChunkIds: number[] = [];

  constructor(chunks: FakeChunk[]) {
    this.chunks = chunks;
  }

  async countAllChunks(): Promise<number> {
    return this.chunks.length;
  }

  async listStaleChunks(): Promise<StaleLawChunk[]> {
    return this.chunks
      .filter((chunk) => !chunk.current)
      .map(({ id, content }) => ({ id, content }));
  }

  async getRun(runId: string): Promise<EmbeddingReindexRunState | null> {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  async createRun(input: {
    runId: string;
    environment: string;
    totalChunks: number;
  }): Promise<void> {
    if (this.runs.has(input.runId)) throw new Error("duplicate runId");
    this.runs.set(input.runId, {
      runId: input.runId,
      environment: input.environment,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      status: "running",
      totalChunks: input.totalChunks,
      processedChunks: 0,
      failedChunks: 0,
      errorCode: null,
    });
  }

  async commitChunk(input: {
    runId: string;
    chunkId: number;
    embedding: number[];
  }): Promise<void> {
    const run = this.runs.get(input.runId);
    const chunk = this.chunks.find((item) => item.id === input.chunkId);
    if (!run || !chunk) throw new Error("fake repository invariant");
    chunk.current = true;
    chunk.embedding = [...input.embedding];
    run.processedChunks += 1;
    this.committedChunkIds.push(input.chunkId);
  }

  async markCompleted(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("fake repository invariant");
    run.status = "completed";
    run.failedChunks = 0;
    run.errorCode = null;
  }

  async markFailed(runId: string, errorCode: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("fake repository invariant");
    run.status = "failed";
    run.failedChunks += 1;
    run.errorCode = errorCode;
  }
}

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const RUN_C = "33333333-3333-4333-8333-333333333333";

function vector(value = 0.25): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => value);
}

function staleChunk(id: number, content = `chunk-${id}`): FakeChunk {
  return { id, content, current: false };
}

function currentChunk(id: number, content = `chunk-${id}`): FakeChunk {
  return { id, content, current: true, embedding: vector() };
}

describe("F-EMB1 legal embedding reindex", () => {
  it("dry-run conta stale/current sem criar ledger, chamar provider ou alterar chunks", async () => {
    const repository = new FakeRepository([
      staleChunk(1),
      currentChunk(2),
      staleChunk(3),
    ]);
    const embed = vi.fn(async () => vector());

    const result = await runEmbeddingReindex(
      { mode: "dry-run", environment: "staging" },
      { repository, embed, log: vi.fn() },
    );

    expect(result.status).toBe("dry-run");
    expect(result.staleChunks).toBe(2);
    expect(result.skippedChunks).toBe(1);
    expect(repository.runs.size).toBe(0);
    expect(repository.committedChunkIds).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("apply processa somente stale rows e fecha o ledger", async () => {
    const repository = new FakeRepository([
      staleChunk(1),
      currentChunk(2),
      staleChunk(3),
    ]);
    const embed = vi.fn(async () => vector());

    const result = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    );

    expect(result.status).toBe("completed");
    expect(result.processedChunks).toBe(2);
    expect(repository.committedChunkIds).toEqual([1, 3]);
    expect(embed).toHaveBeenCalledTimes(2);
    expect(repository.runs.get(RUN_A)).toMatchObject({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      status: "completed",
      totalChunks: 2,
      processedChunks: 2,
      failedChunks: 0,
    });
    expect(await repository.listStaleChunks()).toEqual([]);
  });

  it("replay do mesmo runId concluído é determinístico e não chama provider novamente", async () => {
    const repository = new FakeRepository([staleChunk(1)]);
    const embed = vi.fn(async () => vector());

    await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    );
    embed.mockClear();

    const replay = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    );

    expect(replay.status).toBe("replayed");
    expect(embed).not.toHaveBeenCalled();
    expect(repository.committedChunkIds).toEqual([1]);
  });

  it("nova execução após sucesso é noop com zero stale", async () => {
    const repository = new FakeRepository([staleChunk(1), staleChunk(2)]);
    const embed = vi.fn(async () => vector());

    await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    );
    embed.mockClear();

    const noop = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_B },
      { repository, embed, log: vi.fn() },
    );

    expect(noop.status).toBe("completed");
    expect(noop.staleChunks).toBe(0);
    expect(noop.processedChunks).toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(repository.runs.get(RUN_B)).toMatchObject({
      status: "completed",
      totalChunks: 0,
      processedChunks: 0,
    });
  });

  it("falha parcial preserva chunks já consistentes e novo run continua apenas os stale", async () => {
    const repository = new FakeRepository([
      staleChunk(1),
      staleChunk(2),
      staleChunk(3),
    ]);
    const firstEmbed = vi.fn(async (text: string) => {
      if (text === "chunk-2") throw new Error("EMBEDDING_PROVIDER_HTTP_503");
      return vector();
    });

    const failed = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed: firstEmbed, log: vi.fn() },
    );

    expect(failed.status).toBe("failed");
    expect(failed.processedChunks).toBe(1);
    expect(failed.errorCode).toBe("EMBEDDING_PROVIDER_HTTP_503");
    expect(repository.committedChunkIds).toEqual([1]);
    expect(repository.runs.get(RUN_A)).toMatchObject({
      status: "failed",
      processedChunks: 1,
      failedChunks: 1,
      errorCode: "EMBEDDING_PROVIDER_HTTP_503",
    });

    const retryEmbed = vi.fn(async () => vector(0.5));
    const retry = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_B },
      { repository, embed: retryEmbed, log: vi.fn() },
    );

    expect(retry.status).toBe("completed");
    expect(retry.processedChunks).toBe(2);
    expect(retryEmbed).toHaveBeenCalledTimes(2);
    expect(repository.committedChunkIds).toEqual([1, 2, 3]);
    expect(repository.runs.get(RUN_A)?.status).toBe("failed");
    expect(repository.runs.get(RUN_B)?.status).toBe("completed");
  });

  it("runId running/failed não é reutilizado silenciosamente", async () => {
    const repository = new FakeRepository([staleChunk(1)]);
    repository.runs.set(RUN_A, {
      runId: RUN_A,
      environment: "staging",
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      status: "running",
      totalChunks: 1,
      processedChunks: 0,
      failedChunks: 0,
      errorCode: null,
    });
    const embed = vi.fn(async () => vector());

    await expect(runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    )).rejects.toThrow("EMBEDDING_REINDEX_RUN_ALREADY_RUNNING");
    expect(embed).not.toHaveBeenCalled();

    repository.runs.get(RUN_A)!.status = "failed";
    await expect(runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      { repository, embed, log: vi.fn() },
    )).rejects.toThrow("EMBEDDING_REINDEX_RUN_ALREADY_FAILED");
    expect(embed).not.toHaveBeenCalled();
  });

  it("rejeita vetor inválido, não marca completed e não expõe conteúdo em log", async () => {
    const sensitiveContent = "conteúdo jurídico que não deve aparecer no log";
    const repository = new FakeRepository([staleChunk(1, sensitiveContent)]);
    const logs: string[] = [];
    const invalid = vector();
    invalid[10] = Number.NaN;

    const result = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_C },
      {
        repository,
        embed: vi.fn(async () => invalid),
        log: (message) => logs.push(message),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("EMBEDDING_PROVIDER_INVALID_VECTOR");
    expect(repository.runs.get(RUN_C)?.status).toBe("failed");
    expect(repository.committedChunkIds).toEqual([]);
    expect(logs.join(" ")).not.toContain(sensitiveContent);
  });

  it("normaliza erro arbitrário para código seguro sem vazar mensagem", async () => {
    const sensitiveContent = "texto-fonte-sensível";
    const sensitiveError = "driver exploded with secret detail";
    const repository = new FakeRepository([staleChunk(1, sensitiveContent)]);
    const logs: string[] = [];

    const result = await runEmbeddingReindex(
      { mode: "apply", environment: "staging", runId: RUN_A },
      {
        repository,
        embed: vi.fn(async () => { throw new Error(sensitiveError); }),
        log: (message) => logs.push(message),
      },
    );

    expect(result.errorCode).toBe("EMBEDDING_REINDEX_OPERATION_FAILED");
    expect(logs.join(" ")).not.toContain(sensitiveContent);
    expect(logs.join(" ")).not.toContain(sensitiveError);
  });
});
