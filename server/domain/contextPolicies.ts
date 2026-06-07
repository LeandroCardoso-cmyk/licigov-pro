import { createHash } from "crypto";

import type { ContextFragment, ContextSource } from "./contextAssembly";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyType = "access" | "retention" | "masking" | "redaction" | "lgpd" | "legal" | "sensitivity";
export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted" | "secret";
export type MaskingStrategy = "full_redact" | "partial_mask" | "hash" | "tokenize" | "pseudonymize";

export interface ContextPolicy {
  id: string;
  organizationId: number;
  policyType: PolicyType;
  name: string;
  description: string;
  appliesTo: string[];
  sensitivityLevel: SensitivityLevel;
  maskingStrategy: MaskingStrategy | null;
  requiresEvidence: boolean;
  retentionMs: number | null;
  legalBasis: string | null;
  isActive: boolean;
  priority: number;
  createdBy: number;
  createdAt: string;
}

export interface PolicyApplication {
  id: string;
  organizationId: number;
  policyId: string;
  fragmentId: string;
  appliedStrategy: MaskingStrategy | null;
  originalSensitivity: SensitivityLevel;
  resultSensitivity: SensitivityLevel;
  wasRedacted: boolean;
  wasMasked: boolean;
  auditTrail: string[];
  appliedAt: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _policyStore = new Map<number, ContextPolicy[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function genId(input: string): string {
  return sha256(input).slice(0, 20);
}

// ─── Core functions ───────────────────────────────────────────────────────────

export function createPolicy(params: {
  organizationId: number;
  policyType: PolicyType;
  name: string;
  description?: string;
  appliesTo?: string[];
  sensitivityLevel?: SensitivityLevel;
  maskingStrategy?: MaskingStrategy | null;
  requiresEvidence?: boolean;
  retentionMs?: number | null;
  legalBasis?: string | null;
  isActive?: boolean;
  priority?: number;
  createdBy: number;
}): ContextPolicy {
  const now = new Date().toISOString();
  const policy: ContextPolicy = {
    id:               genId(`${params.organizationId}${params.policyType}${params.name}`),
    organizationId:   params.organizationId,
    policyType:       params.policyType,
    name:             params.name,
    description:      params.description ?? "",
    appliesTo:        params.appliesTo ?? [],
    sensitivityLevel: params.sensitivityLevel ?? "internal",
    maskingStrategy:  params.maskingStrategy ?? null,
    requiresEvidence: params.requiresEvidence ?? false,
    retentionMs:      params.retentionMs ?? null,
    legalBasis:       params.legalBasis ?? null,
    isActive:         params.isActive ?? true,
    priority:         params.priority ?? 0,
    createdBy:        params.createdBy,
    createdAt:        now,
  };

  // Persist to in-memory store
  const existing = _policyStore.get(params.organizationId) ?? [];
  _policyStore.set(params.organizationId, [...existing, policy]);

  return policy;
}

export function applyPolicy(
  policy: ContextPolicy,
  fragment: ContextFragment,
): { fragment: ContextFragment; application: PolicyApplication } {
  const now = new Date().toISOString();
  const originalSensitivity = evaluateSensitivity(fragment.content, fragment.organizationId);
  const auditTrail: string[] = [
    `[${now}] Policy '${policy.name}' (${policy.id}) applied to fragment '${fragment.id}'`,
    `[${now}] Original sensitivity: ${originalSensitivity}`,
    `[${now}] Masking strategy: ${policy.maskingStrategy ?? "none"}`,
  ];

  let newContent = fragment.content;
  let wasRedacted = false;
  let wasMasked = false;
  let resultSensitivity: SensitivityLevel = originalSensitivity;

  if (policy.maskingStrategy === "full_redact") {
    newContent = "[REDACTED]";
    wasRedacted = true;
    resultSensitivity = "public";
    auditTrail.push(`[${now}] Content fully redacted`);
  } else if (policy.maskingStrategy === "partial_mask") {
    const half = Math.ceil(fragment.content.length / 2);
    const visible = fragment.content.slice(0, fragment.content.length - half);
    const masked = "*".repeat(half);
    newContent = visible + masked;
    wasMasked = true;
    auditTrail.push(`[${now}] Content partially masked (last 50%)`);
  } else if (policy.maskingStrategy === "hash") {
    newContent = sha256(fragment.content);
    wasMasked = true;
    resultSensitivity = "internal";
    auditTrail.push(`[${now}] Content replaced with SHA-256 hash`);
  } else if (policy.maskingStrategy === "tokenize") {
    newContent = `[TOKEN:${genId(fragment.content)}]`;
    wasMasked = true;
    auditTrail.push(`[${now}] Content tokenized`);
  } else if (policy.maskingStrategy === "pseudonymize") {
    newContent = `[PSEUDO:${genId(fragment.id + fragment.content)}]`;
    wasMasked = true;
    auditTrail.push(`[${now}] Content pseudonymized`);
  }

  auditTrail.push(`[${now}] Result sensitivity: ${resultSensitivity}`);

  const updatedFragment: ContextFragment = {
    ...fragment,
    content:       newContent,
    tokenEstimate: Math.ceil(newContent.length / 4),
  };

  const applicationId = genId(`${policy.id}${fragment.id}${now}`);

  const application: PolicyApplication = {
    id:                  applicationId,
    organizationId:      fragment.organizationId,
    policyId:            policy.id,
    fragmentId:          fragment.id,
    appliedStrategy:     policy.maskingStrategy,
    originalSensitivity,
    resultSensitivity,
    wasRedacted,
    wasMasked,
    auditTrail,
    appliedAt:           now,
  };

  return { fragment: updatedFragment, application };
}

export function evaluateSensitivity(content: string, _organizationId: number): SensitivityLevel {
  const lower = content.toLowerCase();

  const restrictedKeywords = ["cpf", "cnpj", "rg", "passaporte"];
  if (restrictedKeywords.some(kw => lower.includes(kw))) {
    return "restricted";
  }

  const confidentialKeywords = ["nome", "endereço", "telefone", "email", "salário"];
  if (confidentialKeywords.some(kw => lower.includes(kw))) {
    return "confidential";
  }

  const internalKeywords = ["interno", "confidencial"];
  if (internalKeywords.some(kw => lower.includes(kw))) {
    return "internal";
  }

  return "public";
}

export function filterFragmentsByPolicy(
  fragments: ContextFragment[],
  policies: ContextPolicy[],
  role: string,
): ContextFragment[] {
  const activePolicies = policies.filter(p => p.isActive);

  return fragments
    .filter(fragment => {
      const sensitivity = evaluateSensitivity(fragment.content, fragment.organizationId);

      if (role === "auditor") {
        // Auditors see everything
        return true;
      }

      if (role === "operador") {
        // Operadores cannot see restricted or secret
        if (sensitivity === "restricted" || sensitivity === "secret") {
          return false;
        }
        return true;
      }

      // All other roles cannot see secret
      if (sensitivity === "secret") {
        return false;
      }

      return true;
    })
    .map(fragment => {
      // Apply applicable masking policies
      const applicablePolicies = activePolicies
        .filter(p => isPolicyApplicable(p, fragment))
        .sort((a, b) => b.priority - a.priority);

      let current = fragment;
      for (const policy of applicablePolicies) {
        if (policy.maskingStrategy !== null) {
          const result = applyPolicy(policy, current);
          current = result.fragment;
        }
      }
      return current;
    });
}

export function getPoliciesForOrg(organizationId: number): ContextPolicy[] {
  return _policyStore.get(organizationId) ?? [];
}

export function isPolicyApplicable(policy: ContextPolicy, fragment: ContextFragment): boolean {
  if (!policy.isActive) return false;
  if (policy.appliesTo.length === 0) return true;
  return policy.appliesTo.includes(fragment.source as string);
}
