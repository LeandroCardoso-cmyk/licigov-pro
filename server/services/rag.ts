import { getDb } from "../db";
import { lawChunks } from "../../drizzle/schema";
import { generateEmbedding, cosineSimilarity } from "./embeddings";
import { eq } from "drizzle-orm";

export interface RetrievedChunk {
  content: string;
  articleNumber: string | null;
  similarity: number;
}

/**
 * Busca trechos relevantes da Lei 14.133/21 baseado em uma query
 * @param query - Texto da consulta
 * @param topK - Número de chunks mais relevantes a retornar (padrão: 5)
 * @returns Array de chunks ordenados por relevância
 */
export async function retrieveRelevantLaw(
  query: string,
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[RAG] Database not available");
    return [];
  }
  
  try {
    // 1. Gerar embedding da query
    const queryEmbedding = await generateEmbedding(query);
    
    // 2. Buscar todos os chunks da Lei 14.133/21
    const allChunks = await db
      .select()
      .from(lawChunks)
      .where(eq(lawChunks.lawName, "Lei 14.133/21"));
    
    if (allChunks.length === 0) {
      console.warn("[RAG] Nenhum chunk da Lei 14.133/21 encontrado no banco");
      return [];
    }
    
    // 3. Calcular similaridade para cada chunk
    const chunksWithSimilarity = allChunks.map((chunk) => {
      try {
        const chunkEmbedding = JSON.parse(chunk.embedding as string);
        const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
        
        return {
          content: chunk.content,
          articleNumber: chunk.articleNumber,
          similarity,
        };
      } catch (error) {
        console.error(`[RAG] Erro ao processar chunk ${chunk.id}:`, error);
        return {
          content: chunk.content,
          articleNumber: chunk.articleNumber,
          similarity: 0,
        };
      }
    });
    
    // 4. Ordenar por similaridade e retornar top-K
    return chunksWithSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  } catch (error) {
    console.error("[RAG] Erro ao recuperar trechos relevantes:", error);
    return [];
  }
}

/**
 * Formata chunks recuperados em contexto legal para o prompt
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }
  
  return chunks
    .map((chunk, i) => {
      const article = chunk.articleNumber ? `[${chunk.articleNumber}]` : "";
      const similarity = `(${(chunk.similarity * 100).toFixed(1)}% relevância)`;
      return `### Trecho Relevante ${i + 1} ${article} ${similarity}\n${chunk.content}`;
    })
    .join("\n\n");
}
