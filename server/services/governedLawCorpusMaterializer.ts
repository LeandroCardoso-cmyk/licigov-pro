import { createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  lawChunks,
  legalReferenceSetEvents,
  legalReferenceSets,
  type InsertLawChunk,
  type LawChunk,
  type LegalReferenceEntry,
  type LegalReferenceSet,
} from "../../drizzle/schema";
import {
  GOVERNED_LAW_CONTENT_KIND,
  GOVERNED_LAW_CORPUS_VERSION,
  readGovernedChunkMetadata,
  type GovernedChunkMetadata,
} from "../domain/governedLawCorpus";
import { getDb } from "../db";
import { getReferenceEntries, resolveActiveReferenceSet } from "../db/legalReference";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  generateEmbedding,
  isValidEmbeddingVector,
} from "./embeddings";

type Mode = "dry-run" | "apply";
type RunClaim = "claimed" | "replayed";
type InsertOutcome = "inserted" | "existing";
type RunState = "completed" | "started" | "failed" | null;

export interface GovernedLawCorpusInput {
  readonly mode: Mode;
  readonly environment: "staging" | "production";
  readonly asOfDate: string;
  readonly runId?: string;
}

export interface GovernedLawCorpusResult {
  readonly mode: Mode;
  readonly runId?: string;
  readonly referenceSetId: number;
  readonly referenceSetVersion: number;
  readonly referenceSetContentHash: string;
  readonly totalEntries: number;
  readonly alreadyMaterialized: number;
  readonly materialized: number;
  readonly replayed: boolean;
}

interface RunIdentity {
  readonly setId: number;
  readonly referenceSetContentHash: string;
  readonly runId: string;
}

interface ClaimRunInput extends RunIdentity {
  readonly environment: "staging" | "production";
  readonly totalEntries: number;
  readonly alreadyMaterialized: number;
}

interface CompleteRunInput extends RunIdentity {
  readonly environment: "staging" | "production";
  readonly expectedMaterializationKeys: readonly string[];
  readonly totalEntries: number;
  readonly alreadyMaterialized: number;
  readonly materialized: number;
}

interface FailRunInput extends RunIdentity {
  readonly environment: "staging" | "production";
  readonly errorCode: string;
  readonly materialized: number;
}

interface CorpusEvent {
  readonly action: string;
  readonly correlationId: string | null;
  readonly details: unknown;
}

