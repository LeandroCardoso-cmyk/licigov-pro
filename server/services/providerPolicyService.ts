import { type ProviderPolicy, createPolicy, validateExecution, requiresApproval, isCapabilityAllowed } from "../domain/providerPolicy";

const _policies = new Map<number, ProviderPolicy[]>();

export function addPolicy(input: { organizationId: number; policyName: string; allowedProviders?: string[]; blockedModels?: string[]; maxTokensPerExecution?: number; maxCostPerExecution?: number; dailyCostLimit?: number; approvalThreshold?: number; requiresHumanApproval?: boolean; restrictedCapabilities?: string[] }): ProviderPolicy {
  const p = createPolicy(input);
  const existing = _policies.get(input.organizationId) ?? [];
  _policies.set(input.organizationId, [...existing, p]);
  return p;
}

export function enforcePolicy(organizationId: number, params: { providerType: string; model: string; estimatedTokens: number; estimatedCost: number; capability: string }): { allowed: boolean; violations: string[]; requiresApproval: boolean } {
  const policies = (_policies.get(organizationId) ?? []).filter(p => p.active);
  const violations: string[] = [];
  let needsApproval = false;
  for (const policy of policies) {
    violations.push(...validateExecution(policy, params));
    if (requiresApproval(policy, params.estimatedCost)) needsApproval = true;
  }
  return { allowed: violations.length === 0, violations, requiresApproval: needsApproval };
}

export function getActivePolicies(organizationId: number): ProviderPolicy[] {
  return (_policies.get(organizationId) ?? []).filter(p => p.active);
}

export function checkRequiresApproval(organizationId: number, estimatedCost: number): boolean {
  return (_policies.get(organizationId) ?? []).filter(p => p.active).some(p => requiresApproval(p, estimatedCost));
}
