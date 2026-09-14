import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { lawChunks } from "../../drizzle/schema";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  cosineSimilarity,
  generateEmbedding,
  isValidEmbeddingVector,
} from "./embeddings";

export interface RetrievedChunk {
  content: string;
  articleNumber: string | null;
  similarity: number;
}

/**
 * F-EMB1 — recuperação jurídica model-aware.
 *
 * O corpus legal é global/autoridade de referência; não existe tenantId em law_chunks.
 * Isolamento aqui significa, portanto, isolamento do espaço vetorial: nenhum vetor histórico
 * ou de outra dimensionalidade pode ser comparado ao embedding da consulta atual.
 */
export async function retrieveRelevantLaw(
  query: string,
  topK: number = 5,
  lawNames?: string[],
): Promise<RetrievedChunk[]> {
  const db = await getDb();
  if (!db) {
    console.warn(`[RAG] database_unavailable model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM}`);
    return [];
  }

  try {
    const lineageFilter = and(
      eq(lawChunks.embeddingModel, EMBEDDING_MODEL),
      eq(lawChunks.embeddingDimensions, EMBEDDING_DIM),
    );

    const scopedFilter = lawNames && lawNames.length > 0
      ? and(
          lineageFilter,
          lawNames.length === 1
            ? eq(lawChunks.lawName, lawNames[0])
            : inArray(lawChunks.lawName, lawNames),
        )
      : lineageFilter;

    // Primeiro prova que existe corpus no espaço atual. Isso evita chamar o provider quando a
    // reindexação ainda não ocorreu e impede fallback silencioso para vetores incompatíveis.
    const currentSpaceChunks = await db
      .select()
      .from(lawChunks)
      .where(scopedFilter);

    if (currentSpaceChunks.length === 0) {
      console.warn(
        `[RAG] current_vector_space_empty model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} lawFilterCount=${lawNames?.length ?? 0}`,
      );
      return [];
    }

    const queryEmbedding = await generateEmbedding(query);

    const chunksWithSimilarity = currentSpaceChunks.flatMap((chunk) => {
      let parsed: unknown = chunk.embedding;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          console.warn(`[RAG] invalid_chunk_vector chunkId=${chunk.id} reason=json_parse`);
          return [];
        }
      }

      if (!isValidEmbeddingVector(parsed)) {
        console.warn(`[RAG] invalid_chunk_vector chunkId=${chunk.id} reason=contract`);
        return [];
      }

      return [{
        content: chunk.content,
        articleNumber: chunk.articleNumber,
        similarity: cosineSimilarity(queryEmbedding, parsed),
      }];
    });

    return chunksWithSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.max(0, topK));
  } catch (error) {
    const code = error instanceof Error ? error.name : "unknown";
    console.error(`[RAG] retrieval_failed code=${code} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM}`);
    return [];
  }
}

/**
 * Formata chunks recuperados em contexto legal para o prompt.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  return chunks
    .map((chunk, index) => {
      const article = chunk.articleNumber ? `[${chunk.articleNumber}]` : "";
      const similarity = `(${(chunk.similarity * 100).toFixed(1)}% relevância)`;
      return `### Trecho Relevante ${index + 1} ${article} ${similarity}\n${chunk.content}`;
    })
    .join("\n\n");
}
