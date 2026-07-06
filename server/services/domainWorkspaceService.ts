/**
 * Sprint 5.0.1 — Domain Workspace Service
 *
 * Cria/lança o Workspace PRÓPRIO de cada Business Domain. Cada domínio tem seu
 * workspace — nunca compartilhado. O id é determinístico por (org, domínio),
 * garantindo um único workspace por domínio por organização.
 */

import { createDomainWorkspace, type DomainWorkspace } from "../domain/domainWorkspace";
import { createBusinessDomain, type BusinessDomainCode } from "../domain/businessDomain";
import { insertDomainWorkspace, getDomainWorkspace } from "../db/businessDomains";

export async function createOrLaunchWorkspace(params: {
  organizationId: number;
  businessDomainCode: BusinessDomainCode;
  currentWorkflow?: string;
  permissions?: string[];
  correlationId: string;
}): Promise<DomainWorkspace> {
  const domain = createBusinessDomain(params.businessDomainCode);
  const ws = createDomainWorkspace({
    organizationId: params.organizationId,
    businessDomainId: domain.id,
    businessDomainCode: params.businessDomainCode,
    workspaceType: domain.workspaceType,
    currentWorkflow: params.currentWorkflow,
    permissions: params.permissions,
    correlationId: params.correlationId,
  });
  await insertDomainWorkspace(ws);
  return ws;
}

export async function loadDomainWorkspace(organizationId: number, businessDomainCode: BusinessDomainCode) {
  return getDomainWorkspace(organizationId, businessDomainCode);
}
