import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import {
  lawChunks,
  legalReferenceSetEvents,
  type InsertLawChunk,
  type LawChunk,
  type LegalReferenceEntry,
  type LegalReferenceSet,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getReferenceEntries, resolveActiveReferenceSet } from "../db/legalReference";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  generateEmbedding,
  isValidEmbeddingVector,
} from "./embeddings";

export const GOVERNED_LAW_CORPUS_VERSION = "f-rag1-v1";
export const GOVERNED_LAW_CONTENT_KIND = "governed_reference_summary";

type Mode = "dry-run" | "apply";

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

export interface GovernedChunkMetadata {
  readonly governedMaterialization: true;
  readonly materializationKey: string;
  readonly materializerVersion: string;
  readonly contentKind: typeof GOVERNED_LAW_CONTENT_KIND;
  readonly generatedFrom: "legal_reference_entries.hypothesisSummary";
  readonly summaryNotVerbatimStatutoryText: true;
  readonly referenceSetId: number;
  readonly referenceSetVersion: number;
  readonly referenceSetContentHash: string;
  readonly referenceEntryId: number;
  readonly sourceContentHash: string;
  readonly canonicalLocator: string;
  readonly canonicalDisplay: string;
  readonly sourceAuthority: string;
  readonly sourceIdentifier: string;
  readonly sourceUrl: string;
  readonly publicationDate: string | null;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly activeReference: boolean;
}

type MaterializationEventDetails = {
  runId?: unknown;
  stage?: unknown;
};

export interface GovernedLawCorpusDeps {
  resolveGovernedSet(asOfDate: string): Promise<{ set: LegalReferenceSet; entries: LegalReferenceEntry[] }>;
  listChunks(): Promise<LawChunk[]>;
  insertChunk(chunk: InsertLawChunk): Promise<void>;
  listSetEvents(setId: number): Promise<Array<{ action: string; details: unknown }>>;
  appendSetEvent(input: {
    setId: number;
    action: string;
    details: Record<string, unknown>;
  }): Promise<void>;
  finalizeActiveReference(referenceSetContentHash: string): Promise<void>;
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

export function readGovernedChunkMetadata(value: unknown): GovernedChunkMetadata | null {
  const record = asRecord(value);
  if (!record || record.governedMaterialization !== true) return null;
  if (record.contentKind !== GOVERNED_LAW_CONTENT_KIND) return null;
  if (typeof record.materializationKey !== "string") return null;
  if (typeof record.referenceSetContentHash !== "string") return null;
  if (typeof record.activeReference !== "boolean") return null;
  return record as unknown as GovernedChunkMetadata;
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

function runState(events: Array<{ action: string; details: unknown }>, runId: string): "completed" | "started" | "failed" | null {
  for (const event of events) {
    const details = asRecord(event.details) as MaterializationEventDetails | null;
    if (!details || details.runId !== runId) continue;
    if (event.action === "rag_materialization_completed") return "completed";
    if (event.action === "rag_materialization_failed") return "failed";
    if (event.action === "rag_materialization_started") return "started";
  }
  return null;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "GOVERNED_LAW_CORPUS_UNKNOWN_ERROR";
  const code = error.message.trim();
  return /^[A-Z0-9_:-]{1,100}$/.test(code)
    ? code
    : error.name || "GOVERNED_LAW_CORPUS_ERROR";
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
  async insertChunk(chunk) {
    const db = await requireDb();
    await db.insert(lawChunks).values(chunk);
  },
  async listSetEvents(setId) {
    const db = await requireDb();
    return db
      .select({ action: legalReferenceSetEvents.action, details: legalReferenceSetEvents.details })
      .from(legalReferenceSetEvents)
      .where(eq(legalReferenceSetEvents.setId, setId));
  },
  async appendSetEvent(input) {
    const db = await requireDb();
    await db.insert(legalReferenceSetEvents).values({
      setId: input.setId,
      action: input.action,
      fromStatus: "active",
      toStatus: "active",
      details: input.details,
    });
  },
  async finalizeActiveReference(referenceSetContentHash) {
    const db = await requireDb();
    const rows = await db.select().from(lawChunks);
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const metadata = readGovernedChunkMetadata(row.metadata);
        if (!metadata) continue;
        const shouldBeActive = metadata.referenceSetContentHash === referenceSetContentHash;
        if (metadata.activeReference === shouldBeActive) continue;
        await tx
          .update(lawChunks)
          .set({ metadata: { ...metadata, activeReference: shouldBeActive } })
          .where(eq(lawChunks.id, row.id));
      }
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

  // resolveActiveReferenceSet é o gate jurídico: somente set ACTIVE + aprovado + hash íntegro.
  const { set, entries } = await deps.resolveGovernedSet(input.asOfDate);
  const orderedEntries = [...entries].sort((a, b) => a.canonicalLocator.localeCompare(b.canonicalLocator));
  if (orderedEntries.length === 0) throw new Error("GOVERNED_LAW_CORPUS_EMPTY_REFERENCE_SET");

  const chunks = await deps.listChunks();
  const existingKeys = new Set(
    chunks
      .map((chunk) => readGovernedChunkMetadata(chunk.metadata)?.materializationKey)
      .filter((key): key is string => typeof key === "string"),
  );
  const keys = orderedEntries.map((entry) => buildGovernedMaterializationKey(set, entry));
  const alreadyMaterialized = keys.filter((key) => existingKeys.has(key)).length;

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
  const events = await deps.listSetEvents(set.id);
  const prior = runState(events, runId);
  if (prior === "completed") {
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
  if (prior) throw new Error("GOVERNED_LAW_CORPUS_RUN_ID_NOT_REUSABLE");

  await deps.appendSetEvent({
    setId: set.id,
    action: "rag_materialization_started",
    details: {
      runId,
      environment: input.environment,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIM,
      materializerVersion: GOVERNED_LAW_CORPUS_VERSION,
      totalEntries: orderedEntries.length,
      alreadyMaterialized,
    },
  });

  let materialized = 0;
  try {
    for (let index = 0; index < orderedEntries.length; index += 1) {
      const entry = orderedEntries[index];
      const materializationKey = keys[index];
      if (existingKeys.has(materializationKey)) continue;

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
        // Só vira ativo de uma vez, no final, evitando corpus parcial visível ao RAG.
        activeReference: false,
      };

      await deps.insertChunk({
        lawName: set.law,
        chunkIndex: index,
        articleNumber: entry.canonicalDisplay,
        content,
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        embeddingDimensions: EMBEDDING_DIM,
        metadata,
      });
      existingKeys.add(materializationKey);
      materialized += 1;
    }

    await deps.finalizeActiveReference(set.contentHash);
    await deps.appendSetEvent({
      setId: set.id,
      action: "rag_materialization_completed",
      details: {
        runId,
        environment: input.environment,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        materializerVersion: GOVERNED_LAW_CORPUS_VERSION,
        totalEntries: orderedEntries.length,
        materialized,
        skipped: alreadyMaterialized,
      },
    });
  } catch (error) {
    await deps.appendSetEvent({
      setId: set.id,
      action: "rag_materialization_failed",
      details: {
        runId,
        environment: input.environment,
        errorCode: errorCode(error),
        materialized,
      },
    });
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
