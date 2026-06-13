import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface ProviderPolicy {
  readonly id: string;
  readonly organizationId: number;
  readonly policyName: string;
  readonly allowedProviders: string[]; // providerType strings
  readonly blockedModels: string[];
  readonly maxTokensPerExecution: number;
  readonly maxCostPerExecution: number;
  readonly dailyCostLimit: number;
  readonly approvalThreshold: number;
  readonly requiresHumanApproval: boolean;
  readonly restrictedCapabilities: string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export function createPolicy(params: {
  organizationId: number;
  policyName: string;
  allowedProviders?: string[];
  blockedModels?: string[];
  maxTokensPerExecution?: number;
  maxCostPerExecution?: number;
  dailyCostLimit?: number;
  approvalThreshold?: number;
  requiresHumanApproval?: boolean;
  restrictedCapabilities?: string[];
}): ProviderPolicy {
  const now = new Date().toISOString();
  const id = sha256(`policy:${params.organizationId}:${params.policyName}`).slice(0,20);
  return {
    id,
    organizationId: params.organizationId,
    policyName: params.policyName,
    allowedProviders: params.allowedProviders ?? ["openai","claude","gemini","mock"],
    blockedModels: params.blockedModels ?? [],
    maxTokensPerExecution: params.maxTokensPerExecution ?? 100000,
    maxCostPerExecution: params.maxCostPerExecution ?? 10.0,
    dailyCostLimit: params.dailyCostLimit ?? 100.0,
    approvalThreshold: params.approvalThreshold ?? 5.0,
    requiresHumanApproval: params.requiresHumanApproval ?? false,
    restrictedCapabilities: params.restrictedCapabilities ?? [],
    active: true,
    createdAt: now,
  };
}

export function validateExecution(policy: ProviderPolicy, params: {
  providerType: string;
  model: string;
  estimatedTokens: number;
  estimatedCost: number;
  capability: string;
}): string[] {
  const violations: string[] = [];
  if (!policy.allowedProviders.includes(params.providerType)) violations.push(`Provider '${params.providerType}' não permitido por ${policy.policyName}`);
  if (policy.blockedModels.includes(params.model)) violations.push(`Modelo '${params.model}' bloqueado por ${policy.policyName}`);
  if (params.estimatedTokens > policy.maxTokensPerExecution) violations.push(`Tokens (${params.estimatedTokens}) excedem limite de ${policy.maxTokensPerExecution}`);
  if (params.estimatedCost > policy.maxCostPerExecution) violations.push(`Custo estimado (${params.estimatedCost}) excede limite de ${policy.maxCostPerExecution}`);
  if (policy.restrictedCapabilities.includes(params.capability)) violations.push(`Capability '${params.capability}' restrita por ${policy.policyName}`);
  return violations;
}

export function requiresApproval(policy: ProviderPolicy, estimatedCost: number): boolean {
  return estimatedCost > policy.approvalThreshold || policy.requiresHumanApproval;
}

export function isCapabilityAllowed(policy: ProviderPolicy, capability: string): boolean {
  return !policy.restrictedCapabilities.includes(capability);
}
