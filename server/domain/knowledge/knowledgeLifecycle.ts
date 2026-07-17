/**
 * RC-4.7 — Institutional Knowledge Framework · Lifecycle (Part 5).
 *
 * Estados do ciclo de vida do conhecimento e transições válidas. Replay-safe (declarativo, sem
 * tempo). Draft → Review → Approval → Publication → Deprecation → Archive.
 */

export type KnowledgeLifecycleState =
  | "draft" | "review" | "approval" | "published" | "deprecated" | "archived";

export const ALL_LIFECYCLE_STATES: KnowledgeLifecycleState[] = [
  "draft", "review", "approval", "published", "deprecated", "archived",
];

/** Transições permitidas (replay-safe). */
export const VALID_LIFECYCLE_TRANSITIONS: Record<KnowledgeLifecycleState, readonly KnowledgeLifecycleState[]> = {
  draft: ["review", "archived"],
  review: ["approval", "draft", "archived"],
  approval: ["published", "review", "archived"],
  published: ["deprecated", "archived"],
  deprecated: ["archived", "published"],
  archived: [],
};

export function canTransitionLifecycle(from: KnowledgeLifecycleState, to: KnowledgeLifecycleState): boolean {
  return VALID_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function isPublished(state: KnowledgeLifecycleState): boolean {
  return state === "published";
}

export function isTerminalLifecycle(state: KnowledgeLifecycleState): boolean {
  return state === "archived";
}
