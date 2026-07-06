/**
 * Sprint 5.0.1 — Domain Navigation Service
 *
 * Responsável pela Home da plataforma (Business Domain Portal). Mostra apenas os
 * módulos licenciados e ativos para a organização. A plataforma adapta menus e
 * navegação automaticamente conforme o licenciamento. Degrada graciosamente sem DB.
 */

import { listBusinessDomains, type BusinessDomainCode } from "../domain/businessDomain";
import { listLicensedModules } from "../db/businessDomains";
import { isExpired } from "../domain/licensedModule";

export interface PortalEntry {
  readonly code: BusinessDomainCode;
  readonly name: string;
  readonly workspaceType: string;
  readonly licensed: boolean;
  readonly active: boolean;
}

/**
 * Monta o portal de domínios para a organização. Cada domínio traz seu status de
 * licenciamento; `visible` contém apenas os módulos licenciados e ativos.
 */
export async function buildPortal(organizationId: number, now: string): Promise<{ entries: PortalEntry[]; visible: PortalEntry[] }> {
  const domains = listBusinessDomains();
  const licensed = await listLicensedModules(organizationId);
  const byCode = new Map(licensed.map(m => [m.businessDomainCode, m]));

  const entries: PortalEntry[] = domains.map(d => {
    const lic = byCode.get(d.code);
    const active = lic
      ? lic.active && !isExpired(
          { id: lic.id, organizationId, businessDomainCode: d.code, plan: "trial", active: lic.active, activationDate: "", expirationDate: lic.expirationDate, licensedFeatures: [], correlationId: "", createdAt: "" },
          now,
        )
      : false;
    return {
      code: d.code,
      name: d.name,
      workspaceType: d.workspaceType,
      licensed: !!lic,
      active,
    };
  });

  return { entries, visible: entries.filter(e => e.licensed && e.active) };
}
