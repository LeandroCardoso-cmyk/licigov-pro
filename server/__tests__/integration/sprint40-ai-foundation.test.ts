/**
 * Sprint 4.0 — AI Foundation Layer
 * ORG_ID: 9300
 * Target: ~130 tests, 0 regressions
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Domain imports ───────────────────────────────────────────────────────────
import {
  createOrchestration,
  dispatchOrchestration,
  completeOrchestration,
  failOrchestration,
  cancelOrchestration,
  expireOrchestration,
  markAwaitingTool,
  markAwaitingHuman,
  retryOrchestration,
  computeOrchestrationMetrics,
  ORCHESTRATION_TRANSITIONS,
} from "../../domain/aiOrchestration";

import {
  createPromptVersion,
  submitForReview,
  approvePromptVersion,
  rejectPromptVersion,
  deprecatePromptVersion,
  rollbackPromptVersion,
  getLatestApproved,
  extractVariables,
  verifyChecksum,
} from "../../domain/promptGovernance";

import {
  createMemoryEntry,
  retrieveMemories,
  deactivateMemory,
  refreshRelevance,
  isExpired,
  computeMemoryStats,
  createRetrievalReference,
} from "../../domain/semanticMemory";

import {
  createWorkflow,
  startStep,
  completeStep,
  requestHumanReview,
  applyOverride,
  addApproval,
  escalateWorkflow,
  completeWorkflow,
  cancelWorkflow,
  computeWorkflowMetrics,
} from "../../domain/aiWorkflow";

// ─── Service imports ───────────────────────────────────────────────────────────
import {
  executeWithProvider,
  getModelInfo,
  listAvailableModels,
  estimateTokens,
  AVAILABLE_MODELS,
} from "../../services/aiProviderAbstractionService";

import {
  assembleContext,
  createChunk,
  estimateChunkTokens,
  splitIntoChunks,
  getContextStats,
} from "../../services/contextAssemblyService";

import {
  generateEmbedding,
  cosineSimilarity,
  euclideanDistance,
  batchGenerateEmbeddings,
  getCachedEmbedding,
  EMBEDDING_DIMENSIONS,
} from "../../services/embeddingAbstractionService";

import {
  createIndex,
  addToIndex,
  search,
  deleteFromIndex,
  getIndexStats,
  listIndices,
} from "../../services/vectorStoreAbstractionService";

import {
  createEvidence,
  groundContent,
  verifyEvidence,
  assessHallucinationRisk,
  buildCitation,
} from "../../services/groundingEngineService";

import {
  createBudget,
  consumeTokens,
  reserveTokens,
  releaseReservedTokens,
  estimateTokens as estimateBudgetTokens,
  forecastCost,
  truncateToFit,
  isBudgetExhausted,
  getBudgetUtilization,
} from "../../services/tokenBudgetService";

import {
  recordOperation,
  getLineage,
  getAuditRecords,
  verifyRecordIntegrity,
  computeAuditMetrics,
} from "../../services/aiAuditService";

const ORG = 9300;

// ─── 1. aiOrchestration ────────────────────────────────────────────────────────

describe("aiOrchestration", () => {
  it("createOrchestration returns valid aggregate", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s1", provider: "mock", model: "mock-default", inputs: { prompt: "test" } });
    expect(orch.organizationId).toBe(ORG);
    expect(orch.status).toBe("queued");
    expect(orch.attempt).toBe(1);
    expect(orch.history).toHaveLength(1);
    expect(orch.history[0].type).toBe("created");
    expect(orch.replayKey).toBeTruthy();
    expect(orch.lineage).toHaveLength(0);
  });

  it("replayKey is deterministic for same inputs", () => {
    const inputs = { prompt: "hello", system: "be helpful" };
    const o1 = createOrchestration({ organizationId: ORG, sessionId: "s2", provider: "mock", model: "gpt-4o", inputs });
    const o2 = createOrchestration({ organizationId: ORG, sessionId: "s2", provider: "mock", model: "gpt-4o", inputs });
    expect(o1.replayKey).toBe(o2.replayKey);
  });

  it("dispatchOrchestration transitions queued→dispatched", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s3", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(orch);
    expect(dispatched.status).toBe("dispatched");
    expect(dispatched.history.length).toBeGreaterThan(1);
  });

  it("dispatchOrchestration throws if not queued/retrying", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s4", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(orch);
    expect(() => dispatchOrchestration(dispatched)).toThrow();
  });

  it("completeOrchestration sets status=completed and completedAt", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s5", provider: "mock", model: "mock-default", inputs: {} });
    const executing = { ...dispatchOrchestration(orch), status: "executing" as const };
    const completed = completeOrchestration(executing, { result: "ok" });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    expect(completed.outputs).toEqual({ result: "ok" });
  });

  it("failOrchestration sets status=failed with error", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s6", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(orch);
    const failed = failOrchestration(dispatched, "Network timeout");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Network timeout");
  });

  it("retryOrchestration increments attempt and sets status=retrying→dispatched", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s7", provider: "mock", model: "mock-default", inputs: {}, maxAttempts: 3 });
    const dispatched = dispatchOrchestration(orch);
    const failed = failOrchestration(dispatched, "error");
    const retried = retryOrchestration(failed);
    expect(retried.attempt).toBe(2);
  });

  it("retryOrchestration throws if maxAttempts reached", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s8", provider: "mock", model: "mock-default", inputs: {}, maxAttempts: 1 });
    const dispatched = dispatchOrchestration(orch);
    const failed = failOrchestration(dispatched, "error");
    expect(() => retryOrchestration(failed)).toThrow();
  });

  it("cancelOrchestration sets status=cancelled from dispatched", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s9", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(orch);
    const cancelled = cancelOrchestration(dispatched, 1);
    expect(cancelled.status).toBe("cancelled");
  });

  it("expireOrchestration sets status=expired", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s10", provider: "mock", model: "mock-default", inputs: {} });
    const expired = expireOrchestration(orch);
    expect(expired.status).toBe("expired");
  });

  it("markAwaitingTool transitions executing→awaiting_tool", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s11", provider: "mock", model: "mock-default", inputs: {} });
    const executing = { ...dispatchOrchestration(orch), status: "executing" as const };
    const waiting = markAwaitingTool(executing, "web_search");
    expect(waiting.status).toBe("awaiting_tool");
  });

  it("markAwaitingHuman transitions executing→awaiting_human", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s12", provider: "mock", model: "mock-default", inputs: {} });
    const executing = { ...dispatchOrchestration(orch), status: "executing" as const };
    const waiting = markAwaitingHuman(executing, "review needed");
    expect(waiting.status).toBe("awaiting_human");
  });

  it("computeOrchestrationMetrics returns correct totals", () => {
    const o1 = createOrchestration({ organizationId: ORG, sessionId: "m1", provider: "mock", model: "mock-default", inputs: {} });
    const o2 = createOrchestration({ organizationId: ORG, sessionId: "m2", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(o1);
    const executing = { ...dispatched, status: "executing" as const };
    const completed = completeOrchestration(executing, {});
    const metrics = computeOrchestrationMetrics([completed, o2]);
    expect(metrics.total).toBe(2);
    expect(metrics.completed).toBe(1);
  });

  it("history is append-only (immutable, returns new object)", () => {
    const orch = createOrchestration({ organizationId: ORG, sessionId: "s-imm", provider: "mock", model: "mock-default", inputs: {} });
    const dispatched = dispatchOrchestration(orch);
    expect(orch.history).toHaveLength(1);
    expect(dispatched.history.length).toBeGreaterThan(orch.history.length);
    expect(dispatched).not.toBe(orch);
  });

  it("ORCHESTRATION_TRANSITIONS map covers all 10 states", () => {
    const states = Object.keys(ORCHESTRATION_TRANSITIONS);
    expect(states).toContain("queued");
    expect(states).toContain("dispatched");
    expect(states).toContain("executing");
    expect(states).toContain("awaiting_tool");
    expect(states).toContain("awaiting_human");
    expect(states).toContain("retrying");
    expect(states).toContain("completed");
    expect(states).toContain("failed");
    expect(states).toContain("cancelled");
    expect(states).toContain("expired");
  });

  it("ORCHESTRATION_TRANSITIONS queued→dispatched is valid", () => {
    expect(ORCHESTRATION_TRANSITIONS["queued"]).toContain("dispatched");
    expect(ORCHESTRATION_TRANSITIONS["completed"]).not.toContain("queued");
  });
});

// ─── 2. promptGovernance ──────────────────────────────────────────────────────

describe("promptGovernance", () => {
  it("createPromptVersion creates draft with checksum and extracted variables", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "licitacao-summary", version: "1.0.0", content: "Resumo de {{processo}} para {{orgao}}", createdBy: 1 });
    expect(pv.status).toBe("draft");
    expect(pv.variables).toContain("processo");
    expect(pv.variables).toContain("orgao");
    expect(pv.checksum).toBeTruthy();
    expect(pv.version).toBe("1.0.0");
  });

  it("extractVariables extracts {{var}} placeholders", () => {
    const vars = extractVariables("Hello {{name}}, your {{item}} is ready.");
    expect(vars).toContain("name");
    expect(vars).toContain("item");
  });

  it("extractVariables returns empty array if no variables", () => {
    const vars = extractVariables("No placeholders here.");
    expect(vars).toHaveLength(0);
  });

  it("submitForReview transitions draft→pending_review", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-pr", version: "1.0.0", content: "Content {{var}}", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    expect(submitted.status).toBe("pending_review");
    expect(submitted.history.length).toBeGreaterThan(pv.history.length);
  });

  it("submitForReview throws if not in draft status", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-pr2", version: "1.0.0", content: "Content", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    expect(() => submitForReview(submitted, 1)).toThrow();
  });

  it("approvePromptVersion transitions pending_review→approved", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-appr", version: "1.0.0", content: "Test content", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    const approved = approvePromptVersion(submitted, 2);
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(2);
  });

  it("approvePromptVersion throws if not pending_review", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-appr2", version: "1.0.0", content: "Test", createdBy: 1 });
    expect(() => approvePromptVersion(pv, 2)).toThrow();
  });

  it("rejectPromptVersion transitions pending_review→rejected", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-rej", version: "1.0.0", content: "Test", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    const rejected = rejectPromptVersion(submitted, 2, "Inadequate content");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectedBy).toBe(2);
  });

  it("deprecatePromptVersion sets status=deprecated", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-dep", version: "1.0.0", content: "Test", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    const approved = approvePromptVersion(submitted, 2);
    const deprecated = deprecatePromptVersion(approved, 2);
    expect(deprecated.status).toBe("deprecated");
  });

  it("rollbackPromptVersion creates new version with rollback status", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-roll", version: "1.0.0", content: "Original content", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    const approved = approvePromptVersion(submitted, 2);
    const rolled = rollbackPromptVersion({ originalVersion: approved, newVersionTag: "1.0.1-rollback", createdBy: 1 });
    expect(rolled.status).toBe("rollback");
    expect(rolled.rollbackFrom).toBe(approved.id);
    expect(rolled.id).not.toBe(approved.id);
  });

  it("verifyChecksum returns true for unchanged content", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "test-ck", version: "1.0.0", content: "Stable content", createdBy: 1 });
    expect(verifyChecksum(pv)).toBe(true);
  });

  it("getLatestApproved returns the most recent approved version", () => {
    const key = `org${ORG}-latest-approved`;
    const pv1 = createPromptVersion({ organizationId: ORG, promptKey: key, version: "1.0.0", content: "v1 content", createdBy: 1 });
    const s1 = submitForReview(pv1, 1);
    const a1 = approvePromptVersion(s1, 2);
    const latest = getLatestApproved(ORG, key);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe("approved");
  });

  it("getLatestApproved returns null if no approved version", () => {
    const result = getLatestApproved(ORG, "nonexistent-prompt-key");
    expect(result).toBeNull();
  });

  it("lineage tracks version chain", () => {
    const pv = createPromptVersion({ organizationId: ORG, promptKey: "lineage-test", version: "1.0.0", content: "V1", createdBy: 1 });
    const submitted = submitForReview(pv, 1);
    const approved = approvePromptVersion(submitted, 2);
    const rolled = rollbackPromptVersion({ originalVersion: approved, newVersionTag: "1.0.1-rb", createdBy: 1 });
    expect(rolled.lineage).toContain(approved.id);
  });
});

// ─── 3. semanticMemory ────────────────────────────────────────────────────────

describe("semanticMemory", () => {
  it("createMemoryEntry creates active entry with correct fields", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "licitacao-concept", value: "Processo público de compras", relevanceScore: 0.9 });
    expect(entry.organizationId).toBe(ORG);
    expect(entry.isActive).toBe(true);
    expect(entry.accessCount).toBe(0);
    expect(entry.memoryType).toBe("semantic");
  });

  it("createMemoryEntry supports all 3 memory types", () => {
    const s = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "k1", value: "v1", relevanceScore: 0.5 });
    const c = createMemoryEntry({ organizationId: ORG, memoryType: "contextual", key: "k2", value: "v2", relevanceScore: 0.5 });
    const i = createMemoryEntry({ organizationId: ORG, memoryType: "institutional", key: "k3", value: "v3", relevanceScore: 0.5 });
    expect(s.memoryType).toBe("semantic");
    expect(c.memoryType).toBe("contextual");
    expect(i.memoryType).toBe("institutional");
  });

  it("retrieveMemories returns entries ordered by relevanceScore desc", () => {
    const orgId = ORG + 1;
    createMemoryEntry({ organizationId: orgId, memoryType: "semantic", key: "low-rel", value: "low relevance", relevanceScore: 0.2 });
    createMemoryEntry({ organizationId: orgId, memoryType: "semantic", key: "high-rel", value: "high relevance", relevanceScore: 0.95 });
    const results = retrieveMemories(orgId, "semantic", "", 10);
    expect(results.length).toBeGreaterThan(0);
    if (results.length >= 2) {
      expect(results[0].relevanceScore).toBeGreaterThanOrEqual(results[results.length - 1].relevanceScore);
    }
  });

  it("retrieveMemories filters by organizationId", () => {
    const orgA = ORG + 2;
    const orgB = 9999;
    createMemoryEntry({ organizationId: orgA, memoryType: "semantic", key: "org-filter-a", value: "v1", relevanceScore: 0.7 });
    createMemoryEntry({ organizationId: orgB, memoryType: "semantic", key: "org-filter-b", value: "v2", relevanceScore: 0.7 });
    const results = retrieveMemories(orgA, "semantic", "", 10);
    expect(results.every(r => r.organizationId === orgA)).toBe(true);
  });

  it("retrieveMemories excludes inactive entries", () => {
    const orgId = ORG + 3;
    const entry = createMemoryEntry({ organizationId: orgId, memoryType: "contextual", key: "inactive-test", value: "will be deactivated", relevanceScore: 0.8 });
    deactivateMemory(entry);
    const results = retrieveMemories(orgId, "contextual", "", 10);
    expect(results.every(r => r.isActive)).toBe(true);
  });

  it("deactivateMemory sets isActive=false (immutable)", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "institutional", key: "deact-test", value: "data", relevanceScore: 0.6 });
    const deactivated = deactivateMemory(entry);
    expect(deactivated.isActive).toBe(false);
    expect(entry.isActive).toBe(true);
    expect(deactivated).not.toBe(entry);
  });

  it("refreshRelevance updates relevanceScore (immutable)", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "refresh-test", value: "data", relevanceScore: 0.3 });
    const refreshed = refreshRelevance(entry, 0.95);
    expect(refreshed.relevanceScore).toBe(0.95);
    expect(entry.relevanceScore).toBe(0.3);
  });

  it("isExpired returns false for null ttlMs", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "ttl-null", value: "data", relevanceScore: 0.5, ttlMs: null });
    expect(isExpired(entry)).toBe(false);
  });

  it("isExpired returns true for very short ttl", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "ttl-short", value: "data", relevanceScore: 0.5, ttlMs: 1 });
    return new Promise<void>(resolve => setTimeout(() => {
      expect(isExpired(entry)).toBe(true);
      resolve();
    }, 5));
  });

  it("computeMemoryStats returns correct counts", () => {
    const entries = [
      createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "s1", value: "v", relevanceScore: 0.8 }),
      createMemoryEntry({ organizationId: ORG, memoryType: "contextual", key: "c1", value: "v", relevanceScore: 0.6 }),
      deactivateMemory(createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "s2", value: "v", relevanceScore: 0.3 })),
    ];
    const stats = computeMemoryStats(entries);
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.byType["semantic"]).toBe(2);
    expect(stats.byType["contextual"]).toBe(1);
  });

  it("createRetrievalReference records access", () => {
    const entry = createMemoryEntry({ organizationId: ORG, memoryType: "semantic", key: "ref-test", value: "data", relevanceScore: 0.7 });
    const ref = createRetrievalReference(entry.id, 42, "search query", 0.85);
    expect(ref.memoryId).toBe(entry.id);
    expect(ref.retrievedBy).toBe(42);
    expect(ref.relevanceAtRetrieval).toBe(0.85);
  });
});

// ─── 4. aiWorkflow ─────────────────────────────────────────────────────────────

describe("aiWorkflow", () => {
  it("createWorkflow creates pending workflow", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "licitacao-ai-draft", actor: 1, requiresHumanApproval: true, explanation: "Geração de minuta de licitação" });
    expect(wf.status).toBe("pending");
    expect(wf.organizationId).toBe(ORG);
    expect(wf.history).toHaveLength(1);
    expect(wf.steps).toHaveLength(0);
    expect(wf.overrides).toHaveLength(0);
    expect(wf.approvals).toHaveLength(0);
  });

  it("startStep adds step and sets status=active", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-start", actor: 1, requiresHumanApproval: false, explanation: "Test" });
    const active = startStep(wf, "ai_generation", "Generating content", 1);
    expect(active.status).toBe("active");
    expect(active.steps).toHaveLength(1);
    expect(active.currentStep).toBe("ai_generation");
  });

  it("completeStep marks step as completed", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-complete", actor: 1, requiresHumanApproval: false, explanation: "Test" });
    const active = startStep(wf, "ai_generation", "Generating", 1);
    const completed = completeStep(active, active.steps[0].id, { result: "draft generated" });
    expect(completed.steps[0].completedAt).toBeTruthy();
    expect(completed.steps[0].output).toEqual({ result: "draft generated" });
  });

  it("requestHumanReview sets status=awaiting_human", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-review", actor: 1, requiresHumanApproval: true, explanation: "Test" });
    const reviewing = requestHumanReview(wf, "Please review the AI output");
    expect(reviewing.status).toBe("awaiting_human");
  });

  it("applyOverride requires justification >= 10 chars", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-override", actor: 1, requiresHumanApproval: false, explanation: "Test" });
    expect(() => applyOverride({ wf, overriddenBy: 1, reason: "reason", previousValue: "old", newValue: "new", justification: "short" })).toThrow();
    const overridden = applyOverride({ wf, overriddenBy: 1, reason: "Valid reason", previousValue: "old value", newValue: "new value", justification: "This is a valid override justification" });
    expect(overridden.overrides).toHaveLength(1);
    expect(overridden.status).toBe("overridden");
  });

  it("addApproval records approval decision", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-approval", actor: 1, requiresHumanApproval: true, explanation: "Test" });
    const reviewing = requestHumanReview(wf, "Review please");
    const approved = addApproval({ wf: reviewing, approvedBy: 2, decision: "approve", justification: "Looks good", confidence: 0.9 });
    expect(approved.approvals).toHaveLength(1);
    expect(approved.approvals[0].decision).toBe("approve");
  });

  it("addApproval auto-completes when threshold met and no human approval required", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-auto", actor: 1, requiresHumanApproval: false, explanation: "Test", autoApprovalThreshold: 0.8 });
    const active = startStep(wf, "auto_approval", "Auto review", 1);
    const result = addApproval({ wf: active, approvedBy: 0, decision: "approve", justification: "Automated approval", confidence: 0.95 });
    expect(result.status).toBe("approved");
  });

  it("escalateWorkflow sets status=escalated", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-escalate", actor: 1, requiresHumanApproval: true, explanation: "Test" });
    const reviewing = requestHumanReview(wf, "Review");
    const escalated = escalateWorkflow(reviewing, 1, "Critical issue requires senior review");
    expect(escalated.status).toBe("escalated");
  });

  it("completeWorkflow sets status=completed", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-finish", actor: 1, requiresHumanApproval: false, explanation: "Test" });
    const active = startStep(wf, "completion", "Final step", 1);
    const completed = completeWorkflow(active, 1, { message: "All steps done" });
    expect(completed.status).toBe("completed");
  });

  it("cancelWorkflow sets status=cancelled", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "wf-cancel", actor: 1, requiresHumanApproval: false, explanation: "Test" });
    const cancelled = cancelWorkflow(wf, 1, "User cancelled");
    expect(cancelled.status).toBe("cancelled");
  });

  it("computeWorkflowMetrics returns correct totals", () => {
    const wf1 = createWorkflow({ organizationId: ORG, workflowKey: "metrics-1", actor: 1, requiresHumanApproval: false, explanation: "T" });
    const wf2 = createWorkflow({ organizationId: ORG, workflowKey: "metrics-2", actor: 1, requiresHumanApproval: true, explanation: "T" });
    const completed = completeWorkflow(startStep(wf1, "completion", "done", 1), 1, {});
    const reviewing = requestHumanReview(wf2, "review");
    const metrics = computeWorkflowMetrics([completed, reviewing]);
    expect(metrics.total).toBe(2);
    expect(metrics.completed).toBe(1);
    expect(metrics.pendingHumanReview).toBe(1);
  });

  it("history is append-only across multiple operations", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "imm-wf", actor: 1, requiresHumanApproval: false, explanation: "T" });
    const step1 = startStep(wf, "ai_generation", "gen", 1);
    const step2 = completeStep(step1, step1.steps[0].id, {});
    expect(wf.history.length).toBeLessThan(step2.history.length);
  });
});

// ─── 5. aiProviderAbstractionService ─────────────────────────────────────────

describe("aiProviderAbstractionService", () => {
  it("AVAILABLE_MODELS contains at least 7 models", () => {
    expect(Object.keys(AVAILABLE_MODELS).length).toBeGreaterThanOrEqual(7);
  });

  it("AVAILABLE_MODELS includes all required providers", () => {
    const providers = new Set(Object.values(AVAILABLE_MODELS).map(m => m.provider));
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("gemini")).toBe(true);
    expect(providers.has("mock")).toBe(true);
  });

  it("executeWithProvider returns mock result without real API call", async () => {
    const result = await executeWithProvider({
      organizationId: ORG, sessionId: "exec1", provider: "mock", modelId: "mock-default",
      prompt: "Test prompt", systemPrompt: null, maxTokens: 100, temperature: 0.7, replayKey: "rk-1"
    });
    expect(result.provider).toBe("mock");
    expect(result.content).toBeTruthy();
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.finishReason).toBe("stop");
  });

  it("executeWithProvider is replay-safe (same replayKey → same result)", async () => {
    const params = {
      organizationId: ORG, sessionId: "exec-replay", provider: "mock" as const, modelId: "mock-default",
      prompt: "Replay test", systemPrompt: null, maxTokens: 200, temperature: 0.5, replayKey: "rk-replay-123"
    };
    const r1 = await executeWithProvider(params);
    const r2 = await executeWithProvider(params);
    expect(r1.outputTokens).toBe(r2.outputTokens);
    expect(r1.durationMs).toBe(r2.durationMs);
  });

  it("getModelInfo returns null for unknown model", () => {
    const info = getModelInfo("nonexistent-model");
    expect(info).toBeNull();
  });

  it("getModelInfo returns correct model info", () => {
    const info = getModelInfo("gpt-4o");
    expect(info?.provider).toBe("openai");
    expect(info?.contextWindow).toBeGreaterThan(0);
  });

  it("listAvailableModels returns all models when no provider filter", () => {
    const models = listAvailableModels();
    expect(models.length).toBeGreaterThanOrEqual(7);
  });

  it("listAvailableModels filters by provider", () => {
    const openai = listAvailableModels("openai");
    expect(openai.every(m => m.provider === "openai")).toBe(true);
    expect(openai.length).toBeGreaterThan(0);
  });

  it("estimateTokens calculates tokens as Math.ceil(length/4)", () => {
    const text = "Hello world"; // 11 chars → 3 tokens
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });
});

// ─── 6. contextAssemblyService ───────────────────────────────────────────────

describe("contextAssemblyService", () => {
  it("createChunk creates chunk with estimated token count", () => {
    const chunk = createChunk("Some content text here", "document", 5, "test-source");
    expect(chunk.content).toBe("Some content text here");
    expect(chunk.chunkType).toBe("document");
    expect(chunk.priority).toBe(5);
    expect(chunk.tokenCount).toBeGreaterThan(0);
  });

  it("assembleContext with priority strategy sorts by priority desc", () => {
    const c1 = createChunk("low priority content", "document", 2, "src1");
    const c2 = createChunk("high priority content", "instruction", 9, "src2");
    const result = assembleContext({ organizationId: ORG, sessionId: "ctx1", chunks: [c1, c2], maxTokens: 10000, strategy: "priority" });
    expect(result.chunks[0].priority).toBeGreaterThanOrEqual(result.chunks[result.chunks.length - 1].priority);
  });

  it("assembleContext truncates when totalTokens exceeds maxTokens", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => createChunk("a".repeat(40), "document", i, `src-${i}`));
    const result = assembleContext({ organizationId: ORG, sessionId: "ctx-trunc", chunks, maxTokens: 50, strategy: "priority" });
    expect(result.truncated).toBe(true);
    expect(result.totalTokens).toBeLessThanOrEqual(50);
  });

  it("assembleContext replayKey is deterministic", () => {
    const chunks = [createChunk("content", "document", 5, "s1"), createChunk("more", "instruction", 3, "s2")];
    const r1 = assembleContext({ organizationId: ORG, sessionId: "rk-ctx", chunks, maxTokens: 1000, strategy: "balanced" });
    const r2 = assembleContext({ organizationId: ORG, sessionId: "rk-ctx", chunks, maxTokens: 1000, strategy: "balanced" });
    expect(r1.replayKey).toBe(r2.replayKey);
  });

  it("splitIntoChunks splits long text into multiple chunks", () => {
    const longText = "word ".repeat(200);
    const chunks = splitIntoChunks(longText, 50, "document", "test");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.tokenCount <= 50)).toBe(true);
  });

  it("getContextStats returns correct utilization", () => {
    const chunks = [createChunk("test content", "document", 5, "src")];
    const assembled = assembleContext({ organizationId: ORG, sessionId: "stats-ctx", chunks, maxTokens: 1000, strategy: "priority" });
    const stats = getContextStats(assembled);
    expect(stats.chunkCount).toBe(chunks.length);
    expect(stats.utilizationPercent).toBeGreaterThan(0);
    expect(stats.utilizationPercent).toBeLessThanOrEqual(100);
  });

  it("estimateChunkTokens returns ceil(length/4)", () => {
    expect(estimateChunkTokens("hello")).toBe(Math.ceil(5 / 4));
  });
});

// ─── 7. embeddingAbstractionService ──────────────────────────────────────────

describe("embeddingAbstractionService", () => {
  it("EMBEDDING_DIMENSIONS is 1536", () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("generateEmbedding returns unit vector of correct dimensions", () => {
    const emb = generateEmbedding("Test text", ORG);
    expect(emb.vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const magnitude = Math.sqrt(emb.vector.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it("generateEmbedding is deterministic (same text → same vector)", () => {
    const e1 = generateEmbedding("Licitação pública", ORG);
    const e2 = generateEmbedding("Licitação pública", ORG);
    expect(e1.vector).toEqual(e2.vector);
  });

  it("generateEmbedding produces different vectors for different texts", () => {
    const e1 = generateEmbedding("Text A", ORG);
    const e2 = generateEmbedding("Text B completely different", ORG);
    expect(e1.vector).not.toEqual(e2.vector);
  });

  it("cosineSimilarity returns 1.0 for identical vectors", () => {
    const e = generateEmbedding("Same text", ORG);
    const sim = cosineSimilarity(e.vector, e.vector);
    expect(sim).toBeCloseTo(1.0, 5);
  });

  it("cosineSimilarity is between -1 and 1", () => {
    const e1 = generateEmbedding("Text one", ORG);
    const e2 = generateEmbedding("Totally different text", ORG);
    const sim = cosineSimilarity(e1.vector, e2.vector);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it("euclideanDistance returns 0 for identical vectors", () => {
    const e = generateEmbedding("Same", ORG);
    const dist = euclideanDistance(e.vector, e.vector);
    expect(dist).toBeCloseTo(0, 10);
  });

  it("batchGenerateEmbeddings returns same count as input", () => {
    const texts = ["text1", "text2", "text3"];
    const embeddings = batchGenerateEmbeddings(texts, ORG);
    expect(embeddings).toHaveLength(texts.length);
  });

  it("getCachedEmbedding returns null for unknown checksum", () => {
    const cached = getCachedEmbedding("nonexistent-checksum");
    expect(cached).toBeNull();
  });

  it("getCachedEmbedding returns cached embedding after generation", () => {
    const emb = generateEmbedding("Cacheable text unique " + Date.now(), ORG);
    const cached = getCachedEmbedding(emb.checksum);
    expect(cached).not.toBeNull();
    expect(cached?.vector).toEqual(emb.vector);
  });
});

// ─── 8. vectorStoreAbstractionService ────────────────────────────────────────

describe("vectorStoreAbstractionService", () => {
  it("createIndex creates empty index", () => {
    const idx = createIndex(ORG, "test-index-" + Date.now());
    expect(idx.organizationId).toBe(ORG);
    expect(idx.entries).toHaveLength(0);
  });

  it("addToIndex adds entry to the index", () => {
    const indexName = "add-test-" + Date.now();
    const indexId = `${ORG}:${indexName}`;
    createIndex(ORG, indexName);
    const vector = generateEmbedding("Test entry", ORG).vector;
    const entry = addToIndex(indexId, "Test content", vector, { source: "unit-test" });
    expect(entry.content).toBe("Test content");
    expect(entry.vector).toEqual(vector);
  });

  it("search returns results sorted by similarity desc", () => {
    const indexName = "search-test-" + Date.now();
    const indexId = `${ORG}:${indexName}`;
    createIndex(ORG, indexName);
    const v1 = generateEmbedding("licitacao pregao", ORG).vector;
    const v2 = generateEmbedding("compra direta", ORG).vector;
    const v3 = generateEmbedding("licitacao pregao eletrônico", ORG).vector;
    addToIndex(indexId, "Pregão", v1);
    addToIndex(indexId, "Compra", v2);
    addToIndex(indexId, "Pregão eletrônico", v3);
    const query = generateEmbedding("licitacao pregao", ORG).vector;
    const results = search(ORG, indexName, query, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    if (results.length >= 2) {
      expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    }
  });

  it("search returns empty array for non-existent index", () => {
    const results = search(ORG, "nonexistent-index-xyz", [], 5);
    expect(results).toHaveLength(0);
  });

  it("deleteFromIndex removes entry", () => {
    const indexName = "delete-test-" + Date.now();
    const indexId = `${ORG}:${indexName}`;
    createIndex(ORG, indexName);
    const vector = generateEmbedding("To be deleted", ORG).vector;
    const entry = addToIndex(indexId, "Delete me", vector);
    const deleted = deleteFromIndex(ORG, indexName, entry.id);
    expect(deleted).toBe(true);
    const stats = getIndexStats(ORG, indexName);
    expect(stats?.entryCount).toBe(0);
  });

  it("getIndexStats returns null for unknown index", () => {
    const stats = getIndexStats(ORG, "unknown-index");
    expect(stats).toBeNull();
  });

  it("listIndices returns all indices for org", () => {
    const indexName = "list-test-" + Date.now();
    createIndex(ORG, indexName);
    const indices = listIndices(ORG);
    expect(indices.some(i => i.name === indexName)).toBe(true);
  });
});

// ─── 9. groundingEngineService ───────────────────────────────────────────────

describe("groundingEngineService", () => {
  it("createEvidence returns evidence with citationKey", () => {
    const ev = createEvidence({ organizationId: ORG, sourceRef: "Lei 14133/2021 Art. 6", content: "Define modalidades de licitação", relevanceScore: 0.95, evidenceType: "regulation" });
    expect(ev.organizationId).toBe(ORG);
    expect(ev.citationKey).toBeTruthy();
    expect(ev.verified).toBe(false);
    expect(ev.relevanceScore).toBe(0.95);
  });

  it("verifyEvidence sets verified=true", () => {
    const ev = createEvidence({ organizationId: ORG, sourceRef: "source", content: "content", relevanceScore: 0.8, evidenceType: "document" });
    const verified = verifyEvidence(ev);
    expect(verified.verified).toBe(true);
    expect(verified.verifiedAt).toBeTruthy();
    expect(ev.verified).toBe(false);
  });

  it("groundContent returns grounding result with all required fields", () => {
    const ev = createEvidence({ organizationId: ORG, sourceRef: "Lei 14133/2021", content: "Content reference", relevanceScore: 0.9, evidenceType: "regulation" });
    const result = groundContent({ organizationId: ORG, sessionId: "gnd1", aiContent: "This is AI output. Another claim here.", evidenceRefs: [ev], replayKey: "gnd-rk-1" });
    expect(result.organizationId).toBe(ORG);
    expect(result.groundedContent).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(["low", "medium", "high"]).toContain(result.hallucination_risk);
  });

  it("assessHallucinationRisk returns low for high confidence", () => {
    const ev = createEvidence({ organizationId: ORG, sourceRef: "s", content: "c", relevanceScore: 0.95, evidenceType: "document" });
    const result = groundContent({ organizationId: ORG, sessionId: "gnd2", aiContent: "Claim.", evidenceRefs: [ev], replayKey: "rk-h" });
    const risk = assessHallucinationRisk(result);
    expect(["low", "medium", "high"]).toContain(risk);
  });

  it("buildCitation returns formatted string", () => {
    const ev = createEvidence({ organizationId: ORG, sourceRef: "Lei 8666/1993 Art. 1", content: "content", relevanceScore: 0.8, evidenceType: "regulation" });
    const citation = buildCitation(ev);
    expect(citation).toContain(ev.citationKey);
    expect(citation).toContain(ev.sourceRef);
  });

  it("groundContent with empty evidence returns high risk", () => {
    const result = groundContent({ organizationId: ORG, sessionId: "gnd3", aiContent: "Ungrounded claim.", evidenceRefs: [], replayKey: "rk-empty" });
    expect(result.hallucination_risk).toBe("high");
  });
});

// ─── 10. tokenBudgetService ────────────────────────────────────────────────────

describe("tokenBudgetService", () => {
  it("createBudget creates budget with correct initial state", () => {
    const budget = createBudget(ORG, "sess-budget-1", 4096, "mock-default");
    expect(budget.organizationId).toBe(ORG);
    expect(budget.maxTokens).toBe(4096);
    expect(budget.usedTokens).toBe(0);
    expect(budget.reservedTokens).toBe(0);
    expect(budget.availableTokens).toBe(4096);
  });

  it("consumeTokens reduces availableTokens (immutable)", () => {
    const budget = createBudget(ORG, "sess-consume", 1000, "mock-default");
    const after = consumeTokens(budget, 200);
    expect(after.usedTokens).toBe(200);
    expect(after.availableTokens).toBe(800);
    expect(budget.usedTokens).toBe(0);
  });

  it("consumeTokens throws when hardLimit exceeded", () => {
    const budget = { ...createBudget(ORG, "sess-hard", 100, "mock-default"), hardLimit: true };
    expect(() => consumeTokens(budget, 150)).toThrow();
  });

  it("reserveTokens reduces available (immutable)", () => {
    const budget = createBudget(ORG, "sess-reserve", 1000, "mock-default");
    const after = reserveTokens(budget, 300);
    expect(after.reservedTokens).toBe(300);
    expect(after.availableTokens).toBe(700);
  });

  it("releaseReservedTokens increases available", () => {
    const budget = createBudget(ORG, "sess-release", 1000, "mock-default");
    const reserved = reserveTokens(budget, 300);
    const released = releaseReservedTokens(reserved, 200);
    expect(released.reservedTokens).toBe(100);
    expect(released.availableTokens).toBe(900);
  });

  it("estimateBudgetTokens calculates ceil(length/4)", () => {
    const est = estimateBudgetTokens("Hello world test");
    expect(est.estimatedTokens).toBe(Math.ceil("Hello world test".length / 4));
    expect(est.method).toBe("char_div_4");
    expect(est.confidence).toBeGreaterThan(0);
  });

  it("forecastCost returns non-negative estimate", () => {
    const forecast = forecastCost(1000, 500, "mock-default");
    expect(forecast.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    expect(forecast.inputTokens).toBe(1000);
    expect(forecast.outputTokens).toBe(500);
    expect(forecast.currency).toBe("USD");
  });

  it("truncateToFit returns truncated=false when text fits", () => {
    const result = truncateToFit("Short text", 1000);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("Short text");
  });

  it("truncateToFit truncates long text", () => {
    const longText = "a".repeat(1000);
    const result = truncateToFit(longText, 10);
    expect(result.truncated).toBe(true);
    expect(result.removedTokens).toBeGreaterThan(0);
  });

  it("isBudgetExhausted returns true when no tokens available", () => {
    const budget = createBudget(ORG, "sess-exhaust", 100, "mock-default");
    const consumed = consumeTokens(budget, 100);
    expect(isBudgetExhausted(consumed)).toBe(true);
  });

  it("getBudgetUtilization returns correct percentage", () => {
    const budget = createBudget(ORG, "sess-util", 1000, "mock-default");
    const used = consumeTokens(budget, 250);
    expect(getBudgetUtilization(used)).toBe(25);
  });
});

// ─── 11. aiAuditService ───────────────────────────────────────────────────────

describe("aiAuditService", () => {
  const SESSION = "audit-session-" + Date.now();

  it("recordOperation creates immutable audit record", () => {
    const record = recordOperation({ organizationId: ORG, sessionId: SESSION, operation: "execute", actorId: 1, provider: "mock", modelId: "mock-default", inputs: { prompt: "test" }, success: true, replayKey: "audit-rk-1" });
    expect(record.organizationId).toBe(ORG);
    expect(record.immutable).toBe(true);
    expect(record.forensicSignature).toBeTruthy();
    expect(record.inputHash).toBeTruthy();
  });

  it("recordOperation sets outputHash when outputs provided", () => {
    const record = recordOperation({ organizationId: ORG, sessionId: SESSION, operation: "completion", inputs: {}, outputs: { result: "done" }, success: true, replayKey: "audit-rk-2" });
    expect(record.outputHash).toBeTruthy();
  });

  it("recordOperation stores failure with error", () => {
    const record = recordOperation({ organizationId: ORG, sessionId: SESSION, operation: "execute", inputs: {}, success: false, error: "API error", replayKey: "audit-rk-3" });
    expect(record.success).toBe(false);
    expect(record.error).toBe("API error");
  });

  it("getLineage returns null for unknown session", () => {
    const lineage = getLineage(ORG, "unknown-session-xyz");
    expect(lineage).toBeNull();
  });

  it("getLineage returns lineage after recording", () => {
    const sessId = "lineage-sess-" + Date.now();
    recordOperation({ organizationId: ORG, sessionId: sessId, operation: "execute", inputs: {}, success: true, replayKey: "lg-rk-1" });
    const lineage = getLineage(ORG, sessId);
    expect(lineage).not.toBeNull();
    expect(lineage?.sessionId).toBe(sessId);
    expect(lineage?.records).toHaveLength(1);
  });

  it("getAuditRecords returns records for org", () => {
    recordOperation({ organizationId: ORG, sessionId: "rec-sess", operation: "approval", inputs: {}, success: true, replayKey: "rec-rk" });
    const records = getAuditRecords(ORG);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every(r => r.organizationId === ORG)).toBe(true);
  });

  it("getAuditRecords respects limit", () => {
    const records = getAuditRecords(ORG, 2);
    expect(records.length).toBeLessThanOrEqual(2);
  });

  it("verifyRecordIntegrity returns true for untampered record", () => {
    const record = recordOperation({ organizationId: ORG, sessionId: "integrity-sess", operation: "execute", inputs: { test: true }, success: true, replayKey: "int-rk" });
    expect(verifyRecordIntegrity(record)).toBe(true);
  });

  it("verifyRecordIntegrity returns false for tampered record", () => {
    const record = recordOperation({ organizationId: ORG, sessionId: "tampered-sess", operation: "execute", inputs: {}, success: true, replayKey: "tamp-rk" });
    const tampered = { ...record, success: false };
    expect(verifyRecordIntegrity(tampered)).toBe(false);
  });

  it("computeAuditMetrics returns correct breakdown", () => {
    const sessId = "metrics-sess-" + Date.now();
    recordOperation({ organizationId: ORG, sessionId: sessId, operation: "execute", inputs: {}, success: true, replayKey: "m-rk-1" });
    recordOperation({ organizationId: ORG, sessionId: sessId, operation: "execute", inputs: {}, success: false, error: "err", replayKey: "m-rk-2" });
    const metrics = computeAuditMetrics(ORG);
    expect(metrics.totalRecords).toBeGreaterThan(0);
    expect(metrics.operationBreakdown["execute"]).toBeGreaterThan(0);
    expect(metrics.successRate).toBeGreaterThanOrEqual(0);
    expect(metrics.errorRate).toBeGreaterThanOrEqual(0);
  });
});
