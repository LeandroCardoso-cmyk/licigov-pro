/**
 * RC-4.7 — Institutional Knowledge Framework · Explainability (Part 10).
 *
 * Todo documento se EXPLICA: origem, estrutura, versão, relacionamentos, validações, estado,
 * lifecycle e lineage. Nunca informação implícita. Determinístico.
 */

import type { KnowledgeDocument } from "./knowledgeDocument";
import { allBlocks } from "./knowledgeDocument";
import { computeQuality, validateDocument } from "./knowledgeQuality";
import { VALID_LIFECYCLE_TRANSITIONS } from "./knowledgeLifecycle";

export interface KnowledgeExplanation {
  readonly docId: string;
  readonly origin: { readonly tenantId: number; readonly docKey: string; readonly title: string };
  readonly structure: { readonly sections: number; readonly blocks: number; readonly blockKinds: readonly string[] };
  readonly version: { readonly semver: string; readonly revision: number };
  readonly relationships: readonly string[];
  readonly references: readonly string[];
  readonly validations: { readonly valid: boolean; readonly errors: readonly string[] };
  readonly quality: { readonly health: string; readonly score: number; readonly completeness: number };
  readonly state: string;
  readonly lifecycleNext: readonly string[];
  readonly lineageId: string;
  readonly summary: string;
}

/** Explica um documento de conhecimento. Sempre estruturado — nunca só dados. */
export function explainDocument(doc: KnowledgeDocument): KnowledgeExplanation {
  const blocks = allBlocks(doc);
  const q = computeQuality(doc);
  const v = validateDocument(doc);
  return {
    docId: doc.id,
    origin: { tenantId: doc.tenantId, docKey: doc.docKey, title: doc.title },
    structure: { sections: doc.sections.length, blocks: blocks.length, blockKinds: [...new Set(blocks.map(b => b.kind))].sort((a, b) => a.localeCompare(b)) },
    version: { semver: doc.semver, revision: doc.revision },
    relationships: doc.relationships.map(r => `${r.type}:${r.target}`).sort(),
    references: doc.references.map(r => `${r.type}:${r.to}`).sort(),
    validations: v,
    quality: { health: q.health.status, score: q.health.score, completeness: q.completeness.score },
    state: doc.lifecycleState,
    lifecycleNext: [...VALID_LIFECYCLE_TRANSITIONS[doc.lifecycleState]],
    lineageId: doc.lineageId,
    summary: `Documento "${doc.title}" (${doc.docKey}) v${doc.semver} rev${doc.revision}, estado ${doc.lifecycleState}, ${blocks.length} blocos, saúde ${q.health.status}.`,
  };
}
