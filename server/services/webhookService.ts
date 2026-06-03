/**
 * Sprint 3.3 — Webhook Service.
 *
 * Webhook infrastructure: endpoints, deliveries, dispatch, dead-letter.
 * NO real HTTP in this sprint — structured logs simulate delivery.
 *
 * PRINCIPLES:
 *   - Replay-safe: same payload => same signature.
 *   - Multi-tenant: organizationId mandatory.
 *   - No HTTP real — structured logging only.
 */

import { createHash, createHmac } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | "tr.approved"
  | "item.approved"
  | "export.completed"
  | "workflow.completed"
  | "review.completed"
  | "clause.overridden"
  | "semantic.override"
  | "anomaly.detected";

export interface WebhookEndpoint {
  id: string;
  organizationId: number;
  url: string;
  events: WebhookEventType[];
  secret: string; // HMAC-SHA256 signing key
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  organizationId: number;
  eventType: WebhookEventType;
  payload: WebhookPayload;
  signature: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  attempts: number;
  lastError: string | null;
  correlationId: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookPayload {
  eventType: WebhookEventType;
  organizationId: number;
  data: Record<string, unknown>;
  correlationId: string;
  timestamp: string;
  version: "1.0";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0;
function nextId(prefix: string, seed: string): string {
  _counter++;
  return (
    prefix +
    "_" +
    createHash("sha256")
      .update(`${seed}:${_counter}`)
      .digest("hex")
      .slice(0, 24)
  );
}

function emit(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      service: "webhook_service",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Endpoint ────────────────────────────────────────────────────────────────

export function createEndpoint(params: {
  organizationId: number;
  url: string;
  events: WebhookEventType[];
  secret: string;
}): WebhookEndpoint {
  const now = new Date().toISOString();
  const id = nextId("wep", `${params.organizationId}:${params.url}:${now}`);
  return {
    id,
    organizationId: params.organizationId,
    url: params.url,
    events: params.events,
    secret: params.secret,
    active: true,
    createdAt: now,
  };
}

// ─── Signing ──────────────────────────────────────────────────────────────────

export function signPayload(payload: WebhookPayload, secret: string): string {
  const body = JSON.stringify(payload);
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// ─── Delivery ────────────────────────────────────────────────────────────────

export function buildDelivery(
  endpoint: WebhookEndpoint,
  payload: WebhookPayload,
): WebhookDelivery {
  const now = new Date().toISOString();
  const signature = signPayload(payload, endpoint.secret);
  const id = nextId(
    "wdl",
    `${endpoint.id}:${payload.correlationId}:${now}`,
  );
  return {
    id,
    endpointId: endpoint.id,
    organizationId: endpoint.organizationId,
    eventType: payload.eventType,
    payload,
    signature,
    status: "pending",
    attempts: 0,
    lastError: null,
    correlationId: payload.correlationId,
    createdAt: now,
    deliveredAt: null,
  };
}

export function processDelivery(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
): WebhookDelivery {
  // Simulate delivery via structured log — NO real HTTP
  const now = new Date().toISOString();
  emit("webhook_delivery_simulated", {
    deliveryId: delivery.id,
    endpointId: endpoint.id,
    url: endpoint.url,
    eventType: delivery.eventType,
    correlationId: delivery.correlationId,
    organizationId: delivery.organizationId,
  });

  return {
    ...delivery,
    status: "delivered",
    attempts: delivery.attempts + 1,
    deliveredAt: now,
  };
}

export function retryDelivery(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
  attempt: number,
): WebhookDelivery {
  // Backoff: 1s / 2s / 4s (simulated)
  const maxAttempts = 3;
  const _backoffMs = Math.pow(2, attempt - 1) * 1000;
  const now = new Date().toISOString();

  emit("webhook_retry", {
    deliveryId: delivery.id,
    attempt,
    backoffMs: _backoffMs,
    organizationId: delivery.organizationId,
  });

  if (attempt > maxAttempts) {
    return moveToDeadLetter(delivery, `Max attempts (${maxAttempts}) exceeded`);
  }

  return {
    ...delivery,
    status: "delivered",
    attempts: delivery.attempts + 1,
    deliveredAt: now,
  };
}

export function moveToDeadLetter(
  delivery: WebhookDelivery,
  reason: string,
): WebhookDelivery {
  emit("webhook_dead_letter", {
    deliveryId: delivery.id,
    reason,
    organizationId: delivery.organizationId,
  });
  return {
    ...delivery,
    status: "dead_letter",
    lastError: reason,
  };
}

// ─── Payload builder ──────────────────────────────────────────────────────────

export function buildWebhookPayload(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  orgId: number,
): WebhookPayload {
  const correlationId = createHash("sha256")
    .update(`${orgId}:${eventType}:${JSON.stringify(data)}`)
    .digest("hex")
    .slice(0, 32);
  return {
    eventType,
    organizationId: orgId,
    data,
    correlationId,
    timestamp: new Date().toISOString(),
    version: "1.0",
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export function dispatchEvent(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  endpoints: WebhookEndpoint[],
  orgId: number,
): WebhookDelivery[] {
  const payload = buildWebhookPayload(eventType, data, orgId);
  const deliveries: WebhookDelivery[] = [];

  for (const endpoint of endpoints) {
    if (!endpoint.active) continue;
    if (!endpoint.events.includes(eventType)) continue;
    if (endpoint.organizationId !== orgId) continue;

    const delivery = buildDelivery(endpoint, payload);
    const processed = processDelivery(delivery, endpoint);
    deliveries.push(processed);
  }

  return deliveries;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function getDeliveryStats(deliveries: WebhookDelivery[]): {
  delivered: number;
  failed: number;
  pending: number;
  deadLetter: number;
  successRate: number;
} {
  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const pending = deliveries.filter((d) => d.status === "pending").length;
  const deadLetter = deliveries.filter((d) => d.status === "dead_letter").length;
  const total = deliveries.length;
  const successRate = total > 0 ? delivered / total : 0;
  return { delivered, failed, pending, deadLetter, successRate };
}
