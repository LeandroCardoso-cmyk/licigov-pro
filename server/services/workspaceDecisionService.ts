/**
 * Sprint 5.0 — Workspace Decision Service
 *
 * Registra decisões humanas (com justificativa, fundamentos e aprovação).
 * Copilotos apenas fundamentam; a decisão é sempre do servidor. Persistência graceful.
 */

import { TRPCError } from "@trpc/server";
import {
  createWorkspaceDecision,
  isValidDecision,
  approveDecision as approveDomain,
  type WorkspaceDecision,
} from "../domain/workspaceDecision";
import type { CopilotType } from "../domain/institutionalCopilot";
import { insertDecision, updateDecisionStatus } from "../db/workspace";

export async function registerDecision(params: {
  workspaceId: string;
  organizationId: number;
  title: string;
  decision: string;
  justification: string;
  responsibleUser: number;
  evidenceIds?: string[];
  involvedCopilots?: CopilotType[];
  correlationId: string;
}): Promise<WorkspaceDecision> {
  const decision = createWorkspaceDecision(params);
  if (!isValidDecision(decision)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Decisão exige justificativa e conteúdo não-vazios." });
  }
  await insertDecision(decision);
  return decision;
}

export async function approveWorkspaceDecision(decision: WorkspaceDecision): Promise<WorkspaceDecision> {
  const approved = approveDomain(decision);
  await updateDecisionStatus(approved.id, approved.organizationId, approved.status, approved.outcome);
  return approved;
}
