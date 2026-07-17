/**
 * RC-4.7 — Institutional Knowledge Framework · Registry (Part 7).
 *
 * KnowledgeRegistry (append-only), KnowledgeResolver, KnowledgeIndex, KnowledgeCatalog e
 * KnowledgeSearchMetadata. Determinístico, multi-tenant. Sem banco.
 */

import type { KnowledgeDocument } from "./knowledgeDocument";
import { allBlocks } from "./knowledgeDocument";
import { buildRevisionChains, latestRevision, type KnowledgeRevision } from "./knowledgeVersion";

export interface KnowledgeRegistry {
  readonly documents: readonly KnowledgeDocument[];
}

export function createKnowledgeRegistry(documents: KnowledgeDocument[] = []): KnowledgeRegistry {
  const sorted = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  return { documents: sorted };
}

/** Adiciona um documento (append-only; idempotente por id). */
export function addDocument(registry: KnowledgeRegistry, doc: KnowledgeDocument): KnowledgeRegistry {
  if (registry.documents.some(d => d.id === doc.id)) return registry;
  return createKnowledgeRegistry([...registry.documents, doc]);
}

export function getDocument(registry: KnowledgeRegistry, id: string): KnowledgeDocument | null {
  return registry.documents.find(d => d.id === id) ?? null;
}

// ── Resolver ────────────────────────────────────────────────────────────────

/** Última revisão PUBLICADA de cada linhagem. Determinístico. */
export function resolvePublished(registry: KnowledgeRegistry): KnowledgeDocument[] {
  const byId = new Map(registry.documents.map(d => [d.id, d]));
  const out: KnowledgeDocument[] = [];
  for (const chain of buildRevisionChains(registry.documents)) {
    const latest = latestRevision(chain);
    const doc = latest ? byId.get(latest.docId) : null;
    if (doc && doc.lifecycleState === "published") out.push(doc);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Documentos por docKey (todas as revisões, ordenadas). */
export function resolveByKey(registry: KnowledgeRegistry, docKey: string): KnowledgeDocument[] {
  return registry.documents.filter(d => d.docKey === docKey).sort((a, b) => a.revision - b.revision);
}

/** Revisões de uma linhagem. */
export function resolveVersions(registry: KnowledgeRegistry, lineageId: string): KnowledgeRevision[] {
  const chain = buildRevisionChains(registry.documents).find(c => c.lineageId === lineageId);
  return chain ? [...chain.revisions] : [];
}

// ── Index / Catalog / Search ──────────────────────────────────────────────────

export interface KnowledgeIndex { readonly byKey: Readonly<Record<string, readonly string[]>>; }

/** Índice docKey → ids de documento (ordenado). Determinístico. */
export function buildKnowledgeIndex(registry: KnowledgeRegistry): KnowledgeIndex {
  const byKey: Record<string, string[]> = {};
  for (const d of [...registry.documents].sort((a, b) => a.id.localeCompare(b.id))) {
    (byKey[d.docKey] ??= []).push(d.id);
  }
  return { byKey };
}

export interface KnowledgeCatalogEntry {
  readonly docId: string;
  readonly docKey: string;
  readonly title: string;
  readonly semver: string;
  readonly revision: number;
  readonly lifecycleState: string;
}
export interface KnowledgeCatalog { readonly entries: readonly KnowledgeCatalogEntry[]; }

export function buildKnowledgeCatalog(registry: KnowledgeRegistry): KnowledgeCatalog {
  const entries = registry.documents
    .map(d => ({ docId: d.id, docKey: d.docKey, title: d.title, semver: d.semver, revision: d.revision, lifecycleState: d.lifecycleState }))
    .sort((a, b) => a.docId.localeCompare(b.docId));
  return { entries };
}

export interface KnowledgeSearchMetadata {
  readonly docId: string;
  readonly docKey: string;
  readonly title: string;
  readonly lifecycleState: string;
  readonly blockKinds: readonly string[];
  readonly terms: readonly string[];
}

/** Metadados de busca de um documento (determinístico). */
export function buildSearchMetadata(doc: KnowledgeDocument): KnowledgeSearchMetadata {
  const blockKinds = [...new Set(allBlocks(doc).map(b => b.kind))].sort((a, b) => a.localeCompare(b));
  const terms = [...new Set([doc.title.toLowerCase(), doc.docKey.toLowerCase(), ...blockKinds.map(k => k.toLowerCase())])].sort();
  return { docId: doc.id, docKey: doc.docKey, title: doc.title, lifecycleState: doc.lifecycleState, blockKinds, terms };
}
