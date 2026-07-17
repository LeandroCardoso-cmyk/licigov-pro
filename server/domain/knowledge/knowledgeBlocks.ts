/**
 * RC-4.7 — Institutional Knowledge Framework · Block System (Part 2).
 *
 * Sistema MODULAR de blocos cognitivos. Um documento pode combinar qualquer conjunto de blocos.
 * COMPLETAMENTE GENÉRICO — sem acoplamento com Lei 14.133/decretos/qualquer conteúdo. Determinístico.
 */

import { createHash } from "crypto";

/** Os 20 tipos oficiais de bloco cognitivo. */
export type KnowledgeBlockKind =
  | "OfficialText" | "ExecutiveSummary" | "PlainLanguage" | "PracticalInterpretation"
  | "Applicability" | "Requirements" | "Restrictions" | "Exception" | "Checklist"
  | "Workflow" | "Example" | "Risk" | "FAQ" | "CrossReference" | "RelatedNorms"
  | "RelatedKnowledge" | "RelatedDocument" | "Observations" | "FutureUpdate" | "Explainability";

export const ALL_BLOCK_KINDS: KnowledgeBlockKind[] = [
  "OfficialText", "ExecutiveSummary", "PlainLanguage", "PracticalInterpretation",
  "Applicability", "Requirements", "Restrictions", "Exception", "Checklist",
  "Workflow", "Example", "Risk", "FAQ", "CrossReference", "RelatedNorms",
  "RelatedKnowledge", "RelatedDocument", "Observations", "FutureUpdate", "Explainability",
];

export function isBlockKind(k: string): k is KnowledgeBlockKind {
  return (ALL_BLOCK_KINDS as readonly string[]).includes(k);
}

/** Fragmento atômico de um bloco (texto estrutural/genérico — nunca conteúdo jurídico). */
export interface KnowledgeFragment {
  readonly id: string;
  readonly text: string;
  readonly order: number;
  readonly metadata: Record<string, unknown>;
}

export interface KnowledgeBlock {
  readonly id: string;
  readonly kind: KnowledgeBlockKind;
  readonly title: string;
  readonly order: number;
  readonly fragments: readonly KnowledgeFragment[];
  readonly metadata: Record<string, unknown>;
}

export function createFragment(params: { blockId: string; text: string; order?: number; metadata?: Record<string, unknown> }): KnowledgeFragment {
  const order = params.order ?? 0;
  const id = createHash("sha256").update(`kfrag:${params.blockId}:${order}:${params.text}`).digest("hex").slice(0, 20);
  return { id, text: params.text, order, metadata: params.metadata ?? {} };
}

export interface CreateBlockParams {
  docKey: string;
  kind: KnowledgeBlockKind;
  title?: string;
  order?: number;
  fragments?: { text: string; metadata?: Record<string, unknown> }[];
  metadata?: Record<string, unknown>;
}

/** Cria um bloco cognitivo determinístico. */
export function createBlock(params: CreateBlockParams): KnowledgeBlock {
  const order = params.order ?? 0;
  const id = createHash("sha256").update(`kblock:${params.docKey}:${params.kind}:${order}`).digest("hex").slice(0, 20);
  const fragments = (params.fragments ?? []).map((f, i) => createFragment({ blockId: id, text: f.text, order: i, metadata: f.metadata }));
  return { id, kind: params.kind, title: params.title ?? params.kind, order, fragments, metadata: params.metadata ?? {} };
}

/** Impressão digital estrutural de um bloco (replay-safe; usada no hash do documento). */
export function blockFingerprint(block: KnowledgeBlock): string {
  return createHash("sha256").update(JSON.stringify({
    kind: block.kind, title: block.title, order: block.order,
    fragments: block.fragments.map(f => ({ text: f.text, order: f.order })),
  })).digest("hex").slice(0, 16);
}
