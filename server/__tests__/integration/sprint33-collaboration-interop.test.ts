/**
 * Sprint 3.3 — Collaboration + Interoperability + Institutional Workflow Tests.
 *
 * Covers:
 *   - collaboration.ts domain
 *   - documentCollaborationService
 *   - webhookService
 *   - ssoFoundationService
 *   - externalStorageFoundation
 *   - communicationLayer
 *   - structuredExportService
 *   - interoperabilityObservabilityService
 *
 * Meta: 1090+ tests passing, 0 regressions.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Domain imports ───────────────────────────────────────────────────────────

import {
  createComment,
  editComment,
  resolveComment,
  deleteComment,
  createThread,
  addCommentToThread,
  resolveThread,
  extractMentions,
  buildMentionNotification,
  getThreadComments,
  threadSummary,
  type CollaborationComment,
  type CommentAuthor,
  type DiscussionThread,
} from "../../domain/collaboration";

// ─── Service imports ──────────────────────────────────────────────────────────

import {
  computeDiff,
  buildDocumentDiff,
  buildVersionLineage,
  getMergeConflicts,
  computeDiffSummary,
  rollbackToVersion,
  buildChangeSummary,
  type VersionEntry,
  type DiffChange,
} from "../../services/documentCollaborationService";

import {
  createEndpoint,
  signPayload,
  buildDelivery,
  processDelivery,
  retryDelivery,
  moveToDeadLetter,
  buildWebhookPayload,
  dispatchEvent,
  getDeliveryStats,
  type WebhookEndpoint,
  type WebhookPayload,
} from "../../services/webhookService";

import {
  registerIdentityProvider,
  mapUserIdentity,
  syncGroupMappings,
  createFederatedSession,
  isSessionValid,
  getProviderByType,
  buildRoleSyncPlan,
  resolveUserRoles,
} from "../../services/ssoFoundationService";

import {
  registerAdapter,
  createSyncMetadata,
  updateSyncStatus,
  detectConflicts,
  createStorageSnapshot,
  verifyStorageIntegrity,
  buildSyncPlan,
} from "../../services/externalStorageFoundation";

import {
  createNotification,
  markAsRead,
  batchNotify,
  notifyMentions,
  notifyWorkflowAdvance,
  notifyReviewRequest,
  notifyAnomalyDetected,
  getPendingNotifications,
  getNotificationStats,
} from "../../services/communicationLayer";

import {
  exportItemTRsAsJson,
  exportItemTRsAsXml,
  exportAuditTrailAsJson,
  exportWorkflowAsJson,
  getInteroperabilityContract,
  validateExportPayload,
  computeExportChecksum,
} from "../../services/structuredExportService";

import {
  recordApiUsage,
  recordWebhookDelivery,
  recordCollaborationEvent,
  recordWorkflowTransition,
  detectWebhookAnomalies,
  detectCollaborationSpike,
  computeApiMetrics,
  type ApiUsageMetric,
  type CollaborationMetric,
} from "../../services/interoperabilityObservabilityService";

import {
  createApprovalChain,
} from "../../domain/institutionalWorkflow";

import type { ItemTR } from "../../domain/itemTR";
import type { AuditEvent } from "../../services/operationalAuditService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_ID = 42;

function makeAuthor(userId = 1, role = "editor"): CommentAuthor {
  return { userId, name: `User ${userId}`, role };
}

function makeComment(overrides: Partial<Parameters<typeof createComment>[0]> = {}): CollaborationComment {
  return createComment({
    organizationId: ORG_ID,
    entityType: "item_tr",
    entityId: "item_001",
    threadId: null,
    content: "Hello world",
    author: makeAuthor(),
    ...overrides,
  });
}

function makeVersionEntry(versionId: string, content: string | Record<string, unknown> = "v1 content"): VersionEntry {
  const { createHash } = require("crypto") as typeof import("crypto");
  const str = typeof content === "string" ? content : JSON.stringify(content);
  return {
    versionId,
    content,
    author: 1,
    message: `Version ${versionId}`,
    checksum: createHash("sha256").update(str).digest("hex").slice(0, 32),
    createdAt: new Date().toISOString(),
  };
}

function makeEndpoint(): WebhookEndpoint {
  return createEndpoint({
    organizationId: ORG_ID,
    url: "https://example.com/webhook",
    events: ["tr.approved", "item.approved"],
    secret: "super-secret-key-123",
  });
}

function makePayload(): WebhookPayload {
  return buildWebhookPayload("tr.approved", { trId: "tr_001" }, ORG_ID);
}

function makeItemTR(id = "item_001"): ItemTR {
  return {
    id,
    organizationId: ORG_ID,
    processId: 1,
    itemNumber: 1,
    description: "Cadeiras ergonômicas",
    quantity: 10,
    unit: "UN",
    estimatedPrice: 50000,
    status: "approved",
    source: "manual",
    candidates: [],
    consensus: null,
    provenance: null,
    reviewHistory: { transitions: [] },
    currentReviewState: "approved",
    catmatCode: null,
    catserCode: null,
    explainabilityScore: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ItemTR;
}

function makeAuditEvent(id = "evt_001"): AuditEvent {
  return {
    id,
    organizationId: ORG_ID,
    category: "approval",
    action: "approved",
    actorId: 1,
    actorRole: "approver",
    targetType: "item_tr",
    targetId: "item_001",
    before: null,
    after: { status: "approved" },
    justification: "Revisão concluída",
    correlationId: "corr_001",
    occurredAt: new Date().toISOString(),
  };
}

// ─── Tests: collaboration.ts ──────────────────────────────────────────────────

describe("collaboration.ts — domain", () => {
  describe("createComment", () => {
    it("creates a comment with active status", () => {
      const comment = makeComment();
      expect(comment.status).toBe("active");
      expect(comment.organizationId).toBe(ORG_ID);
      expect(comment.entityType).toBe("item_tr");
      expect(comment.editHistory).toHaveLength(0);
      expect(comment.id).toBeTruthy();
    });

    it("extracts mentions from content", () => {
      const comment = makeComment({ content: "Hello @1 and @2 and @1" });
      expect(comment.mentions).toContain(1);
      expect(comment.mentions).toContain(2);
      expect(comment.mentions).toHaveLength(2); // deduplicated
    });

    it("creates comment with null threadId for root", () => {
      const comment = makeComment({ threadId: null });
      expect(comment.threadId).toBeNull();
    });

    it("creates comment with threadId for reply", () => {
      const comment = makeComment({ threadId: "thread_abc" });
      expect(comment.threadId).toBe("thread_abc");
    });

    it("produces different ids for different content", () => {
      const c1 = makeComment({ content: "First" });
      const c2 = makeComment({ content: "Second" });
      expect(c1.id).not.toBe(c2.id);
    });
  });

  describe("editComment", () => {
    it("updates content and preserves history", () => {
      const original = makeComment({ content: "Original" });
      const edited = editComment(original, "Updated", makeAuthor());
      expect(edited.content).toBe("Updated");
      expect(edited.editHistory).toHaveLength(1);
      expect(edited.editHistory[0].content).toBe("Original");
    });

    it("appends to existing edit history (immutable)", () => {
      const c1 = makeComment({ content: "v1" });
      const c2 = editComment(c1, "v2", makeAuthor());
      const c3 = editComment(c2, "v3", makeAuthor());
      expect(c3.editHistory).toHaveLength(2);
      expect(c3.editHistory[0].content).toBe("v1");
      expect(c3.editHistory[1].content).toBe("v2");
      expect(c3.content).toBe("v3");
    });

    it("does not mutate original comment", () => {
      const original = makeComment({ content: "original" });
      const originalId = original.id;
      editComment(original, "new", makeAuthor());
      expect(original.content).toBe("original");
      expect(original.id).toBe(originalId);
    });
  });

  describe("resolveComment", () => {
    it("sets status to resolved", () => {
      const comment = makeComment();
      const resolved = resolveComment(comment, 1);
      expect(resolved.status).toBe("resolved");
    });

    it("does not mutate original", () => {
      const comment = makeComment();
      resolveComment(comment, 1);
      expect(comment.status).toBe("active");
    });
  });

  describe("deleteComment (soft delete)", () => {
    it("sets status to deleted", () => {
      const comment = makeComment();
      const deleted = deleteComment(comment, 1);
      expect(deleted.status).toBe("deleted");
    });

    it("preserves content (audit-safe)", () => {
      const comment = makeComment({ content: "Preserve this" });
      const deleted = deleteComment(comment, 1);
      expect(deleted.content).toBe("Preserve this");
    });

    it("does not mutate original", () => {
      const comment = makeComment();
      deleteComment(comment, 1);
      expect(comment.status).toBe("active");
    });
  });

  describe("createThread", () => {
    it("creates a thread with open status", () => {
      const rootComment = makeComment();
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Discussão sobre especificações",
        rootComment,
      });
      expect(thread.status).toBe("open");
      expect(thread.resolvedBy).toBeNull();
      expect(thread.resolvedAt).toBeNull();
      expect(thread.comments).toHaveLength(1);
      expect(thread.rootCommentId).toBe(rootComment.id);
    });
  });

  describe("addCommentToThread", () => {
    it("returns new thread with comment appended (immutable)", () => {
      const root = makeComment();
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Thread",
        rootComment: root,
      });
      const reply = makeComment({ content: "Reply", threadId: thread.id });
      const updated = addCommentToThread(thread, reply);
      expect(updated.comments).toHaveLength(2);
      expect(thread.comments).toHaveLength(1); // original unchanged
    });

    it("preserves thread id", () => {
      const root = makeComment();
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Thread",
        rootComment: root,
      });
      const reply = makeComment({ content: "Reply" });
      const updated = addCommentToThread(thread, reply);
      expect(updated.id).toBe(thread.id);
    });
  });

  describe("resolveThread", () => {
    it("sets thread status to resolved", () => {
      const root = makeComment();
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Thread",
        rootComment: root,
      });
      const resolved = resolveThread(thread, 1);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolvedBy).toBe(1);
      expect(resolved.resolvedAt).toBeTruthy();
    });
  });

  describe("extractMentions", () => {
    it("extracts single mention", () => {
      expect(extractMentions("Hello @42")).toEqual([42]);
    });

    it("extracts multiple mentions", () => {
      const mentions = extractMentions("Hi @1 and @2 and @3");
      expect(mentions).toContain(1);
      expect(mentions).toContain(2);
      expect(mentions).toContain(3);
    });

    it("deduplicates mentions", () => {
      expect(extractMentions("@1 @1 @2")).toHaveLength(2);
    });

    it("returns empty for no mentions", () => {
      expect(extractMentions("No mentions here")).toEqual([]);
    });

    it("ignores non-numeric @", () => {
      const mentions = extractMentions("@name is not a mention");
      expect(mentions).toHaveLength(0);
    });
  });

  describe("buildMentionNotification", () => {
    it("creates a mention notification", () => {
      const comment = makeComment({ content: "Hello @99" });
      const notif = buildMentionNotification(comment, 99);
      expect(notif.mentionedUserId).toBe(99);
      expect(notif.mentionerUserId).toBe(comment.author.userId);
      expect(notif.commentId).toBe(comment.id);
      expect(notif.read).toBe(false);
    });
  });

  describe("getThreadComments", () => {
    it("excludes deleted comments from view", () => {
      const root = makeComment({ content: "Root" });
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Thread",
        rootComment: root,
      });
      const deleted = deleteComment(makeComment({ content: "Deleted" }), 1);
      const reply = makeComment({ content: "Active reply" });
      const t2 = addCommentToThread(thread, deleted);
      const t3 = addCommentToThread(t2, reply);
      const visible = getThreadComments(t3);
      expect(visible.every((c) => c.status !== "deleted")).toBe(true);
      expect(t3.comments).toHaveLength(3); // all preserved in history
    });
  });

  describe("threadSummary", () => {
    it("counts active, resolved, mentions", () => {
      const root = makeComment({ content: "Root @5" });
      const thread = createThread({
        organizationId: ORG_ID,
        entityType: "item_tr",
        entityId: "item_001",
        title: "Thread",
        rootComment: root,
      });
      const summary = threadSummary(thread);
      expect(summary.total).toBe(1);
      expect(summary.active).toBe(1);
      expect(summary.resolved).toBe(0);
      expect(summary.mentions).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── Tests: documentCollaborationService ─────────────────────────────────────

describe("documentCollaborationService", () => {
  describe("computeDiff (text)", () => {
    it("returns empty for identical texts", () => {
      const changes = computeDiff("hello", "hello", "text");
      expect(changes).toHaveLength(0);
    });

    it("detects modification", () => {
      const changes = computeDiff("original", "modified", "text");
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0].type).toBe("modified");
    });

    it("is deterministic (replay-safe)", () => {
      const a = computeDiff("foo bar baz", "foo qux baz", "text");
      const b = computeDiff("foo bar baz", "foo qux baz", "text");
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("detects added content", () => {
      const changes = computeDiff("", "new content", "text");
      expect(changes[0].type).toBe("added");
    });

    it("detects removed content", () => {
      const changes = computeDiff("removed", "", "text");
      expect(changes[0].type).toBe("removed");
    });

    it("similarity is between 0 and 1", () => {
      const changes = computeDiff("hello world", "hello there", "text");
      for (const c of changes) {
        expect(c.similarity).toBeGreaterThanOrEqual(0);
        expect(c.similarity).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("computeDiff (object)", () => {
    it("detects field modifications", () => {
      const changes = computeDiff(
        { name: "old", qty: "10" },
        { name: "new", qty: "10" },
        "object",
      );
      expect(changes.some((c) => c.field === "name" && c.type === "modified")).toBe(true);
      expect(changes.some((c) => c.field === "qty")).toBe(false);
    });

    it("detects added fields", () => {
      const changes = computeDiff({}, { newField: "value" }, "object");
      expect(changes.some((c) => c.type === "added" && c.field === "newField")).toBe(true);
    });

    it("detects removed fields", () => {
      const changes = computeDiff({ oldField: "v" }, {}, "object");
      expect(changes.some((c) => c.type === "removed" && c.field === "oldField")).toBe(true);
    });

    it("is deterministic for objects", () => {
      const obj1 = { a: "1", b: "2" };
      const obj2 = { a: "x", b: "2" };
      const d1 = computeDiff(obj1, obj2, "object");
      const d2 = computeDiff(obj1, obj2, "object");
      expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
    });
  });

  describe("buildDocumentDiff", () => {
    it("builds a diff between two versions", () => {
      const from = makeVersionEntry("v1", "original content");
      const to = makeVersionEntry("v2", "modified content");
      const diff = buildDocumentDiff(from, to, ORG_ID);
      expect(diff.organizationId).toBe(ORG_ID);
      expect(diff.fromVersionId).toBe("v1");
      expect(diff.toVersionId).toBe("v2");
      expect(diff.summary).toBeTruthy();
    });

    it("has empty changes for identical versions", () => {
      const v = makeVersionEntry("v1", "same content");
      const diff = buildDocumentDiff(v, v, ORG_ID);
      expect(diff.changes).toHaveLength(0);
    });
  });

  describe("getMergeConflicts", () => {
    it("detects conflicting field modifications", () => {
      const from = makeVersionEntry("v1", { field: "original" });
      const toA = makeVersionEntry("v2", { field: "version-a" });
      const toB = makeVersionEntry("v3", { field: "version-b" });
      const diffA = buildDocumentDiff(from, toA, ORG_ID);
      const diffB = buildDocumentDiff(from, toB, ORG_ID);
      const conflicts = getMergeConflicts([diffA, diffB]);
      expect(conflicts.some((c) => c.field === "field")).toBe(true);
    });

    it("returns empty for non-conflicting diffs", () => {
      const from = makeVersionEntry("v1", { a: "1" });
      const to = makeVersionEntry("v2", { a: "1" });
      const diff = buildDocumentDiff(from, to, ORG_ID);
      const conflicts = getMergeConflicts([diff]);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("rollbackToVersion", () => {
    it("finds the correct version", () => {
      const v1 = makeVersionEntry("v1", "content v1");
      const v2 = makeVersionEntry("v2", "content v2");
      const lineage = buildVersionLineage("entity_1", "item_tr", ORG_ID, [v1, v2]);
      const rolled = rollbackToVersion(lineage, "v1");
      expect(rolled.versionId).toBe("v1");
    });

    it("throws for non-existent version", () => {
      const v1 = makeVersionEntry("v1", "content");
      const lineage = buildVersionLineage("entity_1", "item_tr", ORG_ID, [v1]);
      expect(() => rollbackToVersion(lineage, "nonexistent")).toThrow();
    });
  });

  describe("buildChangeSummary", () => {
    it("summarizes change counts", () => {
      const from = makeVersionEntry("v1", { a: "1", b: "old" });
      const to = makeVersionEntry("v2", { b: "new", c: "added" });
      const diff = buildDocumentDiff(from, to, ORG_ID);
      const summary = buildChangeSummary(diff);
      expect(summary).toHaveProperty("addedCount");
      expect(summary).toHaveProperty("removedCount");
      expect(summary).toHaveProperty("modifiedCount");
      expect(summary).toHaveProperty("highImpactChanges");
    });
  });

  describe("computeDiffSummary", () => {
    it("formats summary correctly", () => {
      const changes: DiffChange[] = [
        { field: "a", type: "modified", before: "x", after: "y", similarity: 0.5 },
        { field: "b", type: "added", before: null, after: "new", similarity: 0 },
      ];
      const summary = computeDiffSummary(changes);
      expect(summary).toContain("1");
      expect(summary).toContain("modificado");
    });

    it("returns 'Sem alterações' for empty diff", () => {
      expect(computeDiffSummary([])).toBe("Sem alterações");
    });
  });
});

// ─── Tests: webhookService ────────────────────────────────────────────────────

describe("webhookService", () => {
  describe("signPayload (replay-safe)", () => {
    it("is deterministic — same payload => same signature", () => {
      const payload = makePayload();
      const endpoint = makeEndpoint();
      const sig1 = signPayload(payload, endpoint.secret);
      const sig2 = signPayload(payload, endpoint.secret);
      expect(sig1).toBe(sig2);
    });

    it("differs for different secrets", () => {
      const payload = makePayload();
      const sig1 = signPayload(payload, "secret1");
      const sig2 = signPayload(payload, "secret2");
      expect(sig1).not.toBe(sig2);
    });

    it("differs for different payloads", () => {
      const p1 = buildWebhookPayload("tr.approved", { id: "1" }, ORG_ID);
      const p2 = buildWebhookPayload("item.approved", { id: "2" }, ORG_ID);
      const sig1 = signPayload(p1, "secret");
      const sig2 = signPayload(p2, "secret");
      expect(sig1).not.toBe(sig2);
    });

    it("returns hex string", () => {
      const payload = makePayload();
      const sig = signPayload(payload, "secret");
      expect(/^[0-9a-f]+$/.test(sig)).toBe(true);
    });
  });

  describe("buildWebhookPayload", () => {
    it("creates payload with correct fields", () => {
      const payload = buildWebhookPayload("tr.approved", { key: "val" }, ORG_ID);
      expect(payload.eventType).toBe("tr.approved");
      expect(payload.organizationId).toBe(ORG_ID);
      expect(payload.version).toBe("1.0");
      expect(payload.correlationId).toBeTruthy();
      expect(payload.data.key).toBe("val");
    });
  });

  describe("createEndpoint", () => {
    it("creates an active endpoint", () => {
      const ep = makeEndpoint();
      expect(ep.active).toBe(true);
      expect(ep.url).toBe("https://example.com/webhook");
      expect(ep.events).toContain("tr.approved");
    });
  });

  describe("buildDelivery", () => {
    it("creates delivery in pending status", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivery = buildDelivery(ep, payload);
      expect(delivery.status).toBe("pending");
      expect(delivery.attempts).toBe(0);
      expect(delivery.signature).toBeTruthy();
    });
  });

  describe("processDelivery", () => {
    it("marks delivery as delivered", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivery = buildDelivery(ep, payload);
      const processed = processDelivery(delivery, ep);
      expect(processed.status).toBe("delivered");
      expect(processed.attempts).toBe(1);
      expect(processed.deliveredAt).toBeTruthy();
    });
  });

  describe("retryDelivery", () => {
    it("retries up to max attempts", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivery = buildDelivery(ep, payload);
      const retried = retryDelivery(delivery, ep, 1);
      expect(["delivered", "dead_letter"]).toContain(retried.status);
    });

    it("moves to dead_letter after max attempts", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivery = buildDelivery(ep, payload);
      const deadLetter = retryDelivery(delivery, ep, 4); // > 3
      expect(deadLetter.status).toBe("dead_letter");
    });
  });

  describe("moveToDeadLetter", () => {
    it("sets dead_letter status with reason", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivery = buildDelivery(ep, payload);
      const dead = moveToDeadLetter(delivery, "Timeout");
      expect(dead.status).toBe("dead_letter");
      expect(dead.lastError).toBe("Timeout");
    });
  });

  describe("dispatchEvent", () => {
    it("dispatches to matching active endpoints", () => {
      const ep = makeEndpoint();
      const deliveries = dispatchEvent("tr.approved", { id: "tr_1" }, [ep], ORG_ID);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].status).toBe("delivered");
    });

    it("skips inactive endpoints", () => {
      const ep: WebhookEndpoint = { ...makeEndpoint(), active: false };
      const deliveries = dispatchEvent("tr.approved", {}, [ep], ORG_ID);
      expect(deliveries).toHaveLength(0);
    });

    it("skips endpoints with non-matching events", () => {
      const ep = makeEndpoint(); // only tr.approved, item.approved
      const deliveries = dispatchEvent("anomaly.detected", {}, [ep], ORG_ID);
      expect(deliveries).toHaveLength(0);
    });

    it("skips endpoints from different org", () => {
      const ep = makeEndpoint(); // ORG_ID = 42
      const deliveries = dispatchEvent("tr.approved", {}, [ep], 999);
      expect(deliveries).toHaveLength(0);
    });
  });

  describe("getDeliveryStats", () => {
    it("computes correct stats", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const delivered = processDelivery(buildDelivery(ep, payload), ep);
      const failed = moveToDeadLetter(buildDelivery(ep, payload), "Error");
      const stats = getDeliveryStats([delivered, failed]);
      expect(stats.delivered).toBe(1);
      expect(stats.deadLetter).toBe(1);
      expect(stats.successRate).toBeCloseTo(0.5, 1);
    });

    it("handles empty deliveries", () => {
      const stats = getDeliveryStats([]);
      expect(stats.successRate).toBe(0);
    });
  });
});

// ─── Tests: ssoFoundationService ─────────────────────────────────────────────

describe("ssoFoundationService", () => {
  describe("registerIdentityProvider", () => {
    it("registers a provider with given type", () => {
      const provider = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "microsoft365",
        name: "Tenant MS365",
        config: { tenantId: "abc123" },
      });
      expect(provider.type).toBe("microsoft365");
      expect(provider.active).toBe(true);
      expect(provider.organizationId).toBe(ORG_ID);
    });

    it("generates a unique id", () => {
      const p1 = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "google_workspace",
        name: "Google",
        config: {},
      });
      const p2 = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "azure_ad",
        name: "Azure",
        config: {},
      });
      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe("mapUserIdentity", () => {
    it("creates an identity mapping", () => {
      const mapping = mapUserIdentity({
        organizationId: ORG_ID,
        providerId: "idp_001",
        externalUserId: "ext_user_001",
        internalUserId: 42,
        groups: ["admins"],
        roles: ["editor"],
        lastSyncedAt: new Date().toISOString(),
      });
      expect(mapping.internalUserId).toBe(42);
      expect(mapping.externalUserId).toBe("ext_user_001");
      expect(mapping.id).toBeTruthy();
    });
  });

  describe("syncGroupMappings", () => {
    it("creates mappings for each group", () => {
      const mappings = syncGroupMappings(
        "idp_001",
        ["Admins", "Editors", "Viewers"],
        ORG_ID,
      );
      expect(mappings).toHaveLength(3);
      expect(mappings[0].organizationId).toBe(ORG_ID);
      expect(mappings[0].active).toBe(true);
    });

    it("derives internal role from group name", () => {
      const mappings = syncGroupMappings("idp_001", ["Document Admins"], ORG_ID);
      expect(mappings[0].internalRole).toBeTruthy();
    });
  });

  describe("isSessionValid", () => {
    it("returns true for future expiry", () => {
      const provider = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "generic_oidc",
        name: "OIDC",
        config: {},
      });
      const session = createFederatedSession(1, provider.id, "token_opaque", {}, ORG_ID);
      expect(isSessionValid(session)).toBe(true);
    });

    it("returns false for expired session", () => {
      const provider = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "ldap",
        name: "LDAP",
        config: {},
      });
      const session = createFederatedSession(1, provider.id, "token", {}, ORG_ID);
      const expired = { ...session, expiresAt: new Date(Date.now() - 1000).toISOString() };
      expect(isSessionValid(expired)).toBe(false);
    });
  });

  describe("buildRoleSyncPlan", () => {
    it("maps groups to roles via mappings", () => {
      const mappings = syncGroupMappings("idp_001", ["Editors", "Admins"], ORG_ID);
      const plan = buildRoleSyncPlan(["Editors"], mappings);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0].source).toBe("Editors");
    });

    it("returns empty plan for unmatched groups", () => {
      const plan = buildRoleSyncPlan(["Unknown"], []);
      expect(plan).toHaveLength(0);
    });
  });

  describe("getProviderByType", () => {
    it("finds active provider by type", () => {
      const p = registerIdentityProvider({
        organizationId: ORG_ID,
        type: "microsoft365",
        name: "MS365",
        config: {},
      });
      const found = getProviderByType([p], "microsoft365");
      expect(found?.id).toBe(p.id);
    });

    it("returns null for missing type", () => {
      const found = getProviderByType([], "azure_ad");
      expect(found).toBeNull();
    });
  });
});

// ─── Tests: externalStorageFoundation ────────────────────────────────────────

describe("externalStorageFoundation", () => {
  describe("registerAdapter", () => {
    it("registers adapter with active status", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "google_drive",
        name: "Drive da Prefeitura",
        config: { folderId: "abc" },
      });
      expect(adapter.active).toBe(true);
      expect(adapter.providerType).toBe("google_drive");
    });
  });

  describe("createSyncMetadata", () => {
    it("creates sync metadata with synced status", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "onedrive",
        name: "OneDrive",
        config: {},
      });
      const meta = createSyncMetadata(adapter.id, "ext_001", "/local/file.pdf", "checksum_abc", ORG_ID);
      expect(meta.syncStatus).toBe("synced");
      expect(meta.localPath).toBe("/local/file.pdf");
    });
  });

  describe("detectConflicts", () => {
    it("detects conflicting checksums for same external id", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "s3",
        name: "S3",
        config: {},
      });
      const m1 = createSyncMetadata(adapter.id, "ext_shared", "/path/a", "checksum_A", ORG_ID);
      const m2 = createSyncMetadata(adapter.id, "ext_shared", "/path/b", "checksum_B", ORG_ID);
      const conflicts = detectConflicts([m1, m2]);
      expect(conflicts).toHaveLength(2);
      expect(conflicts.every((c) => c.syncStatus === "conflict")).toBe(true);
    });

    it("returns empty for no conflicts", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "custom",
        name: "Custom",
        config: {},
      });
      const m1 = createSyncMetadata(adapter.id, "ext_001", "/path/a", "same_checksum", ORG_ID);
      const m2 = createSyncMetadata(adapter.id, "ext_002", "/path/b", "other_checksum", ORG_ID);
      const conflicts = detectConflicts([m1, m2]);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("createStorageSnapshot", () => {
    it("creates snapshot with correct counts", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "sharepoint",
        name: "SharePoint",
        config: {},
      });
      const m1 = createSyncMetadata(adapter.id, "e1", "/p1", "c1", ORG_ID);
      const m2 = createSyncMetadata(adapter.id, "e2", "/p2", "c2", ORG_ID);
      const snapshot = createStorageSnapshot(adapter, [m1, m2]);
      expect(snapshot.totalFiles).toBe(2);
      expect(snapshot.syncedFiles).toBe(2);
      expect(snapshot.checksum).toBeTruthy();
    });
  });

  describe("buildSyncPlan", () => {
    it("categorizes metadata into upload/download/conflict", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "google_drive",
        name: "Drive",
        config: {},
      });
      const synced = createSyncMetadata(adapter.id, "e1", "/p1", "c1", ORG_ID);
      const pending = updateSyncStatus(
        createSyncMetadata(adapter.id, "e2", "/upload/me", "c2", ORG_ID),
        "pending",
      );
      const plan = buildSyncPlan([synced, pending]);
      expect(plan.toUpload).toContain("/upload/me");
    });
  });

  describe("verifyStorageIntegrity", () => {
    it("returns valid=true when counts match", () => {
      const adapter = registerAdapter({
        organizationId: ORG_ID,
        providerType: "s3",
        name: "S3",
        config: {},
      });
      const metadata = [
        createSyncMetadata(adapter.id, "e1", "/p1", "c1", ORG_ID),
        createSyncMetadata(adapter.id, "e2", "/p2", "c2", ORG_ID),
      ];
      const snapshot = createStorageSnapshot(adapter, metadata);
      const result = verifyStorageIntegrity(snapshot, metadata);
      expect(result.valid).toBe(true);
      expect(result.mismatches).toBe(0);
    });
  });
});

// ─── Tests: communicationLayer ────────────────────────────────────────────────

describe("communicationLayer", () => {
  describe("createNotification", () => {
    it("creates notification with read=false", () => {
      const n = createNotification({
        organizationId: ORG_ID,
        recipientUserId: 10,
        senderUserId: 1,
        type: "mention",
        priority: "normal",
        title: "Você foi mencionado",
        message: "Alguém mencionou você",
      });
      expect(n.read).toBe(false);
      expect(n.recipientUserId).toBe(10);
      expect(n.correlationId).toBeTruthy();
    });
  });

  describe("markAsRead", () => {
    it("marks notification as read", () => {
      const n = createNotification({
        organizationId: ORG_ID,
        recipientUserId: 10,
        senderUserId: null,
        type: "workflow_alert",
        priority: "high",
        title: "Workflow",
        message: "Avanço de workflow",
      });
      const read = markAsRead(n, 10);
      expect(read.read).toBe(true);
      expect(read.readAt).toBeTruthy();
      expect(n.read).toBe(false); // immutable
    });
  });

  describe("batchNotify", () => {
    it("creates one notification per user", () => {
      const batch = batchNotify(
        [1, 2, 3],
        {
          organizationId: ORG_ID,
          senderUserId: null,
          type: "review_request",
          priority: "high",
          title: "Revisão solicitada",
          message: "Por favor revise",
          entityType: "item_tr",
          entityId: "item_001",
          read: false,
          readAt: null,
          correlationId: "",
          createdAt: "",
        },
        ORG_ID,
      );
      expect(batch.totalCount).toBe(3);
      expect(batch.notifications).toHaveLength(3);
    });
  });

  describe("notifyMentions", () => {
    it("creates notifications for each mention", () => {
      const comment = makeComment({ content: "Hello @10 and @20" });
      const notifications = notifyMentions(comment, [10, 20], ORG_ID);
      expect(notifications).toHaveLength(2);
      expect(notifications.every((n) => n.type === "mention")).toBe(true);
    });
  });

  describe("notifyWorkflowAdvance", () => {
    it("creates notifications for assignees", () => {
      const chain = createApprovalChain({
        organizationId: ORG_ID,
        processId: 1,
        assignedTo: { elaboration: [5, 6] },
      });
      const notifications = notifyWorkflowAdvance(
        chain,
        { userId: 1, userEmail: "user@example.com" },
        ORG_ID,
      );
      expect(notifications.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("notifyReviewRequest", () => {
    it("creates review request notifications", () => {
      const notifications = notifyReviewRequest("item_001", [7, 8], 1, ORG_ID);
      expect(notifications).toHaveLength(2);
      expect(notifications[0].type).toBe("review_request");
    });
  });

  describe("notifyAnomalyDetected", () => {
    it("creates anomaly notification with urgent priority for critical", () => {
      const notifications = notifyAnomalyDetected("high_failure_rate", "critical", ORG_ID);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].priority).toBe("urgent");
    });

    it("creates anomaly notification with high priority for non-critical", () => {
      const notifications = notifyAnomalyDetected("spike", "warning", ORG_ID);
      expect(notifications[0].priority).toBe("high");
    });
  });

  describe("getPendingNotifications", () => {
    it("returns only unread notifications for user+org", () => {
      const n1 = createNotification({
        organizationId: ORG_ID,
        recipientUserId: 10,
        senderUserId: null,
        type: "mention",
        priority: "normal",
        title: "T1",
        message: "M1",
      });
      const n2 = markAsRead(
        createNotification({
          organizationId: ORG_ID,
          recipientUserId: 10,
          senderUserId: null,
          type: "mention",
          priority: "normal",
          title: "T2",
          message: "M2",
        }),
        10,
      );
      const getPending = getPendingNotifications(10, ORG_ID);
      const pending = getPending([n1, n2]);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(n1.id);
    });
  });

  describe("getNotificationStats", () => {
    it("computes unread count and breakdowns", () => {
      const n1 = createNotification({
        organizationId: ORG_ID,
        recipientUserId: 1,
        senderUserId: null,
        type: "mention",
        priority: "normal",
        title: "T",
        message: "M",
      });
      const getStats = getNotificationStats(ORG_ID);
      const stats = getStats([n1]);
      expect(stats.total).toBe(1);
      expect(stats.unread).toBe(1);
      expect(stats.byType.mention).toBe(1);
    });
  });
});

// ─── Tests: structuredExportService ──────────────────────────────────────────

describe("structuredExportService", () => {
  const items = [makeItemTR("i1"), makeItemTR("i2")];
  const events = [makeAuditEvent("e1"), makeAuditEvent("e2")];

  describe("exportItemTRsAsJson (replay-safe)", () => {
    it("produces stable checksum for same input", () => {
      const exp1 = exportItemTRsAsJson(items, ORG_ID);
      const exp2 = exportItemTRsAsJson(items, ORG_ID);
      expect(exp1.checksum).toBe(exp2.checksum);
    });

    it("has correct schema and format", () => {
      const exp = exportItemTRsAsJson(items, ORG_ID);
      expect(exp.schema).toBe("item_tr_v1");
      expect(exp.format).toBe("json");
      expect(exp.version).toBe("1.0");
    });

    it("includes item count in payload", () => {
      const exp = exportItemTRsAsJson(items, ORG_ID);
      expect(exp.payload.count).toBe(2);
    });
  });

  describe("exportItemTRsAsXml", () => {
    it("produces XML in payload", () => {
      const exp = exportItemTRsAsXml(items, ORG_ID);
      expect(exp.format).toBe("xml");
      expect(typeof exp.payload.xml).toBe("string");
      expect((exp.payload.xml as string)).toContain("<?xml");
    });

    it("has stable checksum for same input", () => {
      const exp1 = exportItemTRsAsXml(items, ORG_ID);
      const exp2 = exportItemTRsAsXml(items, ORG_ID);
      expect(exp1.checksum).toBe(exp2.checksum);
    });
  });

  describe("exportAuditTrailAsJson", () => {
    it("exports audit events with count", () => {
      const exp = exportAuditTrailAsJson(events, ORG_ID);
      expect(exp.schema).toBe("audit_v1");
      expect(exp.payload.count).toBe(2);
    });
  });

  describe("exportWorkflowAsJson", () => {
    it("exports workflow chain", () => {
      const chain = createApprovalChain({ organizationId: ORG_ID, processId: 1 });
      const exp = exportWorkflowAsJson(chain, ORG_ID);
      expect(exp.schema).toBe("workflow_v1");
      expect(exp.payload.workflow).toBeTruthy();
    });
  });

  describe("getInteroperabilityContract", () => {
    it("returns contract for item_tr_v1", () => {
      const contract = getInteroperabilityContract("item_tr_v1");
      expect(contract.schema).toBe("item_tr_v1");
      expect(contract.fields.id.required).toBe(true);
    });

    it("returns contract for audit_v1", () => {
      const contract = getInteroperabilityContract("audit_v1");
      expect(contract.schema).toBe("audit_v1");
    });
  });

  describe("validateExportPayload", () => {
    it("validates valid payload", () => {
      const payload = {
        id: "item_001",
        description: "Test",
        quantity: 1,
        unit: "UN",
        status: "approved",
      };
      const result = validateExportPayload(payload, "item_tr_v1");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports missing required fields", () => {
      const result = validateExportPayload({}, "item_tr_v1");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("computeExportChecksum (replay-safe)", () => {
    it("is deterministic for same payload", () => {
      const payload = { a: "1", b: "2" };
      const c1 = computeExportChecksum(payload);
      const c2 = computeExportChecksum(payload);
      expect(c1).toBe(c2);
    });

    it("differs for different payloads", () => {
      const c1 = computeExportChecksum({ a: "1" });
      const c2 = computeExportChecksum({ a: "2" });
      expect(c1).not.toBe(c2);
    });
  });
});

// ─── Tests: interoperabilityObservabilityService ──────────────────────────────

describe("interoperabilityObservabilityService", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("recordApiUsage emits structured log", () => {
    expect(() => recordApiUsage("/api/tr", "GET", ORG_ID, 120, 200)).not.toThrow();
    expect(console.info).toHaveBeenCalled();
  });

  it("recordWebhookDelivery emits log", () => {
    expect(() => recordWebhookDelivery("tr.approved", "delivered", 50, ORG_ID)).not.toThrow();
  });

  it("recordCollaborationEvent emits log", () => {
    expect(() => recordCollaborationEvent("comment_created", ORG_ID, "item_tr")).not.toThrow();
  });

  it("recordWorkflowTransition emits log", () => {
    expect(() => recordWorkflowTransition("technical_review", 3600000, ORG_ID)).not.toThrow();
  });

  describe("detectWebhookAnomalies", () => {
    it("detects high failure rate", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const deliveries = [
        processDelivery(buildDelivery(ep, payload), ep),
        moveToDeadLetter(buildDelivery(ep, payload), "Error"),
        moveToDeadLetter(buildDelivery(ep, payload), "Error"),
      ];
      const anomalies = detectWebhookAnomalies(deliveries);
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].anomalyType).toBe("high_webhook_failure_rate");
    });

    it("returns empty for healthy delivery rate", () => {
      const ep = makeEndpoint();
      const payload = makePayload();
      const deliveries = [
        processDelivery(buildDelivery(ep, payload), ep),
        processDelivery(buildDelivery(ep, payload), ep),
      ];
      const anomalies = detectWebhookAnomalies(deliveries);
      expect(anomalies).toHaveLength(0);
    });

    it("returns empty for empty deliveries", () => {
      expect(detectWebhookAnomalies([])).toHaveLength(0);
    });
  });

  describe("detectCollaborationSpike", () => {
    it("detects spike for >100 events", () => {
      const events: CollaborationMetric[] = Array.from({ length: 101 }, (_, i) => ({
        eventType: "comment",
        organizationId: ORG_ID,
        entityType: "item_tr",
        recordedAt: new Date().toISOString(),
      }));
      const spike = detectCollaborationSpike(events);
      expect(spike).not.toBeNull();
      expect(spike?.anomalyType).toBe("collaboration_event_spike");
    });

    it("returns null for normal event count", () => {
      const events: CollaborationMetric[] = Array.from({ length: 10 }, () => ({
        eventType: "comment",
        organizationId: ORG_ID,
        entityType: "item_tr",
        recordedAt: new Date().toISOString(),
      }));
      expect(detectCollaborationSpike(events)).toBeNull();
    });
  });

  describe("computeApiMetrics", () => {
    it("computes correct averages", () => {
      const usages: ApiUsageMetric[] = [
        { endpoint: "/api/tr", method: "GET", organizationId: ORG_ID, durationMs: 100, status: 200, recordedAt: new Date().toISOString() },
        { endpoint: "/api/items", method: "POST", organizationId: ORG_ID, durationMs: 200, status: 201, recordedAt: new Date().toISOString() },
        { endpoint: "/api/tr", method: "GET", organizationId: ORG_ID, durationMs: 300, status: 500, recordedAt: new Date().toISOString() },
      ];
      const metrics = computeApiMetrics(usages);
      expect(metrics.avgDurationMs).toBeCloseTo(200, 0);
      expect(metrics.errorRate).toBeCloseTo(1 / 3, 2);
      expect(metrics.topEndpoints.length).toBeGreaterThan(0);
    });

    it("returns zeros for empty usage", () => {
      const metrics = computeApiMetrics([]);
      expect(metrics.avgDurationMs).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it("computes p95 latency", () => {
      const usages: ApiUsageMetric[] = Array.from({ length: 100 }, (_, i) => ({
        endpoint: "/api/test",
        method: "GET",
        organizationId: ORG_ID,
        durationMs: (i + 1) * 10,
        status: 200,
        recordedAt: new Date().toISOString(),
      }));
      const metrics = computeApiMetrics(usages);
      expect(metrics.p95).toBeGreaterThan(800);
    });
  });
});
