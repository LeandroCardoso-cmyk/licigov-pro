/**
 * Sprint 3.3 — Collaboration Comments Router.
 *
 * Discussion threads and comments on entities (item_tr, clause, document, workflow).
 * NOT to be confused with collaborationRouter.ts which manages process members.
 *
 * Multi-tenant: organizationId required on all inputs.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import {
  createComment,
  createThread,
  addCommentToThread,
  resolveThread,
  getThreadComments,
} from "../domain/collaboration";
import type {
  CollaborationComment,
  DiscussionThread,
} from "../domain/collaboration";

// In-memory store per org (reset on restart — DB persistence via migration tables)
const threadStore = new Map<number, DiscussionThread[]>();

function getOrgThreads(orgId: number): DiscussionThread[] {
  return threadStore.get(orgId) ?? [];
}

function saveThread(orgId: number, thread: DiscussionThread): void {
  const threads = getOrgThreads(orgId);
  const idx = threads.findIndex((t) => t.id === thread.id);
  if (idx >= 0) {
    threads[idx] = thread;
  } else {
    threads.push(thread);
  }
  threadStore.set(orgId, threads);
}

const entityTypeSchema = z.enum(["item_tr", "clause", "document", "workflow"]);

export const collaborationCommentsRouter = router({
  getThreads: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        entityType: entityTypeSchema,
        organizationId: z.number(),
      }),
    )
    .query(({ input }) => {
      const threads = getOrgThreads(input.organizationId);
      return threads.filter(
        (t) =>
          t.entityId === input.entityId &&
          t.entityType === input.entityType,
      );
    }),

  createComment: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        entityType: entityTypeSchema,
        organizationId: z.number(),
        content: z.string().min(1),
        threadId: z.string().nullable().optional(),
        actorUserId: z.number(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const author = {
        userId: input.actorUserId,
        name: ctx.user.name ?? "Usuário",
        role: ctx.user.role ?? "user",
      };

      const comment = createComment({
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        threadId: input.threadId ?? null,
        content: input.content,
        author,
      });

      if (!input.threadId) {
        // Create a new thread with this as root comment
        const thread = createThread({
          organizationId: input.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          title: input.content.slice(0, 100),
          rootComment: comment,
        });
        saveThread(input.organizationId, thread);
      } else {
        // Add comment to existing thread
        const threads = getOrgThreads(input.organizationId);
        const thread = threads.find((t) => t.id === input.threadId);
        if (thread) {
          const updated = addCommentToThread(thread, comment);
          saveThread(input.organizationId, updated);
        }
      }

      return comment satisfies CollaborationComment;
    }),

  resolveThread: protectedProcedure
    .input(
      z.object({
        threadId: z.string(),
        organizationId: z.number(),
        actorUserId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const threads = getOrgThreads(input.organizationId);
      const thread = threads.find((t) => t.id === input.threadId);
      if (!thread) throw new Error("Thread não encontrada");

      const resolved = resolveThread(thread, input.actorUserId);
      saveThread(input.organizationId, resolved);
      return resolved satisfies DiscussionThread;
    }),

  getTimeline: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        organizationId: z.number(),
      }),
    )
    .query(({ input }) => {
      const threads = getOrgThreads(input.organizationId);
      const entityThreads = threads.filter(
        (t) => t.entityId === input.entityId,
      );
      const allComments: CollaborationComment[] = [];
      for (const thread of entityThreads) {
        allComments.push(...getThreadComments(thread));
      }
      // Sort chronologically
      return allComments.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }),
});
