/**
 * Kernel — Request Notification
 *
 * Notificação de uma solicitação institucional. Preparada para múltiplos canais
 * (sistema, e-mail, WhatsApp) mas apenas as notificações INTERNAS (sistema) são
 * implementadas nesta sprint; os demais canais são pontos de extensão. Determinístico.
 */

import { createHash } from "crypto";

export type NotificationChannel = "sistema" | "email" | "whatsapp";

export type NotificationStatus = "pendente" | "entregue" | "lida";

export interface RequestNotification {
  readonly id: string;
  readonly requestId: string;
  readonly organizationId: number;
  readonly recipientUser: number;
  readonly channel: NotificationChannel;
  readonly title: string;
  readonly message: string;
  readonly status: NotificationStatus;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createRequestNotification(params: {
  requestId: string;
  organizationId: number;
  recipientUser: number;
  channel?: NotificationChannel;
  title: string;
  message?: string;
  correlationId: string;
  createdAt?: string;
}): RequestNotification {
  const id = createHash("sha256")
    .update(`rnot:${params.organizationId}:${params.requestId}:${params.recipientUser}:${params.channel ?? "sistema"}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    requestId: params.requestId,
    organizationId: params.organizationId,
    recipientUser: params.recipientUser,
    channel: params.channel ?? "sistema",
    title: params.title,
    message: params.message ?? "",
    status: "pendente",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

export function markDelivered(n: RequestNotification): RequestNotification {
  return { ...n, status: "entregue" };
}

export function markRead(n: RequestNotification): RequestNotification {
  return { ...n, status: "lida" };
}

/** Apenas o canal "sistema" é implementado nesta sprint. */
export function isChannelImplemented(channel: NotificationChannel): boolean {
  return channel === "sistema";
}
