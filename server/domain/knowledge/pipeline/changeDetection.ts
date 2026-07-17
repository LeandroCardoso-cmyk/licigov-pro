/**
 * RC-4.8 — Institutional Knowledge Pipeline · Change Detection (Fase 7).
 *
 * KnowledgeDiff, KnowledgeChangeSet, KnowledgeImpactAnalysis, KnowledgeMigrationPlan,
 * KnowledgeUpgrade e KnowledgeRollback. Determinístico. Compara documentos por bloco (fingerprint).
 * Sem conteúdo jurídico.
 */

import type { KnowledgeDocument } from "../knowledgeDocument";
import { allBlocks } from "../knowledgeDocument";
import { blockFingerprint } from "../knowledgeBlocks";

export interface KnowledgeDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

export interface KnowledgeChangeSet {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly lineageId: string;
  readonly diff: KnowledgeDiff;
}

export type ImpactSeverity = "none" | "low" | "medium" | "high";
export interface KnowledgeImpactAnalysis {
  readonly severity: ImpactSeverity;
  readonly impactedBlocks: number;
  readonly requiresRepublish: boolean;
  readonly detail: string;
}

export interface MigrationStep { readonly order: number; readonly action: "add" | "remove" | "update"; readonly blockId: string; }
export interface KnowledgeMigrationPlan { readonly steps: readonly MigrationStep[]; }

export interface KnowledgeUpgrade {
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly changeSet: KnowledgeChangeSet;
  readonly plan: KnowledgeMigrationPlan;
}

export interface KnowledgeRollback {
  readonly toRevision: number;
  readonly lineageId: string;
  readonly reason: string;
}

function blockMap(doc: KnowledgeDocument): Map<string, string> {
  return new Map(allBlocks(doc).map(b => [b.id, blockFingerprint(b)]));
}

/** Diff estrutural entre dois documentos (por bloco). Determinístico. */
export function diffDocuments(from: KnowledgeDocument, to: KnowledgeDocument): KnowledgeDiff {
  const a = blockMap(from); const b = blockMap(to);
  const added: string[] = []; const removed: string[] = []; const changed: string[] = []; const unchanged: string[] = [];
  for (const [id, fp] of b) {
    if (!a.has(id)) added.push(id);
    else if (a.get(id) !== fp) changed.push(id);
    else unchanged.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) removed.push(id);
  return {
    added: added.sort(), removed: removed.sort(), changed: changed.sort(), unchanged: unchanged.sort(),
  };
}

export function buildChangeSet(from: KnowledgeDocument, to: KnowledgeDocument): KnowledgeChangeSet {
  return { fromRevision: from.revision, toRevision: to.revision, lineageId: to.lineageId, diff: diffDocuments(from, to) };
}

/** Análise de impacto a partir de um changeset. Determinística. */
export function analyzeImpact(changeSet: KnowledgeChangeSet): KnowledgeImpactAnalysis {
  const { added, removed, changed } = changeSet.diff;
  const impacted = added.length + removed.length + changed.length;
  const severity: ImpactSeverity = impacted === 0 ? "none" : removed.length > 0 ? "high" : changed.length > 0 ? "medium" : "low";
  return { severity, impactedBlocks: impacted, requiresRepublish: impacted > 0, detail: `${added.length} adicionados, ${removed.length} removidos, ${changed.length} alterados.` };
}

/** Plano de migração determinístico a partir do diff. */
export function buildMigrationPlan(diff: KnowledgeDiff): KnowledgeMigrationPlan {
  const steps: MigrationStep[] = [];
  let order = 1;
  for (const id of diff.removed) steps.push({ order: order++, action: "remove", blockId: id });
  for (const id of diff.changed) steps.push({ order: order++, action: "update", blockId: id });
  for (const id of diff.added) steps.push({ order: order++, action: "add", blockId: id });
  return { steps };
}

export function buildUpgrade(from: KnowledgeDocument, to: KnowledgeDocument): KnowledgeUpgrade {
  const changeSet = buildChangeSet(from, to);
  return { fromRevision: from.revision, toRevision: to.revision, changeSet, plan: buildMigrationPlan(changeSet.diff) };
}

/** Rollback LÓGICO para uma revisão anterior (não remove revisões posteriores). */
export function buildRollback(lineageId: string, toRevision: number, reason: string): KnowledgeRollback {
  return { toRevision, lineageId, reason };
}