export interface GovernedLawCorpusDeps {
  resolveGovernedSet(asOfDate: string): Promise<{ set: LegalReferenceSet; entries: LegalReferenceEntry[] }>;
  listChunks(): Promise<LawChunk[]>;
  claimRun(input: ClaimRunInput): Promise<RunClaim>;
  insertChunkIfMissing(input: {
    setId: number;
    referenceSetContentHash: string;
    materializationKey: string;
    chunk: InsertLawChunk;
  }): Promise<InsertOutcome>;
  completeRun(input: CompleteRunInput): Promise<void>;
  failRun(input: FailRunInput): Promise<void>;
  embed(text: string): Promise<number[]>;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireDb() {
  return getDb().then((db) => {
    if (!db) throw new Error("GOVERNED_LAW_CORPUS_DB_UNAVAILABLE");
    return db;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function eventRunId(event: CorpusEvent): string | null {
  if (event.correlationId) return event.correlationId;
  const details = asRecord(event.details);
  return typeof details?.runId === "string" ? details.runId : null;
}

function runState(events: readonly CorpusEvent[], runId: string): RunState {
  let started = false;
  let failed = false;
  for (const event of events) {
    if (eventRunId(event) !== runId) continue;
    if (event.action === "rag_materialization_completed") return "completed";
    if (event.action === "rag_materialization_failed") failed = true;
    if (event.action === "rag_materialization_started") started = true;
  }
  if (failed) return "failed";
  if (started) return "started";
  return null;
}

function findOtherRunningRun(events: readonly CorpusEvent[], runId: string): string | null {
  const candidates = new Set(
    events
      .filter((event) => event.action === "rag_materialization_started")
      .map(eventRunId)
      .filter((candidate): candidate is string => Boolean(candidate) && candidate !== runId),
  );
  for (const candidate of candidates) {
    if (runState(events, candidate) === "started") return candidate;
  }
  return null;
}

function buildContent(entry: LegalReferenceEntry): string {
  return `${entry.canonicalDisplay}: ${entry.hypothesisSummary}`;
}

export function buildGovernedMaterializationKey(
  set: Pick<LegalReferenceSet, "law" | "jurisdiction" | "version" | "contentHash">,
  entry: Pick<LegalReferenceEntry, "canonicalLocator" | "contentHash">,
): string {
  const identity = [
    GOVERNED_LAW_CORPUS_VERSION,
    set.law,
    set.jurisdiction,
    String(set.version),
    set.contentHash,
    entry.canonicalLocator,
    entry.contentHash,
    EMBEDDING_MODEL,
    String(EMBEDDING_DIM),
  ].join("\0");
  return createHash("sha256").update(identity).digest("hex");
}

function countMaterializationKeys(chunks: readonly LawChunk[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of chunks) {
    const key = readGovernedChunkMetadata(chunk.metadata)?.materializationKey;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function assertNoDuplicateKeys(counts: ReadonlyMap<string, number>, expectedKeys?: ReadonlySet<string>): void {
  for (const [key, count] of counts) {
    if (count > 1 && (!expectedKeys || expectedKeys.has(key))) {
      throw new Error("GOVERNED_LAW_CORPUS_DUPLICATE_MATERIALIZATION_KEY");
    }
  }
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "GOVERNED_LAW_CORPUS_UNKNOWN_ERROR";
  const code = error.message.trim();
  return /^[A-Z0-9_:-]{1,100}$/.test(code)
    ? code
    : error.name || "GOVERNED_LAW_CORPUS_ERROR";
}

async function lockReferenceSet(tx: { execute: (query: unknown) => Promise<unknown> }, setId: number): Promise<void> {
  await tx.execute(sql`SELECT id FROM legal_reference_sets WHERE id = ${setId} FOR UPDATE`);
}

async function assertReferenceStillActive(
  tx: any,
  setId: number,
  expectedContentHash: string,
): Promise<void> {
  const rows = await tx
    .select({
      status: legalReferenceSets.status,
      contentHash: legalReferenceSets.contentHash,
      approvedReferenceHash: legalReferenceSets.approvedReferenceHash,
      approvedByUserId: legalReferenceSets.approvedByUserId,
    })
    .from(legalReferenceSets)
    .where(eq(legalReferenceSets.id, setId))
    .limit(1);
  const current = rows[0];
  if (
    !current
    || current.status !== "active"
    || current.contentHash !== expectedContentHash
    || current.approvedReferenceHash !== expectedContentHash
    || !current.approvedByUserId
  ) {
    throw new Error("GOVERNED_LAW_CORPUS_REFERENCE_CHANGED");
  }
}

export const defaultGovernedLawCorpusDeps: GovernedLawCorpusDeps = {
  async resolveGovernedSet(asOfDate) {
    const { set } = await resolveActiveReferenceSet(asOfDate);
    const entries = await getReferenceEntries(set.id);
    return { set, entries };
  },
  async listChunks() {
    const db = await requireDb();
    return db.select().from(lawChunks);
  },
  async claimRun(input) {
    const db = await requireDb();
    return db.transaction(async (tx) => {
      await lockReferenceSet(tx as any, input.setId);
      await assertReferenceStillActive(tx, input.setId, input.referenceSetContentHash);

      const events: CorpusEvent[] = await tx
        .select({
          action: legalReferenceSetEvents.action,
          correlationId: legalReferenceSetEvents.correlationId,
          details: legalReferenceSetEvents.details,
        })
        .from(legalReferenceSetEvents)
        .where(eq(legalReferenceSetEvents.setId, input.setId));

      const state = runState(events, input.runId);
      if (state === "completed") return "replayed" as const;
      if (state) throw new Error("GOVERNED_LAW_CORPUS_RUN_ID_NOT_REUSABLE");
      if (findOtherRunningRun(events, input.runId)) {
        throw new Error("GOVERNED_LAW_CORPUS_ALREADY_RUNNING");
      }

      await tx.insert(legalReferenceSetEvents).values({
        setId: input.setId,
        action: "rag_materialization_started",
        correlationId: input.runId,
        details: {
          runId: input.runId,
          environment: input.environment,
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIM,
          materializerVersion: GOVERNED_LAW_CORPUS_VERSION,
          totalEntries: input.totalEntries,
          alreadyMaterialized: input.alreadyMaterialized,
        },
      });
      return "claimed" as const;
    });
  },
  async insertChunkIfMissing(input) {
    const db = await requireDb();
    return db.transaction(async (tx) => {
      // Row-lock curto: serializa somente o check+insert; provider roda FORA da transação.
      await lockReferenceSet(tx as any, input.setId);
      await assertReferenceStillActive(tx, input.setId, input.referenceSetContentHash);
      const rows = await tx.select().from(lawChunks);
      const counts = countMaterializationKeys(rows);
      const count = counts.get(input.materializationKey) ?? 0;
      if (count > 1) throw new Error("GOVERNED_LAW_CORPUS_DUPLICATE_MATERIALIZATION_KEY");
      if (count === 1) return "existing" as const;
      await tx.insert(lawChunks).values(input.chunk);
      return "inserted" as const;
    });
  },
  async completeRun(input) {
    const db = await requireDb();
    await db.transaction(async (tx) => {
      await lockReferenceSet(tx as any, input.setId);
      await assertReferenceStillActive(tx, input.setId, input.referenceSetContentHash);

      const events: CorpusEvent[] = await tx
        .select({
          action: legalReferenceSetEvents.action,
          correlationId: legalReferenceSetEvents.correlationId,
          details: legalReferenceSetEvents.details,
        })
        .from(legalReferenceSetEvents)
        .where(eq(legalReferenceSetEvents.setId, input.setId));
      if (runState(events, input.runId) !== "started") {
        throw new Error("GOVERNED_LAW_CORPUS_RUN_STATE_INVALID");
      }

      const rows = await tx.select().from(lawChunks);
      const expected = new Set(input.expectedMaterializationKeys);
      const counts = countMaterializationKeys(rows);
      assertNoDuplicateKeys(counts, expected);
      if (input.expectedMaterializationKeys.some((key) => (counts.get(key) ?? 0) !== 1)) {
        throw new Error("GOVERNED_LAW_CORPUS_INCOMPLETE");
      }

      // Publicação atômica do read-model: nenhum corpus parcial fica visível ao RAG.
      for (const row of rows) {
        const metadata = readGovernedChunkMetadata(row.metadata);
        if (!metadata) continue;
        const shouldBeActive = expected.has(metadata.materializationKey);
        if (metadata.activeReference === shouldBeActive) continue;
        await tx
          .update(lawChunks)
          .set({ metadata: { ...metadata, activeReference: shouldBeActive } })
          .where(eq(lawChunks.id, row.id));
      }

      await tx.insert(legalReferenceSetEvents).values({
        setId: input.setId,
        action: "rag_materialization_completed",
        correlationId: input.runId,
        details: {
          runId: input.runId,
          environment: input.environment,
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIM,
          materializerVersion: GOVERNED_LAW_CORPUS_VERSION,
          totalEntries: input.totalEntries,
          materialized: input.materialized,
          skipped: input.alreadyMaterialized,
        },
      });
    });
  },
  async failRun(input) {
    const db = await requireDb();
    await db.transaction(async (tx) => {
      await lockReferenceSet(tx as any, input.setId);
      const events: CorpusEvent[] = await tx
        .select({
          action: legalReferenceSetEvents.action,
          correlationId: legalReferenceSetEvents.correlationId,
          details: legalReferenceSetEvents.details,
        })
        .from(legalReferenceSetEvents)
        .where(eq(legalReferenceSetEvents.setId, input.setId));
      const state = runState(events, input.runId);
      if (state === "completed" || state === "failed") return;
      if (state !== "started") throw new Error("GOVERNED_LAW_CORPUS_RUN_STATE_INVALID");
      await tx.insert(legalReferenceSetEvents).values({
        setId: input.setId,
        action: "rag_materialization_failed",
        correlationId: input.runId,
        details: {
          runId: input.runId,
          environment: input.environment,
          errorCode: input.errorCode,
          materialized: input.materialized,
        },
      });
    });
  },
  embed: generateEmbedding,
};

export async function materializeGovernedLawCorpus(
  input: GovernedLawCorpusInput,
  deps: GovernedLawCorpusDeps = defaultGovernedLawCorpusDeps,
): Promise<GovernedLawCorpusResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) {
    throw new Error("GOVERNED_LAW_CORPUS_AS_OF_DATE_INVALID");
  }
  if (input.mode === "apply" && !isUuid(input.runId)) {
    throw new Error("GOVERNED_LAW_CORPUS_RUN_ID_REQUIRED");
  }
  if (input.mode === "dry-run" && input.runId) {
    throw new Error("GOVERNED_LAW_CORPUS_DRY_RUN_FORBIDS_RUN_ID");
  }

  // Gate jurídico: somente set ACTIVE + aprovado + approvedReferenceHash íntegro.
  const { set, entries } = await deps.resolveGovernedSet(input.asOfDate);
  const orderedEntries = [...entries].sort((a, b) => a.canonicalLocator.localeCompare(b.canonicalLocator));
  if (orderedEntries.length === 0) throw new Error("GOVERNED_LAW_CORPUS_EMPTY_REFERENCE_SET");

  const keys = orderedEntries.map((entry) => buildGovernedMaterializationKey(set, entry));
  const expectedKeys = new Set(keys);
  const initialChunks = await deps.listChunks();
  const initialCounts = countMaterializationKeys(initialChunks);
  assertNoDuplicateKeys(initialCounts, expectedKeys);
  const alreadyMaterialized = keys.filter((key) => (initialCounts.get(key) ?? 0) === 1).length;

  if (input.mode === "dry-run") {
    return {
      mode: input.mode,
      referenceSetId: set.id,
      referenceSetVersion: set.version,
      referenceSetContentHash: set.contentHash,
      totalEntries: orderedEntries.length,
      alreadyMaterialized,
      materialized: 0,
      replayed: false,
    };
  }

  const runId = input.runId!;
  const claim = await deps.claimRun({
    setId: set.id,
    referenceSetContentHash: set.contentHash,
    runId,
    environment: input.environment,
    totalEntries: orderedEntries.length,
    alreadyMaterialized,
  });
  if (claim === "replayed") {
    return {
      mode: input.mode,
      runId,
      referenceSetId: set.id,
      referenceSetVersion: set.version,
      referenceSetContentHash: set.contentHash,
      totalEntries: orderedEntries.length,
      alreadyMaterialized,
      materialized: 0,
      replayed: true,
    };
  }

  let materialized = 0;
  try {
    for (let index = 0; index < orderedEntries.length; index += 1) {
      const entry = orderedEntries[index];
      const materializationKey = keys[index];
      if ((initialCounts.get(materializationKey) ?? 0) === 1) continue;

      const content = buildContent(entry);
      const embedding = await deps.embed(content);
      if (!isValidEmbeddingVector(embedding)) {
        throw new Error("GOVERNED_LAW_CORPUS_INVALID_VECTOR");
      }

      const metadata: GovernedChunkMetadata = {
        governedMaterialization: true,
        materializationKey,
        materializerVersion: GOVERNED_LAW_CORPUS_VERSION,
        contentKind: GOVERNED_LAW_CONTENT_KIND,
        generatedFrom: "legal_reference_entries.hypothesisSummary",
        summaryNotVerbatimStatutoryText: true,
        referenceSetId: set.id,
        referenceSetVersion: set.version,
        referenceSetContentHash: set.contentHash,
        referenceEntryId: entry.id,
        sourceContentHash: entry.contentHash,
        canonicalLocator: entry.canonicalLocator,
        canonicalDisplay: entry.canonicalDisplay,
        sourceAuthority: entry.sourceAuthority,
        sourceIdentifier: entry.sourceIdentifier,
        sourceUrl: entry.sourceUrl,
        publicationDate: entry.publicationDate ?? null,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: EMBEDDING_DIM,
        activeReference: false,
      };

      const outcome = await deps.insertChunkIfMissing({
        setId: set.id,
        referenceSetContentHash: set.contentHash,
        materializationKey,
        chunk: {
          lawName: set.law,
          chunkIndex: index,
          articleNumber: entry.canonicalDisplay,
          content,
          embedding,
          embeddingModel: EMBEDDING_MODEL,
          embeddingDimensions: EMBEDDING_DIM,
          metadata,
        },
      });
      if (outcome === "inserted") materialized += 1;
    }

    await deps.completeRun({
      setId: set.id,
      referenceSetContentHash: set.contentHash,
      runId,
      environment: input.environment,
      expectedMaterializationKeys: keys,
      totalEntries: orderedEntries.length,
      alreadyMaterialized,
      materialized,
    });
  } catch (error) {
    try {
      await deps.failRun({
        setId: set.id,
        referenceSetContentHash: set.contentHash,
        runId,
        environment: input.environment,
        errorCode: errorCode(error),
        materialized,
      });
    } catch {
      throw new Error("GOVERNED_LAW_CORPUS_FAILURE_AUDIT_FAILED");
    }
    throw error;
  }

  return {
    mode: input.mode,
    runId,
    referenceSetId: set.id,
    referenceSetVersion: set.version,
    referenceSetContentHash: set.contentHash,
    totalEntries: orderedEntries.length,
    alreadyMaterialized,
    materialized,
    replayed: false,
  };
}

export {
  GOVERNED_LAW_CONTENT_KIND,
  GOVERNED_LAW_CORPUS_VERSION,
  readGovernedChunkMetadata,
} from "../domain/governedLawCorpus";
