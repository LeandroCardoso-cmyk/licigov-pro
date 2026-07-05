/**
 * Sprint 4.9 — Copilot Session
 *
 * Representa uma interação supervisionada com um copiloto. Liga o copiloto ao
 * workflow oficial, ao contexto (RAG/KG) e à cadeia de reasoning. Determinístico,
 * multi-tenant, replay-safe.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type CopilotSessionStatus =
  | "open"
  | "reasoning"
  | "recommended"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "closed";

export interface CopilotSession {
  readonly id: string;
  readonly organizationId: number;
  readonly workflowId: string;
  readonly copilotId: string;
  readonly copilotType: CopilotType;
  readonly userId: number;
  readonly contextId: string;
  readonly reasoningId: string;
  readonly query: string;
  readonly status: CopilotSessionStatus;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const VALID_TRANSITIONS: Record<CopilotSessionStatus, CopilotSessionStatus[]> = {
  open: ["reasoning", "closed"],
  reasoning: ["recommended", "closed"],
  recommended: ["awaiting_approval", "closed"],
  awaiting_approval: ["approved", "rejected", "closed"],
  approved: ["closed"],
  rejected: ["closed"],
  closed: [],
};

export function createCopilotSession(params: {
  organizationId: number;
  workflowId: string;
  copilotId: string;
  copilotType: CopilotType;
  userId: number;
  query: string;
  correlationId: string;
  createdAt?: string;
}): CopilotSession {
  const id = createHash("sha256")
    .update(`cps:${params.organizationId}:${params.copilotId}:${params.workflowId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  // contextId e reasoningId são determinísticos, derivados da sessão
  const contextId = createHash("sha256").update(`ctx:${id}`).digest("hex").slice(0, 20);
  const reasoningId = createHash("sha256").update(`rsn:${id}`).digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    workflowId: params.workflowId,
    copilotId: params.copilotId,
    copilotType: params.copilotType,
    userId: params.userId,
    contextId,
    reasoningId,
    query: params.query,
    status: "open",
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransition(from: CopilotSessionStatus, to: CopilotSessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function advanceSession(
  session: CopilotSession,
  to: CopilotSessionStatus,
  at?: string,
): CopilotSession {
  if (!canTransition(session.status, to)) {
    throw new Error(`Transição de sessão inválida: ${session.status} → ${to}`);
  }
  return { ...session, status: to, updatedAt: at ?? new Date().toISOString() };
}

export function isTerminal(session: CopilotSession): boolean {
  return VALID_TRANSITIONS[session.status].length === 0;
}
