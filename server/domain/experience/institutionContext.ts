/**
 * RC-X.1 — Institutional Experience Framework · InstitutionContext (Part 2).
 *
 * Contexto institucional IMUTÁVEL durante a sessão. Descreve a instituição, o tenant, os corpora
 * ativos, os módulos habilitados, capacidades, permissões, workspaces e branding. NÃO contém UX
 * definitiva, IA nem conteúdo jurídico. Multi-tenant, determinístico (replayHash via sha256).
 */

import { createHash } from "crypto";

/** Tipos de tenant suportados (Part 9). */
export type TenantType = "municipio_pequeno" | "municipio_grande" | "consorcio" | "camara" | "autarquia";

/** Elemento da cadeia de resolução do contexto (auditabilidade). */
export interface ResolutionStep {
  readonly stage: string;
  readonly source: string;
  readonly detail: string;
}

export interface InstitutionBranding {
  readonly primaryColor: string;
  readonly logo: string;
  readonly displayName: string;
}

export interface InstitutionContext {
  readonly tenantId: number;
  readonly institutionId: string;
  readonly institutionName: string;
  readonly municipality: string;
  readonly state: string;
  readonly country: string;
  readonly tenantType: TenantType;
  /** Ids de corpora ativos (Institutional Corpus Framework). */
  readonly activeCorpora: readonly string[];
  /** Módulos habilitados (licenciamento — Part 8). */
  readonly enabledModules: readonly string[];
  /** Ids de capacidades contratadas. */
  readonly capabilities: readonly string[];
  /** Permissões do usuário/instituição. */
  readonly permissions: readonly string[];
  /** Ids de workspaces disponíveis. */
  readonly workspaceIds: readonly string[];
  /** Cadeia de resolução (como o contexto foi montado) — auditabilidade. */
  readonly resolutionChain: readonly ResolutionStep[];
  readonly branding: InstitutionBranding;
  readonly metadata: Record<string, unknown>;
  /** Hash determinístico dos campos estruturais (replay-safe). */
  readonly replayHash: string;
}

function computeReplayHash(c: Omit<InstitutionContext, "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: c.tenantId, institution: c.institutionId, name: c.institutionName, municipality: c.municipality,
    state: c.state, country: c.country, tenantType: c.tenantType,
    activeCorpora: [...c.activeCorpora].sort(), enabledModules: [...c.enabledModules].sort(),
    capabilities: [...c.capabilities].sort(), permissions: [...c.permissions].sort(),
    workspaceIds: [...c.workspaceIds].sort(), branding: c.branding, metadata: c.metadata,
  })).digest("hex").slice(0, 32);
}

export interface CreateInstitutionContextParams {
  tenantId: number;
  institutionId: string;
  institutionName: string;
  municipality?: string;
  state?: string;
  country?: string;
  tenantType: TenantType;
  activeCorpora?: string[];
  enabledModules?: string[];
  capabilities?: string[];
  permissions?: string[];
  workspaceIds?: string[];
  resolutionChain?: ResolutionStep[];
  branding?: Partial<InstitutionBranding>;
  metadata?: Record<string, unknown>;
}

/** Cria um contexto institucional IMUTÁVEL (congelado). Determinístico. */
export function createInstitutionContext(params: CreateInstitutionContextParams): InstitutionContext {
  const branding: InstitutionBranding = {
    primaryColor: params.branding?.primaryColor ?? "#1e3a8a",
    logo: params.branding?.logo ?? "",
    displayName: params.branding?.displayName ?? params.institutionName,
  };
  const base: Omit<InstitutionContext, "replayHash"> = {
    tenantId: params.tenantId, institutionId: params.institutionId, institutionName: params.institutionName,
    municipality: params.municipality ?? "", state: params.state ?? "", country: params.country ?? "BR",
    tenantType: params.tenantType,
    activeCorpora: Object.freeze([...(params.activeCorpora ?? [])]),
    enabledModules: Object.freeze([...(params.enabledModules ?? [])]),
    capabilities: Object.freeze([...(params.capabilities ?? [])]),
    permissions: Object.freeze([...(params.permissions ?? [])]),
    workspaceIds: Object.freeze([...(params.workspaceIds ?? [])]),
    resolutionChain: Object.freeze([...(params.resolutionChain ?? [])]),
    branding: Object.freeze(branding),
    metadata: Object.freeze({ ...(params.metadata ?? {}) }),
  };
  const replayHash = computeReplayHash(base);
  return Object.freeze({ ...base, replayHash });
}

export function isValidContext(c: InstitutionContext): boolean {
  return c.tenantId > 0 && c.institutionId.length > 0 && c.institutionName.length > 0;
}

/** Verifica se um módulo está habilitado no contexto (licenciamento). */
export function hasModule(c: InstitutionContext, moduleId: string): boolean {
  return c.enabledModules.includes(moduleId);
}
