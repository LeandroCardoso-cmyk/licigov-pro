/**
 * Sprint 5.0 — Workspace Decision
 *
 * Registra uma DECISÃO HUMANA tomada dentro do Workspace. Copilotos apenas
 * fundamentam; a decisão e sua responsabilidade são sempre do servidor.
 * Determinística, auditável, com evidências e copilotos envolvidos.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type DecisionOutcome = "aprovada" | "rejeitada" | "adiada" | "delegada";

export type DecisionStatus = "registrada" | "aprovada" | "rejeitada";

export interface WorkspaceDecision {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly title: string;
  readonly decision: string;
  readonly justification: string;
  readonly responsibleUser: number;
  readonly outcome: DecisionOutcome;
  readonly status: DecisionStatus;
  readonly evidenceIds: readonly string[];
  readonly involvedCopilots: readonly CopilotType[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createWorkspaceDecision(params: {
  workspaceId: string;
  organizationId: number;
  title: string;
  decision: string;
  justification: string;
  responsibleUser: number;
  outcome?: DecisionOutcome;
  evidenceIds?: string[];
  involvedCopilots?: CopilotType[];
  correlationId: string;
  createdAt?: string;
}): WorkspaceDecision {
  const id = createHash("sha256")
    .update(`wdec:${params.organizationId}:${params.workspaceId}:${params.title}:${params.responsibleUser}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    title: params.title,
    decision: params.decision,
    justification: params.justification,
    responsibleUser: params.responsibleUser,
    outcome: params.outcome ?? "adiada",
    status: "registrada",
    evidenceIds: params.evidenceIds ?? [],
    involvedCopilots: params.involvedCopilots ?? [],
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Uma decisão só é válida (registrável) com justificativa não-vazia. */
export function isValidDecision(decision: WorkspaceDecision): boolean {
  return decision.justification.trim().length > 0 && decision.decision.trim().length > 0;
}

export function approveDecision(decision: WorkspaceDecision): WorkspaceDecision {
  return { ...decision, status: "aprovada", outcome: "aprovada" };
}

export function rejectDecision(decision: WorkspaceDecision, reason: string): WorkspaceDecision {
  return { ...decision, status: "rejeitada", outcome: "rejeitada", justification: `${decision.justification} | Rejeição: ${reason}` };
}
