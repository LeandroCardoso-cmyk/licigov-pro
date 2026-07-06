/**
 * Sprint 5.0.1 — Domain Workspace
 *
 * Workspace específico de um Business Domain. Cada domínio possui seu PRÓPRIO
 * workspace — nunca compartilhado. A reutilização entre domínios ocorre
 * exclusivamente através do Kernel. Determinístico, multi-tenant.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./businessDomain";
import type { CopilotType } from "./institutionalCopilot";

export interface DomainWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly businessDomainId: string;
  readonly businessDomainCode: BusinessDomainCode;
  readonly workspaceType: string;
  readonly currentWorkflow: string;
  readonly activeCopilots: readonly CopilotType[];
  readonly activeDocuments: readonly string[];
  readonly activeTasks: readonly string[];
  readonly permissions: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createDomainWorkspace(params: {
  organizationId: number;
  businessDomainId: string;
  businessDomainCode: BusinessDomainCode;
  workspaceType: string;
  currentWorkflow?: string;
  permissions?: string[];
  correlationId: string;
  createdAt?: string;
}): DomainWorkspace {
  const id = createHash("sha256")
    .update(`dws:${params.organizationId}:${params.businessDomainCode}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    businessDomainId: params.businessDomainId,
    businessDomainCode: params.businessDomainCode,
    workspaceType: params.workspaceType,
    currentWorkflow: params.currentWorkflow ?? "",
    activeCopilots: [],
    activeDocuments: [],
    activeTasks: [],
    permissions: params.permissions ?? [],
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}
