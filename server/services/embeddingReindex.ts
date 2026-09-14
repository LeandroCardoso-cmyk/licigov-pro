/**
 * F-EMB1 — reindexação governada do corpus jurídico global.
 *
 * Este serviço NÃO executa no boot, não expõe endpoint e não decide rollout. Ele fornece
 * um boundary testável para uma operação one-shot, mantendo embedding + lineage + contador
 * do ledger coerentes por transação. O corpus law_chunks é global/referencial no modelo atual;
 * portanto não inventamos organizationId/tenantId para esta operação.
 */
import { eq, ne, or, sql } from "drizzle-orm";
import { embeddingReindexRuns, lawChunks } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  generateEmbedding,
  isValidEmbeddingVector,
} from "./embeddings";

export type EmbeddingReindexMode = "dry-run" | "apply";

export interface StaleLawChunk {
  id: number;
  content: string;
}

export interface EmbeddingReindexRunState {
  runId: string;
  environment: string;
  model: string;
  dimensions: number;
  status: "running" | "completed" | "failed";
  totalChunks: number;
  processedChunks: number;
  failedChunks: number;
  errorCode: string | null;
}

export interface EmbeddingReindexRepository {
  countAllChunks(): Promise<number>;
  listStaleChunks(): Promise<StaleLawChunk[]>;
  getRun(runId: string): Promise<EmbeddingReindexRunState | null>;
  createRun(input: {
    runId: string;
    environment: string;
    totalChunks: number;
  }): Promise<void>;
  commitChunk(input: {
    runId: string;
    chunkId: number;
    embedding: number[];
  }): Promise<void>;
  markCompleted(runId: string): Promise<void>;
  markFailed(runId: string, errorCode: string): Promise<void>;
}

export interface RunEmbeddingReindexInput {
  mode: EmbeddingReindexMode;
  environment: string;
  runId?: string;
}

export interface RunEmbeddingReindexResult {
  mode: EmbeddingReindexMode;
  runId: string | null;
  environment: string;
  model: string;
  dimensions: number;
  status: "dry-run" | "completed" | "failed" | "replayed";
  totalChunks: number;
  staleChunks: number;
  processedChunks: number;
  skippedChunks: number;
  failedChunks: number;
  errorCode: string | null;
}

export interface RunEmbeddingReindexDeps {
  repository: EmbeddingReindexRepository;
  embed?: (text: string) => Promise<number[]>;
  log?: (message: string) => void;
}

function defaultLog(message: string): void {
  console.info(`[F-EMB1] ${message}`);
}

function validateRunId(runId: string | undefined): string {
  if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("EMBEDDING_REINDEX_RUN_ID_INVALID");
  }
  return runId;
}

/**
 * Converte qualquer erro em código operacional sanitizado. Mensagens arbitrárias de driver,
 * provider ou conteúdo nunca são persistidas/logadas pelo runner.
 */
export function toSafeReindexErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/^EMBEDDING_[A-Z0-9_]+$/.test(raw)) {
    return raw.slice(0, 100);
  }
  return "EMBEDDING_REINDEX_OPERATION_FAILED";
}

function assertRunIdentity(run: EmbeddingReindexRunState, environment: string): void {
  if (
    run.environment !== environment
    || run.model !== EMBEDDING_MODEL
    || run.dimensions !== EMBEDDING_DIM
  ) {
    throw new Error("EMBEDDING_REINDEX_RUN_IDENTITY_CONFLICT");
  }
}

/**
 * Orquestra a reindexação. Regras centrais:
 * - dry-run nunca cria ledger nem altera chunks;
 * - apply exige runId explícito;
 * - runId concluído é replay determinístico (sem nova chamada ao provider);
 * - runId já running/failed não é sobrescrito: retry usa novo runId e processa só stale rows;
 * - cada chunk é persistido junto com model+dimensions e incremento do ledger numa transação;
 * - qualquer falha interrompe a execução e deixa os chunks já consistentes intactos;
 * - uma execução posterior naturalmente continua apenas os chunks ainda stale.
 */
