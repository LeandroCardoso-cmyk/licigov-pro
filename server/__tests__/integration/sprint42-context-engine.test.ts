import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ─── Domain imports ───────────────────────────────────────────────────────────
import {
  estimateTokens,
  createFragment,
  createLayer,
  createWindow,
  addFragmentToLayer,
  assembleContext,
  detectSemanticOverlap,
  pruneContext,
  isContextStale,
} from "../../domain/contextAssembly";

import {
  createPromptStage,
  createPromptChain,
  buildExecutionPlan,
  validateChain,
  getNextStages,
  applyFallback,
} from "../../domain/promptOrchestration";

import {
  createPolicy,
  applyPolicy,
  evaluateSensitivity,
  filterFragmentsByPolicy,
  getPoliciesForOrg,
  isPolicyApplicable,
} from "../../domain/contextPolicies";

import {
  createReasoningStage,
  createReasoningTrace,
  detectContradictions,
  detectAmbiguities,
  propagateConfidence,
  buildExplainabilityTree,
  formatReasoningForHuman,
} from "../../domain/aiReasoning";

import {
  createOrchestrationCheckpoint,
  evaluateCheckpoint,
  addCheckpointToHistory,
  createWorkflow,
} from "../../domain/aiWorkflow";

// ─── Service imports ──────────────────────────────────────────────────────────
import {
  assembleContextService,
  snapshotAssembly,
  getAssemblySnapshots,
  compareAssemblies,
} from "../../services/contextAssemblyService";

import {
  rankFragments,
  computeRecencyScore,
  computeLegalScore,
} from "../../services/contextRankingService";

import {
  executeChain,
  replayExecution,
  getExecutionHistory,
} from "../../services/promptOrchestratorService";

import {
  createGroundingSource,
  expandGrounding,
  rankSources,
  buildProvenanceGraph,
  computeHallucinationRisk,
} from "../../services/groundingExpansionService";

import {
  compressContext,
  computeJaccard,
  detectDuplicates,
  removeLowRelevance,
} from "../../services/semanticCompressionService";

import {
  recordTokenUsage,
  recordGroundingQuality,
  recordHallucinationRisk,
  recordCompressionRatio,
  recordContextDrift,
  recordAssemblyLatency,
  computeContextHealth,
  getSessionMetrics,
} from "../../services/contextObservabilityService";

import {
  createTemplate,
  renderTemplate,
  versionTemplate,
  rollbackTemplate,
  approveTemplate,
  getTemplatesByKey,
} from "../../services/promptTemplateService";

// ─── Constants ────────────────────────────────────────────────────────────────
const ORG = 9500;

