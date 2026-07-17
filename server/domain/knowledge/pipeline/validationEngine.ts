/**
 * RC-4.8 — Institutional Knowledge Pipeline · Validation Engine (Fase 5).
 *
 * KnowledgeValidationEngine + Rule + Result + Registry + HealthReport. Regras declarativas e
 * determinísticas sobre um KnowledgeDocument. Sem conteúdo jurídico.
 */

import type { KnowledgeDocument } from "../knowledgeDocument";
import { allBlocks } from "../knowledgeDocument";
import { computeQuality } from "../knowledgeQuality";

export type ValidationSeverity = "info" | "warning" | "error";

export interface KnowledgeValidationResult {
  readonly ruleId: string;
  readonly passed: boolean;
  readonly severity: ValidationSeverity;
  readonly detail: string;
}

export interface KnowledgeValidationRule {
  readonly id: string;
  readonly name: string;
  readonly severity: ValidationSeverity;
  readonly evaluate: (doc: KnowledgeDocument) => { passed: boolean; detail: string };
}

export interface KnowledgeValidationRegistry {
  readonly rules: readonly KnowledgeValidationRule[];
}

export function createValidationRegistry(rules: KnowledgeValidationRule[] = []): KnowledgeValidationRegistry {
  const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
  return { rules: sorted };
}

export function registerRule(registry: KnowledgeValidationRegistry, rule: KnowledgeValidationRule): KnowledgeValidationRegistry {
  if (registry.rules.some(r => r.id === rule.id)) return registry;
  return createValidationRegistry([...registry.rules, rule]);
}

/** Regras institucionais padrão (estruturais/qualidade). */
export const DEFAULT_VALIDATION_RULES: KnowledgeValidationRule[] = [
  { id: "has_blocks", name: "Documento possui blocos", severity: "error", evaluate: (d) => ({ passed: allBlocks(d).length > 0, detail: "documento sem blocos" }) },
  { id: "has_explainability", name: "Possui bloco Explainability", severity: "error", evaluate: (d) => ({ passed: allBlocks(d).some(b => b.kind === "Explainability"), detail: "bloco Explainability ausente" }) },
  { id: "consistent", name: "Consistência sem issues", severity: "warning", evaluate: (d) => { const c = computeQuality(d).consistency; return { passed: c.issues.length === 0, detail: c.issues.join("; ") }; } },
  { id: "valid_versioning", name: "Versionamento válido", severity: "error", evaluate: (d) => ({ passed: d.revision >= 1 && /^\d+\.\d+\.\d+$/.test(d.semver), detail: "versionamento inválido" }) },
];

export const KnowledgeValidationEngine = {
  /** Executa todas as regras sobre o documento. Determinístico (ordem por ruleId). */
  run(registry: KnowledgeValidationRegistry, doc: KnowledgeDocument): KnowledgeValidationResult[] {
    return registry.rules.map(rule => {
      const { passed, detail } = rule.evaluate(doc);
      return { ruleId: rule.id, passed, severity: rule.severity, detail: passed ? "ok" : detail };
    }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  },
};

export interface KnowledgeHealthReport {
  readonly healthy: boolean;
  readonly score: number;
  readonly failedCount: number;
  readonly errorCount: number;
  readonly results: readonly KnowledgeValidationResult[];
}

/** Relatório de saúde a partir dos resultados. Determinístico. */
export function buildHealthReport(results: readonly KnowledgeValidationResult[]): KnowledgeHealthReport {
  const failed = results.filter(r => !r.passed);
  const errors = failed.filter(r => r.severity === "error");
  const score = results.length === 0 ? 0 : Math.round((results.filter(r => r.passed).length / results.length) * 1000) / 1000;
  return { healthy: errors.length === 0, score, failedCount: failed.length, errorCount: errors.length, results };
}
