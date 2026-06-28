import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import { createSemanticCorpus, updateCorpusStats, setIndexingStatus, isCorpusStale, upgradeEmbeddingVersion } from "../domain/semanticCorpus";
import { createGovernancePolicy, enforceGovernance, deactivatePolicy } from "../domain/semanticGovernance";
import { getReindexJobs, createReindexJob, approveReindexJob } from "../services/reindexOrchestrationService";
import { getChunkingStats } from "../services/chunkingService";
import { getEmbeddingStats } from "../services/embeddingService";
import { getRetrievalStats } from "../services/retrievalService";

const _corpora = new Map<number, any[]>();
const _policies = new Map<number, any[]>();

export const semanticGovernanceRouter = router({
  createCorpus: tenantProcedure
    .input(z.object({ corpusType: z.enum(["legal_base","jurisprudence","institutional","templates","custom"]), corpusName: z.string(), corpusDescription: z.string().optional(), indexingStrategy: z.enum(["full_reindex","incremental","rolling","append_only"]).optional() }))
    .mutation(({ input, ctx }) => {
      const corpus = createSemanticCorpus({ organizationId: ctx.organizationId, ...input });
      const existing = _corpora.get(ctx.organizationId) ?? [];
      _corpora.set(ctx.organizationId, [...existing, corpus]);
      return corpus;
    }),

  updateCorpus: tenantProcedure
    .input(z.object({ corpusId: z.string(), chunks: z.number(), embeddings: z.number() }))
    .mutation(({ input, ctx }) => {
      const existing = _corpora.get(ctx.organizationId) ?? [];
      const idx = existing.findIndex((c: any) => c.id === input.corpusId);
      if (idx === -1) return null;
      const updated = updateCorpusStats(existing[idx], input.chunks, input.embeddings);
      const newList = [...existing]; newList[idx] = updated;
      _corpora.set(ctx.organizationId, newList);
      return updated;
    }),

  manageRetention: tenantProcedure
    .input(z.object({ corpusId: z.string(), maxAgeDays: z.number() }))
    .query(({ input, ctx }) => {
      const existing = _corpora.get(ctx.organizationId) ?? [];
      const corpus = existing.find((c: any) => c.id === input.corpusId);
      if (!corpus) return { stale: false };
      return { stale: isCorpusStale(corpus, input.maxAgeDays * 24 * 60 * 60 * 1000) };
    }),

  manageQuotas: tenantProcedure
    .input(z.object({ policyName: z.string(), maxEmbeddingsPerDay: z.number().optional(), maxRetrievalsPerDay: z.number().optional() }))
    .mutation(({ input, ctx }) => {
      const policy = createGovernancePolicy({ organizationId: ctx.organizationId, ...input });
      const existing = _policies.get(ctx.organizationId) ?? [];
      _policies.set(ctx.organizationId, [...existing, policy]);
      return policy;
    }),

  getSemanticMetrics: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => ({ chunks: getChunkingStats(ctx.organizationId), embeddings: getEmbeddingStats(ctx.organizationId), retrievals: getRetrievalStats(ctx.organizationId) })),

  getIndexingStatus: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => {
      const corpora = _corpora.get(ctx.organizationId) ?? [];
      return corpora.map((c: any) => ({ id: c.id, name: c.corpusName, status: c.indexingStatus }));
    }),

  approveReindex: tenantProcedure
    .input(z.object({ jobId: z.string(), approvedBy: z.string() }))
    .mutation(({ input, ctx }) => approveReindexJob(ctx.organizationId, input.jobId, input.approvedBy)),

  getRetrievalLineage: tenantProcedure
    .input(z.object({}))
    .query(({ ctx }) => getReindexJobs(ctx.organizationId)),
});
