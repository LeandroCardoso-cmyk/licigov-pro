/**
 * Sprint 5.0 — Cognitive Procurement Workspace
 *
 * O Workspace é o ambiente operacional principal do Departamento de Licitações.
 * Coordena processos, documentos, copilotos, tarefas, decisões e aprovações
 * durante o ciclo de preparação da contratação. Toda ação é contextual,
 * auditável, rastreável, explicável e supervisionada. Determinístico, multi-tenant.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type WorkspaceType = "licitacao" | "contratacao_direta" | "contrato" | "parecer" | "generico";

export type WorkspaceStatus =
  | "draft"
  | "active"
  | "in_review"
  | "awaiting_approval"
  | "completed"
  | "archived";

export type WorkspaceStage =
  | "planejamento"
  | "elaboracao"
  | "revisao"
  | "aprovacao"
  | "concluido";

export interface CognitiveWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly processId: string;
  readonly workspaceType: WorkspaceType;
  readonly title: string;
  readonly status: WorkspaceStatus;
  readonly owner: number;
  readonly participants: readonly number[];
  readonly currentStage: WorkspaceStage;
  readonly activeCopilots: readonly CopilotType[];
  readonly activeTasks: readonly string[];
  readonly activeDocuments: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const STATUS_TRANSITIONS: Record<WorkspaceStatus, WorkspaceStatus[]> = {
  draft: ["active", "archived"],
  active: ["in_review", "awaiting_approval", "archived"],
  in_review: ["active", "awaiting_approval", "archived"],
  awaiting_approval: ["active", "completed", "archived"],
  completed: ["archived"],
  archived: [],
};

const STAGE_ORDER: WorkspaceStage[] = ["planejamento", "elaboracao", "revisao", "aprovacao", "concluido"];

export function createCognitiveWorkspace(params: {
  organizationId: number;
  processId: string;
  workspaceType: WorkspaceType;
  title: string;
  owner: number;
  participants?: number[];
  correlationId: string;
  createdAt?: string;
}): CognitiveWorkspace {
  const id = createHash("sha256")
    .update(`ws:${params.organizationId}:${params.processId}:${params.workspaceType}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    processId: params.processId,
    workspaceType: params.workspaceType,
    title: params.title,
    status: "draft",
    owner: params.owner,
    participants: params.participants ?? [params.owner],
    currentStage: "planejamento",
    activeCopilots: [],
    activeTasks: [],
    activeDocuments: [],
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransitionStatus(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function transitionStatus(ws: CognitiveWorkspace, to: WorkspaceStatus, at?: string): CognitiveWorkspace {
  if (!canTransitionStatus(ws.status, to)) {
    throw new Error(`Transição de status inválida: ${ws.status} → ${to}`);
  }
  return { ...ws, status: to, updatedAt: at ?? new Date().toISOString() };
}

export function advanceStage(ws: CognitiveWorkspace, at?: string): CognitiveWorkspace {
  const idx = STAGE_ORDER.indexOf(ws.currentStage);
  const next = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : ws.currentStage;
  return { ...ws, currentStage: next, updatedAt: at ?? new Date().toISOString() };
}

export function addParticipant(ws: CognitiveWorkspace, userId: number, at?: string): CognitiveWorkspace {
  if (ws.participants.includes(userId)) return ws;
  return { ...ws, participants: [...ws.participants, userId], updatedAt: at ?? new Date().toISOString() };
}

export function activateCopilot(ws: CognitiveWorkspace, copilotType: CopilotType, at?: string): CognitiveWorkspace {
  if (ws.activeCopilots.includes(copilotType)) return ws;
  return { ...ws, activeCopilots: [...ws.activeCopilots, copilotType], updatedAt: at ?? new Date().toISOString() };
}

export function attachTask(ws: CognitiveWorkspace, taskId: string, at?: string): CognitiveWorkspace {
  if (ws.activeTasks.includes(taskId)) return ws;
  return { ...ws, activeTasks: [...ws.activeTasks, taskId], updatedAt: at ?? new Date().toISOString() };
}

export function isArchived(ws: CognitiveWorkspace): boolean {
  return ws.status === "archived";
}
