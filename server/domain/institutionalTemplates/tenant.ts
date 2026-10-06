/**
 * Contrato de tenant (INV-TPL-06/07/36 — CROSS_TENANT_RELATIONSHIP_MUST_BE_IMPOSSIBLE).
 *
 * O domínio não implementa FK: ele define a regra que a camada de persistência (T2) terá de garantir — por FK
 * composta, UNIQUE composto ou validação fail-closed na mesma transação (mecanismo = decisão G0/T0, HD-26).
 * Aqui: toda relação parent→child é validada por `organizationId`; divergência é sempre erro, nunca coerção.
 */
import { issue, isOrgId, type OrgId, type TemplateIssue } from "./types";

export interface OrganizationScoped {
  readonly organizationId: OrgId;
}

/** `organizationId` presente e válido (sem NULL = global; sem PLATFORM_GLOBAL). */
export function organizationIssues(entity: { readonly organizationId?: unknown }, path: string): TemplateIssue[] {
  return isOrgId(entity.organizationId)
    ? []
    : [issue("ORGANIZATION_REQUIRED", path, "organizationId obrigatório (V1 organization-only; NULL nunca significa global)")];
}

/** Relação parent→child no mesmo tenant. Qualquer divergência é CROSS_TENANT_REFERENCE. */
export function sameOrganizationIssues(parent: OrganizationScoped, child: OrganizationScoped, path: string): TemplateIssue[] {
  if (!isOrgId(parent.organizationId) || !isOrgId(child.organizationId)) {
    return [issue("ORGANIZATION_REQUIRED", path, "organizationId ausente em uma das pontas da relação")];
  }
  return parent.organizationId === child.organizationId
    ? []
    : [issue("CROSS_TENANT_REFERENCE", path, "relação entre organizações diferentes é proibida")];
}
