/**
 * Sprint 5.0 — Workspace Risk Service
 *
 * Identifica, correlaciona e sugere mitigação de riscos no Workspace.
 * Persistência graceful. Determinístico.
 */

import {
  createWorkspaceRisk,
  correlateRisks,
  mitigateRisk,
  riskExposure,
  aggregateWorkspaceRisk,
  type WorkspaceRisk,
  type RiskCategory,
  type RiskSeverity,
} from "../domain/workspaceRisk";
import { insertRisk } from "../db/workspace";

export async function identifyRisk(params: {
  workspaceId: string;
  organizationId: number;
  category: RiskCategory;
  description: string;
  severity?: RiskSeverity;
  likelihood?: number;
  mitigation?: string;
  correlationId: string;
}): Promise<WorkspaceRisk> {
  const risk = createWorkspaceRisk(params);
  await insertRisk(risk);
  return risk;
}

export async function mitigate(risk: WorkspaceRisk, mitigation: string): Promise<WorkspaceRisk> {
  const mitigated = mitigateRisk(risk, mitigation);
  await insertRisk(mitigated);
  return mitigated;
}

/** Correlaciona riscos e retorna exposição por risco + nível agregado do workspace. */
export function analyzeRisks(risks: readonly WorkspaceRisk[]): {
  correlations: Map<string, string[]>;
  exposures: Array<{ id: string; exposure: number }>;
  aggregate: RiskSeverity;
} {
  return {
    correlations: correlateRisks(risks),
    exposures: risks.map(r => ({ id: r.id, exposure: riskExposure(r) })),
    aggregate: aggregateWorkspaceRisk(risks),
  };
}