export async function runEmbeddingReindex(
  input: RunEmbeddingReindexInput,
  deps: RunEmbeddingReindexDeps,
): Promise<RunEmbeddingReindexResult> {
  const log = deps.log ?? defaultLog;
  const embed = deps.embed ?? ((text: string) => generateEmbedding(text));

  const totalCorpusChunks = await deps.repository.countAllChunks();
  const staleAtStart = await deps.repository.listStaleChunks();
  const skippedAtStart = Math.max(0, totalCorpusChunks - staleAtStart.length);

  if (input.mode === "dry-run") {
    log(
      `runId=none model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} status=dry-run total=${staleAtStart.length} processed=0 skipped=${skippedAtStart} failed=0`,
    );
    return {
      mode: input.mode,
      runId: null,
      environment: input.environment,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      status: "dry-run",
      totalChunks: totalCorpusChunks,
      staleChunks: staleAtStart.length,
      processedChunks: 0,
      skippedChunks: skippedAtStart,
      failedChunks: 0,
      errorCode: null,
    };
  }

  const runId = validateRunId(input.runId);
  const existing = await deps.repository.getRun(runId);
  if (existing) {
    assertRunIdentity(existing, input.environment);
    if (existing.status === "completed") {
      log(
        `runId=${runId} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} status=replayed total=${existing.totalChunks} processed=${existing.processedChunks} skipped=${skippedAtStart} failed=${existing.failedChunks}`,
      );
      return {
        mode: input.mode,
        runId,
        environment: input.environment,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        status: "replayed",
        totalChunks: totalCorpusChunks,
        staleChunks: staleAtStart.length,
        processedChunks: existing.processedChunks,
        skippedChunks: skippedAtStart,
        failedChunks: existing.failedChunks,
        errorCode: existing.errorCode,
      };
    }
    throw new Error(
      existing.status === "running"
        ? "EMBEDDING_REINDEX_RUN_ALREADY_RUNNING"
        : "EMBEDDING_REINDEX_RUN_ALREADY_FAILED",
    );
  }

  await deps.repository.createRun({
    runId,
    environment: input.environment,
    totalChunks: staleAtStart.length,
  });

  let processedChunks = 0;
  for (const chunk of staleAtStart) {
    try {
      const embedding = await embed(chunk.content);
      if (!isValidEmbeddingVector(embedding)) {
        throw new Error("EMBEDDING_PROVIDER_INVALID_VECTOR");
      }

      await deps.repository.commitChunk({
        runId,
        chunkId: chunk.id,
        embedding,
      });
      processedChunks += 1;
    } catch (error) {
      const errorCode = toSafeReindexErrorCode(error);
      await deps.repository.markFailed(runId, errorCode);
      log(
        `runId=${runId} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} status=failed total=${staleAtStart.length} processed=${processedChunks} skipped=${skippedAtStart} failed=1 errorCode=${errorCode}`,
      );
      return {
        mode: input.mode,
        runId,
        environment: input.environment,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        status: "failed",
        totalChunks: totalCorpusChunks,
        staleChunks: staleAtStart.length,
        processedChunks,
        skippedChunks: skippedAtStart,
        failedChunks: 1,
        errorCode,
      };
    }
  }

  // Fail-closed: só fecha completed quando o espaço antigo realmente zerou.
  const remaining = await deps.repository.listStaleChunks();
  if (remaining.length > 0) {
    const errorCode = "EMBEDDING_REINDEX_STALE_REMAIN";
    await deps.repository.markFailed(runId, errorCode);
    log(
      `runId=${runId} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} status=failed total=${staleAtStart.length} processed=${processedChunks} skipped=${skippedAtStart} failed=1 errorCode=${errorCode}`,
    );
    return {
      mode: input.mode,
      runId,
      environment: input.environment,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      status: "failed",
      totalChunks: totalCorpusChunks,
      staleChunks: remaining.length,
      processedChunks,
      skippedChunks: skippedAtStart,
      failedChunks: 1,
      errorCode,
    };
  }

  await deps.repository.markCompleted(runId);
  log(
    `runId=${runId} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} status=completed total=${staleAtStart.length} processed=${processedChunks} skipped=${skippedAtStart} failed=0`,
  );

  return {
    mode: input.mode,
    runId,
    environment: input.environment,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    status: "completed",
    totalChunks: totalCorpusChunks,
    staleChunks: 0,
    processedChunks,
    skippedChunks: skippedAtStart,
    failedChunks: 0,
    errorCode: null,
  };
}

type ReindexDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Adapter Drizzle/MySQL do domínio acima. */
export function createDrizzleEmbeddingReindexRepository(db: ReindexDb): EmbeddingReindexRepository {
  const staleFilter = () => or(
    ne(lawChunks.embeddingModel, EMBEDDING_MODEL),
    ne(lawChunks.embeddingDimensions, EMBEDDING_DIM),
  );

  return {
    async countAllChunks() {
      const rows = await db.select({ id: lawChunks.id }).from(lawChunks);
      return rows.length;
    },

    async listStaleChunks() {
      return db
        .select({ id: lawChunks.id, content: lawChunks.content })
        .from(lawChunks)
        .where(staleFilter());
    },

    async getRun(runId) {
      const rows = await db
        .select()
        .from(embeddingReindexRuns)
        .where(eq(embeddingReindexRuns.runId, runId))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        runId: row.runId,
        environment: row.environment,
        model: row.model,
        dimensions: row.dimensions,
        status: row.status,
        totalChunks: row.totalChunks,
        processedChunks: row.processedChunks,
        failedChunks: row.failedChunks,
        errorCode: row.errorCode,
      };
    },

    async createRun(input) {
      await db.insert(embeddingReindexRuns).values({
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
    },

    async commitChunk(input) {
      await db.transaction(async (tx) => {
        await tx
          .update(lawChunks)
          .set({
            embedding: input.embedding,
            embeddingModel: EMBEDDING_MODEL,
            embeddingDimensions: EMBEDDING_DIM,
          })
          .where(eq(lawChunks.id, input.chunkId));

        await tx
          .update(embeddingReindexRuns)
          .set({
            processedChunks: sql`${embeddingReindexRuns.processedChunks} + 1`,
          })
          .where(eq(embeddingReindexRuns.runId, input.runId));
      });
    },

    async markCompleted(runId) {
      await db
        .update(embeddingReindexRuns)
        .set({
          status: "completed",
          failedChunks: 0,
          errorCode: null,
          completedAt: new Date(),
        })
        .where(eq(embeddingReindexRuns.runId, runId));
    },

    async markFailed(runId, errorCode) {
      await db
        .update(embeddingReindexRuns)
        .set({
          status: "failed",
          failedChunks: sql`${embeddingReindexRuns.failedChunks} + 1`,
          errorCode,
          completedAt: new Date(),
        })
        .where(eq(embeddingReindexRuns.runId, runId));
    },
  };
}

/** Resolve o banco real somente no boundary operacional/CLI. */
export async function getEmbeddingReindexRepository(): Promise<EmbeddingReindexRepository> {
  const db = await getDb();
  if (!db) throw new Error("EMBEDDING_REINDEX_DATABASE_UNAVAILABLE");
  return createDrizzleEmbeddingReindexRepository(db);
}
