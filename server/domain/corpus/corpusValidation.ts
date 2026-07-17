/**
 * RC-4.5.1 — Institutional Corpus Framework · Validation.
 *
 * validateCorpusFramework(): corpora válidos, coleções válidas (sempre dentro de um corpus),
 * hierarquia sem ciclos, vínculos consistentes (multi-tenant), versionamento consistente.
 * Determinística.
 */

import type { CorpusFramework } from "./corpusFramework";
import { isValidCorpus } from "./institutionalCorpus";
import { isValidCollection } from "./knowledgeCollection";
import { hasHierarchyCycle } from "./corpusHierarchy";
import { buildCorpusVersionChains, isCorpusVersionChainConsistent } from "./corpusVersion";

export interface CorpusValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateCorpusFramework(framework: CorpusFramework): CorpusValidation {
  const errors: string[] = [];
  const corpusIds = new Set<string>();

  for (const c of framework.corpora) {
    if (corpusIds.has(c.id)) errors.push(`corpus com id duplicado: ${c.id}`);
    corpusIds.add(c.id);
    if (!isValidCorpus(c)) errors.push(`corpus inválido (tipo/tenant/versão/nome/owner): ${c.id}`);
    if (c.parentId && !framework.corpora.some(p => p.id === c.parentId)) errors.push(`corpus ${c.id}: pai inexistente ${c.parentId}`);
    if (c.parentId) {
      const parent = framework.corpora.find(p => p.id === c.parentId);
      if (parent && parent.tenantId !== c.tenantId) errors.push(`corpus ${c.id}: pai em outro tenant (isolamento violado)`);
    }
  }

  if (hasHierarchyCycle(framework.corpora)) errors.push("ciclo detectado na hierarquia de corpora");

  // Coleções: sempre dentro de um corpus existente (nunca soltas no sistema), mesmo tenant.
  const collectionIds = new Set<string>();
  for (const col of framework.collections) {
    if (collectionIds.has(col.id)) errors.push(`coleção com id duplicado: ${col.id}`);
    collectionIds.add(col.id);
    if (!isValidCollection(col)) errors.push(`coleção inválida: ${col.id}`);
    const owner = framework.corpora.find(c => c.id === col.corpusId);
    if (!owner) errors.push(`coleção ${col.id}: corpus inexistente ${col.corpusId}`);
    else if (owner.tenantId !== col.tenantId) errors.push(`coleção ${col.id}: tenant divergente do corpus`);
  }

  // Vínculos de conhecimento: coleção e corpus existentes; multi-tenant consistente.
  for (const l of framework.links) {
    if (!corpusIds.has(l.corpusId)) errors.push(`vínculo ${l.id}: corpus inexistente ${l.corpusId}`);
    if (!collectionIds.has(l.collectionId)) errors.push(`vínculo ${l.id}: coleção inexistente ${l.collectionId}`);
    const col = framework.collections.find(c => c.id === l.collectionId);
    if (col && col.corpusId !== l.corpusId) errors.push(`vínculo ${l.id}: coleção não pertence ao corpus`);
    if (col && col.tenantId !== l.tenantId) errors.push(`vínculo ${l.id}: tenant divergente (isolamento violado)`);
  }

  // Versionamento consistente por linhagem.
  for (const chain of buildCorpusVersionChains(framework.corpora)) {
    if (!isCorpusVersionChainConsistent(chain)) errors.push(`cadeia de versões inconsistente na linhagem ${chain.lineageId}`);
  }

  return { valid: errors.length === 0, errors };
}
