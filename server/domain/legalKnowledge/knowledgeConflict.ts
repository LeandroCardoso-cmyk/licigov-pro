/**
 * RC-4.5 — Legal Knowledge Foundation · Conflict Model (estrutura).
 *
 * Representa conflitos entre unidades de conhecimento jurídico. NÃO resolve conflitos —
 * apenas os representa e detecta estruturalmente. Determinístico. Explicável.
 */

import { createHash } from "crypto";
import type { LegalKnowledgeUnit } from "./legalKnowledgeUnit";
import type { KnowledgeReference } from "./knowledgeReference";

export type ConflictType = "hierarchical" | "temporal" | "referential" | "revocation" | "duplication";
export type ConflictSeverity = "info" | "warning" | "critical";
export type ConflictResolutionStrategy = "hierarchy_prevails" | "latest_prevails" | "manual_review" | "none";

export interface KnowledgeConflict {
  readonly id: string;
  readonly type: ConflictType;
  readonly severity: ConflictSeverity;
  readonly unitsInvolved: readonly string[];
  /** Estratégia SUGERIDA (não aplicada — apenas representada). */
  readonly strategy: ConflictResolutionStrategy;
  /** Explicação (explainability). */
  readonly explanation: string;
}

function conflictId(type: string, units: readonly string[]): string {
  return createHash("sha256").update(`kconf:${type}:${[...units].sort().join("|")}`).digest("hex").slice(0, 20);
}

function mk(type: ConflictType, severity: ConflictSeverity, units: string[], strategy: ConflictResolutionStrategy, explanation: string): KnowledgeConflict {
  return { id: conflictId(type, units), type, severity, unitsInvolved: units, strategy, explanation };
}

/**
 * Detecta conflitos estruturais numa base de conhecimento (SEM resolvê-los).
 * Determinístico (ordenação estável). Multi-tenant (opera sobre a base fornecida).
 */
export function detectConflicts(units: readonly LegalKnowledgeUnit[], references: readonly KnowledgeReference[]): KnowledgeConflict[] {
  const conflicts: KnowledgeConflict[] = [];
  const byId = new Map(units.map(u => [u.id, u]));

  // Duplicação: mesma linhagem + mesma versão em unidades distintas.
  const seen = new Map<string, string>();
  for (const u of [...units].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${u.lineageId}:${u.version}`;
    const prev = seen.get(key);
    if (prev && prev !== u.id) conflicts.push(mk("duplication", "critical", [prev, u.id], "manual_review", "Duas unidades com mesma linhagem e versão."));
    else seen.set(key, u.id);
  }

  // Temporal: effectiveDate posterior a revokedDate.
  for (const u of units) {
    if (u.effectiveDate && u.revokedDate && u.effectiveDate > u.revokedDate) {
      conflicts.push(mk("temporal", "warning", [u.id], "latest_prevails", "Vigência inicia após a revogação."));
    }
  }

  // Revogação/Referencial: referência aponta para unidade inexistente ou revoga unidade ainda vigente.
  for (const r of references) {
    if (!byId.has(r.from) || !byId.has(r.to)) {
      conflicts.push(mk("referential", "critical", [r.from, r.to], "manual_review", `Referência ${r.type} aponta para unidade inexistente.`));
      continue;
    }
    if (r.type === "revokes" && byId.get(r.to)!.validity === "vigente") {
      conflicts.push(mk("revocation", "warning", [r.from, r.to], "hierarchy_prevails", "Revogação declarada, porém o destino permanece vigente."));
    }
  }

  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}
