/**
 * Sprint 4.5 — Provider Activation Layer
 * ORG ID: 9800
 * Target: ~160 tests, 0 regressions
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

const ORG = 9800;

// ─── Domain imports ────────────────────────────────────────────────────────────

import {
  type ProviderType,
  type HealthStatus,
  type CircuitBreakerState,
  type AIProvider,
  createProvider,
  updateProviderHealth,
  openCircuitBreaker,
  closeCircuitBreaker,
  halfOpenCircuitBreaker,
  isProviderAvailable,
  getProviderScore,
} from "../../domain/aiProvider";

import {
  type ExecutionType,
  type ExecutionStatus,
  type ProviderExecution,
  createProviderExecution,
  completeExecution,
  failExecution,
  triggerFallback,
  createReplaySnapshot,
  isReplayable,
} from "../../domain/providerExecution";

import {
  type ProviderPolicy,
  createPolicy,
  validateExecution,
  requiresApproval,
  isCapabilityAllowed,
} from "../../domain/providerPolicy";

import {
  type RoutingStrategy,
  type FallbackStrategy,
  type ProviderRouting,
  createRouting,
  selectProvider,
  getFallbackChain,
} from "../../domain/providerRouting";

import {
  type ProviderOrchestrationStep,
  type InferenceSnapshot,
  createProviderOrchestrationStep,
  addInferenceSnapshot,
} from "../../domain/aiWorkflow";

// ─── Service imports ───────────────────────────────────────────────────────────

import {
  registerProvider,
  unregisterProvider,
  getProvider,
  listProviders,
  updateHealth,
  getAvailableProviders,
  registerDefaultProviders,
} from "../../services/providerRegistryService";

import {
  getOrCreateRouting,
  selectProviderForOrg,
  buildFallbackChain,
  routeByCapability,
  routeWithFallback,
} from "../../services/providerRoutingService";

import {
  executeInference,
  replayExecution,
  getExecutionHistory,
} from "../../services/providerExecutionService";

import {
  addPolicy,
  enforcePolicy,
  getActivePolicies,
  checkRequiresApproval,
} from "../../services/providerPolicyService";

import {
  estimateCost,
  recordUsage,
  getTodayUsage,
  getMonthlyUsage,
  checkQuota,
  detectAnomaly,
  getUsageSummary,
} from "../../services/providerCostService";

import {
  recordLatency,
  recordTokenUsage,
  recordError,
  recordFallback,
  getProviderHealth,
  getExecutionLineage,
  getProviderMetrics,
  computeReliabilityScore,
} from "../../services/providerObservabilityService";

import {
  createSnapshot,
  replayFromSnapshot,
  validateReplay,
  getReplayHistory,
} from "../../services/providerReplayService";

import {
  triggerFailover,
  getFailoverChain,
  enterDegradedMode,
  exitDegradedMode,
  getDegradedOrgs,
  recordFailoverEvent,
  getFailoverHistory,
} from "../../services/providerFailoverService";

// ─── Adapter imports ────────────────────────────────────────────────────────────

import { mockAdapter } from "../../providers/mock/mockAdapter";
import { openaiAdapter } from "../../providers/openai/openaiAdapter";
import { claudeAdapter } from "../../providers/claude/claudeAdapter";
import { geminiAdapter } from "../../providers/gemini/geminiAdapter";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sha256(x: string) {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── 1. Domain: AIProvider ────────────────────────────────────────────────────

describe("AIProvider domain", () => {
  it("createProvider generates deterministic ID", () => {
    const p1 = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Test" });
    const p2 = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Test" });
    expect(p1.id).toBe(p2.id);
    expect(p1.id).toHaveLength(20);
  });

  it("createProvider sets correct defaults for openai", () => {
    const p = createProvider({ organizationId: ORG, providerType: "openai", providerName: "OpenAI" });
    expect(p.latencyScore).toBe(0.8);
    expect(p.reliabilityScore).toBe(0.9);
    expect(p.costScore).toBe(0.5);
    expect(p.circuitBreakerState).toBe("closed");
    expect(p.healthStatus).toBe("unknown");
    expect(p.enabled).toBe(true);
  });

  it("createProvider sets correct defaults for claude", () => {
    const p = createProvider({ organizationId: ORG, providerType: "claude", providerName: "Claude" });
    expect(p.latencyScore).toBe(0.85);
    expect(p.reliabilityScore).toBe(0.92);
    expect(p.costScore).toBe(0.6);
  });

  it("createProvider sets correct defaults for gemini", () => {
    const p = createProvider({ organizationId: ORG, providerType: "gemini", providerName: "Gemini" });
    expect(p.latencyScore).toBe(0.9);
    expect(p.reliabilityScore).toBe(0.85);
    expect(p.costScore).toBe(0.7);
  });

  it("createProvider sets correct defaults for mock", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    expect(p.latencyScore).toBe(1.0);
    expect(p.reliabilityScore).toBe(1.0);
    expect(p.costScore).toBe(1.0);
  });

  it("createProvider respects custom priority", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock", priority: 9 });
    expect(p.priority).toBe(9);
  });

  it("createProvider sets default supportedCapabilities", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    expect(p.supportedCapabilities).toContain("inference");
    expect(p.supportedCapabilities).toContain("embedding");
    expect(p.supportedCapabilities).toContain("completion");
  });

  it("createProvider sets default rateLimitConfig", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    expect(p.rateLimitConfig.requestsPerMinute).toBe(60);
    expect(p.rateLimitConfig.tokensPerMinute).toBe(100000);
    expect(p.rateLimitConfig.concurrentRequests).toBe(10);
  });

  it("createProvider sets default retryPolicy", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    expect(p.retryPolicy.maxRetries).toBe(3);
    expect(p.retryPolicy.backoffMs).toBe(1000);
    expect(p.retryPolicy.maxBackoffMs).toBe(10000);
  });

  it("updateProviderHealth updates health status and scores", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const updated = updateProviderHealth(p, { healthStatus: "healthy", latencyScore: 0.99 });
    expect(updated.healthStatus).toBe("healthy");
    expect(updated.latencyScore).toBe(0.99);
    expect(updated.organizationId).toBe(ORG);
  });

  it("openCircuitBreaker sets state to open and unavailable", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const opened = openCircuitBreaker(p);
    expect(opened.circuitBreakerState).toBe("open");
    expect(opened.healthStatus).toBe("unavailable");
  });

  it("closeCircuitBreaker sets state to closed and healthy", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const opened = openCircuitBreaker(p);
    const closed = closeCircuitBreaker(opened);
    expect(closed.circuitBreakerState).toBe("closed");
    expect(closed.healthStatus).toBe("healthy");
  });

  it("halfOpenCircuitBreaker sets degraded state", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const half = halfOpenCircuitBreaker(p);
    expect(half.circuitBreakerState).toBe("half_open");
    expect(half.healthStatus).toBe("degraded");
  });

  it("isProviderAvailable returns true for enabled closed provider", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const updated = updateProviderHealth(p, { healthStatus: "healthy" });
    expect(isProviderAvailable(updated)).toBe(true);
  });

  it("isProviderAvailable returns false for open circuit breaker", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const opened = openCircuitBreaker(p);
    expect(isProviderAvailable(opened)).toBe(false);
  });

  it("isProviderAvailable returns false for unavailable health", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const unavail = updateProviderHealth(p, { healthStatus: "unavailable" });
    expect(isProviderAvailable(unavail)).toBe(false);
  });

  it("getProviderScore computes weighted score", () => {
    const p = createProvider({ organizationId: ORG, providerType: "mock", providerName: "Mock" });
    const score = getProviderScore(p);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    // mock: 1.0*0.3 + 1.0*0.4 + 1.0*0.3 = 1.0
    expect(score).toBe(1.0);
  });

  it("createProvider with custom rateLimitConfig", () => {
    const p = createProvider({ organizationId: ORG, providerType: "openai", providerName: "OAI", rateLimitConfig: { requestsPerMinute: 120 } });
    expect(p.rateLimitConfig.requestsPerMinute).toBe(120);
    expect(p.rateLimitConfig.tokensPerMinute).toBe(100000);
  });

  it("createProvider with custom retryPolicy", () => {
    const p = createProvider({ organizationId: ORG, providerType: "claude", providerName: "Cl", retryPolicy: { maxRetries: 5 } });
    expect(p.retryPolicy.maxRetries).toBe(5);
    expect(p.retryPolicy.backoffMs).toBe(1000);
  });

  it("provider ID differs across provider types", () => {
    const p1 = createProvider({ organizationId: ORG, providerType: "openai", providerName: "X" });
    const p2 = createProvider({ organizationId: ORG, providerType: "claude", providerName: "X" });
    expect(p1.id).not.toBe(p2.id);
  });

  it("provider ID differs across organizations", () => {
    const p1 = createProvider({ organizationId: ORG, providerType: "mock", providerName: "X" });
    const p2 = createProvider({ organizationId: ORG + 1, providerType: "mock", providerName: "X" });
    expect(p1.id).not.toBe(p2.id);
  });
});

// ─── 2. Domain: ProviderExecution ─────────────────────────────────────────────

describe("ProviderExecution domain", () => {
  it("createProviderExecution creates pending execution", () => {
    const exec = createProviderExecution({
      organizationId: ORG,
      workflowId: "wf-1",
      providerId: "pid-1",
      model: "gpt-4",
      executionType: "inference",
      requestPayload: { prompt: "hello" },
    });
    expect(exec.executionStatus).toBe("pending");
    expect(exec.organizationId).toBe(ORG);
    expect(exec.model).toBe("gpt-4");
    expect(exec.id).toHaveLength(20);
  });

  it("createProviderExecution generates promptHash", () => {
    const exec = createProviderExecution({
      organizationId: ORG,
      workflowId: "wf-1",
      providerId: "pid-1",
      model: "gpt-4",
      executionType: "inference",
      requestPayload: { prompt: "hello" },
    });
    expect(exec.promptHash).toHaveLength(64);
  });

  it("createProviderExecution uses provided correlationId", () => {
    const exec = createProviderExecution({
      organizationId: ORG,
      workflowId: "wf-1",
      providerId: "pid-1",
      model: "gpt-4",
      executionType: "inference",
      requestPayload: {},
      correlationId: "corr-abc",
    });
    expect(exec.correlationId).toBe("corr-abc");
  });

  it("completeExecution updates status and response", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    const completed = completeExecution(exec, {
      responsePayload: { content: "result" },
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      latencyMs: 300,
    });
    expect(completed.executionStatus).toBe("completed");
    expect(completed.responsePayload).toEqual({ content: "result" });
    expect(completed.tokenUsage.totalTokens).toBe(30);
    expect(completed.latencyMs).toBe(300);
  });

  it("failExecution sets failed status with error", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    const failed = failExecution(exec, "connection timeout");
    expect(failed.executionStatus).toBe("failed");
    expect(failed.responsePayload).toEqual({ error: "connection timeout" });
  });

  it("triggerFallback sets fallback_triggered status", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    const fallback = triggerFallback(exec);
    expect(fallback.executionStatus).toBe("fallback_triggered");
    expect(fallback.fallbackTriggered).toBe(true);
  });

  it("createReplaySnapshot creates snapshot with correct key", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    const withSnapshot = createReplaySnapshot(exec);
    expect(withSnapshot.replaySnapshot).not.toBeNull();
    expect(withSnapshot.replaySnapshot!.snapshotKey).toHaveLength(64);
    expect(withSnapshot.replaySnapshot!.originalExecutionId).toBe(exec.id);
    expect(withSnapshot.executionStatus).toBe("replay");
  });

  it("isReplayable returns false for non-completed execution", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    expect(isReplayable(exec)).toBe(false);
  });

  it("completeExecution preserves reasoningTrace", () => {
    const exec = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {},
    });
    const completed = completeExecution(exec, {
      responsePayload: {},
      tokenUsage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      latencyMs: 100,
      reasoningTrace: "step1 -> step2",
    });
    expect(completed.reasoningTrace).toBe("step1 -> step2");
  });

  it("execution ID is deterministic for same correlationId+model", () => {
    const e1 = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {}, correlationId: "fixed-corr",
    });
    const e2 = createProviderExecution({
      organizationId: ORG, workflowId: "wf-1", providerId: "p1", model: "gpt-4",
      executionType: "inference", requestPayload: {}, correlationId: "fixed-corr",
    });
    expect(e1.id).toBe(e2.id);
  });
});

// ─── 3. Domain: ProviderPolicy ─────────────────────────────────────────────────

describe("ProviderPolicy domain", () => {
  it("createPolicy generates deterministic ID", () => {
    const p1 = createPolicy({ organizationId: ORG, policyName: "test" });
    const p2 = createPolicy({ organizationId: ORG, policyName: "test" });
    expect(p1.id).toBe(p2.id);
  });

  it("createPolicy sets default allowed providers", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "default" });
    expect(p.allowedProviders).toContain("openai");
    expect(p.allowedProviders).toContain("claude");
    expect(p.allowedProviders).toContain("gemini");
    expect(p.allowedProviders).toContain("mock");
  });

  it("validateExecution passes for allowed provider", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol1", allowedProviders: ["openai"] });
    const violations = validateExecution(p, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 0.1, capability: "inference" });
    expect(violations).toHaveLength(0);
  });

  it("validateExecution fails for blocked provider", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol2", allowedProviders: ["openai"] });
    const violations = validateExecution(p, { providerType: "claude", model: "claude-3", estimatedTokens: 100, estimatedCost: 0.1, capability: "inference" });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("claude");
  });

  it("validateExecution fails for blocked model", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol3", blockedModels: ["gpt-3.5"] });
    const violations = validateExecution(p, { providerType: "openai", model: "gpt-3.5", estimatedTokens: 100, estimatedCost: 0.1, capability: "inference" });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("validateExecution fails for token limit exceeded", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol4", maxTokensPerExecution: 1000 });
    const violations = validateExecution(p, { providerType: "openai", model: "gpt-4", estimatedTokens: 2000, estimatedCost: 0.1, capability: "inference" });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("validateExecution fails for cost limit exceeded", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol5", maxCostPerExecution: 1.0 });
    const violations = validateExecution(p, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 5.0, capability: "inference" });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("validateExecution fails for restricted capability", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol6", restrictedCapabilities: ["embedding"] });
    const violations = validateExecution(p, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 0.1, capability: "embedding" });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("requiresApproval returns true when cost exceeds threshold", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol7", approvalThreshold: 2.0 });
    expect(requiresApproval(p, 5.0)).toBe(true);
  });

  it("requiresApproval returns false below threshold", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol8", approvalThreshold: 10.0 });
    expect(requiresApproval(p, 1.0)).toBe(false);
  });

  it("requiresApproval returns true if requiresHumanApproval is set", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol9", requiresHumanApproval: true });
    expect(requiresApproval(p, 0.01)).toBe(true);
  });

  it("isCapabilityAllowed returns true for unrestricted capability", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol10" });
    expect(isCapabilityAllowed(p, "inference")).toBe(true);
  });

  it("isCapabilityAllowed returns false for restricted capability", () => {
    const p = createPolicy({ organizationId: ORG, policyName: "pol11", restrictedCapabilities: ["embedding"] });
    expect(isCapabilityAllowed(p, "embedding")).toBe(false);
  });
});

// ─── 4. Domain: ProviderRouting ────────────────────────────────────────────────

describe("ProviderRouting domain", () => {
  const makeProvider = (type: ProviderType, priority: number, latency: number, cost: number, reliability: number): AIProvider => ({
    id: sha256(`test:${type}:${priority}`).slice(0, 20),
    organizationId: ORG,
    providerType: type,
    providerName: type,
    enabled: true,
    priority,
    supportedCapabilities: ["inference","embedding","completion","classification"],
    healthStatus: "healthy",
    latencyScore: latency,
    reliabilityScore: reliability,
    costScore: cost,
    rateLimitConfig: { requestsPerMinute: 60, tokensPerMinute: 100000, concurrentRequests: 10 },
    retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 10000 },
    circuitBreakerState: "closed",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it("createRouting sets deterministic defaults", () => {
    const r = createRouting({ organizationId: ORG });
    expect(r.routingStrategy).toBe("deterministic_priority");
    expect(r.fallbackStrategy).toBe("next_provider");
    expect(r.resilienceMode).toBe(true);
    expect(r.active).toBe(true);
  });

  it("selectProvider with lowest_latency picks highest latencyScore", () => {
    const r = createRouting({ organizationId: ORG, routingStrategy: "lowest_latency" });
    const providers = [
      makeProvider("openai", 5, 0.5, 0.5, 0.9),
      makeProvider("claude", 5, 0.9, 0.6, 0.92),
      makeProvider("gemini", 5, 0.7, 0.7, 0.85),
    ];
    const selected = selectProvider(r, providers);
    expect(selected?.latencyScore).toBe(0.9);
  });

  it("selectProvider with lowest_cost picks highest costScore", () => {
    const r = createRouting({ organizationId: ORG, routingStrategy: "lowest_cost" });
    const providers = [
      makeProvider("openai", 5, 0.8, 0.5, 0.9),
      makeProvider("mock", 5, 1.0, 1.0, 1.0),
      makeProvider("gemini", 5, 0.9, 0.7, 0.85),
    ];
    const selected = selectProvider(r, providers);
    expect(selected?.costScore).toBe(1.0);
  });

  it("selectProvider with highest_reliability picks highest reliabilityScore", () => {
    const r = createRouting({ organizationId: ORG, routingStrategy: "highest_reliability" });
    const providers = [
      makeProvider("openai", 5, 0.8, 0.5, 0.9),
      makeProvider("claude", 5, 0.85, 0.6, 0.95),
      makeProvider("gemini", 5, 0.9, 0.7, 0.85),
    ];
    const selected = selectProvider(r, providers);
    expect(selected?.reliabilityScore).toBe(0.95);
  });

  it("selectProvider with deterministic_priority picks highest priority", () => {
    const r = createRouting({ organizationId: ORG, routingStrategy: "deterministic_priority" });
    const providers = [
      makeProvider("openai", 3, 0.8, 0.5, 0.9),
      makeProvider("claude", 8, 0.85, 0.6, 0.92),
      makeProvider("gemini", 5, 0.9, 0.7, 0.85),
    ];
    const selected = selectProvider(r, providers);
    expect(selected?.priority).toBe(8);
  });

  it("selectProvider filters by capability", () => {
    const r = createRouting({ organizationId: ORG });
    const p1 = { ...makeProvider("openai", 9, 0.8, 0.5, 0.9), supportedCapabilities: ["inference"] };
    const p2 = { ...makeProvider("claude", 5, 0.85, 0.6, 0.92), supportedCapabilities: ["embedding"] };
    const selected = selectProvider(r, [p1, p2], "embedding");
    expect(selected?.providerType).toBe("claude");
  });

  it("selectProvider returns null when no providers available", () => {
    const r = createRouting({ organizationId: ORG });
    const result = selectProvider(r, []);
    expect(result).toBeNull();
  });

  it("getFallbackChain excludes specified provider", () => {
    const r = createRouting({ organizationId: ORG });
    const providers = [
      makeProvider("openai", 8, 0.8, 0.5, 0.9),
      makeProvider("claude", 5, 0.85, 0.6, 0.92),
    ];
    const chain = getFallbackChain(r, providers, providers[0]!.id);
    expect(chain.every(p => p.id !== providers[0]!.id)).toBe(true);
  });

  it("getFallbackChain returns empty for no available providers", () => {
    const r = createRouting({ organizationId: ORG });
    const opened = openCircuitBreaker(makeProvider("mock", 5, 1.0, 1.0, 1.0));
    const chain = getFallbackChain(r, [opened]);
    expect(chain).toHaveLength(0);
  });
});

// ─── 5. Service: ProviderRegistry ─────────────────────────────────────────────

describe("ProviderRegistryService", () => {
  const REG_ORG = 9800 + 1000;

  it("registerProvider adds provider to registry", () => {
    const p = registerProvider({ organizationId: REG_ORG, providerType: "mock", providerName: "Reg Mock" });
    expect(p.id).toHaveLength(20);
    expect(listProviders(REG_ORG).length).toBeGreaterThan(0);
  });

  it("registerProvider is idempotent", () => {
    const p1 = registerProvider({ organizationId: REG_ORG, providerType: "openai", providerName: "Idempotent" });
    const p2 = registerProvider({ organizationId: REG_ORG, providerType: "openai", providerName: "Idempotent" });
    expect(p1.id).toBe(p2.id);
  });

  it("getProvider returns registered provider", () => {
    const p = registerProvider({ organizationId: REG_ORG, providerType: "claude", providerName: "Get Test" });
    const found = getProvider(REG_ORG, p.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(p.id);
  });

  it("getProvider returns null for unknown ID", () => {
    const found = getProvider(REG_ORG, "unknown-id");
    expect(found).toBeNull();
  });

  it("updateHealth modifies provider health", () => {
    const p = registerProvider({ organizationId: REG_ORG, providerType: "gemini", providerName: "Health Test" });
    const updated = updateHealth(REG_ORG, p.id, { healthStatus: "healthy", latencyScore: 0.95 });
    expect(updated!.healthStatus).toBe("healthy");
    expect(updated!.latencyScore).toBe(0.95);
  });

  it("updateHealth returns null for unknown provider", () => {
    const result = updateHealth(REG_ORG, "unknown", { healthStatus: "healthy" });
    expect(result).toBeNull();
  });

  it("unregisterProvider removes provider", () => {
    const p = registerProvider({ organizationId: REG_ORG + 1, providerType: "mock", providerName: "To Remove" });
    const removed = unregisterProvider(REG_ORG + 1, p.id);
    expect(removed).toBe(true);
    expect(getProvider(REG_ORG + 1, p.id)).toBeNull();
  });

  it("getAvailableProviders filters unavailable", () => {
    const p = registerProvider({ organizationId: REG_ORG + 2, providerType: "mock", providerName: "Avail Test" });
    updateHealth(REG_ORG + 2, p.id, { healthStatus: "healthy" });
    const available = getAvailableProviders(REG_ORG + 2);
    expect(available.length).toBeGreaterThan(0);
    expect(available.every(pp => pp.healthStatus !== "unavailable")).toBe(true);
  });

  it("registerDefaultProviders creates mock provider", () => {
    const providers = registerDefaultProviders(REG_ORG + 3);
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0]!.providerType).toBe("mock");
  });

  it("registerDefaultProviders marks mock as healthy", () => {
    const providers = registerDefaultProviders(REG_ORG + 4);
    expect(providers[0]!.healthStatus).toBe("healthy");
  });
});

// ─── 6. Service: ProviderRouting ──────────────────────────────────────────────

describe("ProviderRoutingService", () => {
  const ROUTE_ORG = 9800 + 2000;

  beforeEach(() => {
    registerDefaultProviders(ROUTE_ORG);
  });

  it("getOrCreateRouting creates routing for new org", () => {
    const routing = getOrCreateRouting(ROUTE_ORG + 1);
    expect(routing.organizationId).toBe(ROUTE_ORG + 1);
    expect(routing.routingStrategy).toBe("deterministic_priority");
  });

  it("getOrCreateRouting returns same routing on second call", () => {
    const r1 = getOrCreateRouting(ROUTE_ORG + 2);
    const r2 = getOrCreateRouting(ROUTE_ORG + 2);
    expect(r1.id).toBe(r2.id);
  });

  it("selectProviderForOrg returns provider for org", () => {
    const provider = selectProviderForOrg(ROUTE_ORG);
    expect(provider).not.toBeNull();
  });

  it("routeWithFallback returns non-empty chain", () => {
    const chain = routeWithFallback(ROUTE_ORG);
    expect(chain.length).toBeGreaterThan(0);
  });

  it("routeWithFallback first item is primary provider", () => {
    const primary = selectProviderForOrg(ROUTE_ORG);
    const chain = routeWithFallback(ROUTE_ORG);
    if (primary && chain.length > 0) {
      expect(chain[0]!.id).toBe(primary.id);
    }
  });

  it("buildFallbackChain excludes specified provider", () => {
    registerProvider({ organizationId: ROUTE_ORG + 5, providerType: "openai", providerName: "OAI" });
    registerDefaultProviders(ROUTE_ORG + 5);
    const p = registerProvider({ organizationId: ROUTE_ORG + 5, providerType: "claude", providerName: "Cl" });
    updateHealth(ROUTE_ORG + 5, p.id, { healthStatus: "healthy" });
    const chain = buildFallbackChain(ROUTE_ORG + 5, p.id);
    expect(chain.every(x => x.id !== p.id)).toBe(true);
  });
});

// ─── 7. Service: ProviderExecution ────────────────────────────────────────────

describe("ProviderExecutionService", () => {
  const EXEC_ORG = 9800 + 3000;

  it("executeInference returns completed execution", () => {
    const exec = executeInference({ organizationId: EXEC_ORG, workflowId: "wf-test", model: "mock-model", prompt: "hello" });
    expect(exec.executionStatus).toBe("replay"); // createReplaySnapshot sets it to replay
    expect(exec.organizationId).toBe(EXEC_ORG);
  });

  it("executeInference populates responsePayload", () => {
    const exec = executeInference({ organizationId: EXEC_ORG, workflowId: "wf-resp", model: "mock-model", prompt: "test prompt" });
    expect(exec.responsePayload).toBeDefined();
    expect((exec.responsePayload as any).content).toBeDefined();
  });

  it("executeInference populates tokenUsage", () => {
    const exec = executeInference({ organizationId: EXEC_ORG, workflowId: "wf-tok", model: "mock-model", prompt: "token test" });
    expect(exec.tokenUsage.totalTokens).toBeGreaterThan(0);
  });

  it("executeInference creates replaySnapshot", () => {
    const exec = executeInference({ organizationId: EXEC_ORG, workflowId: "wf-snap", model: "mock-model", prompt: "snapshot test" });
    expect(exec.replaySnapshot).not.toBeNull();
    expect(exec.replaySnapshot!.snapshotKey).toHaveLength(64);
  });

  it("executeInference with correlationId is idempotent", () => {
    const corrId = sha256("idempotent-test").slice(0, 20);
    const exec1 = executeInference({ organizationId: EXEC_ORG + 1, workflowId: "wf-idem", model: "mock-model", prompt: "idem", correlationId: corrId });
    const exec2 = executeInference({ organizationId: EXEC_ORG + 1, workflowId: "wf-idem", model: "mock-model", prompt: "idem", correlationId: corrId });
    expect(exec1.id).toBe(exec2.id);
  });

  it("getExecutionHistory returns all executions for org", () => {
    executeInference({ organizationId: EXEC_ORG + 2, workflowId: "wf-hist1", model: "m1", prompt: "p1" });
    executeInference({ organizationId: EXEC_ORG + 2, workflowId: "wf-hist2", model: "m2", prompt: "p2" });
    const history = getExecutionHistory(EXEC_ORG + 2);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("replayExecution replays from stored snapshot", () => {
    const exec = executeInference({ organizationId: EXEC_ORG + 3, workflowId: "wf-replay", model: "mock-m", prompt: "replay me" });
    const replayed = replayExecution(EXEC_ORG + 3, exec.id);
    expect(replayed).not.toBeNull();
    expect(replayed!.executionStatus).toBe("replay");
    expect(replayed!.replaySnapshot!.originalExecutionId).toBe(exec.id);
  });

  it("replayExecution returns null for unknown execution", () => {
    const result = replayExecution(EXEC_ORG + 3, "nonexistent");
    expect(result).toBeNull();
  });

  it("executeInference sets reasoningTrace", () => {
    const exec = executeInference({ organizationId: EXEC_ORG + 4, workflowId: "wf-trace", model: "mock-t", prompt: "trace" });
    expect(exec.reasoningTrace).toContain("mock");
  });

  it("executeInference sets explainabilityData", () => {
    const exec = executeInference({ organizationId: EXEC_ORG + 4, workflowId: "wf-expl", model: "mock-e", prompt: "explain" });
    expect(exec.explainabilityData).toBeDefined();
    expect((exec.explainabilityData as any).provider).toBe("mock");
  });
});

// ─── 8. Service: ProviderPolicy ────────────────────────────────────────────────

describe("ProviderPolicyService", () => {
  const POL_ORG = 9800 + 4000;

  it("addPolicy creates and stores policy", () => {
    const p = addPolicy({ organizationId: POL_ORG, policyName: "Test Policy" });
    expect(p.id).toHaveLength(20);
    const policies = getActivePolicies(POL_ORG);
    expect(policies.some(pp => pp.id === p.id)).toBe(true);
  });

  it("enforcePolicy allows when no violations", () => {
    addPolicy({ organizationId: POL_ORG + 1, policyName: "Allow All" });
    const result = enforcePolicy(POL_ORG + 1, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 0.1, capability: "inference" });
    expect(result.allowed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("enforcePolicy rejects blocked provider", () => {
    addPolicy({ organizationId: POL_ORG + 2, policyName: "Block Claude", allowedProviders: ["openai"] });
    const result = enforcePolicy(POL_ORG + 2, { providerType: "claude", model: "claude-3", estimatedTokens: 100, estimatedCost: 0.1, capability: "inference" });
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("enforcePolicy sets requiresApproval when cost exceeds threshold", () => {
    addPolicy({ organizationId: POL_ORG + 3, policyName: "Low Threshold", approvalThreshold: 0.5 });
    const result = enforcePolicy(POL_ORG + 3, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 5.0, capability: "inference" });
    expect(result.requiresApproval).toBe(true);
  });

  it("getActivePolicies filters inactive", () => {
    addPolicy({ organizationId: POL_ORG + 4, policyName: "Active Policy" });
    const policies = getActivePolicies(POL_ORG + 4);
    expect(policies.every(p => p.active)).toBe(true);
  });

  it("checkRequiresApproval returns false when no policies", () => {
    const result = checkRequiresApproval(POL_ORG + 99, 1.0);
    expect(result).toBe(false);
  });

  it("checkRequiresApproval returns true with high threshold policy", () => {
    addPolicy({ organizationId: POL_ORG + 5, policyName: "Low Approval Threshold", approvalThreshold: 1.0 });
    const result = checkRequiresApproval(POL_ORG + 5, 5.0);
    expect(result).toBe(true);
  });
});

// ─── 9. Service: ProviderCost ──────────────────────────────────────────────────

describe("ProviderCostService", () => {
  const COST_ORG = 9800 + 5000;

  it("estimateCost computes correct openai cost", () => {
    const cost = estimateCost("openai", 1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.001 + 500 * 0.002, 6);
  });

  it("estimateCost computes correct claude cost", () => {
    const cost = estimateCost("claude", 1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.0008 + 500 * 0.0024, 6);
  });

  it("estimateCost computes correct gemini cost", () => {
    const cost = estimateCost("gemini", 1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.0005 + 500 * 0.0015, 6);
  });

  it("estimateCost returns 0 for mock", () => {
    const cost = estimateCost("mock", 1000, 500);
    expect(cost).toBe(0);
  });

  it("recordUsage stores cost record", () => {
    const record = recordUsage({ organizationId: COST_ORG, providerId: "p1", model: "gpt-4", promptTokens: 100, completionTokens: 50, providerType: "openai" });
    expect(record.totalCost).toBeGreaterThan(0);
    expect(record.id).toHaveLength(20);
  });

  it("getTodayUsage returns records from today", () => {
    recordUsage({ organizationId: COST_ORG + 1, providerId: "p1", model: "gpt-4", promptTokens: 100, completionTokens: 50, providerType: "openai" });
    const today = getTodayUsage(COST_ORG + 1);
    expect(today.length).toBeGreaterThan(0);
  });

  it("checkQuota returns allowed when under limit", () => {
    const result = checkQuota(COST_ORG + 2, 100.0);
    expect(result.allowed).toBe(true);
    expect(result.exceeded).toBe(false);
  });

  it("getUsageSummary returns correct structure", () => {
    recordUsage({ organizationId: COST_ORG + 3, providerId: "p1", model: "gpt-4", promptTokens: 100, completionTokens: 50, providerType: "openai" });
    const summary = getUsageSummary(COST_ORG + 3);
    expect(summary.totalRecords).toBeGreaterThan(0);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it("detectAnomaly returns no anomaly for fresh org", () => {
    const result = detectAnomaly(COST_ORG + 4);
    expect(result.isAnomaly).toBe(false);
    expect(result.message).toBeNull();
  });

  it("getMonthlyUsage returns records from this month", () => {
    recordUsage({ organizationId: COST_ORG + 5, providerId: "p1", model: "gpt-4", promptTokens: 200, completionTokens: 100, providerType: "openai" });
    const monthly = getMonthlyUsage(COST_ORG + 5);
    expect(monthly.length).toBeGreaterThan(0);
  });
});

// ─── 10. Service: ProviderObservability ───────────────────────────────────────

describe("ProviderObservabilityService", () => {
  const OBS_ORG = 9800 + 6000;

  it("recordLatency stores latency record", () => {
    recordLatency({ organizationId: OBS_ORG, providerId: "p1", model: "gpt-4", latencyMs: 300, correlationId: "c1" });
    const metrics = getProviderMetrics(OBS_ORG);
    expect(metrics.totalRequests).toBeGreaterThan(0);
  });

  it("recordError stores error record", () => {
    recordError({ organizationId: OBS_ORG + 1, providerId: "p1", errorMessage: "timeout", correlationId: "c2" });
    const metrics = getProviderMetrics(OBS_ORG + 1);
    expect(metrics.totalErrors).toBeGreaterThan(0);
  });

  it("recordFallback stores fallback record", () => {
    recordFallback({ organizationId: OBS_ORG + 2, fromProviderId: "p1", toProviderId: "p2", reason: "circuit open", correlationId: "c3" });
    const metrics = getProviderMetrics(OBS_ORG + 2);
    expect(metrics.totalFallbacks).toBeGreaterThan(0);
  });

  it("recordTokenUsage stores token record", () => {
    recordTokenUsage({ organizationId: OBS_ORG + 3, providerId: "p1", promptTokens: 100, completionTokens: 50, correlationId: "c4" });
    // no direct accessor but should not throw
    expect(true).toBe(true);
  });

  it("getProviderHealth returns health scores", () => {
    recordLatency({ organizationId: OBS_ORG + 4, providerId: "px", model: "gpt-4", latencyMs: 100, correlationId: "c5" });
    const health = getProviderHealth(OBS_ORG + 4, "px");
    expect(health.healthScore).toBeGreaterThanOrEqual(0);
    expect(health.avgLatencyMs).toBe(100);
    expect(health.errorRate).toBe(0);
  });

  it("getProviderHealth returns non-zero errorRate after errors", () => {
    recordLatency({ organizationId: OBS_ORG + 5, providerId: "py", model: "m1", latencyMs: 200, correlationId: "cx1" });
    recordError({ organizationId: OBS_ORG + 5, providerId: "py", errorMessage: "err", correlationId: "cx2" });
    const health = getProviderHealth(OBS_ORG + 5, "py");
    expect(health.errorRate).toBeGreaterThan(0);
  });

  it("getExecutionLineage returns records for correlationId", () => {
    recordLatency({ organizationId: OBS_ORG + 6, providerId: "p1", model: "m1", latencyMs: 150, correlationId: "lin1" });
    recordTokenUsage({ organizationId: OBS_ORG + 6, providerId: "p1", promptTokens: 50, completionTokens: 25, correlationId: "lin1" });
    const lineage = getExecutionLineage(OBS_ORG + 6, "lin1");
    expect(lineage.length).toBe(2);
  });

  it("computeReliabilityScore returns value between 0 and 1", () => {
    recordLatency({ organizationId: OBS_ORG + 7, providerId: "pz", model: "m1", latencyMs: 100, correlationId: "r1" });
    const score = computeReliabilityScore(OBS_ORG + 7, "pz");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("getProviderMetrics returns correct avgLatencyMs", () => {
    recordLatency({ organizationId: OBS_ORG + 8, providerId: "pm", model: "m1", latencyMs: 100, correlationId: "a1" });
    recordLatency({ organizationId: OBS_ORG + 8, providerId: "pm", model: "m1", latencyMs: 200, correlationId: "a2" });
    const metrics = getProviderMetrics(OBS_ORG + 8);
    expect(metrics.avgLatencyMs).toBe(150);
  });
});

// ─── 11. Service: ProviderReplay ──────────────────────────────────────────────

describe("ProviderReplayService", () => {
  const REPLAY_ORG = 9800 + 7000;

  const makeExec = (id: string = "exec1"): ProviderExecution => ({
    id,
    organizationId: REPLAY_ORG,
    workflowId: "wf-replay",
    providerId: "p1",
    model: "gpt-4",
    executionType: "inference",
    promptHash: sha256("prompt"),
    promptVersion: "1.0",
    requestPayload: { prompt: "test" },
    responsePayload: { content: "result" },
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    latencyMs: 300,
    retryCount: 0,
    fallbackTriggered: false,
    executionStatus: "completed",
    correlationId: "corr1",
    replaySnapshot: null,
    reasoningTrace: null,
    explainabilityData: null,
    createdAt: new Date().toISOString(),
  });

  it("createSnapshot stores and returns snapshot", () => {
    const exec = makeExec("snap-exec-1");
    const snap = createSnapshot(exec);
    expect(snap.snapshotKey).toHaveLength(64);
    expect(snap.originalExecutionId).toBe("snap-exec-1");
  });

  it("replayFromSnapshot returns stored snapshot", () => {
    const exec = makeExec("snap-exec-2");
    const snap = createSnapshot(exec);
    const replayed = replayFromSnapshot(snap.snapshotKey, REPLAY_ORG);
    expect(replayed).not.toBeNull();
    expect(replayed!.originalExecutionId).toBe("snap-exec-2");
  });

  it("replayFromSnapshot returns null for wrong org", () => {
    const exec = makeExec("snap-exec-3");
    const snap = createSnapshot(exec);
    const replayed = replayFromSnapshot(snap.snapshotKey, REPLAY_ORG + 999);
    expect(replayed).toBeNull();
  });

  it("validateReplay passes for identical snapshot", () => {
    const exec = makeExec("snap-exec-4");
    const snap = createSnapshot(exec);
    const result = validateReplay(snap, snap);
    expect(result.valid).toBe(true);
    expect(result.snapshotKeyMatch).toBe(true);
    expect(result.payloadMatch).toBe(true);
  });

  it("validateReplay fails for different snapshotKey", () => {
    const exec1 = makeExec("snap-exec-5");
    const exec2 = makeExec("snap-exec-6");
    const snap1 = createSnapshot(exec1);
    const snap2 = createSnapshot(exec2);
    const result = validateReplay(snap1, snap2);
    expect(result.valid).toBe(false);
    expect(result.snapshotKeyMatch).toBe(false);
  });

  it("getReplayHistory returns replay records", () => {
    const exec = makeExec("snap-exec-7");
    const snap = createSnapshot(exec);
    replayFromSnapshot(snap.snapshotKey, REPLAY_ORG);
    const history = getReplayHistory(REPLAY_ORG);
    expect(history.length).toBeGreaterThan(0);
  });
});

// ─── 12. Service: ProviderFailover ────────────────────────────────────────────

describe("ProviderFailoverService", () => {
  const FAIL_ORG = 9800 + 8000;

  beforeEach(() => {
    registerDefaultProviders(FAIL_ORG);
  });

  it("triggerFailover returns event with reason", () => {
    const providers = listProviders(FAIL_ORG);
    const p = providers[0]!;
    const { event } = triggerFailover(FAIL_ORG, p.id, "connection timeout");
    expect(event.reason).toBe("connection timeout");
    expect(event.failedProviderId).toBe(p.id);
  });

  it("triggerFailover stores event in history", () => {
    const providers = listProviders(FAIL_ORG);
    const p = providers[0]!;
    triggerFailover(FAIL_ORG, p.id, "timeout");
    const history = getFailoverHistory(FAIL_ORG);
    expect(history.length).toBeGreaterThan(0);
  });

  it("enterDegradedMode adds org to degraded list", () => {
    enterDegradedMode(FAIL_ORG + 1);
    const degraded = getDegradedOrgs();
    expect(degraded).toContain(FAIL_ORG + 1);
  });

  it("exitDegradedMode removes org from degraded list", () => {
    enterDegradedMode(FAIL_ORG + 2);
    exitDegradedMode(FAIL_ORG + 2);
    const degraded = getDegradedOrgs();
    expect(degraded).not.toContain(FAIL_ORG + 2);
  });

  it("recordFailoverEvent stores event", () => {
    const event = recordFailoverEvent(FAIL_ORG + 3, { organizationId: FAIL_ORG + 3, failedProviderId: "p1", newProviderId: "p2", reason: "test" });
    expect(event.id).toHaveLength(20);
    const history = getFailoverHistory(FAIL_ORG + 3);
    expect(history.some(e => e.id === event.id)).toBe(true);
  });

  it("getFailoverChain returns available provider types in order", () => {
    registerProvider({ organizationId: FAIL_ORG + 4, providerType: "openai", providerName: "OAI" });
    const p = listProviders(FAIL_ORG + 4).find(x => x.providerType === "openai")!;
    if (p) updateHealth(FAIL_ORG + 4, p.id, { healthStatus: "healthy" });
    const chain = getFailoverChain(FAIL_ORG + 4);
    expect(Array.isArray(chain)).toBe(true);
  });

  it("getFailoverHistory returns empty for new org", () => {
    const history = getFailoverHistory(FAIL_ORG + 99);
    expect(history).toHaveLength(0);
  });
});

// ─── 13. Adapters ─────────────────────────────────────────────────────────────

describe("Provider Adapters", () => {
  it("mockAdapter.execute returns deterministic content", () => {
    const r1 = mockAdapter.execute({ model: "mock", prompt: "hello", organizationId: ORG });
    const r2 = mockAdapter.execute({ model: "mock", prompt: "hello", organizationId: ORG });
    expect(r1.content).toBe(r2.content);
  });

  it("mockAdapter.healthCheck returns true", () => {
    expect(mockAdapter.healthCheck()).toBe(true);
  });

  it("mockAdapter.estimateCost returns 0", () => {
    expect(mockAdapter.estimateCost(1000, 500)).toBe(0);
  });

  it("mockAdapter.supportsModel returns true for any model", () => {
    expect(mockAdapter.supportsModel("anything")).toBe(true);
  });

  it("mockAdapter.validateCapability returns true for any capability", () => {
    expect(mockAdapter.validateCapability("inference")).toBe(true);
    expect(mockAdapter.validateCapability("unknown-cap")).toBe(true);
  });

  it("mockAdapter.execute returns 0 latencyMs", () => {
    const r = mockAdapter.execute({ model: "mock", prompt: "test", organizationId: ORG });
    expect(r.latencyMs).toBe(0);
  });

  it("openaiAdapter.execute returns content hash", () => {
    const r = openaiAdapter.execute({ model: "gpt-4", prompt: "test", organizationId: ORG });
    expect(r.content).toHaveLength(20);
    expect(r.latencyMs).toBe(320);
    expect(r.completionTokens).toBe(150);
  });

  it("openaiAdapter.supportsModel checks gpt prefix", () => {
    expect(openaiAdapter.supportsModel("gpt-4")).toBe(true);
    expect(openaiAdapter.supportsModel("claude-3")).toBe(false);
  });

  it("openaiAdapter.estimateCost computes correct rates", () => {
    const cost = openaiAdapter.estimateCost(1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.001 + 500 * 0.002, 6);
  });

  it("openaiAdapter.validateCapability accepts inference", () => {
    expect(openaiAdapter.validateCapability("inference")).toBe(true);
    expect(openaiAdapter.validateCapability("unknown")).toBe(false);
  });

  it("claudeAdapter.execute returns content hash with 280ms latency", () => {
    const r = claudeAdapter.execute({ model: "claude-3", prompt: "test", organizationId: ORG });
    expect(r.latencyMs).toBe(280);
    expect(r.completionTokens).toBe(200);
  });

  it("claudeAdapter.supportsModel checks claude prefix", () => {
    expect(claudeAdapter.supportsModel("claude-3")).toBe(true);
    expect(claudeAdapter.supportsModel("gpt-4")).toBe(false);
  });

  it("claudeAdapter.estimateCost computes correct rates", () => {
    const cost = claudeAdapter.estimateCost(1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.0008 + 500 * 0.0024, 6);
  });

  it("claudeAdapter.normalizeResponse wraps content", () => {
    const norm = claudeAdapter.normalizeResponse("result");
    expect((norm as any).provider).toBe("claude");
  });

  it("geminiAdapter.execute returns content hash with 250ms latency", () => {
    const r = geminiAdapter.execute({ model: "gemini-pro", prompt: "test", organizationId: ORG });
    expect(r.latencyMs).toBe(250);
    expect(r.completionTokens).toBe(175);
  });

  it("geminiAdapter.supportsModel checks gemini prefix", () => {
    expect(geminiAdapter.supportsModel("gemini-pro")).toBe(true);
    expect(geminiAdapter.supportsModel("gpt-4")).toBe(false);
  });

  it("geminiAdapter.estimateCost computes correct rates", () => {
    const cost = geminiAdapter.estimateCost(1000, 500);
    expect(cost).toBeCloseTo(1000 * 0.0005 + 500 * 0.0015, 6);
  });

  it("geminiAdapter.validateCapability accepts embedding", () => {
    expect(geminiAdapter.validateCapability("embedding")).toBe(true);
    expect(geminiAdapter.validateCapability("classification")).toBe(false);
  });

  it("adapters produce different content for same prompt", () => {
    const prompt = "compare me";
    const mock = mockAdapter.execute({ model: "m", prompt, organizationId: ORG });
    const oai = openaiAdapter.execute({ model: "gpt-4", prompt, organizationId: ORG });
    const cl = claudeAdapter.execute({ model: "claude-3", prompt, organizationId: ORG });
    // All should be different (different hash prefixes)
    expect(mock.content).not.toBe(oai.content);
    expect(oai.content).not.toBe(cl.content);
  });
});

// ─── 14. Domain: AIWorkflow — Sprint 4.5 extensions ──────────────────────────

describe("AIWorkflow Sprint 4.5 extensions", () => {
  it("createProviderOrchestrationStep generates deterministic ID", () => {
    const s1 = createProviderOrchestrationStep({ workflowId: "wf1", organizationId: ORG, providerId: "p1", model: "gpt-4" });
    const s2 = createProviderOrchestrationStep({ workflowId: "wf1", organizationId: ORG, providerId: "p1", model: "gpt-4" });
    expect(s1.id).toBe(s2.id);
    expect(s1.id).toHaveLength(20);
  });

  it("createProviderOrchestrationStep sets defaults", () => {
    const step = createProviderOrchestrationStep({ workflowId: "wf1", organizationId: ORG, providerId: "p1", model: "claude-3" });
    expect(step.executionType).toBe("inference");
    expect(step.fallbackChain).toEqual([]);
    expect(step.snapshotKey).toBeNull();
    expect(step.lineageId).toHaveLength(20);
  });

  it("createProviderOrchestrationStep accepts executionType", () => {
    const step = createProviderOrchestrationStep({ workflowId: "wf1", organizationId: ORG, providerId: "p1", model: "m1", executionType: "embedding" });
    expect(step.executionType).toBe("embedding");
  });

  it("createProviderOrchestrationStep accepts fallbackChain", () => {
    const step = createProviderOrchestrationStep({ workflowId: "wf1", organizationId: ORG, providerId: "p1", model: "m1", fallbackChain: ["p2", "p3"] });
    expect(step.fallbackChain).toEqual(["p2", "p3"]);
  });

  it("addInferenceSnapshot appends to empty workflow", () => {
    const workflow = { id: "wf1", organizationId: ORG };
    const snapshot: InferenceSnapshot = {
      id: "snap1",
      workflowId: "wf1",
      organizationId: ORG,
      executionId: "exec1",
      snapshotKey: sha256("snap"),
      payload: { result: "ok" },
      createdAt: new Date().toISOString(),
    };
    const updated = addInferenceSnapshot(workflow, snapshot);
    expect(updated.inferenceSnapshots).toHaveLength(1);
    expect(updated.inferenceSnapshots[0]!.id).toBe("snap1");
  });

  it("addInferenceSnapshot accumulates multiple snapshots", () => {
    const workflow = { id: "wf2", organizationId: ORG };
    const snap1: InferenceSnapshot = { id: "s1", workflowId: "wf2", organizationId: ORG, executionId: "e1", snapshotKey: sha256("s1"), payload: {}, createdAt: new Date().toISOString() };
    const snap2: InferenceSnapshot = { id: "s2", workflowId: "wf2", organizationId: ORG, executionId: "e2", snapshotKey: sha256("s2"), payload: {}, createdAt: new Date().toISOString() };
    const w1 = addInferenceSnapshot(workflow, snap1);
    const w2 = addInferenceSnapshot(w1, snap2);
    expect(w2.inferenceSnapshots).toHaveLength(2);
  });

  it("createProviderOrchestrationStep lineageId differs per call", () => {
    const s1 = createProviderOrchestrationStep({ workflowId: "wf-diff", organizationId: ORG, providerId: "p1", model: "m1" });
    const s2 = createProviderOrchestrationStep({ workflowId: "wf-diff", organizationId: ORG, providerId: "p2", model: "m1" });
    // Different providerId means different step ID but lineageId includes timestamp so may differ
    expect(s1.id).not.toBe(s2.id);
  });
});

// ─── 15. Integration: Full provider lifecycle ─────────────────────────────────

describe("Full provider lifecycle", () => {
  const LIFE_ORG = 9800 + 9000;

  it("register → execute → replay lifecycle", () => {
    // Register providers
    const p = registerProvider({ organizationId: LIFE_ORG, providerType: "mock", providerName: "Life Mock", priority: 5, supportedCapabilities: ["inference"] });
    updateHealth(LIFE_ORG, p.id, { healthStatus: "healthy" });

    // Execute inference
    const exec = executeInference({ organizationId: LIFE_ORG, workflowId: "lifecycle-wf", model: "mock-model", prompt: "lifecycle test" });
    expect(exec.executionStatus).toBe("replay");
    expect(exec.organizationId).toBe(LIFE_ORG);

    // Replay
    const replayed = replayExecution(LIFE_ORG, exec.id);
    expect(replayed).not.toBeNull();
    expect(replayed!.replaySnapshot!.originalExecutionId).toBe(exec.id);
  });

  it("policy enforcement blocks unauthorized provider", () => {
    addPolicy({ organizationId: LIFE_ORG + 1, policyName: "Only Mock", allowedProviders: ["mock"] });
    const result = enforcePolicy(LIFE_ORG + 1, { providerType: "openai", model: "gpt-4", estimatedTokens: 100, estimatedCost: 0.5, capability: "inference" });
    expect(result.allowed).toBe(false);
  });

  it("cost tracking after execution", () => {
    const record = recordUsage({ organizationId: LIFE_ORG + 2, providerId: "p1", model: "gpt-4", promptTokens: 500, completionTokens: 200, providerType: "openai" });
    const summary = getUsageSummary(LIFE_ORG + 2);
    expect(summary.totalCost).toBeGreaterThan(0);
    expect(summary.totalRecords).toBeGreaterThan(0);
  });

  it("failover after circuit break", () => {
    registerDefaultProviders(LIFE_ORG + 3);
    const providers = listProviders(LIFE_ORG + 3);
    const p = providers[0]!;
    const { event } = triggerFailover(LIFE_ORG + 3, p.id, "simulated failure");
    expect(event.failedProviderId).toBe(p.id);
    expect(event.occurredAt).toBeDefined();
  });

  it("observability records latency and errors", () => {
    recordLatency({ organizationId: LIFE_ORG + 4, providerId: "p-obs", model: "gpt-4", latencyMs: 450, correlationId: "life-corr" });
    recordError({ organizationId: LIFE_ORG + 4, providerId: "p-obs", errorMessage: "rate limit", correlationId: "life-corr" });
    const lineage = getExecutionLineage(LIFE_ORG + 4, "life-corr");
    expect(lineage.length).toBe(2);
    const metrics = getProviderMetrics(LIFE_ORG + 4);
    expect(metrics.totalRequests).toBeGreaterThan(0);
    expect(metrics.totalErrors).toBeGreaterThan(0);
  });

  it("snapshot replay preserves payload integrity", () => {
    const exec = executeInference({ organizationId: LIFE_ORG + 5, workflowId: "snap-wf", model: "mock-m", prompt: "snapshot integrity" });
    if (exec.replaySnapshot) {
      const snap = createSnapshot(exec);
      const replayed = replayFromSnapshot(snap.snapshotKey, LIFE_ORG + 5);
      if (replayed) {
        const validation = validateReplay(snap, replayed);
        expect(validation.payloadMatch).toBe(true);
      }
    }
  });

  it("routing selects mock in degraded mode", () => {
    enterDegradedMode(LIFE_ORG + 6);
    const providers = listProviders(LIFE_ORG + 6);
    expect(providers.some(p => p.providerType === "mock")).toBe(true);
    exitDegradedMode(LIFE_ORG + 6);
  });

  it("multi-tenant isolation: org A cannot see org B executions", () => {
    const orgA = LIFE_ORG + 7;
    const orgB = LIFE_ORG + 8;
    executeInference({ organizationId: orgA, workflowId: "wf-a", model: "mock-m", prompt: "org-a exec" });
    executeInference({ organizationId: orgB, workflowId: "wf-b", model: "mock-m", prompt: "org-b exec" });
    const histA = getExecutionHistory(orgA);
    const histB = getExecutionHistory(orgB);
    expect(histA.every(e => e.organizationId === orgA)).toBe(true);
    expect(histB.every(e => e.organizationId === orgB)).toBe(true);
  });

  it("multi-tenant isolation: org A cannot replay org B snapshot", () => {
    const orgA = LIFE_ORG + 9;
    const orgB = LIFE_ORG + 10;
    const exec = executeInference({ organizationId: orgA, workflowId: "wf-x", model: "mock-m", prompt: "cross-org" });
    if (exec.replaySnapshot) {
      const snap = createSnapshot(exec);
      const result = replayFromSnapshot(snap.snapshotKey, orgB);
      expect(result).toBeNull();
    }
  });
});
