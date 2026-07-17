/**
 * RC-4.7 — Institutional Knowledge Framework · Versionamento (Part 6).
 *
 * Append-only, immutable snapshots, versão semântica, lineage, rollback lógico e histórico de
 * revisões. Determinístico. Cada evolução gera nova revisão SEM sobrescrever a anterior.
 */

import { createKnowledgeDocument, type KnowledgeDocument, type CreateKnowledgeDocumentParams } from "./knowledgeDocument";
import type { KnowledgeLifecycleState } from "./knowledgeLifecycle";

export interface KnowledgeRevision {
  readonly docId: string;
  readonly lineageId: string;
  readonly revision: number;
  readonly semver: string;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly replayHash: string;
  readonly createdAt: string;
}

export interface KnowledgeRevisionChain {
  readonly lineageId: string;
  readonly revisions: readonly KnowledgeRevision[];
}

export function toRevision(d: KnowledgeDocument): KnowledgeRevision {
  return { docId: d.id, lineageId: d.lineageId, revision: d.revision, semver: d.semver, lifecycleState: d.lifecycleState, replayHash: d.replayHash, createdAt: d.createdAt };
}

/** Agrupa documentos em cadeias de revisão por linhagem (append-only, ordenadas). */
export function buildRevisionChains(docs: readonly KnowledgeDocument[]): KnowledgeRevisionChain[] {
  const byLineage = new Map<string, KnowledgeRevision[]>();
  for (const d of docs) {
    const arr = byLineage.get(d.lineageId) ?? [];
    arr.push(toRevision(d));
    byLineage.set(d.lineageId, arr);
  }
  return [...byLineage.entries()]
    .map(([lineageId, revisions]) => ({ lineageId, revisions: [...revisions].sort((a, b) => a.revision - b.revision) }))
    .sort((a, b) => a.lineageId.localeCompare(b.lineageId));
}

export function latestRevision(chain: KnowledgeRevisionChain): KnowledgeRevision | null {
  return chain.revisions.length ? chain.revisions[chain.revisions.length - 1] : null;
}

export function isRevisionChainConsistent(chain: KnowledgeRevisionChain): boolean {
  return chain.revisions.every((r, i) => r.revision === i + 1);
}

/** Bump semver (patch por padrão). Determinístico. */
export function bumpSemver(semver: string, level: "major" | "minor" | "patch" = "patch"): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(semver);
  if (!m) return "1.0.0";
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === "major") { maj += 1; min = 0; pat = 0; }
  else if (level === "minor") { min += 1; pat = 0; }
  else { pat += 1; }
  return `${maj}.${min}.${pat}`;
}

type DocChange = Partial<Pick<CreateKnowledgeDocumentParams, "title" | "sections" | "references" | "relationships" | "lifecycleState" | "metadata">> & { semverLevel?: "major" | "minor" | "patch" };

/** Gera a PRÓXIMA revisão (append-only), preservando linhagem e bumpando o semver. */
export function evolveDocument(previous: KnowledgeDocument, changes: DocChange = {}, updatedAt?: string): KnowledgeDocument {
  return createKnowledgeDocument({
    tenantId: previous.tenantId, docKey: previous.docKey, title: changes.title ?? previous.title,
    sections: (changes.sections ?? previous.sections) as never[], references: (changes.references ?? previous.references) as never[],
    relationships: (changes.relationships ?? previous.relationships) as never[],
    semver: bumpSemver(previous.semver, changes.semverLevel ?? "patch"),
    revision: previous.revision + 1, lifecycleState: changes.lifecycleState ?? previous.lifecycleState,
    metadata: changes.metadata ?? previous.metadata, createdAt: previous.createdAt, updatedAt,
  });
}

/**
 * Rollback LÓGICO: retorna o snapshot imutável de uma revisão anterior a partir da cadeia — sem
 * remover revisões posteriores (histórico preservado). Retorna null se a revisão não existir.
 */
export function logicalRollback(docs: readonly KnowledgeDocument[], lineageId: string, revision: number): KnowledgeDocument | null {
  return docs.find(d => d.lineageId === lineageId && d.revision === revision) ?? null;
}

/** Histórico de revisões (ordenado) de uma linhagem. */
export function revisionHistory(docs: readonly KnowledgeDocument[], lineageId: string): KnowledgeRevision[] {
  const chain = buildRevisionChains(docs).find(c => c.lineageId === lineageId);
  return chain ? [...chain.revisions] : [];
}
