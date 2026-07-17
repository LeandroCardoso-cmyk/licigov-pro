/**
 * RC-4.5.1 — Institutional Corpus Framework · Queries (Part 8).
 *
 * API DECLARATIVA de consulta sobre um CorpusFramework em memória. Nenhuma consulta depende de
 * banco. Determinística (ordenação estável). Multi-tenant (opera sobre o framework fornecido).
 */

import type { CorpusFramework } from "./corpusFramework";
import type { InstitutionalCorpus } from "./institutionalCorpus";
import type { KnowledgeCollection } from "./knowledgeCollection";
import type { CorpusKnowledgeLink } from "./corpusIntegration";

const corpusById = (f: CorpusFramework) => new Map(f.corpora.map(c => [c.id, c]));

/** Corpus por id. */
export function findCorpus(framework: CorpusFramework, corpusId: string): InstitutionalCorpus | null {
  return framework.corpora.find(c => c.id === corpusId) ?? null;
}

/** Coleções de um corpus. */
export function findCollections(framework: CorpusFramework, corpusId: string): KnowledgeCollection[] {
  return framework.collections.filter(col => col.corpusId === corpusId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Ids de conhecimento (vínculos) pertencentes a um corpus. */
export function findKnowledgeByCorpus(framework: CorpusFramework, corpusId: string): CorpusKnowledgeLink[] {
  return framework.links.filter(l => l.corpusId === corpusId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Ids de conhecimento (vínculos) pertencentes a uma coleção. */
export function findKnowledgeByCollection(framework: CorpusFramework, collectionId: string): CorpusKnowledgeLink[] {
  return framework.links.filter(l => l.collectionId === collectionId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Pais na hierarquia (ancestrais, do mais próximo ao mais distante). */
export function findCorpusParents(framework: CorpusFramework, corpusId: string): InstitutionalCorpus[] {
  const m = corpusById(framework);
  const out: InstitutionalCorpus[] = [];
  const seen = new Set<string>();
  let cur = m.get(corpusId)?.parentId ?? null;
  while (cur && m.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(m.get(cur)!);
    cur = m.get(cur)!.parentId;
  }
  return out;
}

/** Filhos diretos na hierarquia. */
export function findCorpusChildren(framework: CorpusFramework, corpusId: string): InstitutionalCorpus[] {
  return framework.corpora.filter(c => c.parentId === corpusId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Hierarquia completa: ancestrais (raiz→pai) + o próprio + filhos diretos. */
export function findCorpusHierarchy(framework: CorpusFramework, corpusId: string): InstitutionalCorpus[] {
  const self = findCorpus(framework, corpusId);
  if (!self) return [];
  return [...findCorpusParents(framework, corpusId).reverse(), self, ...findCorpusChildren(framework, corpusId)];
}

/**
 * Dependências de um corpus: corpora dos quais ele depende estruturalmente (seus ancestrais).
 * Um corpus filho depende da existência de seus pais.
 */
export function findCorpusDependencies(framework: CorpusFramework, corpusId: string): InstitutionalCorpus[] {
  return findCorpusParents(framework, corpusId);
}

/** Metadados consolidados de um corpus (estruturais — nunca conteúdo). */
export function findCorpusMetadata(framework: CorpusFramework, corpusId: string): Record<string, unknown> | null {
  const c = findCorpus(framework, corpusId);
  if (!c) return null;
  return {
    id: c.id, tenantId: c.tenantId, type: c.type, scope: c.scope, jurisdiction: c.jurisdiction,
    owner: c.owner, status: c.status, version: c.version, lineageId: c.lineageId,
    collections: findCollections(framework, corpusId).length,
    attachedKnowledge: findKnowledgeByCorpus(framework, corpusId).length,
    ...c.metadata,
  };
}
