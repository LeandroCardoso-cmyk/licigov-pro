/**
 * RC-4.6 — Federal Procurement Corpus Package · Federal Collections (Part 4).
 *
 * As 5 coleções OFICIAIS (VAZIAS) do Corpus Federal de Licitações: Lei 14.133, Decretos,
 * IN SEGES, AGU, TCU. NENHUM conteúdo jurídico é inserido (knowledgeUnits vazio). Apenas a
 * estrutura instalável. Determinístico, multi-tenant.
 */

import { createCollectionManifest, type CollectionManifest } from "./collectionManifest";

export const FEDERAL_COLLECTION_VERSION = "1.0.0";

/** Especificação declarativa das coleções federais (sem conteúdo). */
export const FEDERAL_COLLECTION_SPECS: readonly { name: string; category: string; authority: string; description: string }[] = [
  { name: "Lei 14.133", category: "lei", authority: "Congresso Nacional", description: "Coleção estrutural (vazia) da Lei nº 14.133/2021." },
  { name: "Decretos", category: "decreto", authority: "Presidência da República", description: "Coleção estrutural (vazia) dos decretos regulamentares federais." },
  { name: "IN SEGES", category: "instrucao_normativa", authority: "SEGES/ME", description: "Coleção estrutural (vazia) das Instruções Normativas da SEGES." },
  { name: "AGU", category: "parecer", authority: "Advocacia-Geral da União", description: "Coleção estrutural (vazia) de pareceres e orientações da AGU." },
  { name: "TCU", category: "acordao", authority: "Tribunal de Contas da União", description: "Coleção estrutural (vazia) de acórdãos e entendimentos do TCU." },
];

/**
 * Constrói as 5 coleções federais VAZIAS para uma organização. Determinístico.
 * `Decretos`, `IN SEGES`, `AGU` e `TCU` dependem estruturalmente da coleção `Lei 14.133`.
 */
export function buildFederalCollections(tenantId: number): CollectionManifest[] {
  const lei = createCollectionManifest({
    tenantId, name: "Lei 14.133", category: "lei", authority: "Congresso Nacional",
    version: FEDERAL_COLLECTION_VERSION, description: FEDERAL_COLLECTION_SPECS[0].description,
  });
  const dependents = FEDERAL_COLLECTION_SPECS.slice(1).map(spec => createCollectionManifest({
    tenantId, name: spec.name, category: spec.category, authority: spec.authority,
    version: FEDERAL_COLLECTION_VERSION, description: spec.description, dependencies: [lei.id],
  }));
  return [lei, ...dependents];
}
