/**
 * RC-4.7 — Institutional Knowledge Framework · Renderer (Part 4).
 *
 * Renderer institucional: transforma um KnowledgeDocument em 6 visões estruturadas
 * (Institutional, Copilot, Explainability, Audit, Review, Export). Determinístico. SEM React —
 * produz estruturas de dados; a UI definitiva é responsabilidade de outra camada.
 */

import type { KnowledgeDocument } from "./knowledgeDocument";
import { allBlocks } from "./knowledgeDocument";
import type { KnowledgeBlock, KnowledgeBlockKind } from "./knowledgeBlocks";
import { computeQuality } from "./knowledgeQuality";

export type KnowledgeView = "institutional" | "copilot" | "explainability" | "audit" | "review" | "export";

export const ALL_VIEWS: KnowledgeView[] = ["institutional", "copilot", "explainability", "audit", "review", "export"];

export interface RenderedBlock {
  readonly id: string;
  readonly kind: KnowledgeBlockKind;
  readonly title: string;
  readonly text: string;
}
export interface RenderedKnowledge {
  readonly view: KnowledgeView;
  readonly docId: string;
  readonly title: string;
  readonly semver: string;
  readonly lifecycleState: string;
  readonly blocks: readonly RenderedBlock[];
  readonly meta: Record<string, unknown>;
}

/** Blocos priorizados/filtrados por visão (determinístico). */
const VIEW_KINDS: Record<KnowledgeView, KnowledgeBlockKind[] | "all"> = {
  institutional: "all",
  copilot: ["ExecutiveSummary", "PlainLanguage", "PracticalInterpretation", "Checklist", "FAQ", "Example"],
  explainability: ["Explainability", "CrossReference", "RelatedNorms", "RelatedKnowledge", "RelatedDocument"],
  audit: ["OfficialText", "Explainability", "FutureUpdate", "Observations"],
  review: ["OfficialText", "Requirements", "Restrictions", "Exception", "Risk", "Observations"],
  export: "all",
};

function renderBlock(b: KnowledgeBlock): RenderedBlock {
  return { id: b.id, kind: b.kind, title: b.title, text: b.fragments.map(f => f.text).join("\n") };
}

/** Renderiza o documento na visão solicitada. Determinístico. */
export function renderKnowledge(doc: KnowledgeDocument, view: KnowledgeView): RenderedKnowledge {
  const kinds = VIEW_KINDS[view];
  const blocks = allBlocks(doc)
    .filter(b => kinds === "all" || kinds.includes(b.kind))
    .map(renderBlock);

  const meta: Record<string, unknown> = { revision: doc.revision, lineageId: doc.lineageId };
  if (view === "audit" || view === "review") {
    const q = computeQuality(doc);
    meta.quality = { health: q.health.status, healthScore: q.health.score, completeness: q.completeness.score };
    meta.updatedAt = doc.updatedAt;
  }
  if (view === "export") meta.replayHash = doc.replayHash;

  return {
    view, docId: doc.id, title: doc.title, semver: doc.semver, lifecycleState: doc.lifecycleState, blocks, meta,
  };
}

/** Renderiza todas as visões (mapa determinístico). */
export function renderAllViews(doc: KnowledgeDocument): Record<KnowledgeView, RenderedKnowledge> {
  const out = {} as Record<KnowledgeView, RenderedKnowledge>;
  for (const v of ALL_VIEWS) out[v] = renderKnowledge(doc, v);
  return out;
}
