/**
 * RC-4.6.2 — Knowledge Binding Framework · Versionamento (Part 4).
 *
 * Bindings evoluem SEM perder histórico (append-only, nunca sobrescreve). Determinístico.
 * BindingVersionChain agrupa versões por linhagem; evolveBinding gera a próxima versão.
 */

import { createKnowledgeBinding, type KnowledgeBinding, type BindingStatus, type KnowledgeBindingMetadata } from "./knowledgeBinding";

export interface BindingVersion {
  readonly bindingId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly status: BindingStatus;
  readonly replayHash: string;
  readonly createdAt: string;
}

export interface BindingVersionChain {
  readonly lineageId: string;
  readonly versions: readonly BindingVersion[];
}

export function toBindingVersion(b: KnowledgeBinding): BindingVersion {
  return { bindingId: b.bindingId, lineageId: b.lineageId, version: b.version, status: b.status, replayHash: b.replayHash, createdAt: b.createdAt };
}

/** Agrupa bindings em cadeias de versão por linhagem (ordenadas por versão). Append-only. */
export function buildBindingChains(bindings: readonly KnowledgeBinding[]): BindingVersionChain[] {
  const byLineage = new Map<string, BindingVersion[]>();
  for (const b of bindings) {
    const arr = byLineage.get(b.lineageId) ?? [];
    arr.push(toBindingVersion(b));
    byLineage.set(b.lineageId, arr);
  }
  return [...byLineage.entries()]
    .map(([lineageId, versions]) => ({ lineageId, versions: [...versions].sort((a, b) => a.version - b.version) }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
}

export function latestBindingVersion(chain: BindingVersionChain): BindingVersion | null {
  return chain.versions.length ? chain.versions[chain.versions.length - 1] : null;
}

export function isBindingChainConsistent(chain: BindingVersionChain): boolean {
  return chain.versions.every((v, i) => v.version === i + 1);
}

type BindingChange = { status?: BindingStatus; authority?: string; scope?: string; metadata?: KnowledgeBindingMetadata };

/**
 * Gera a PRÓXIMA versão de um binding, preservando a linhagem (mesmo nó/unidade/tipo).
 * Nunca altera o anterior (append-only).
 */
export function evolveBinding(previous: KnowledgeBinding, changes: BindingChange = {}, updatedAt?: string): KnowledgeBinding {
  return createKnowledgeBinding({
    tenantId: previous.tenantId, normativeNodeId: previous.normativeNodeId, knowledgeUnitId: previous.knowledgeUnitId,
    bindingType: previous.bindingType, authority: changes.authority ?? previous.authority, scope: changes.scope ?? previous.scope,
    status: changes.status ?? previous.status, metadata: changes.metadata ?? previous.metadata,
    version: previous.version + 1, createdAt: previous.createdAt, updatedAt: updatedAt ?? previous.updatedAt,
  });
}

/** Supersede um binding (nova versão com status "superseded"). */
export function supersedeBinding(previous: KnowledgeBinding, updatedAt?: string): KnowledgeBinding {
  return evolveBinding(previous, { status: "superseded" }, updatedAt);
}

/** Revoga um binding (nova versão com status "revoked"). */
export function revokeBinding(previous: KnowledgeBinding, updatedAt?: string): KnowledgeBinding {
  return evolveBinding(previous, { status: "revoked" }, updatedAt);
}
