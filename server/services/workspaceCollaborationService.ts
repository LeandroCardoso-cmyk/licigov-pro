/**
 * Sprint 5.0 — Workspace Collaboration Service
 *
 * Coordena colaboração entre usuários e copilotos: comentários, revisões,
 * marcações, delegação e notificações internas. Comentários/revisões são
 * registrados na timeline (auditável). Determinístico.
 */

import { createHash } from "crypto";
import { recordEvent } from "./workspaceTimelineService";

export interface Comment {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly authorId: number;
  readonly body: string;
  readonly refId: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createComment(params: {
  workspaceId: string;
  organizationId: number;
  authorId: number;
  body: string;
  refId?: string;
  correlationId: string;
  createdAt?: string;
}): Comment {
  const id = createHash("sha256")
    .update(`wcmt:${params.organizationId}:${params.workspaceId}:${params.authorId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    authorId: params.authorId,
    body: params.body,
    refId: params.refId ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Registra um comentário e o reflete na timeline institucional. */
export async function postComment(params: {
  workspaceId: string;
  organizationId: number;
  authorId: number;
  body: string;
  refId?: string;
  correlationId: string;
}): Promise<Comment> {
  const comment = createComment(params);
  await recordEvent({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    eventType: "comment",
    actor: String(params.authorId),
    summary: params.body.slice(0, 140),
    refId: comment.id,
    correlationId: params.correlationId,
  });
  return comment;
}

export interface Delegation {
  readonly workspaceId: string;
  readonly fromUser: number;
  readonly toUser: number;
  readonly taskId: string;
}

/** Delega uma tarefa a outro usuário, registrando na timeline. */
export async function delegateTask(params: {
  workspaceId: string;
  organizationId: number;
  fromUser: number;
  toUser: number;
  taskId: string;
  correlationId: string;
}): Promise<Delegation> {
  await recordEvent({
    organizationId: params.organizationId,
    workspaceId: params.workspaceId,
    eventType: "change",
    actor: String(params.fromUser),
    summary: `Tarefa ${params.taskId} delegada ao usuário ${params.toUser}.`,
    refId: params.taskId,
    correlationId: params.correlationId,
  });
  return { workspaceId: params.workspaceId, fromUser: params.fromUser, toUser: params.toUser, taskId: params.taskId };
}
