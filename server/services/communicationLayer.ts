/**
 * Sprint 3.3 — Communication Layer.
 *
 * Operational internal notifications: mentions, workflow alerts, review requests.
 *
 * PRINCIPLES:
 *   - Multi-tenant: organizationId mandatory.
 *   - Replay-safe: same input => consistent result.
 *   - Structured logging.
 */

import { createHash } from "crypto";
import type { CollaborationComment } from "../domain/collaboration";
import type { ApprovalChain } from "../domain/institutionalWorkflow";

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType =
  | "mention"
  | "review_request"
  | "correction_request"
  | "approval_request"
  | "workflow_alert"
  | "collaboration_alert"
  | "anomaly_alert";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface Notification {
  id: string;
  organizationId: number;
  recipientUserId: number;
  senderUserId: number | null;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  readAt: string | null;
  correlationId: string;
  createdAt: string;
}

export interface NotificationBatch {
  id: string;
  organizationId: number;
  notifications: Notification[];
  totalCount: number;
  sentAt: string;
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
      service: "communication_layer",
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}

// ─── Core notification ────────────────────────────────────────────────────────

export function createNotification(params: {
  organizationId: number;
  recipientUserId: number;
  senderUserId: number | null;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
}): Notification {
  const now = new Date().toISOString();
  const correlationId = createHash("sha256")
    .update(`${params.organizationId}:${params.recipientUserId}:${params.type}:${now}`)
    .digest("hex")
    .slice(0, 32);
  const id = nextId("ntf", correlationId);

  const notification: Notification = {
    id,
    organizationId: params.organizationId,
    recipientUserId: params.recipientUserId,
    senderUserId: params.senderUserId,
    type: params.type,
    priority: params.priority,
    title: params.title,
    message: params.message,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    read: false,
    readAt: null,
    correlationId,
    createdAt: now,
  };

  emit("notification_created", {
    notificationId: id,
    type: params.type,
    recipientUserId: params.recipientUserId,
    organizationId: params.organizationId,
  });

  return notification;
}

export function markAsRead(
  notification: Notification,
  _userId: number,
): Notification {
  const now = new Date().toISOString();
  return {
    ...notification,
    read: true,
    readAt: now,
  };
}

export function batchNotify(
  userIds: number[],
  params: Omit<Notification, "id" | "recipientUserId" | "read" | "readAt" | "correlationId" | "createdAt">,
  orgId: number,
): NotificationBatch {
  const now = new Date().toISOString();
  const notifications: Notification[] = userIds.map((uid) =>
    createNotification({
      organizationId: orgId,
      recipientUserId: uid,
      senderUserId: params.senderUserId,
      type: params.type,
      priority: params.priority,
      title: params.title,
      message: params.message,
      entityType: params.entityType,
      entityId: params.entityId,
    }),
  );

  const batchId = nextId("nbt", `${orgId}:${now}`);
  return {
    id: batchId,
    organizationId: orgId,
    notifications,
    totalCount: notifications.length,
    sentAt: now,
  };
}

// ─── Domain-specific notify helpers ───────────────────────────────────────────

export function notifyMentions(
  comment: CollaborationComment,
  mentions: number[],
  orgId: number,
): Notification[] {
  return mentions.map((uid) =>
    createNotification({
      organizationId: orgId,
      recipientUserId: uid,
      senderUserId: comment.author.userId,
      type: "mention",
      priority: "normal",
      title: "Você foi mencionado em um comentário",
      message: `${comment.author.name} mencionou você em um comentário sobre ${comment.entityType} ${comment.entityId}`,
      entityType: comment.entityType,
      entityId: comment.entityId,
    }),
  );
}

export function notifyWorkflowAdvance(
  chain: ApprovalChain,
  actor: { userId?: number; userEmail?: string },
  orgId: number,
): Notification[] {
  const assignees = chain.assignedTo[chain.currentStage] ?? [];
  const actorDisplay = actor.userEmail ?? `user:${actor.userId ?? "system"}`;
  return assignees.map((uid) =>
    createNotification({
      organizationId: orgId,
      recipientUserId: uid,
      senderUserId: actor.userId ?? null,
      type: "workflow_alert",
      priority: "high",
      title: "Workflow avançou para o seu estágio",
      message: `${actorDisplay} avançou o workflow para o estágio "${chain.currentStage}"`,
      entityType: "workflow",
      entityId: chain.id,
    }),
  );
}

export function notifyReviewRequest(
  itemId: string,
  reviewers: number[],
  sender: number,
  orgId: number,
): Notification[] {
  return reviewers.map((uid) =>
    createNotification({
      organizationId: orgId,
      recipientUserId: uid,
      senderUserId: sender,
      type: "review_request",
      priority: "high",
      title: "Solicitação de revisão",
      message: `Uma revisão foi solicitada para o item ${itemId}`,
      entityType: "item_tr",
      entityId: itemId,
    }),
  );
}

export function notifyAnomalyDetected(
  anomalyType: string,
  severity: string,
  orgId: number,
): Notification[] {
  // Notify organization-level (sentinel user 0 means admin)
  return [
    createNotification({
      organizationId: orgId,
      recipientUserId: 0, // admin placeholder
      senderUserId: null,
      type: "anomaly_alert",
      priority: severity === "critical" ? "urgent" : "high",
      title: `Anomalia detectada: ${anomalyType}`,
      message: `Uma anomalia do tipo "${anomalyType}" foi detectada (severidade: ${severity})`,
      entityType: null,
      entityId: null,
    }),
  ];
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getPendingNotifications(
  userId: number,
  orgId: number,
): (notifications: Notification[]) => Notification[] {
  return (notifications) =>
    notifications.filter(
      (n) =>
        n.organizationId === orgId &&
        n.recipientUserId === userId &&
        !n.read,
    );
}

export function getNotificationStats(
  orgId: number,
): (notifications: Notification[]) => {
  total: number;
  unread: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
} {
  return (notifications) => {
    const orgNotifs = notifications.filter((n) => n.organizationId === orgId);
    const unread = orgNotifs.filter((n) => !n.read).length;
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const n of orgNotifs) {
      byType[n.type] = (byType[n.type] ?? 0) + 1;
      byPriority[n.priority] = (byPriority[n.priority] ?? 0) + 1;
    }
    return { total: orgNotifs.length, unread, byType, byPriority };
  };
}
