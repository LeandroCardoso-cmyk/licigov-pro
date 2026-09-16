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
import {
  GOVERNED_LAW_CONTENT_KIND,
  readGovernedChunkMetadata,
} from "./governedLawCorpusMaterializer";

export interface RetrievedChunk {
  content: string;
  articleNumber: string | null;
  similarity: number;
  contentKind?: string;
  canonicalLocator?: string;
  sourceIdentifier?: string;
  sourceUrl?: string;
}

/**
 * F-EMB1/F-RAG1 — recuperação jurídica model-aware e provenance-aware.
 *
 * O corpus legal é global/autoridade de referência; não existe tenantId em law_chunks.
 * Isolamento aqui significa, portanto, isolamento do espaço vetorial: nenhum vetor histórico
 * ou de outra dimensionalidade pode ser comparado ao embedding da consulta atual.
 *
 * Chunks materializados a partir do reference set governado só entram no RAG quando
 * `activeReference=true`. Isso evita tornar visível uma materialização parcial ou um set
 * governado já substituído. Chunks legados sem essa metadata mantêm a semântica anterior.
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

    // Defense in depth: a query já filtra lineage no banco, mas o boundary de similaridade também
    // rejeita qualquer linha inesperada. Chunks governados incompletos/inativos também ficam fora.
    const eligibleChunks = currentSpaceChunks.filter((chunk) => {
      const compatible = chunk.embeddingModel === EMBEDDING_MODEL
        && chunk.embeddingDimensions === EMBEDDING_DIM;
      if (!compatible) {
        console.warn(`[RAG] incompatible_chunk_lineage chunkId=${chunk.id}`);
        return false;
      }

      const governed = readGovernedChunkMetadata(chunk.metadata);
      if (governed && !governed.activeReference) {
        console.warn(`[RAG] inactive_governed_chunk chunkId=${chunk.id}`);
        return false;
      }
      return true;
    });

    if (eligibleChunks.length === 0) {
      console.warn(
        `[RAG] current_vector_space_empty model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM} lawFilterCount=${lawNames?.length ?? 0}`,
      );
      return [];
    }

    const queryEmbedding = await generateEmbedding(query);

    const chunksWithSimilarity = eligibleChunks.flatMap((chunk) => {
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

      const governed = readGovernedChunkMetadata(chunk.metadata);
      return [{
        content: chunk.content,
        articleNumber: chunk.articleNumber,
        similarity: cosineSimilarity(queryEmbedding, parsed),
        ...(governed
          ? {
              contentKind: governed.contentKind,
              canonicalLocator: governed.canonicalLocator,
              sourceIdentifier: governed.sourceIdentifier,
              sourceUrl: governed.sourceUrl,
            }
          : {}),
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
 * Resumos governados são rotulados explicitamente como RESUMO, nunca como transcrição literal.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  return chunks
    .map((chunk, index) => {
      const article = chunk.articleNumber ? `[${chunk.articleNumber}]` : "";
      const similarity = `(${(chunk.similarity * 100).toFixed(1)}% relevância)`;

      if (chunk.contentKind === GOVERNED_LAW_CONTENT_KIND) {
        const source = chunk.sourceIdentifier
          ? `\nFonte oficial identificada: ${chunk.sourceIdentifier}${chunk.sourceUrl ? ` — ${chunk.sourceUrl}` : ""}`
          : "";
        const locator = chunk.canonicalLocator ? `\nLocator: ${chunk.canonicalLocator}` : "";
        return `### Referência Jurídica Governada ${index + 1} ${article} ${similarity}`
          + `\nNatureza: resumo verificado para enquadramento; NÃO é transcrição literal da norma.`
          + `${source}${locator}\nResumo: ${chunk.content}`;
      }

      return `### Trecho Relevante ${index + 1} ${article} ${similarity}\n${chunk.content}`;
    })
    .join("\n\n");
}
