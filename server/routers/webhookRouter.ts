/**
 * Sprint 3.3 — Webhook Router.
 *
 * Endpoint registration, test dispatch, delivery queries, stats.
 * Multi-tenant: organizationId required.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  createEndpoint,
  buildWebhookPayload,
  buildDelivery,
  processDelivery,
  getDeliveryStats,
} from "../services/webhookService";
import type {
  WebhookEndpoint,
  WebhookDelivery,
  WebhookEventType,
} from "../services/webhookService";

// In-memory stores (DB persistence via migration tables)
const endpointStore = new Map<number, WebhookEndpoint[]>();
const deliveryStore = new Map<number, WebhookDelivery[]>();

function getEndpoints(orgId: number): WebhookEndpoint[] {
  return endpointStore.get(orgId) ?? [];
}

function saveEndpoint(orgId: number, ep: WebhookEndpoint): void {
  const eps = getEndpoints(orgId);
  eps.push(ep);
  endpointStore.set(orgId, eps);
}

function getDeliveries(orgId: number): WebhookDelivery[] {
  return deliveryStore.get(orgId) ?? [];
}

function saveDelivery(orgId: number, d: WebhookDelivery): void {
  const deliveries = getDeliveries(orgId);
  deliveries.push(d);
  deliveryStore.set(orgId, deliveries);
}

const webhookEventTypeSchema = z.enum([
  "tr.approved",
  "item.approved",
  "export.completed",
  "workflow.completed",
  "review.completed",
  "clause.overridden",
  "semantic.override",
  "anomaly.detected",
]);

export const webhookRouter = router({
  registerEndpoint: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        url: z.string().url(),
        events: z.array(webhookEventTypeSchema).min(1),
        secret: z.string().min(8),
      }),
    )
    .mutation(({ input }) => {
      const endpoint = createEndpoint({
        organizationId: input.organizationId,
        url: input.url,
        events: input.events as WebhookEventType[],
        secret: input.secret,
      });
      saveEndpoint(input.organizationId, endpoint);
      return endpoint satisfies WebhookEndpoint;
    }),

  dispatchTestEvent: protectedProcedure
    .input(
      z.object({
        endpointId: z.string(),
        organizationId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const endpoints = getEndpoints(input.organizationId);
      const endpoint = endpoints.find((e) => e.id === input.endpointId);
      if (!endpoint) throw new Error("Endpoint não encontrado");

      const payload = buildWebhookPayload(
        "tr.approved",
        { test: true, endpointId: endpoint.id },
        input.organizationId,
      );
      const delivery = buildDelivery(endpoint, payload);
      const processed = processDelivery(delivery, endpoint);
      saveDelivery(input.organizationId, processed);
      return processed satisfies WebhookDelivery;
    }),

  getDeliveries: protectedProcedure
    .input(
      z.object({
        organizationId: z.number(),
        eventType: webhookEventTypeSchema.optional(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(({ input }) => {
      let deliveries = getDeliveries(input.organizationId);
      if (input.eventType) {
        deliveries = deliveries.filter((d) => d.eventType === input.eventType);
      }
      return deliveries.slice(-input.limit);
    }),

  getStats: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(({ input }) => {
      const deliveries = getDeliveries(input.organizationId);
      return getDeliveryStats(deliveries);
    }),
});
