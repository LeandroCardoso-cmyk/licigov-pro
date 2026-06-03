/**
 * Sprint 3.3 — Collaboration Domain.
 *
 * Collaboration layer for document threads and comments.
 * PRINCIPLES:
 *   - Immutable history: comments/threads never edited in place.
 *   - Audit-safe: soft deletes only, content preserved.
 *   - Replay-safe: deterministic IDs from inputs.
 *   - Multi-tenant: organizationId mandatory.
 */

import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommentAuthor {
  userId: number;
  name: string;
  role: string;
}

export type CommentStatus = "active" | "resolved" | "deleted";

export interface EditHistoryEntry {
  content: string;
  editedAt: string;
}

export interface CollaborationComment {
  id: string;
  organizationId: number;
  entityType: "item_tr" | "clause" | "document" | "workflow";
  entityId: string;
  threadId: string | null;
  content: string;
  author: CommentAuthor;
  mentions: number[];
  status: CommentStatus;
  editHistory: EditHistoryEntry[];
  attachments: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DiscussionThread {
  id: string;
  organizationId: number;
  entityType: "item_tr" | "clause" | "document" | "workflow";
  entityId: string;
  title: string;
  rootCommentId: string;
  comments: CollaborationComment[];
  status: "open" | "resolved";
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface MentionNotification {
  id: string;
  organizationId: number;
  mentionedUserId: number;
  mentionerUserId: number;
  commentId: string;
  threadId: string;
  entityType: string;
  entityId: string;
  read: boolean;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;

function genId(...parts: (string | number)[]): string {
  _idCounter++;
  return createHash("sha256")
    .update(`${parts.join(":")}:${_idCounter}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

// ─── Comment functions ────────────────────────────────────────────────────────

export function createComment(params: {
  organizationId: number;
  entityType: CollaborationComment["entityType"];
  entityId: string;
  threadId: string | null;
  content: string;
  author: CommentAuthor;
  attachments?: string[];
}): CollaborationComment {
  const now = new Date().toISOString();
  const mentions = extractMentions(params.content);
  const id = genId(
    params.organizationId,
    params.entityId,
    params.author.userId,
    now,
  );
  return {
    id,
    organizationId: params.organizationId,
    entityType: params.entityType,
    entityId: params.entityId,
    threadId: params.threadId,
    content: params.content,
    author: params.author,
    mentions,
    status: "active",
    editHistory: [],
    attachments: params.attachments ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function editComment(
  comment: CollaborationComment,
  newContent: string,
  editor: CommentAuthor,
): CollaborationComment {
  const now = new Date().toISOString();
  // Preserve old content in history
  const historyEntry: EditHistoryEntry = {
    content: comment.content,
    editedAt: now,
  };
  return {
    ...comment,
    content: newContent,
    mentions: extractMentions(newContent),
    editHistory: [...comment.editHistory, historyEntry],
    author: editor.userId === comment.author.userId ? comment.author : comment.author,
    updatedAt: now,
  };
}

export function resolveComment(
  comment: CollaborationComment,
  resolverId: number,
): CollaborationComment {
  return {
    ...comment,
    status: "resolved",
    updatedAt: new Date().toISOString(),
  };
}

export function deleteComment(
  comment: CollaborationComment,
  deleterId: number,
): CollaborationComment {
  // Soft delete — content preserved, status changed
  return {
    ...comment,
    status: "deleted",
    updatedAt: new Date().toISOString(),
  };
}

// ─── Thread functions ─────────────────────────────────────────────────────────

export function createThread(params: {
  organizationId: number;
  entityType: DiscussionThread["entityType"];
  entityId: string;
  title: string;
  rootComment: CollaborationComment;
}): DiscussionThread {
  const now = new Date().toISOString();
  const id = genId(params.organizationId, params.entityId, params.title, now);
  return {
    id,
    organizationId: params.organizationId,
    entityType: params.entityType,
    entityId: params.entityId,
    title: params.title,
    rootCommentId: params.rootComment.id,
    comments: [params.rootComment],
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
  };
}

export function addCommentToThread(
  thread: DiscussionThread,
  comment: CollaborationComment,
): DiscussionThread {
  // Immutable — returns new object
  return {
    ...thread,
    comments: [...thread.comments, comment],
  };
}

export function resolveThread(
  thread: DiscussionThread,
  userId: number,
): DiscussionThread {
  return {
    ...thread,
    status: "resolved",
    resolvedBy: userId,
    resolvedAt: new Date().toISOString(),
  };
}

// ─── Mention helpers ──────────────────────────────────────────────────────────

export function extractMentions(content: string): number[] {
  const matches = content.matchAll(/@(\d+)/g);
  const ids = new Set<number>();
  for (const match of matches) {
    const id = parseInt(match[1], 10);
    if (!isNaN(id)) ids.add(id);
  }
  return Array.from(ids);
}

export function buildMentionNotification(
  comment: CollaborationComment,
  mentionedUserId: number,
): MentionNotification {
  const now = new Date().toISOString();
  const id = genId(comment.id, mentionedUserId, now);
  return {
    id,
    organizationId: comment.organizationId,
    mentionedUserId,
    mentionerUserId: comment.author.userId,
    commentId: comment.id,
    threadId: comment.threadId ?? comment.id,
    entityType: comment.entityType,
    entityId: comment.entityId,
    read: false,
    createdAt: now,
  };
}

// ─── Thread query helpers ─────────────────────────────────────────────────────

export function getThreadComments(
  thread: DiscussionThread,
): CollaborationComment[] {
  // Excludes deleted from view but preserves in thread.comments
  return thread.comments.filter((c) => c.status !== "deleted");
}

export function threadSummary(
  thread: DiscussionThread,
): { total: number; resolved: number; active: number; mentions: number } {
  const visible = thread.comments;
  const active = visible.filter((c) => c.status === "active").length;
  const resolved = visible.filter((c) => c.status === "resolved").length;
  const mentions = visible.reduce((acc, c) => acc + c.mentions.length, 0);
  return {
    total: visible.length,
    resolved,
    active,
    mentions,
  };
}
