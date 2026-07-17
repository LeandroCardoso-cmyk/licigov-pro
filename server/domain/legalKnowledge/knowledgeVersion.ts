/**
 * RC-4.5 — Legal Knowledge Foundation · Versionamento (estrutura).
 *
 * Cada unidade jurídica evolui SEM perder histórico (append-only, nunca sobrescreve).
 * Determinístico. VersionChain agrupa versões por linhagem; KnowledgeEvolution gera a
 * próxima versão preservando a linhagem.
 */

import { createLegalKnowledgeUnit, type LegalKnowledgeUnit, type CreateLegalKnowledgeUnitParams } from "./legalKnowledgeUnit";

export interface KnowledgeVersion {
  readonly unitId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly replayHash: string;
  readonly validity: LegalKnowledgeUnit["validity"];
  readonly createdAt: string;
}

export interface VersionChain {
  readonly lineageId: string;
  readonly versions: readonly KnowledgeVersion[];
}

export function toVersion(u: LegalKnowledgeUnit): KnowledgeVersion {
  return { unitId: u.id, lineageId: u.lineageId, version: u.version, replayHash: u.replayHash, validity: u.validity, createdAt: u.createdAt };
}

/** Agrupa unidades em cadeias de versão por linhagem (ordenadas por versão). Append-only. */
export function buildVersionChains(units: readonly LegalKnowledgeUnit[]): VersionChain[] {
  const byLineage = new Map<string, KnowledgeVersion[]>();
  for (const u of units) {
    const arr = byLineage.get(u.lineageId) ?? [];
    arr.push(toVersion(u));
    byLineage.set(u.lineageId, arr);
  }
  return [...byLineage.entries()]
    .map(([lineageId, versions]) => ({ lineageId, versions: [...versions].sort((a, b) => a.version - b.version) }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
}

/** Última versão de uma linhagem. */
export function latestVersion(chain: VersionChain): KnowledgeVersion | null {
  return chain.versions.length ? chain.versions[chain.versions.length - 1] : null;
}

/**
 * KnowledgeEvolution — gera a PRÓXIMA versão de uma unidade, preservando a linhagem.
 * Nunca altera a unidade anterior (append-only).
 */
export function evolveUnit(previous: LegalKnowledgeUnit, changes: Partial<Omit<CreateLegalKnowledgeUnitParams, "tenantId" | "type" | "sourceReference" | "version">>, createdAt?: string): LegalKnowledgeUnit {
  return createLegalKnowledgeUnit({
    tenantId: previous.tenantId, type: previous.type, sourceReference: previous.sourceReference,
    title: changes.title ?? previous.title, description: changes.description ?? previous.description,
    hierarchy: changes.hierarchy ?? previous.hierarchy, jurisdiction: changes.jurisdiction ?? previous.jurisdiction,
    validity: changes.validity ?? previous.validity, effectiveDate: changes.effectiveDate ?? previous.effectiveDate,
    revokedDate: changes.revokedDate ?? previous.revokedDate, metadata: changes.metadata ?? previous.metadata,
    version: previous.version + 1, createdAt,
  });
}

/** Consistência do versionamento: versões sequenciais sem lacunas por linhagem. */
export function isVersionChainConsistent(chain: VersionChain): boolean {
  return chain.versions.every((v, i) => v.version === i + 1);
}
