import { GoogleGenerativeAI } from "@google/generative-ai";
import { ENV } from "../_core/env";
import { createHash } from "crypto";
import { getDb } from "../db";
import { embeddingCache } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const genAI = new GoogleGenerativeAI(ENV.geminiApiKey);

/**
 * Gera hash SHA-256 de um texto
 */
function hashText(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Gera embedding para um texto usando Google Gemini text-embedding-004
 * Usa cache para evitar gerar embeddings duplicados
 */
export async function generateEmbedding(text: string, useCache: boolean = true): Promise<number[]> {
  const db = await getDb();
  const textHash = hashText(text);
  
  // 1. Tentar buscar no cache
  if (useCache && db) {
    try {
      const cached = await db
        .select()
        .from(embeddingCache)
        .where(eq(embeddingCache.textHash, textHash))
        .limit(1);
      
      if (cached.length > 0) {
        // Atualizar hitCount e lastUsedAt
        await db
          .update(embeddingCache)
          .set({
            hitCount: cached[0].hitCount + 1,
            lastUsedAt: new Date(),
          })
          .where(eq(embeddingCache.id, cached[0].id));
        
        return cached[0].embedding as number[];
      }
    } catch (error) {
      console.warn("Erro ao buscar cache de embedding:", error);
      // Continua para gerar novo embedding
    }
  }
  
  // 2. Gerar novo embedding
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    const embedding = result.embedding.values;
    
    // 3. Salvar no cache
    if (useCache && db) {
      try {
        await db.insert(embeddingCache).values({
          textHash,
          text: text.substring(0, 1000), // Salvar apenas primeiros 1000 chars para debug
          embedding: embedding as any,
          model: "text-embedding-004",
          hitCount: 0,
          lastUsedAt: new Date(),
        });
      } catch (error) {
        console.warn("Erro ao salvar cache de embedding:", error);
        // Não falha se não conseguir salvar no cache
      }
    }
    
    return embedding;
  } catch (error) {
    console.error("Erro ao gerar embedding:", error);
    throw new Error("Falha ao gerar embedding");
  }
}

/**
 * Gera embeddings para múltiplos textos em paralelo
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const embeddings = await Promise.all(texts.map(text => generateEmbedding(text)));
    return embeddings;
  } catch (error) {
    console.error("Erro ao gerar embeddings em lote:", error);
    throw new Error("Falha ao gerar embeddings em lote");
  }
}

/**
 * Calcula similaridade de cosseno entre dois vetores
 * Retorna valor entre -1 e 1, onde 1 significa vetores idênticos
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vetores devem ter o mesmo tamanho");
  }
  
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}