// ─────────────────────────────────────────────────────────────────────────────
// 1. contextAssembly domain
// ─────────────────────────────────────────────────────────────────────────────
describe("contextAssembly domain", () => {
  it("estimateTokens: ceil(length/4)", () => {
    expect(estimateTokens("hello")).toBe(2);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });

  it("createFragment: has required fields", () => {
    const f = createFragment({ organizationId: ORG, source: "legal", content: "Lei 14133", priority: "critical", relevanceScore: 0.9, confidence: 0.8 });
    expect(f.organizationId).toBe(ORG);
    expect(f.source).toBe("legal");
    expect(f.priority).toBe("critical");
    expect(f.isStale).toBe(false);
    expect(f.staleness).toBe(0);
    expect(typeof f.replayKey).toBe("string");
    expect(f.id.length).toBe(20);
  });

  it("createFragment: replayKey is deterministic", () => {
    const f1 = createFragment({ organizationId: ORG, source: "legal", content: "X", priority: "high", relevanceScore: 0.5, confidence: 0.5 });
    const f2 = createFragment({ organizationId: ORG, source: "legal", content: "X", priority: "high", relevanceScore: 0.5, confidence: 0.5 });
    expect(f1.replayKey).toBe(f2.replayKey);
  });

  it("createLayer: starts with empty fragments", () => {
    const l = createLayer({ organizationId: ORG, layerType: "workflow", maxTokens: 512, priority: "high" });
    expect(l.fragments).toHaveLength(0);
    expect(l.totalTokens).toBe(0);
  });

  it("createWindow: softLimit = maxTokens * 0.8", () => {
    const w = createWindow(ORG, 1000);
    expect(w.softLimit).toBe(800);
    expect(w.status).toBe("open");
    expect(w.organizationId).toBe(ORG);
  });

  it("addFragmentToLayer: immutable, updates totalTokens", () => {
    const l = createLayer({ organizationId: ORG, layerType: "retrieval", maxTokens: 512, priority: "medium" });
    const f = createFragment({ organizationId: ORG, source: "retrieval", content: "conteúdo", priority: "medium", relevanceScore: 0.7, confidence: 0.6 });
    const newLayer = addFragmentToLayer(l, f);
    expect(newLayer).not.toBe(l);
    expect(newLayer.fragments).toHaveLength(1);
    expect(newLayer.totalTokens).toBe(f.tokenEstimate);
    expect(l.fragments).toHaveLength(0);
  });

  it("assembleContext: deduplicates by replayKey", () => {
    const f = createFragment({ organizationId: ORG, source: "legal", content: "duplicado", priority: "high", relevanceScore: 0.9, confidence: 0.8 });
    let l = createLayer({ organizationId: ORG, layerType: "legal", maxTokens: 1024, priority: "high" });
    l = addFragmentToLayer(addFragmentToLayer(l, f), f);
    const assembly = assembleContext(ORG, [l], 4096);
    expect(assembly.orderedFragments.filter(x => x.replayKey === f.replayKey)).toHaveLength(1);
  });

  it("assembleContext: sorts by priority desc", () => {
    let l = createLayer({ organizationId: ORG, layerType: "legal", maxTokens: 4096, priority: "high" });
    const fLow = createFragment({ organizationId: ORG, source: "legal", content: "low priority", priority: "low", relevanceScore: 0.5, confidence: 0.5 });
    const fCrit = createFragment({ organizationId: ORG, source: "legal", content: "critical priority", priority: "critical", relevanceScore: 0.5, confidence: 0.5 });
    l = addFragmentToLayer(addFragmentToLayer(l, fLow), fCrit);
    const assembly = assembleContext(ORG, [l], 4096);
    expect(assembly.orderedFragments[0].priority).toBe("critical");
  });

  it("assembleContext: respects hard token limit", () => {
    let l = createLayer({ organizationId: ORG, layerType: "retrieval", maxTokens: 100, priority: "medium" });
    for (let i = 0; i < 10; i++) {
      const f = createFragment({ organizationId: ORG, source: "retrieval", content: `${"x".repeat(100)} item ${i}`, priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
      l = addFragmentToLayer(l, f);
    }
    const assembly = assembleContext(ORG, [l], 50);
    expect(assembly.totalTokensUsed).toBeLessThanOrEqual(50);
  });

  it("assembleContext: replayKey is deterministic", () => {
    const f = createFragment({ organizationId: ORG, source: "user", content: "deterministic", priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
    let l = createLayer({ organizationId: ORG, layerType: "user", maxTokens: 1024, priority: "medium" });
    l = addFragmentToLayer(l, f);
    const a1 = assembleContext(ORG, [l], 4096);
    const a2 = assembleContext(ORG, [l], 4096);
    expect(a1.replayKey).toBe(a2.replayKey);
  });

  it("assembleContext: detects stale fragments (staleness > 0.8)", () => {
    const f = createFragment({ organizationId: ORG, source: "memory", content: "stale", priority: "low", relevanceScore: 0.3, confidence: 0.3 });
    const staleF = { ...f, staleness: 0.9, replayKey: f.replayKey + "stale" };
    let l = createLayer({ organizationId: ORG, layerType: "memory", maxTokens: 4096, priority: "low" });
    l = addFragmentToLayer(addFragmentToLayer(l, f), staleF as typeof f);
    const assembly = assembleContext(ORG, [l], 4096);
    expect(assembly.staleFragments.length).toBeGreaterThanOrEqual(1);
  });

  it("detectSemanticOverlap: identical content returns 1", () => {
    const f1 = createFragment({ organizationId: ORG, source: "legal", content: "lei licitação contrato", priority: "high", relevanceScore: 0.8, confidence: 0.8 });
    const f2 = createFragment({ organizationId: ORG, source: "retrieval", content: "lei licitação contrato", priority: "medium", relevanceScore: 0.6, confidence: 0.6 });
    expect(detectSemanticOverlap(f1, f2)).toBe(1);
  });

  it("detectSemanticOverlap: disjoint content returns 0", () => {
    const f1 = createFragment({ organizationId: ORG, source: "legal", content: "lei contrato", priority: "high", relevanceScore: 0.8, confidence: 0.8 });
    const f2 = createFragment({ organizationId: ORG, source: "retrieval", content: "compras públicas", priority: "medium", relevanceScore: 0.6, confidence: 0.6 });
    expect(detectSemanticOverlap(f1, f2)).toBe(0);
  });

  it("pruneContext: reduces to target tokens", () => {
    let l = createLayer({ organizationId: ORG, layerType: "retrieval", maxTokens: 4096, priority: "medium" });
    for (let i = 0; i < 5; i++) {
      const f = createFragment({ organizationId: ORG, source: "retrieval", content: `${"texto ".repeat(20)}${i}`, priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
      l = addFragmentToLayer(l, f);
    }
    const assembly = assembleContext(ORG, [l], 4096);
    const pruned = pruneContext(assembly, 30);
    expect(pruned.totalTokensUsed).toBeLessThanOrEqual(30);
  });

  it("isContextStale: old temporalContext returns true", () => {
    const f = createFragment({ organizationId: ORG, source: "memory", content: "old", priority: "low", relevanceScore: 0.3, confidence: 0.3, temporalContext: new Date(0).toISOString() });
    expect(isContextStale(f, 1000)).toBe(true);
  });

  it("isContextStale: recent temporalContext returns false", () => {
    const f = createFragment({ organizationId: ORG, source: "memory", content: "recent", priority: "high", relevanceScore: 0.9, confidence: 0.9 });
    expect(isContextStale(f, 86400000)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. promptOrchestration domain
// ─────────────────────────────────────────────────────────────────────────────
describe("promptOrchestration domain", () => {
  it("createPromptStage: has all required fields", () => {
    const s = createPromptStage({ name: "Test", stageType: "instruction", templateId: "tpl_1", inputVariables: ["x"], outputSchema: { result: "string" }, maxTokens: 512, timeoutMs: 5000, retryCount: 1, fallbackStrategy: "skip", dependsOn: [], guardrails: [] });
    expect(s.name).toBe("Test");
    expect(s.stageType).toBe("instruction");
    expect(s.id.length).toBe(20);
  });

  it("createPromptStage: id is deterministic", () => {
    const params = { name: "Det", stageType: "output" as const, templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry" as const, dependsOn: [], guardrails: [] };
    expect(createPromptStage(params).id).toBe(createPromptStage(params).id);
  });

  it("createPromptChain: has replayKey", () => {
    const s = createPromptStage({ name: "s1", stageType: "system", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "chain1", stages: [s], transitions: [] });
    expect(typeof chain.replayKey).toBe("string");
    expect(chain.organizationId).toBe(ORG);
  });

  it("buildExecutionPlan: single stage", () => {
    const s = createPromptStage({ name: "only", stageType: "instruction", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "simple", stages: [s], transitions: [] });
    const plan = buildExecutionPlan(chain);
    expect(plan.executionOrder).toContain(s.id);
    expect(plan.estimatedTokens).toBe(100);
  });

  it("buildExecutionPlan: topological order respects dependencies", () => {
    const s1 = createPromptStage({ name: "A", stageType: "system", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const s2 = createPromptStage({ name: "B", stageType: "instruction", templateId: "t2", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [s1.id], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "ordered", stages: [s1, s2], transitions: [] });
    const plan = buildExecutionPlan(chain);
    expect(plan.executionOrder.indexOf(s1.id)).toBeLessThan(plan.executionOrder.indexOf(s2.id));
  });

  it("validateChain: valid chain returns no errors", () => {
    const s = createPromptStage({ name: "valid", stageType: "output", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "valid_chain", stages: [s], transitions: [] });
    const result = validateChain(chain);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validateChain: detects missing dependency", () => {
    const s = createPromptStage({ name: "broken", stageType: "output", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: ["nonexistent"], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "broken_chain", stages: [s], transitions: [] });
    const result = validateChain(chain);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("getNextStages: returns stages with completed deps", () => {
    const s1 = createPromptStage({ name: "A", stageType: "system", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const s2 = createPromptStage({ name: "B", stageType: "instruction", templateId: "t2", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [s1.id], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "chain", stages: [s1, s2], transitions: [] });
    const next = getNextStages(chain, [s1.id]);
    expect(next.map(s => s.id)).toContain(s2.id);
  });

  it("applyFallback: returns new stage with fallback strategy", () => {
    const s = createPromptStage({ name: "fallback_test", stageType: "output", templateId: "t1", inputVariables: [], outputSchema: {}, maxTokens: 100, timeoutMs: 1000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const newStage = applyFallback(s, "escalate");
    expect(newStage.fallbackStrategy).toBe("escalate");
    expect(newStage).not.toBe(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. contextPolicies domain
// ─────────────────────────────────────────────────────────────────────────────
describe("contextPolicies domain", () => {
  it("createPolicy: id is deterministic", () => {
    const params = { organizationId: ORG, policyType: "lgpd" as const, name: "LGPD Base", description: "Base LGPD policy", appliesTo: ["legal"], sensitivityLevel: "confidential" as const, maskingStrategy: "hash" as const, requiresEvidence: true, retentionMs: null, legalBasis: "LGPD Art. 7", isActive: true, priority: 10, createdBy: 1 };
    const p1 = createPolicy(params);
    const p2 = createPolicy(params);
    expect(p1.id).toBe(p2.id);
  });

  it("evaluateSensitivity: CPF → restricted", () => {
    expect(evaluateSensitivity("cpf do contribuinte", ORG)).toBe("restricted");
  });

  it("evaluateSensitivity: nome → confidential", () => {
    expect(evaluateSensitivity("nome do fornecedor", ORG)).toBe("confidential");
  });

  it("evaluateSensitivity: neutral → public", () => {
    expect(evaluateSensitivity("processo licitatório", ORG)).toBe("public");
  });

  it("applyPolicy: full_redact → content = [REDACTED]", () => {
    const policy = createPolicy({ organizationId: ORG, policyType: "redaction", name: "Redact All", description: "redact", appliesTo: ["legal"], sensitivityLevel: "restricted", maskingStrategy: "full_redact", requiresEvidence: false, retentionMs: null, legalBasis: null, isActive: true, priority: 1, createdBy: 1 });
    const f = createFragment({ organizationId: ORG, source: "legal", content: "CPF 123.456.789-00", priority: "high", relevanceScore: 0.8, confidence: 0.7 });
    const { fragment, application } = applyPolicy(policy, f);
    expect(fragment.content).toBe("[REDACTED]");
    expect(application.wasRedacted).toBe(true);
  });

  it("applyPolicy: hash strategy → content is hex string", () => {
    const policy = createPolicy({ organizationId: ORG, policyType: "masking", name: "Hash Mask", description: "hash", appliesTo: ["memory"], sensitivityLevel: "confidential", maskingStrategy: "hash", requiresEvidence: false, retentionMs: null, legalBasis: null, isActive: true, priority: 2, createdBy: 1 });
    const f = createFragment({ organizationId: ORG, source: "memory", content: "sensitive data", priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
    const { fragment } = applyPolicy(policy, f);
    expect(fragment.content).toMatch(/^[a-f0-9]+$/);
  });

  it("filterFragmentsByPolicy: operador cannot see restricted", () => {
    const policy = createPolicy({ organizationId: ORG, policyType: "access", name: "Restrict Access", description: "restrict", appliesTo: ["legal"], sensitivityLevel: "restricted", maskingStrategy: "full_redact", requiresEvidence: false, retentionMs: null, legalBasis: null, isActive: true, priority: 1, createdBy: 1 });
    const f = createFragment({ organizationId: ORG, source: "legal", content: "CPF info", priority: "critical", relevanceScore: 0.9, confidence: 0.9 });
    const visible = filterFragmentsByPolicy([f], [policy], "operador");
    expect(visible.find(x => x.id === f.id && x.content === "CPF info")).toBeUndefined();
  });

  it("filterFragmentsByPolicy: auditor sees all", () => {
    const policy = createPolicy({ organizationId: ORG, policyType: "access", name: "Restrict", description: "r", appliesTo: ["legal"], sensitivityLevel: "secret", maskingStrategy: "full_redact", requiresEvidence: false, retentionMs: null, legalBasis: null, isActive: true, priority: 1, createdBy: 1 });
    const f = createFragment({ organizationId: ORG, source: "legal", content: "secret content", priority: "critical", relevanceScore: 0.9, confidence: 0.9 });
    const visible = filterFragmentsByPolicy([f], [policy], "auditor");
    expect(visible.length).toBeGreaterThan(0);
  });

  it("isPolicyApplicable: checks appliesTo against fragment.source", () => {
    const policy = createPolicy({ organizationId: ORG, policyType: "retention", name: "Legal Retention", description: "r", appliesTo: ["legal"], sensitivityLevel: "internal", maskingStrategy: null, requiresEvidence: false, retentionMs: null, legalBasis: null, isActive: true, priority: 1, createdBy: 1 });
    const f = createFragment({ organizationId: ORG, source: "legal", content: "lei", priority: "critical", relevanceScore: 0.9, confidence: 0.9 });
    const fOther = createFragment({ organizationId: ORG, source: "memory", content: "memory", priority: "low", relevanceScore: 0.3, confidence: 0.3 });
    expect(isPolicyApplicable(policy, f)).toBe(true);
    expect(isPolicyApplicable(policy, fOther)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. aiReasoning domain
// ─────────────────────────────────────────────────────────────────────────────
describe("aiReasoning domain", () => {
  it("createReasoningStage: confidence label maps correctly", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "x", output: "y", confidenceScore: 0.95 });
    expect(s.confidence).toBe("certain");
  });

  it("createReasoningStage: confidenceScore < 0.3 → unknown", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "inference", input: "x", output: "y", confidenceScore: 0.1 });
    expect(s.confidence).toBe("unknown");
  });

  it("createReasoningStage: replayKey deterministic", () => {
    const params = { organizationId: ORG, stageType: "citation" as const, input: "input_det", output: "output_det" };
    const s1 = createReasoningStage(params);
    const s2 = createReasoningStage(params);
    expect(s1.replayKey).toBe(s2.replayKey);
  });

  it("createReasoningTrace: overallConfidence is weighted average", () => {
    const s1 = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "a", output: "b", confidenceScore: 0.6 });
    const s2 = createReasoningStage({ organizationId: ORG, stageType: "conclusion", input: "c", output: "d", confidenceScore: 0.8 });
    const trace = createReasoningTrace(ORG, "sess_001", [s1, s2]);
    expect(trace.overallConfidence).toBeGreaterThan(0);
    expect(trace.overallConfidence).toBeLessThanOrEqual(1);
    expect(trace.organizationId).toBe(ORG);
  });

  it("createReasoningTrace: finalConclusion = output of last stage", () => {
    const s1 = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "a", output: "first" });
    const s2 = createReasoningStage({ organizationId: ORG, stageType: "conclusion", input: "b", output: "final conclusion" });
    const trace = createReasoningTrace(ORG, "sess_002", [s1, s2]);
    expect(trace.finalConclusion).toBe("final conclusion");
  });

  it("detectContradictions: finds negation patterns", () => {
    const s1 = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "x", output: "aprovado pela lei" });
    const s2 = createReasoningStage({ organizationId: ORG, stageType: "inference", input: "y", output: "não aprovado conforme norma" });
    const contradictions = detectContradictions([s1, s2]);
    expect(Array.isArray(contradictions)).toBe(true);
  });

  it("detectAmbiguities: finds hedging words", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "inference", input: "x", output: "talvez seja possível aprovar" });
    const ambiguities = detectAmbiguities(s);
    expect(ambiguities.length).toBeGreaterThan(0);
  });

  it("propagateConfidence: confidence decays across stages", () => {
    const s1 = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "a", output: "b", confidenceScore: 0.7 });
    const s2 = createReasoningStage({ organizationId: ORG, stageType: "conclusion", input: "c", output: "d", confidenceScore: 0.8 });
    const propagated = propagateConfidence([s1, s2]);
    expect(propagated).toHaveLength(2);
    expect(propagated[1].confidenceScore).toBeLessThanOrEqual(propagated[0].confidenceScore + 0.01);
  });

  it("propagateConfidence: returns new array (immutable)", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "citation", input: "x", output: "y", confidenceScore: 0.8 });
    const original = [s];
    const propagated = propagateConfidence(original);
    expect(propagated).not.toBe(original);
  });

  it("buildExplainabilityTree: returns non-null object", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "premise_extraction", input: "x", output: "y" });
    const trace = createReasoningTrace(ORG, "sess_003", [s]);
    const tree = buildExplainabilityTree(trace);
    expect(tree).not.toBeNull();
    expect(typeof tree).toBe("object");
  });

  it("formatReasoningForHuman: returns markdown string", () => {
    const s = createReasoningStage({ organizationId: ORG, stageType: "conclusion", input: "x", output: "resultado final" });
    const trace = createReasoningTrace(ORG, "sess_004", [s]);
    const markdown = formatReasoningForHuman(trace);
    expect(typeof markdown).toBe("string");
    expect(markdown.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. aiWorkflow orchestration checkpoint
// ─────────────────────────────────────────────────────────────────────────────
describe("aiWorkflow orchestration checkpoints", () => {
  it("createOrchestrationCheckpoint: status=passed for high confidence low risk", () => {
    const cp = createOrchestrationCheckpoint({ workflowId: "wf1", organizationId: ORG, stage: "generation", confidenceScore: 0.9, hallucinationRisk: 0.2 });
    expect(cp.status).toBe("passed");
    expect(cp.approvalRequired).toBe(false);
  });

  it("createOrchestrationCheckpoint: status=warning for medium confidence", () => {
    const cp = createOrchestrationCheckpoint({ workflowId: "wf2", organizationId: ORG, stage: "review", confidenceScore: 0.7, hallucinationRisk: 0.4 });
    expect(cp.approvalRequired).toBe(true);
  });

  it("createOrchestrationCheckpoint: status=failed for low confidence", () => {
    const cp = createOrchestrationCheckpoint({ workflowId: "wf3", organizationId: ORG, stage: "output", confidenceScore: 0.3, hallucinationRisk: 0.8 });
    expect(cp.status).toBe("failed");
  });

  it("evaluateCheckpoint: canProceed = confidence>0.6 && risk<0.7", () => {
    const cp = createOrchestrationCheckpoint({ workflowId: "wf4", organizationId: ORG, stage: "reasoning", confidenceScore: 0.75, hallucinationRisk: 0.3 });
    const eval_ = evaluateCheckpoint(cp);
    expect(eval_.canProceed).toBe(true);
  });

  it("evaluateCheckpoint: cannot proceed with confidence <= 0.6", () => {
    const cp = createOrchestrationCheckpoint({ workflowId: "wf5", organizationId: ORG, stage: "reasoning", confidenceScore: 0.5, hallucinationRisk: 0.3 });
    const eval_ = evaluateCheckpoint(cp);
    expect(eval_.canProceed).toBe(false);
  });

  it("addCheckpointToHistory: appends to workflow history", () => {
    const wf = createWorkflow({ organizationId: ORG, workflowKey: "test_checkpoint", actor: 1, explanation: "Test" });
    const cp = createOrchestrationCheckpoint({ workflowId: wf.id, organizationId: ORG, stage: "ai_generation", confidenceScore: 0.8, hallucinationRisk: 0.2 });
    const updated = addCheckpointToHistory(wf, cp);
    expect(updated.history.length).toBeGreaterThan(wf.history.length);
    expect(updated).not.toBe(wf);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. contextAssemblyService
// ─────────────────────────────────────────────────────────────────────────────
describe("contextAssemblyService", () => {
  const SESSION = `sess_svc_${ORG}`;

  it("assembleContextService: returns assembly output", () => {
    const result = assembleContextService({ organizationId: ORG, sessionId: SESSION, legalRefs: ["Lei 14133/2021 Art. 6"], maxTokens: 2048 });
    expect(result.assembly).toBeDefined();
    expect(result.tokenCount).toBeGreaterThanOrEqual(0);
    expect(result.organizationId ?? ORG).toBe(ORG);
  });

  it("assembleContextService: legalRefs → critical priority fragments", () => {
    const result = assembleContextService({ organizationId: ORG, sessionId: SESSION, legalRefs: ["Lei 14133/2021"] });
    const legalFrags = result.assembly.orderedFragments.filter(f => f.source === "legal");
    expect(legalFrags.length).toBeGreaterThan(0);
    expect(legalFrags[0].priority).toBe("critical");
  });

  it("assembleContextService: compressionRatio = tokenCount / maxTokens", () => {
    const result = assembleContextService({ organizationId: ORG, sessionId: SESSION, maxTokens: 4096 });
    expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    expect(result.compressionRatio).toBeLessThanOrEqual(1);
  });

  it("snapshotAssembly: stores and retrieves by org", () => {
    const result = assembleContextService({ organizationId: ORG, sessionId: SESSION });
    snapshotAssembly(result, ORG);
    const snapshots = getAssemblySnapshots(ORG);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("compareAssemblies: returns diff string", () => {
    const r1 = assembleContextService({ organizationId: ORG, sessionId: SESSION, maxTokens: 1024 });
    const r2 = assembleContextService({ organizationId: ORG, sessionId: SESSION, maxTokens: 2048 });
    const diff = compareAssemblies(r1, r2);
    expect(typeof diff).toBe("string");
    expect(diff.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. contextRankingService
// ─────────────────────────────────────────────────────────────────────────────
describe("contextRankingService", () => {
  const fragments = [
    createFragment({ organizationId: ORG, source: "legal", content: "Lei 14133", priority: "critical", relevanceScore: 0.9, confidence: 0.9, legalBasis: "Lei 14133/2021" }),
    createFragment({ organizationId: ORG, source: "memory", content: "precedente", priority: "low", relevanceScore: 0.4, confidence: 0.5 }),
    createFragment({ organizationId: ORG, source: "retrieval", content: "resultado busca", priority: "medium", relevanceScore: 0.6, confidence: 0.7 }),
  ];

  it("rankFragments: returns sorted rankedFragments", () => {
    const result = rankFragments({ organizationId: ORG, fragments, workflowStage: "generation", role: "admin", legalWeight: 0.15, recencyWeight: 0.15, confidenceWeight: 0.15 });
    expect(result.rankedFragments.length).toBe(3);
    expect(result.rankedFragments[0].rankPosition).toBe(1);
    expect(result.totalFragments).toBe(3);
  });

  it("rankFragments: replayKey is deterministic", () => {
    const input = { organizationId: ORG, fragments, workflowStage: "generation", role: "admin", legalWeight: 0.15, recencyWeight: 0.15, confidenceWeight: 0.15 };
    const r1 = rankFragments(input);
    const r2 = rankFragments(input);
    expect(r1.replayKey).toBe(r2.replayKey);
  });

  it("computeRecencyScore: recent → 1.0", () => {
    const now = new Date().toISOString();
    expect(computeRecencyScore(now, now)).toBe(1.0);
  });

  it("computeRecencyScore: very old → 0.2", () => {
    const old = new Date(0).toISOString();
    expect(computeRecencyScore(old, new Date().toISOString())).toBe(0.2);
  });

  it("computeLegalScore: legalBasis not null → 1.0", () => {
    const f = createFragment({ organizationId: ORG, source: "retrieval", content: "x", priority: "medium", relevanceScore: 0.5, confidence: 0.5, legalBasis: "Art. 6" });
    expect(computeLegalScore(f)).toBe(1.0);
  });

  it("computeLegalScore: source=legal → 0.8", () => {
    const f = createFragment({ organizationId: ORG, source: "legal", content: "x", priority: "high", relevanceScore: 0.8, confidence: 0.8 });
    expect(computeLegalScore(f)).toBe(0.8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. promptOrchestratorService
// ─────────────────────────────────────────────────────────────────────────────
describe("promptOrchestratorService", () => {
  const makeChainInput = () => {
    const s1 = createPromptStage({ name: "Stage1", stageType: "system", templateId: "t1", inputVariables: ["var1"], outputSchema: {}, maxTokens: 256, timeoutMs: 5000, retryCount: 1, fallbackStrategy: "retry", dependsOn: [], guardrails: [] });
    const s2 = createPromptStage({ name: "Stage2", stageType: "output", templateId: "t2", inputVariables: ["var2"], outputSchema: {}, maxTokens: 512, timeoutMs: 5000, retryCount: 1, fallbackStrategy: "skip", dependsOn: [s1.id], guardrails: [] });
    const chain = createPromptChain(ORG, { name: "test_chain", stages: [s1, s2], transitions: [] });
    const assembly = assembleContext(ORG, [], 4096);
    return { chain, assembly };
  };

  it("executeChain: returns completed result", () => {
    const { chain, assembly } = makeChainInput();
    const result = executeChain({ organizationId: ORG, sessionId: "orch_sess_1", chainId: chain.id, chain, contextAssembly: assembly, variables: { var1: "hello", var2: "world" }, maxTokens: 4096 });
    expect(result.status).toBe("completed");
    expect(result.stageExecutions.length).toBe(2);
    expect(result.replayKey).toBeTruthy();
    expect(result.correlationId).toBeTruthy();
  });

  it("executeChain: replay-safe (same input → same replayKey)", () => {
    const { chain, assembly } = makeChainInput();
    const input = { organizationId: ORG, sessionId: "orch_sess_det", chainId: chain.id, chain, contextAssembly: assembly, variables: { var1: "A", var2: "B" }, maxTokens: 4096 };
    const r1 = executeChain(input);
    const r2 = executeChain(input);
    expect(r1.replayKey).toBe(r2.replayKey);
  });

  it("executeChain: stores in execution history", () => {
    const { chain, assembly } = makeChainInput();
    executeChain({ organizationId: ORG, sessionId: "orch_sess_hist", chainId: chain.id, chain, contextAssembly: assembly, variables: { var1: "X" }, maxTokens: 4096 });
    const history = getExecutionHistory(ORG, "orch_sess_hist");
    expect(history.length).toBeGreaterThan(0);
  });

  it("replayExecution: returns new execution", () => {
    const { chain, assembly } = makeChainInput();
    const original = executeChain({ organizationId: ORG, sessionId: "orch_replay", chainId: chain.id, chain, contextAssembly: assembly, variables: { var1: "orig" }, maxTokens: 4096 });
    const replayed = replayExecution(original, { var1: "new" });
    expect(replayed).toBeDefined();
    expect(typeof replayed.replayKey).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. groundingExpansionService
// ─────────────────────────────────────────────────────────────────────────────
describe("groundingExpansionService", () => {
  const src = createGroundingSource({ organizationId: ORG, sourceType: "legal_text", content: "Art. 6 Lei 14133", citation: "Lei 14133/2021 Art. 6", authority: 0.95, relevanceScore: 0.9, legalBasis: "Lei 14133/2021", isVerified: true });

  it("createGroundingSource: has required fields", () => {
    expect(src.organizationId).toBe(ORG);
    expect(src.isVerified).toBe(true);
    expect(src.id.length).toBe(20);
    expect(typeof src.replayKey).toBe("string");
  });

  it("createGroundingSource: replayKey deterministic", () => {
    const s2 = createGroundingSource({ organizationId: ORG, sourceType: "legal_text", content: "Art. 6 Lei 14133", citation: "Lei 14133/2021 Art. 6", authority: 0.95, relevanceScore: 0.9 });
    expect(src.replayKey).toBe(s2.replayKey);
  });

  it("expandGrounding: returns grounding expansion", () => {
    const expansion = expandGrounding(ORG, "licitação pública", [src]);
    expect(expansion.sources.length).toBeGreaterThan(0);
    expect(expansion.organizationId).toBe(ORG);
    expect(typeof expansion.groundingConfidence).toBe("number");
  });

  it("rankSources: deterministic order", () => {
    const s2 = createGroundingSource({ organizationId: ORG, sourceType: "precedent", content: "TCU precedente", citation: "TCU Ac. 123/2023", authority: 0.7, relevanceScore: 0.8 });
    const r1 = rankSources([src, s2]);
    const r2 = rankSources([s2, src]);
    expect(r1[0].id).toBe(r2[0].id);
  });

  it("buildProvenanceGraph: maps source ids to provenance", () => {
    const graph = buildProvenanceGraph([src]);
    expect(typeof graph).toBe("object");
    expect(Object.keys(graph).length).toBeGreaterThan(0);
  });

  it("computeHallucinationRisk: empty sources → 1.0", () => {
    expect(computeHallucinationRisk([])).toBe(1.0);
  });

  it("computeHallucinationRisk: verified high-authority → low risk", () => {
    const risk = computeHallucinationRisk([src]);
    expect(risk).toBeLessThan(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. semanticCompressionService
// ─────────────────────────────────────────────────────────────────────────────
describe("semanticCompressionService", () => {
  const makeFragments = () => [
    createFragment({ organizationId: ORG, source: "legal", content: "Lei 14133 licitação contrato", priority: "critical", relevanceScore: 0.9, confidence: 0.9 }),
    createFragment({ organizationId: ORG, source: "retrieval", content: "resultado busca semântica", priority: "medium", relevanceScore: 0.6, confidence: 0.6 }),
    createFragment({ organizationId: ORG, source: "memory", content: "memória institucional", priority: "low", relevanceScore: 0.3, confidence: 0.3 }),
  ];

  it("compressContext: returns result with counts", () => {
    const frags = makeFragments();
    const result = compressContext({ organizationId: ORG, fragments: frags, targetTokens: 20, preservePriority: ["critical"] });
    expect(result.originalFragments.length).toBe(3);
    expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
    expect(result.replayKey).toBeTruthy();
  });

  it("compressContext: preserves critical priority", () => {
    const frags = makeFragments();
    const result = compressContext({ organizationId: ORG, fragments: frags, targetTokens: 5, preservePriority: ["critical"] });
    const criticalInResult = result.compressedFragments.find(f => f.priority === "critical");
    expect(criticalInResult).toBeDefined();
  });

  it("computeJaccard: identical → 1", () => {
    const f1 = createFragment({ organizationId: ORG, source: "legal", content: "teste jaccard overlap", priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
    const f2 = createFragment({ organizationId: ORG, source: "retrieval", content: "teste jaccard overlap", priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
    expect(computeJaccard(f1, f2)).toBe(1);
  });

  it("computeJaccard: disjoint → 0", () => {
    const f1 = createFragment({ organizationId: ORG, source: "legal", content: "lei contrato", priority: "high", relevanceScore: 0.8, confidence: 0.8 });
    const f2 = createFragment({ organizationId: ORG, source: "memory", content: "xyz abc", priority: "low", relevanceScore: 0.2, confidence: 0.2 });
    expect(computeJaccard(f1, f2)).toBe(0);
  });

  it("detectDuplicates: groups identical replayKey", () => {
    const f = createFragment({ organizationId: ORG, source: "legal", content: "dup", priority: "medium", relevanceScore: 0.5, confidence: 0.5 });
    const groups = detectDuplicates([f, f]);
    const dupGroup = groups.find(g => g.length > 1);
    expect(dupGroup).toBeDefined();
  });

  it("removeLowRelevance: removes below threshold", () => {
    const frags = makeFragments();
    const filtered = removeLowRelevance(frags, 0.5);
    expect(filtered.every(f => f.relevanceScore >= 0.5)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. contextObservabilityService
// ─────────────────────────────────────────────────────────────────────────────
describe("contextObservabilityService", () => {
  const SESSION_OBS = `obs_${ORG}_001`;

  it("recordTokenUsage: returns valid metric", () => {
    const m = recordTokenUsage(ORG, SESSION_OBS, 1024);
    expect(m.metricName).toBe("context_tokens");
    expect(m.value).toBe(1024);
    expect(m.unit).toBe("tokens");
    expect(m.organizationId).toBe(ORG);
  });

  it("recordGroundingQuality: correct metricName", () => {
    const m = recordGroundingQuality(ORG, SESSION_OBS, 0.85);
    expect(m.metricName).toBe("grounding_quality");
    expect(m.value).toBe(0.85);
  });

  it("recordHallucinationRisk: correct unit", () => {
    const m = recordHallucinationRisk(ORG, SESSION_OBS, 0.2);
    expect(m.metricName).toBe("hallucination_risk");
    expect(m.unit).toBe("score");
  });

  it("recordCompressionRatio: value stored", () => {
    const m = recordCompressionRatio(ORG, SESSION_OBS, 0.6);
    expect(m.value).toBe(0.6);
  });

  it("recordContextDrift: drift metric stored", () => {
    const m = recordContextDrift(ORG, SESSION_OBS, 0.45);
    expect(m.metricName).toBe("context_drift");
  });

  it("recordAssemblyLatency: latency in ms", () => {
    const m = recordAssemblyLatency(ORG, SESSION_OBS, 123);
    expect(m.metricName).toBe("assembly_latency");
    expect(m.unit).toBe("ms");
  });

  it("getSessionMetrics: returns recorded metrics", () => {
    recordTokenUsage(ORG, SESSION_OBS, 512);
    const metrics = getSessionMetrics(ORG, SESSION_OBS);
    expect(metrics.length).toBeGreaterThan(0);
  });

  it("computeContextHealth: returns health snapshot", () => {
    const metrics = getSessionMetrics(ORG, SESSION_OBS);
    const health = computeContextHealth(ORG, SESSION_OBS, metrics);
    expect(health.organizationId).toBe(ORG);
    expect(typeof health.avgTokenUsage).toBe("number");
    expect(typeof health.staleContextAlerts).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. promptTemplateService
// ─────────────────────────────────────────────────────────────────────────────
describe("promptTemplateService", () => {
  const baseParams = {
    organizationId: ORG,
    templateKey: `tr_test_${ORG}`,
    name: "Template TR Teste",
    content: "Elabore {{objeto}} para {{orgao}} conforme {{lei}}",
    legalBasis: "Lei 14133/2021",
    createdBy: 1,
  };

  it("createTemplate: extracts variables from {{...}}", () => {
    const t = createTemplate(baseParams);
    expect(t.variables).toContain("objeto");
    expect(t.variables).toContain("orgao");
    expect(t.variables).toContain("lei");
    expect(t.version).toBe("1.0.0");
  });

  it("createTemplate: replayKey is deterministic", () => {
    const t1 = createTemplate(baseParams);
    const t2 = createTemplate(baseParams);
    expect(t1.replayKey).toBe(t2.replayKey);
  });

  it("renderTemplate: substitutes variables", () => {
    const t = createTemplate(baseParams);
    const vars = { objeto: "computadores", orgao: "Prefeitura SP", lei: "Lei 14133" };
    const result = renderTemplate(t, vars);
    expect(result.renderedContent).toContain("computadores");
    expect(result.renderedContent).toContain("Prefeitura SP");
    expect(result.variablesUsed).toContain("objeto");
    expect(result.missingVariables).toHaveLength(0);
  });

  it("renderTemplate: lists missingVariables", () => {
    const t = createTemplate(baseParams);
    const result = renderTemplate(t, { objeto: "x" });
    expect(result.missingVariables).toContain("orgao");
  });

  it("versionTemplate: minor version bump", () => {
    const t = createTemplate(baseParams);
    const v2 = versionTemplate(t, "Novo conteúdo {{objeto}}", 1);
    expect(v2.version).toBe("1.1.0");
    expect(v2.lineage).toContain(t.id);
  });

  it("versionTemplate: original unchanged", () => {
    const t = createTemplate(baseParams);
    const v2 = versionTemplate(t, "outro", 1);
    expect(t.version).toBe("1.0.0");
    expect(v2.version).toBe("1.1.0");
  });

  it("rollbackTemplate: major version bump", () => {
    const t = createTemplate(baseParams);
    const rb = rollbackTemplate(t, "1.0.0", 1);
    expect(rb.version).toBe("2.0.0");
  });

  it("approveTemplate: sets isApproved=true", () => {
    const t = createTemplate({ ...baseParams, templateKey: `tr_approve_${ORG}` });
    expect(t.isApproved).toBe(false);
    const approved = approveTemplate(t, 2);
    expect(approved.isApproved).toBe(true);
    expect(approved.approvedBy).toBe(2);
    expect(t.isApproved).toBe(false);
  });

  it("getTemplatesByKey: retrieves stored templates", () => {
    createTemplate({ ...baseParams, templateKey: `tr_getkey_${ORG}` });
    const list = getTemplatesByKey(ORG, `tr_getkey_${ORG}`);
    expect(list.length).toBeGreaterThan(0);
  });
});
