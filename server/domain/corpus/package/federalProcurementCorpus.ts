/**
 * RC-4.6 — Federal Procurement Corpus Package · Federal Procurement Corpus.
 *
 * O PRIMEIRO pacote oficial do sistema: o Corpus Federal de Licitações. Estrutura instalável
 * (manifesto + 5 coleções vazias) — SEM conteúdo jurídico. Determinístico, multi-tenant.
 */

import { createCorpusManifest, type CorpusManifest } from "./corpusManifest";
import { createCorpusPackage, type CorpusPackage } from "./corpusPackage";
import { buildFederalCollections } from "./federalCollections";

export const FEDERAL_PROCUREMENT_CORPUS_NAME = "Federal Procurement Corpus";
export const FEDERAL_PROCUREMENT_CORPUS_VERSION = "1.0.0";

/** Compatibilidade padrão do pacote federal. */
export const FEDERAL_COMPATIBILITY = {
  platform: "0.12.0",
  corpusFramework: "1.0.0",
  schema: "1.0.0",
} as const;

/** Constrói o manifesto do Corpus Federal de Licitações. Determinístico. */
export function buildFederalProcurementManifest(tenantId: number, collectionIds: string[]): CorpusManifest {
  return createCorpusManifest({
    tenantId,
    name: FEDERAL_PROCUREMENT_CORPUS_NAME,
    description: "Corpus oficial (estrutura instalável) das contratações públicas federais. Sem conteúdo jurídico nesta versão.",
    authority: "Governo Federal",
    jurisdiction: "federal",
    language: "pt-BR",
    scope: "uniao",
    version: FEDERAL_PROCUREMENT_CORPUS_VERSION,
    compatibility: { ...FEDERAL_COMPATIBILITY },
    dependencies: [],
    collections: collectionIds,
    metadata: { official: true, contentIncluded: false },
  });
}

/**
 * Constrói o pacote completo do Corpus Federal de Licitações (manifesto + coleções vazias).
 * Determinístico. NÃO contém conteúdo jurídico.
 */
export function buildFederalProcurementCorpus(tenantId: number, createdAt?: string): CorpusPackage {
  const collections = buildFederalCollections(tenantId);
  const manifest = buildFederalProcurementManifest(tenantId, collections.map(c => c.id));
  return createCorpusPackage({ tenantId, manifest, collections, lifecycle: "registered", createdAt });
}
