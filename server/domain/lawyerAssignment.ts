/**
 * FASE 5 — Business Domain: Parecer Jurídico
 *
 * LawyerAssignment atribui um trabalho (LegalOpinionWorkspace) a um Procurador
 * dentro do domínio de destino. A distribuição ocorre APÓS o encaminhamento do
 * Institutional Request Engine — o domínio jamais distribui trabalho em outro
 * domínio. Determinístico, multi-tenant.
 */

import { createHash } from "crypto";
import type { LegalOpinionPriority } from "./legalOpinionWorkspace";

export interface LawyerAssignment {
  readonly id: string;
  readonly organizationId: number;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly lawyerId: number | null;
  readonly sector: string;
  readonly priority: LegalOpinionPriority;
  readonly correlationId: string;
  readonly assignedAt: string;
}

export function createLawyerAssignment(params: {
  organizationId: number;
  workspaceId: string;
  requestId: string;
  lawyerId?: number | null;
  sector?: string;
  priority?: LegalOpinionPriority;
  correlationId: string;
  assignedAt?: string;
}): LawyerAssignment {
  const id = createHash("sha256")
    .update(`las:${params.organizationId}:${params.workspaceId}:${params.lawyerId ?? "fila"}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    requestId: params.requestId,
    lawyerId: params.lawyerId ?? null,
    sector: params.sector ?? "",
    priority: params.priority ?? "media",
    correlationId: params.correlationId,
    assignedAt: params.assignedAt ?? new Date().toISOString(),
  };
}

/** Ordena atribuições por prioridade (urgente → baixa) de forma determinística. */
export function prioritizeAssignments(assignments: readonly LawyerAssignment[]): LawyerAssignment[] {
  const weight: Record<LegalOpinionPriority, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };
  return [...assignments].sort((a, b) =>
    weight[a.priority] - weight[b.priority] || a.id.localeCompare(b.id));
}
