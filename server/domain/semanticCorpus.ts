import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export type CorpusType = "legal_base" | "jurisprudence" | "institutional" | "templates" | "custom";
export type IndexingStrategy = "full_reindex" | "incremental" | "rolling" | "append_only";
export type IndexingStatus = "pending" | "indexing" | "indexed" | "failed" | "stale" | "rebuilding";

export interface SemanticCorpus {
  readonly id: string;
  readonly organizationId: number;
  readonly corpusType: CorpusType;
  readonly corpusName: string;
  readonly corpusDescription: string;
  readonly indexingStrategy: IndexingStrategy;
  readonly embeddingProvider: string;
  readonly activeEmbeddingVersion: string;
  readonly totalChunks: number;
  readonly totalEmbeddings: number;
  readonly indexingStatus: IndexingStatus;
  readonly lastIndexedAt: string | null;
  readonly createdAt: string;
}

export function createSemanticCorpus(params: {
  organizationId: number;
  corpusType: CorpusType;
  corpusName: string;
  corpusDescription?: string;
  indexingStrategy?: IndexingStrategy;
  embeddingProvider?: string;
  activeEmbeddingVersion?: string;
}): SemanticCorpus {
  const now = new Date().toISOString();
  const id = sha256(`corpus:${params.organizationId}:${params.corpusType}:${params.corpusName}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    corpusType: params.corpusType,
    corpusName: params.corpusName,
    corpusDescription: params.corpusDescription ?? "",
    indexingStrategy: params.indexingStrategy ?? "incremental",
    embeddingProvider: params.embeddingProvider ?? "mock",
    activeEmbeddingVersion: params.activeEmbeddingVersion ?? "v1",
    totalChunks: 0,
    totalEmbeddings: 0,
    indexingStatus: "pending",
    lastIndexedAt: null,
    createdAt: now,
  };
}

export function updateCorpusStats(corpus: SemanticCorpus, chunks: number, embeddings: number): SemanticCorpus {
  return { ...corpus, totalChunks: chunks, totalEmbeddings: embeddings, lastIndexedAt: new Date().toISOString(), indexingStatus: "indexed" };
}

export function setIndexingStatus(corpus: SemanticCorpus, status: IndexingStatus): SemanticCorpus {
  return { ...corpus, indexingStatus: status };
}

export function isCorpusStale(corpus: SemanticCorpus, maxAgeMs: number): boolean {
  if (!corpus.lastIndexedAt) return true;
  return Date.now() - new Date(corpus.lastIndexedAt).getTime() > maxAgeMs;
}

export function upgradeEmbeddingVersion(corpus: SemanticCorpus, newVersion: string): SemanticCorpus {
  return { ...corpus, activeEmbeddingVersion: newVersion, indexingStatus: "stale" };
}
