/**
 * Push notifications — Forge API removed.
 * Currently logs to console and returns false (no-op fallback).
 * To re-enable: integrate with Resend, SendGrid, or Web Push API.
 */
import { TRPCError } from "@trpc/server";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

function validate(input: NotificationPayload): NotificationPayload {
  const title = input.title?.trim();
  const content = input.content?.trim();

  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "Notification title is required." });
  if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "Notification content is required." });
  if (title.length > TITLE_MAX_LENGTH)
    throw new TRPCError({ code: "BAD_REQUEST", message: `Title must be at most ${TITLE_MAX_LENGTH} characters.` });
  if (content.length > CONTENT_MAX_LENGTH)
    throw new TRPCError({ code: "BAD_REQUEST", message: `Content must be at most ${CONTENT_MAX_LENGTH} characters.` });

  return { title, content };
}

/**
 * Dispatches an owner notification.
 * Returns `true` if delivered, `false` if no provider is configured.
 * Callers should fall back to email/slack on `false`.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const { title, content } = validate(payload);
  console.log(`[Notification] (no-op) title="${title}" content="${content.slice(0, 80)}..."`);
  return false;
}
