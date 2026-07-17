/**
 * RC-4.5.1 — Institutional Corpus Framework · Aggregate + fixture estrutural.
 *
 * Container multi-tenant de corpora + coleções + vínculos de conhecimento. A base de exemplo é
 * ESTRUTURAL (placeholders — NENHUM corpus real / Lei 14.133 / acórdão / doutrina), usada apenas
 * para exercitar a fundação (hierarquia, integração, projeção, consultas, versionamento).
 * Determinística.
 */

import { createInstitutionalCorpus, type InstitutionalCorpus } from "./institutionalCorpus";
import { createKnowledgeCollection, type KnowledgeCollection } from "./knowledgeCollection";
import { attachLegalKnowledge, type CorpusKnowledgeLink } from "./corpusIntegration";
import { structuralSampleBase } from "../legalKnowledge/knowledgeBase";

export interface CorpusFramework {
  readonly corpora: readonly InstitutionalCorpus[];
  readonly collections: readonly KnowledgeCollection[];
  readonly links: readonly CorpusKnowledgeLink[];
}

export function createCorpusFramework(
  corpora: InstitutionalCorpus[],
  collections: KnowledgeCollection[],
  links: CorpusKnowledgeLink[] = [],
): CorpusFramework {
  return { corpora, collections, links };
}

/**
 * Framework ESTRUTURAL de exemplo (sem conteúdo institucional real) para uma organização.
 * Monta: Corpus Federal (raiz) → Corpus Estadual (filho), cada um com uma coleção, e vincula
 * unidades da base estrutural da Legal Knowledge Foundation (RC-4.5). Determinístico.
 */
export function structuralSampleFramework(tenantId: number): CorpusFramework {
  const T = "2026-01-01T00:00:00.000Z";

  const federal = createInstitutionalCorpus({
    tenantId, name: "Corpus Federal (estrutura)", type: "federal", scope: "uniao",
    jurisdiction: "federal", owner: "Departamento de Licitações", status: "active",
    createdAt: T, updatedAt: T,
  });
  const estadual = createInstitutionalCorpus({
    tenantId, name: "Corpus Estadual (estrutura)", type: "estadual", scope: "estado",
    jurisdiction: "estadual", owner: "Departamento de Licitações", parentId: federal.id, status: "active",
    createdAt: T, updatedAt: T,
  });

  const colFederal = createKnowledgeCollection({ tenantId, corpusId: federal.id, name: "Coleção Federal (estrutura)", createdAt: T });
  const colEstadual = createKnowledgeCollection({ tenantId, corpusId: estadual.id, name: "Coleção Estadual (estrutura)", createdAt: T });

  // Vincula unidades da fundação jurídica (RC-4.5) — apenas referências estruturais.
  const legalBase = structuralSampleBase(tenantId);
  const primaria = legalBase.units.find(u => u.type === "lei")!;
  const secundaria = legalBase.units.find(u => u.type === "decreto" && u.version === 1)!;

  const r1 = attachLegalKnowledge({ corpus: federal, collection: colFederal, unit: primaria, explanation: "Unidade primária pertence ao corpus federal.", createdAt: T });
  const r2 = attachLegalKnowledge({ corpus: estadual, collection: colEstadual, unit: secundaria, explanation: "Unidade secundária pertence ao corpus estadual.", createdAt: T });

  return {
    corpora: [federal, estadual],
    collections: [r1.collection, r2.collection],
    links: [r1.link, r2.link],
  };
}
