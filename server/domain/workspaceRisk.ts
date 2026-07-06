/**
 * Sprint 5.0 — Workspace Risk
 *
 * Registra riscos identificados dentro de um Workspace, permite correlação entre
 * riscos e sugere mitigação. Determinístico, auditável.
 */

import { createHash } from "crypto";

export type RiskCategory =
  | "juridico"
  | "tecnico"
  | "economico"
  | "operacional"
  | "conformidade"
  | "integridade";

export type RiskSeverity = "baixo" | "medio" | "alto" | "critico";

export type RiskStatus = "identificado" | "mitigado" | "aceito" | "escalado";

export interface WorkspaceRisk {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly category: RiskCategory;
  readonly description: string;
  readonly severity: RiskSeverity;
  readonly likelihood: number;
  readonly status: RiskStatus;
  readonly mitigation: string;
  readonly correlatedRiskIds: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { baixo: 1, medio: 2, alto: 3, critico: 4 };

export function createWorkspaceRisk(params: {
  workspaceId: string;
  organizationId: number;
  category: RiskCategory;
  description: string;
  severity?: RiskSeverity;
  likelihood?: number;
  mitigation?: string;
  correlatedRiskIds?: string[];
  correlationId: string;
  createdAt?: string;
}): WorkspaceRisk {
  const id = createHash("sha256")
    .update(`wrisk:${params.organizationId}:${params.workspaceId}:${params.category}:${params.description}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    category: params.category,
    description: params.description,
    severity: params.severity ?? "medio",
    likelihood: params.likelihood ?? 0.5,
    status: "identificado",
    mitigation: params.mitigation ?? "",
    correlatedRiskIds: params.correlatedRiskIds ?? [],
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Score de exposição (severidade × probabilidade), normalizado 0-1. */
export function riskExposure(risk: WorkspaceRisk): number {
  return (SEVERITY_RANK[risk.severity] / 4) * Math.max(0, Math.min(1, risk.likelihood));
}

/** Correlaciona riscos da mesma categoria (retorna ids correlacionados). */
export function correlateRisks(risks: readonly WorkspaceRisk[]): Map<string, string[]> {
  const byCategory = new Map<RiskCategory, string[]>();
  for (const r of risks) {
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r.id]);
  }
  const result = new Map<string, string[]>();
  for (const r of risks) {
    const same = (byCategory.get(r.category) ?? []).filter(id => id !== r.id);
    result.set(r.id, same);
  }
  return result;
}

export function mitigateRisk(risk: WorkspaceRisk, mitigation: string): WorkspaceRisk {
  return { ...risk, status: "mitigado", mitigation };
}

/** Nível de risco agregado de um workspace (maior exposição). */
export function aggregateWorkspaceRisk(risks: readonly WorkspaceRisk[]): RiskSeverity {
  let max = 0;
  for (const r of risks) max = Math.max(max, SEVERITY_RANK[r.severity]);
  return (["baixo", "baixo", "medio", "alto", "critico"] as const)[max];
}
