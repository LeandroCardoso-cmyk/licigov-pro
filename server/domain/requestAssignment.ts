/**
 * Kernel — Request Assignment (distribuição)
 *
 * Representa a distribuição de uma solicitação para um usuário, setor ou fila,
 * com prioridade. Base para as Work Queues (Institutional Inbox). Determinístico.
 */

import { createHash } from "crypto";
import type { RequestPriority } from "./institutionalRequest";

export interface RequestAssignment {
  readonly id: string;
  readonly requestId: string;
  readonly organizationId: number;
  readonly userId: number | null;
  readonly sector: string;
  readonly queue: string;
  readonly priority: RequestPriority;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createRequestAssignment(params: {
  requestId: string;
  organizationId: number;
  userId?: number | null;
  sector?: string;
  queue?: string;
  priority?: RequestPriority;
  correlationId: string;
  createdAt?: string;
}): RequestAssignment {
  const id = createHash("sha256")
    .update(`rasg:${params.organizationId}:${params.requestId}:${params.userId ?? "fila"}:${params.queue ?? ""}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    requestId: params.requestId,
    organizationId: params.organizationId,
    userId: params.userId ?? null,
    sector: params.sector ?? "",
    queue: params.queue ?? "geral",
    priority: params.priority ?? "media",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

const PRIORITY_RANK: Record<RequestPriority, number> = { urgente: 4, alta: 3, media: 2, baixa: 1 };

/** Ordena atribuições por prioridade (desc) e id (determinístico). */
export function prioritizeAssignments(assignments: readonly RequestAssignment[]): RequestAssignment[] {
  return [...assignments].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
