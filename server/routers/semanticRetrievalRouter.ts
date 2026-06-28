import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { chunkText, getChunks, getChunkingStats } from "../services/chunkingService";
import { generateEmbedding, batchGenerateEmbeddings, getEmbeddings, getEmbeddingStats } from "../services/embeddingService";
import { retrieve, getRetrievalSessions, getEvidences, getRetrievalStats } from "../services/retrievalService";
import { rerank, getRerankStrategies } from "../services/rerankingService";
import { createVectorIndex, appendToIndex, searchIndex, getIndex } from "../services/vectorIndexService";
import { buildExplanation } from "../services/retrievalExplainabilityService";

export const semanticRetrievalRouter = router({
  createEmbedding: tenantProcedure
    .input(z.object({ chunkId: z.string(), text: z.string(), provider: z.string().optional(), model: z.string().optional(), correlationId: z.string() }))
    .mutation(({ input, ctx }) => generateEmbedding({ organizationId: ctx.organizationId, ...input, provider: input.provider as any })),

  retrieveContext: tenantProcedure
    .input(z.object({ queryText: z.string(), queryVector: z.array(z.number()), candidates: z.array(z.object({ chunkId: z.string(), vector: z.array(z.number()), text: z.string() })), strategy: z.enum(["vector_similarity","bm25_hybrid","weighted_retrieval","contextual_expansion"]).optional(), topK: z.number().optional(), correlationId: z.string() }))
    .mutation(({ input, ctx }) => retrieve({ organizationId: ctx.organizationId, ...input })),

  rerankResults: tenantProcedure
    .input(z.object({ retrievalSessionId: z.string(), candidates: z.array(z.object({ chunkId: z.string(), originalScore: z.number(), text: z.string() })), strategy: z.enum(["semantic","contextual","legal_priority","workflow_aware"]), queryContext: z.string().optional() }))
    .mutation(({ input, ctx }) => rerank({ organizationId: ctx.organizationId, ...input })),

  getRetrievalTrace: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input, ctx }) => {
      const session = getRetrievalSessions(ctx.organizationId).find(s => s.id === input.sessionId);
      if (!session) return null;
      const evidences = getEvidences(ctx.organizationId, input.sessionId);
      return buildExplanation(session, evidences);
    }),

  getChunkLineage: tenantProcedure
    .input(z.object({ documentId: z.string().optional() }))
    .query(({ input, ctx }) => getChunks(ctx.organizationId, input.documentId)),

  replayRetrieval: tenantProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input, ctx }) => {
      const session = getRetrievalSessions(ctx.organizationId).find(s => s.id === input.sessionId);
      return session ?? null;
    }),

  getEmbeddingAnalytics: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getEmbeddingStats(ctx.organizationId)),

  getCorpusHealth: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => ({ chunks: getChunkingStats(ctx.organizationId), embeddings: getEmbeddingStats(ctx.organizationId), retrievals: getRetrievalStats(ctx.organizationId) })),

  simulateRetrieval: tenantProcedure
    .input(z.object({ queryText: z.string(), strategy: z.enum(["vector_similarity","bm25_hybrid","weighted_retrieval","contextual_expansion"]).optional() }))
    .query(({ input }) => ({ queryText: input.queryText, strategy: input.strategy ?? "vector_similarity", simulated: true, note: "Use retrieveContext mutation for real retrieval" })),

  rebuildIndex: tenantProcedure
    .input(z.object({ corpusId: z.string(), embeddingVersion: z.string().optional() }))
    .mutation(({ input, ctx }) => createVectorIndex({ organizationId: ctx.organizationId, corpusId: input.corpusId, embeddingVersion: input.embeddingVersion })),
});
