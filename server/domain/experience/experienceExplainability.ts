/**
 * RC-X.1 — Institutional Experience Framework · Explainability (Part 12).
 *
 * Toda navegação/workspace se EXPLICA: por que apareceu, qual capacidade habilitou, qual módulo
 * registrou, a qual workspace pertence e qual tenant autorizou. Nunca informação implícita.
 * Determinístico.
 */

import type { InstitutionContext } from "./institutionContext";
import type { ResolvedWorkspace } from "./workspace";
import type { NavigationItem } from "./navigationBuilder";

export interface ExperienceExplanation {
  readonly subject: string;
  readonly appeared: boolean;
  readonly reason: string;
  readonly capability: string;
  readonly module: string;
  readonly workspace: string;
  readonly tenantId: number;
}

/** Explica um item de navegação (usa a explainability já embutida no item). */
export function explainNavigationItem(item: NavigationItem): ExperienceExplanation {
  return {
    subject: item.id,
    appeared: true,
    reason: item.explanation.reason,
    capability: item.explanation.capability,
    module: item.explanation.module,
    workspace: item.explanation.workspace,
    tenantId: item.explanation.tenantId,
  };
}

/** Explica por que um workspace apareceu (ou não) para um contexto. */
export function explainWorkspace(rw: ResolvedWorkspace, context: InstitutionContext): ExperienceExplanation {
  return {
    subject: rw.workspace.id,
    appeared: rw.enabled,
    reason: rw.reason,
    capability: (rw.enabled ? rw.enabledBy[0] : rw.missing[0]) ?? rw.workspace.requiredCapabilities[0] ?? "",
    module: rw.workspace.module,
    workspace: rw.workspace.id,
    tenantId: context.tenantId,
  };
}
