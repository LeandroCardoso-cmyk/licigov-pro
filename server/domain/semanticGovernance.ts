import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

export interface SemanticGovernancePolicy {
  readonly id: string;
  readonly organizationId: number;
  readonly policyName: string;
  readonly maxChunksPerCorpus: number;
  readonly maxEmbeddingsPerDay: number;
  readonly maxRetrievalsPerDay: number;
  readonly maxTokenBudgetPerDay: number;
  readonly retentionDays: number;
  readonly allowedCorpusTypes: string[];
  readonly requireApprovalForReindex: boolean;
  readonly allowedEmbeddingProviders: string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GovernanceEnforcementResult {
  readonly allowed: boolean;
  readonly violations: string[];
  readonly requiresApproval: boolean;
  readonly quotaRemaining: { chunks: number; embeddings: number; retrievals: number; tokens: number };
}

export function createGovernancePolicy(params: {
  organizationId: number;
  policyName: string;
  maxChunksPerCorpus?: number;
  maxEmbeddingsPerDay?: number;
  maxRetrievalsPerDay?: number;
  maxTokenBudgetPerDay?: number;
  retentionDays?: number;
  allowedCorpusTypes?: string[];
  requireApprovalForReindex?: boolean;
  allowedEmbeddingProviders?: string[];
}): SemanticGovernancePolicy {
  const now = new Date().toISOString();
  const id = sha256(`sgp:${params.organizationId}:${params.policyName}:${now}`).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    policyName: params.policyName,
    maxChunksPerCorpus: params.maxChunksPerCorpus ?? 10000,
    maxEmbeddingsPerDay: params.maxEmbeddingsPerDay ?? 5000,
    maxRetrievalsPerDay: params.maxRetrievalsPerDay ?? 10000,
    maxTokenBudgetPerDay: params.maxTokenBudgetPerDay ?? 500000,
    retentionDays: params.retentionDays ?? 365,
    allowedCorpusTypes: params.allowedCorpusTypes ?? ["legal_base", "jurisprudence", "institutional", "templates", "custom"],
    requireApprovalForReindex: params.requireApprovalForReindex ?? true,
    allowedEmbeddingProviders: params.allowedEmbeddingProviders ?? ["mock", "openai", "gemini"],
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function enforceGovernance(
  policy: SemanticGovernancePolicy,
  usage: { chunksToday: number; embeddingsToday: number; retrievalsToday: number; tokensToday: number },
  request: { operation: string; corpusType?: string; provider?: string; isReindex?: boolean },
): GovernanceEnforcementResult {
  const violations: string[] = [];
  let requiresApproval = false;

  if (usage.embeddingsToday >= policy.maxEmbeddingsPerDay) violations.push(`Embedding daily limit exceeded: ${usage.embeddingsToday}/${policy.maxEmbeddingsPerDay}`);
  if (usage.retrievalsToday >= policy.maxRetrievalsPerDay) violations.push(`Retrieval daily limit exceeded: ${usage.retrievalsToday}/${policy.maxRetrievalsPerDay}`);
  if (usage.tokensToday >= policy.maxTokenBudgetPerDay) violations.push(`Token budget exceeded: ${usage.tokensToday}/${policy.maxTokenBudgetPerDay}`);
  if (request.corpusType && !policy.allowedCorpusTypes.includes(request.corpusType)) violations.push(`Corpus type not allowed: ${request.corpusType}`);
  if (request.provider && !policy.allowedEmbeddingProviders.includes(request.provider)) violations.push(`Embedding provider not allowed: ${request.provider}`);
  if (request.isReindex && policy.requireApprovalForReindex) requiresApproval = true;

  return {
    allowed: violations.length === 0,
    violations,
    requiresApproval,
    quotaRemaining: {
      chunks: Math.max(0, policy.maxChunksPerCorpus - usage.chunksToday),
      embeddings: Math.max(0, policy.maxEmbeddingsPerDay - usage.embeddingsToday),
      retrievals: Math.max(0, policy.maxRetrievalsPerDay - usage.retrievalsToday),
      tokens: Math.max(0, policy.maxTokenBudgetPerDay - usage.tokensToday),
    },
  };
}

export function isRetentionExpired(createdAt: string, retentionDays: number): boolean {
  const age = Date.now() - new Date(createdAt).getTime();
  return age > retentionDays * 24 * 60 * 60 * 1000;
}

export function deactivatePolicy(policy: SemanticGovernancePolicy): SemanticGovernancePolicy {
  return { ...policy, active: false, updatedAt: new Date().toISOString() };
}
