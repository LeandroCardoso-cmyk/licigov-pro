import { GoogleGenerativeAI } from "@google/generative-ai";
import { ENV } from "../_core/env";

const genAI = new GoogleGenerativeAI(ENV.geminiApiKey);

/**
 * Gera embedding para um texto usando Google Gemini text-embedding-004
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const result = await model.embedContent(text);
    return result.embedding.values;
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
    const embeddings = await Promise.all(texts.map(generateEmbedding));
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
