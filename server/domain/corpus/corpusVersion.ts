/**
 * RC-4.5.1 — Institutional Corpus Framework · Versionamento & Ciclo de vida (Part 9).
 *
 * Cada Corpus evolui SEM perder histórico (append-only, nunca sobrescreve): Version, Evolution,
 * Lifecycle, Activation, Deprecation. Determinístico. VersionChain agrupa versões por linhagem.
 */

import { createInstitutionalCorpus, type InstitutionalCorpus, type CorpusStatus, type CreateInstitutionalCorpusParams } from "./institutionalCorpus";

export interface CorpusVersion {
  readonly corpusId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly status: CorpusStatus;
  readonly replayHash: string;
  readonly createdAt: string;
}

export interface CorpusVersionChain {
  readonly lineageId: string;
  readonly versions: readonly CorpusVersion[];
}

export function toCorpusVersion(c: InstitutionalCorpus): CorpusVersion {
  return { corpusId: c.id, lineageId: c.lineageId, version: c.version, status: c.status, replayHash: c.replayHash, createdAt: c.createdAt };
}

/** Agrupa corpora em cadeias de versão por linhagem (ordenadas por versão). Append-only. */
export function buildCorpusVersionChains(corpora: readonly InstitutionalCorpus[]): CorpusVersionChain[] {
  const byLineage = new Map<string, CorpusVersion[]>();
  for (const c of corpora) {
    const arr = byLineage.get(c.lineageId) ?? [];
    arr.push(toCorpusVersion(c));
    byLineage.set(c.lineageId, arr);
  }
  return [...byLineage.entries()]
    .map(([lineageId, versions]) => ({ lineageId, versions: [...versions].sort((a, b) => a.version - b.version) }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
}

export function latestCorpusVersion(chain: CorpusVersionChain): CorpusVersion | null {
  return chain.versions.length ? chain.versions[chain.versions.length - 1] : null;
}

/** Consistência: versões sequenciais sem lacunas por linhagem. */
export function isCorpusVersionChainConsistent(chain: CorpusVersionChain): boolean {
  return chain.versions.every((v, i) => v.version === i + 1);
}

type CorpusChange = Partial<Omit<CreateInstitutionalCorpusParams, "tenantId" | "type" | "owner" | "name" | "version">>;

/** Gera a PRÓXIMA versão de um corpus, preservando a linhagem. Nunca altera o anterior. */
export function evolveCorpus(previous: InstitutionalCorpus, changes: CorpusChange = {}, updatedAt?: string): InstitutionalCorpus {
  return createInstitutionalCorpus({
    tenantId: previous.tenantId, type: previous.type, owner: previous.owner, name: previous.name,
    description: changes.description ?? previous.description, scope: changes.scope ?? previous.scope,
    jurisdiction: changes.jurisdiction ?? previous.jurisdiction, parentId: changes.parentId ?? previous.parentId,
    status: changes.status ?? previous.status, language: changes.language ?? previous.language,
    metadata: changes.metadata ?? previous.metadata,
    version: previous.version + 1, createdAt: previous.createdAt, updatedAt: updatedAt ?? previous.updatedAt,
  });
}

/** Ativa um corpus (nova versão com status "active"). */
export function activateCorpus(previous: InstitutionalCorpus, updatedAt?: string): InstitutionalCorpus {
  return evolveCorpus(previous, { status: "active" }, updatedAt);
}

/** Deprecia um corpus (nova versão com status "deprecated"). */
export function deprecateCorpus(previous: InstitutionalCorpus, updatedAt?: string): InstitutionalCorpus {
  return evolveCorpus(previous, { status: "deprecated" }, updatedAt);
}

/** Arquiva um corpus (nova versão com status "archived"). */
export function archiveCorpus(previous: InstitutionalCorpus, updatedAt?: string): InstitutionalCorpus {
  return evolveCorpus(previous, { status: "archived" }, updatedAt);
}
