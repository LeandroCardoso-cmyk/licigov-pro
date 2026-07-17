/**
 * RC-4.5 — Legal Knowledge Foundation · Explainability (Part 8).
 *
 * Toda unidade jurídica se EXPLICA: origem, hierarquia, dependências, referências, versões,
 * relacionamentos e conflitos. Nunca retorna apenas dados. Determinístico.
 */

import type { KnowledgeBase } from "./knowledgeBase";
import type { LegalKnowledgeUnit } from "./legalKnowledgeUnit";
import { findParents, findChildren, findDependencies, findReferences, findRelatedKnowledge } from "./knowledgeQueries";
import { buildVersionChains } from "./knowledgeVersion";
import { detectConflicts } from "./knowledgeConflict";

export interface KnowledgeExplanation {
  readonly unitId: string;
  readonly origin: { readonly sourceReference: string; readonly type: string; readonly jurisdiction: string; readonly validity: string };
  readonly hierarchy: { readonly level: number; readonly parents: readonly string[]; readonly children: readonly string[] };
  readonly dependencies: readonly string[];
  readonly references: readonly { readonly id: string; readonly type: string; readonly to: string; readonly explanation: string }[];
  readonly versions: readonly number[];
  readonly relationships: readonly string[];
  readonly conflicts: readonly string[];
  readonly summary: string;
}

/** Explica uma unidade jurídica dentro da base. Sempre estruturado — nunca só dados. */
export function explainKnowledgeUnit(base: KnowledgeBase, unit: LegalKnowledgeUnit): KnowledgeExplanation {
  const chain = buildVersionChains(base.units).find(c => c.lineageId === unit.lineageId);
  const conflicts = detectConflicts(base.units, base.references).filter(c => c.unitsInvolved.includes(unit.id));
  return {
    unitId: unit.id,
    origin: { sourceReference: unit.sourceReference, type: unit.type, jurisdiction: unit.jurisdiction, validity: unit.validity },
    hierarchy: { level: unit.hierarchy, parents: findParents(base, unit.id).map(u => u.id), children: findChildren(base, unit.id).map(u => u.id) },
    dependencies: findDependencies(base, unit.id).map(u => u.id),
    references: findReferences(base, unit.id).map(r => ({ id: r.id, type: r.type, to: r.to, explanation: r.explanation })),
    versions: (chain?.versions ?? []).map(v => v.version),
    relationships: findRelatedKnowledge(base, unit.id).map(u => u.id),
    conflicts: conflicts.map(c => c.id),
    summary: `Unidade ${unit.type} (${unit.validity}), hierarquia ${unit.hierarchy}, versão ${unit.version}, origem ${unit.sourceReference}.`,
  };
}
