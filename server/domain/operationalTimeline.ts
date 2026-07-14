/**
 * FASE 5 — Centro de Operações: Timeline Operacional (append-only)
 *
 * Histórico institucional completo do departamento: quem, quando, o que aconteceu.
 * Nunca editável — append-only. Determinístico, replay-safe (snapshot sha256).
 */

import { createHash } from "crypto";

export interface OperationalTimelineEntry {
  readonly id: string;
  readonly organizationId: number;
  readonly order: number;
  readonly actor: string;
  readonly action: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly summary: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createOperationalTimelineEntry(params: {
  organizationId: number;
  order: number;
  actor: string;
  action: string;
  referenceType?: string;
  referenceId?: string;
  summary: string;
  correlationId: string;
  createdAt?: string;
}): OperationalTimelineEntry {
  const id = createHash("sha256")
    .update(`optl:${params.organizationId}:${params.order}:${params.action}:${params.referenceId ?? ""}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    order: params.order,
    actor: params.actor,
    action: params.action,
    referenceType: params.referenceType ?? "",
    referenceId: params.referenceId ?? "",
    summary: params.summary,
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Anexa uma entrada mantendo a ordem crescente (append-only). */
export function appendOperationalTimeline(
  entries: readonly OperationalTimelineEntry[],
  entry: OperationalTimelineEntry,
): OperationalTimelineEntry[] {
  return [...entries, entry].sort((a, b) => a.order - b.order);
}

/** Assinatura determinística da timeline (para replay/auditoria). */
export function operationalTimelineSnapshot(entries: readonly OperationalTimelineEntry[]): string {
  const payload = entries.map(e => `${e.order}:${e.action}:${e.referenceId}`).join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
