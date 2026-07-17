/**
 * RC-4.7 — Institutional Knowledge Framework · Knowledge Quality (Part 3).
 *
 * Métricas determinísticas de qualidade: completeness, coverage, consistency, health + validator.
 * Genérico — não conhece conteúdo jurídico. Puro.
 */

import type { KnowledgeDocument } from "./knowledgeDocument";
import { allBlocks } from "./knowledgeDocument";
import type { KnowledgeBlockKind } from "./knowledgeBlocks";
import { isBlockKind } from "./knowledgeBlocks";

/** Blocos recomendados para um documento institucional "completo". */
export const RECOMMENDED_BLOCKS: KnowledgeBlockKind[] = [
  "ExecutiveSummary", "PlainLanguage", "Applicability", "Requirements", "Explainability",
];

export interface KnowledgeCompleteness {
  readonly score: number;
  readonly presentRecommended: readonly string[];
  readonly missingRecommended: readonly string[];
}
export interface KnowledgeCoverage {
  readonly score: number;
  readonly sectionCount: number;
  readonly blockCount: number;
  readonly distinctKinds: number;
}
export interface KnowledgeConsistency {
  readonly score: number;
  readonly issues: readonly string[];
}
export type KnowledgeHealthStatus = "healthy" | "degraded" | "incomplete" | "unknown";
export interface KnowledgeHealth {
  readonly status: KnowledgeHealthStatus;
  readonly score: number;
}
export interface KnowledgeQuality {
  readonly completeness: KnowledgeCompleteness;
  readonly coverage: KnowledgeCoverage;
  readonly consistency: KnowledgeConsistency;
  readonly health: KnowledgeHealth;
}

function round(n: number): number { return Math.round(n * 1000) / 1000; }

export function computeCompleteness(doc: KnowledgeDocument): KnowledgeCompleteness {
  const kinds = new Set(allBlocks(doc).map(b => b.kind));
  const present = RECOMMENDED_BLOCKS.filter(k => kinds.has(k));
  const missing = RECOMMENDED_BLOCKS.filter(k => !kinds.has(k));
  return { score: round(present.length / RECOMMENDED_BLOCKS.length), presentRecommended: present, missingRecommended: missing };
}

export function computeCoverage(doc: KnowledgeDocument): KnowledgeCoverage {
  const blocks = allBlocks(doc);
  const distinct = new Set(blocks.map(b => b.kind)).size;
  // cobertura = variedade de tipos sobre o universo de 20 tipos.
  return { score: round(distinct / 20), sectionCount: doc.sections.length, blockCount: blocks.length, distinctKinds: distinct };
}

export function computeConsistency(doc: KnowledgeDocument): KnowledgeConsistency {
  const issues: string[] = [];
  const blocks = allBlocks(doc);
  for (const b of blocks) {
    if (!isBlockKind(b.kind)) issues.push(`bloco ${b.id}: tipo inválido ${b.kind}`);
    if (b.fragments.length === 0) issues.push(`bloco ${b.kind} (${b.id}): sem fragmentos`);
  }
  const ids = allBlocks(doc).map(b => b.id);
  if (new Set(ids).size !== ids.length) issues.push("blocos com id duplicado");
  const score = blocks.length === 0 ? 0 : round(1 - Math.min(1, issues.length / blocks.length));
  return { score, issues };
}

export function computeHealth(completeness: KnowledgeCompleteness, coverage: KnowledgeCoverage, consistency: KnowledgeConsistency): KnowledgeHealth {
  if (coverage.blockCount === 0) return { status: "unknown", score: 0 };
  const score = round((completeness.score * 0.4) + (coverage.score * 0.2) + (consistency.score * 0.4));
  const status: KnowledgeHealthStatus = consistency.issues.length > 0 ? "degraded"
    : completeness.missingRecommended.length > 0 ? "incomplete"
    : "healthy";
  return { status, score };
}

export function computeQuality(doc: KnowledgeDocument): KnowledgeQuality {
  const completeness = computeCompleteness(doc);
  const coverage = computeCoverage(doc);
  const consistency = computeConsistency(doc);
  const health = computeHealth(completeness, coverage, consistency);
  return { completeness, coverage, consistency, health };
}

export interface KnowledgeValidation { readonly valid: boolean; readonly errors: readonly string[]; }

/** Validador estrutural do documento (ids, tipos, fragmentos, referências). */
export function validateDocument(doc: KnowledgeDocument): KnowledgeValidation {
  const errors: string[] = [];
  if (doc.tenantId <= 0) errors.push("tenant inválido");
  if (!doc.docKey) errors.push("docKey ausente");
  const blockIds = new Set<string>();
  for (const b of allBlocks(doc)) {
    if (blockIds.has(b.id)) errors.push(`bloco com id duplicado: ${b.id}`);
    blockIds.add(b.id);
    if (!isBlockKind(b.kind)) errors.push(`bloco com tipo inválido: ${b.kind}`);
  }
  const nodeIds = new Set<string>([doc.id, ...doc.sections.map(s => s.id), ...blockIds]);
  for (const r of doc.references) {
    if (!nodeIds.has(r.from) && r.from !== doc.docKey) { /* referência externa permitida */ }
  }
  return { valid: errors.length === 0, errors };
}
