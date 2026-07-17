/**
 * RC-4.5.1 — Institutional Corpus Framework · Explainability (Part 10).
 *
 * Todo Corpus se EXPLICA: origem, responsável, escopo, abrangência, hierarquia, dependências,
 * coleções e versões. Nunca retorna apenas dados; nunca existe informação implícita.
 * Determinístico.
 */

import type { CorpusFramework } from "./corpusFramework";
import type { InstitutionalCorpus } from "./institutionalCorpus";
import { getCorpusType } from "./corpusTypes";
import { findCollections, findKnowledgeByCorpus, findCorpusParents, findCorpusChildren, findCorpusDependencies } from "./corpusQueries";
import { buildCorpusVersionChains } from "./corpusVersion";

export interface CorpusExplanation {
  readonly corpusId: string;
  readonly origin: { readonly owner: string; readonly type: string; readonly jurisdiction: string; readonly status: string };
  readonly scope: string;
  readonly breadth: { readonly nature: string; readonly level: number };
  readonly hierarchy: { readonly parents: readonly string[]; readonly children: readonly string[] };
  readonly dependencies: readonly string[];
  readonly collections: readonly { readonly id: string; readonly name: string; readonly members: number }[];
  readonly attachedKnowledge: readonly string[];
  readonly versions: readonly number[];
  readonly summary: string;
}

/** Explica um corpus dentro do framework. Sempre estruturado — nunca só dados. */
export function explainCorpus(framework: CorpusFramework, corpus: InstitutionalCorpus): CorpusExplanation {
  const type = getCorpusType(corpus.type);
  const chain = buildCorpusVersionChains(framework.corpora).find(c => c.lineageId === corpus.lineageId);
  return {
    corpusId: corpus.id,
    origin: { owner: corpus.owner, type: corpus.type, jurisdiction: corpus.jurisdiction, status: corpus.status },
    scope: corpus.scope,
    breadth: { nature: type.nature, level: type.breadth },
    hierarchy: {
      parents: findCorpusParents(framework, corpus.id).map(c => c.id),
      children: findCorpusChildren(framework, corpus.id).map(c => c.id),
    },
    dependencies: findCorpusDependencies(framework, corpus.id).map(c => c.id),
    collections: findCollections(framework, corpus.id).map(col => ({ id: col.id, name: col.name, members: col.members.length })),
    attachedKnowledge: findKnowledgeByCorpus(framework, corpus.id).map(l => l.unitId),
    versions: (chain?.versions ?? []).map(v => v.version),
    summary: `Corpus ${type.name} (${corpus.status}), escopo ${corpus.scope}, responsável ${corpus.owner}, versão ${corpus.version}.`,
  };
}
