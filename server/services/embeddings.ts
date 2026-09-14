/**
 * F-EMB1 — Infraestrutura governada de embeddings do Cognitive Kernel.
 *
 * Embeddings são um concern distinto da geração textual. Este módulo mantém um boundary
 * pequeno e observável para o Gemini Embeddings API, sem migrar o SDK usado pelos demais
 * fluxos cognitivos. A identidade do cache inclui modelo + dimensionalidade + texto
 * normalizado para impedir reutilização silenciosa de vetores de espaços distintos.
 */
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { embeddingCache } from "../../drizzle/schema";

export const EMBEDDING_MODEL = "gemini-embedding-2";
export const EMBEDDING_DIM = 768;
const EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
const EMBEDDING_TIMEOUT_MS = 20_000;

type EmbeddingApiResponse = {
  embedding?: {
    values?: unknown;
  };
};

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Cache identity versionada por espaço vetorial. Um mesmo texto em outro modelo/dimensão
 * obrigatoriamente produz uma chave diferente, permitindo coexistência/replay seguro.
 */
export function buildEmbeddingCacheKey(text: string): string {
  const identity = `${EMBEDDING_MODEL}\0${EMBEDDING_DIM}\0${normalizeText(text)}`;
  return createHash("sha256").update(identity).digest("hex");
}

/** Validação fail-closed antes de qualquer similaridade ou persistência. */
export function isValidEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === EMBEDDING_DIM
    && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

export function isCompatibleCachedEmbedding(cached: {
  model: string;
  dimensions: number;
  embedding: unknown;
}): cached is { model: string; dimensions: number; embedding: number[] } {
  return cached.model === EMBEDDING_MODEL
    && cached.dimensions === EMBEDDING_DIM
    && isValidEmbeddingVector(cached.embedding);
}

async function requestEmbedding(text: string): Promise<number[]> {
  const apiKey = ENV.geminiApiKey?.trim();
  if (!apiKey) {
    throw new Error("EMBEDDING_PROVIDER_NOT_CONFIGURED");
  }

  let response: Response;
  try {
    response = await fetch(EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIM,
      }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
  } catch {
    // Não propaga URL, headers, chave ou texto-fonte.
    throw new Error("EMBEDDING_PROVIDER_TRANSPORT_ERROR");
  }

  if (!response.ok) {
    // O status é suficiente para operação; corpo remoto pode conter conteúdo não sanitizado.
    throw new Error(`EMBEDDING_PROVIDER_HTTP_${response.status}`);
  }

  let payload: EmbeddingApiResponse;
  try {
    payload = await response.json() as EmbeddingApiResponse;
  } catch {
    throw new Error("EMBEDDING_PROVIDER_INVALID_JSON");
  }

  const vector = payload.embedding?.values;
  if (!isValidEmbeddingVector(vector)) {
    throw new Error("EMBEDDING_PROVIDER_INVALID_VECTOR");
  }
  return vector;
}

/**
 * Gera embedding textual no espaço vetorial canônico F-EMB1.
 * O cache é best-effort; falhas de cache nunca mascaram falhas do provider.
 */
export async function generateEmbedding(text: string, useCache: boolean = true): Promise<number[]> {
  if (!text.trim()) {
    throw new Error("EMBEDDING_TEXT_EMPTY");
  }

  const textHash = buildEmbeddingCacheKey(text);
  const db = useCache ? await getDb() : null;

  if (db) {
    try {
      const cached = await db
        .select()
        .from(embeddingCache)
        .where(eq(embeddingCache.textHash, textHash))
        .limit(1);

      if (cached.length > 0 && isCompatibleCachedEmbedding(cached[0])) {
        await db
          .update(embeddingCache)
          .set({
            hitCount: cached[0].hitCount + 1,
            lastUsedAt: new Date(),
          })
          .where(eq(embeddingCache.id, cached[0].id));
        return cached[0].embedding;
      }
    } catch (error) {
      const code = error instanceof Error ? error.name : "unknown";
      console.warn(`[Embeddings] cache_read_failed code=${code} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM}`);
    }
  }

  let embedding: number[];
  try {
    embedding = await requestEmbedding(text);
  } catch (error) {
    const code = error instanceof Error ? error.message : "EMBEDDING_PROVIDER_UNKNOWN_ERROR";
    console.error(`[Embeddings] generation_failed code=${code} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM}`);
    throw error;
  }

  if (db) {
    try {
      await db.insert(embeddingCache).values({
        textHash,
        text: text.substring(0, 1000),
        embedding,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIM,
        hitCount: 0,
        lastUsedAt: new Date(),
      });
    } catch (error) {
      const code = error instanceof Error ? error.name : "unknown";
      console.warn(`[Embeddings] cache_write_failed code=${code} model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIM}`);
    }
  }

  return embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map((text) => generateEmbedding(text)));
}

/**
 * Similaridade de cosseno fail-closed para vetores incompatíveis.
 * Vetores de comprimentos distintos nunca devem ser comparados.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error("EMBEDDING_VECTOR_SPACE_MISMATCH");
  }
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) {
    throw new Error("EMBEDDING_VECTOR_INVALID");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dotProduct += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
