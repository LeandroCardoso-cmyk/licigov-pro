/**
 * Sprint 1.8 — Contrato oficial de Domain Events do LiciGov Pro.
 *
 * Todo evento de domínio publicado via Outbox ou processado por handlers
 * DEVE satisfazer esta interface para garantir rastreabilidade end-to-end.
 */

export interface DomainEventMetadata {
  schemaVersion: number;
  sourceService?: string;
  tags?: string[];
  idempotencyKey?: string;
}

export interface DomainEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  organizationId: number;
  correlationId?: string;
  requestId?: string;
  /** ID do evento que causou este (cadeia causal) */
  causationId?: string;
  actorId?: number;
  actorRole?: string;
  payload: TPayload;
  metadata: DomainEventMetadata;
}

export type DomainEventOf<TPayload> = DomainEvent<TPayload>;

/**
 * Cria um DomainEvent com eventId e occurredAt preenchidos automaticamente.
 */
export function createDomainEvent<TPayload>(
  params: Omit<DomainEvent<TPayload>, "eventId" | "occurredAt" | "metadata"> & {
    metadata?: Partial<DomainEventMetadata>;
  },
): DomainEvent<TPayload> {
  return {
    eventId: crypto.randomUUID(),
    occurredAt: new Date(),
    ...params,
    eventVersion: params.eventVersion ?? 1,
    metadata: { schemaVersion: 1, ...params.metadata },
  };
}

/**
 * Type guard: verifica se um valor é um DomainEvent válido.
 */
export function isValidDomainEvent(value: unknown): value is DomainEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.eventId === "string" &&
    e.eventId.length > 0 &&
    typeof e.eventType === "string" &&
    e.eventType.length > 0 &&
    typeof e.aggregateType === "string" &&
    e.aggregateType.length > 0 &&
    typeof e.aggregateId === "string" &&
    e.aggregateId.length > 0 &&
    typeof e.organizationId === "number" &&
    e.organizationId > 0 &&
    e.occurredAt instanceof Date &&
    e.payload !== null &&
    typeof e.payload === "object"
  );
}
