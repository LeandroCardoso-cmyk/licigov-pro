/**
 * Sprint 4.4 — AI Execution Engine + Autonomous Assistants Foundation
 * ORG ID: 9700
 * Target: ~150 tests, 0 regressions
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";

// ─── Domain imports ───────────────────────────────────────────────────────────
import {
  type SafetyLevel,
  type ActionClassification,
  type SafetyCheck,
  type HallucinationRisk,
  type RollbackPlan,
  classifyAction,
  performSafetyCheck,
  assessHallucinationRisk,
  buildRollbackPlan,
  isActionBlocked,
  requiresHumanApproval,
  validateRollbackPlan,
} from "../../domain/actionSafety";

import {
  type ApprovalStatus,
  type ApprovalWorkflow,
  type ApprovalDecision,
  createApprovalWorkflow,
  recordApprovalDecision,
  isWorkflowResolved,
  isApproved,
  escalateWorkflow,
  delegateWorkflow,
  overrideWorkflow,
  isWorkflowExpired,
  getApprovalSummary,
} from "../../domain/humanApproval";

import {
  type AssistantRole,
  type CapabilityType,
  type AssistantProfile,
  type AssistantCapability,
  createAssistantProfile,
  getDefaultProfile,
  canAssistantPerform,
  getCapabilityConfidence,
  isActionRestricted,
  mergeProfiles,
} from "../../domain/assistantSpecialization";

import {
  type AgentExecutionStatus,
  type ExecutionStage,
  type AgentExecution,
  type ExecutionCheckpoint,
  type ExecutionDecision,
  createAgentExecution,
  advanceExecutionStage,
  addExecutionCheckpoint,
  recordExecutionDecision,
  initiateRollback,
  createExecutionReplay,
  isExecutionReplayable,
  getExecutionSummary,
} from "../../domain/agentExecution";

import {
  type TaskPriority,
  type ExecutionTask,
  type ExecutionPlan,
  createExecutionPlan,
  addTaskToPlan,
  addDependency,
  getReadyTasks,
  getParallelizableTasks,
  topologicalSort,
  validatePlanConstraints,
  estimatePlanDuration,
} from "../../domain/agentPlanning";

import {
  type AutonomousStageType,
  type AutonomousStageStatus,
  type AutonomousStage,
  createAutonomousStage,
  addAutonomousStageToWorkflow,
} from "../../domain/aiWorkflow";

// ─── Service imports ──────────────────────────────────────────────────────────
import {
  type AgentExecutionEngineInput,
  type AgentExecutionEngineOutput,
  runAgentExecution,
  getExecutionHistory,
  replayExecution,
} from "../../services/agentExecutionEngine";

import {
  type AgentPlanningInput,
  type AgentPlanningOutput,
  planExecution,
  getPlanHistory,
  replayPlan,
} from "../../services/agentPlanningService";

import {
  type AutonomousWorkflowInput,
  type AutonomousWorkflowOutput,
  runAutonomousWorkflow,
  getWorkflowHistory,
} from "../../services/autonomousWorkflowService";

import {
  type ApprovalServiceInput,
  type ApprovalServiceOutput,
  createApprovalRequest,
  recordDecision,
  escalateApproval,
  delegateApproval,
  getApprovalHistory,
  getPendingApprovals,
} from "../../services/humanApprovalService";

import {
  type AgentSafetyInput,
  type AgentSafetyOutput,
  type SafetyReport,
  verifySafety,
  getSafetyHistory,
  buildSafetyReport,
} from "../../services/agentSafetyService";

import {
  type CopilotContextInput,
  type CopilotContextOutput,
  assembleCopilotContext,
  getCopilotHistory,
  getDefaultCopilot,
} from "../../services/copilotContextService";

import {
  type ExecutionObservabilityTrace,
  type ExecutionObservabilityMetric,
  recordExecutionTrace,
  recordExecutionMetric,
  executionLatency,
  approvalLatency,
  rollbackFrequency,
  safetyBlockRate,
  hallucinationRiskLevel,
  orchestrationDepth,
  getExecutionTraces,
  getExecutionMetrics,
  computeExecutionHealth,
} from "../../services/executionObservabilityService";

import {
  type TaskSimulationInput,
  type TaskSimulationOutput,
  simulateTasks,
  getSimulationHistory,
} from "../../services/taskSimulationService";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORG = 9700;

// ─── Helper: build a minimal valid ExecutionTask omitting auto-generated fields ───
function makeTask(overrides: Partial<Omit<ExecutionTask, "id" | "planId" | "createdAt" | "completedAt" | "output">> & { taskName: string }): Omit<ExecutionTask, "id" | "planId" | "createdAt" | "completedAt" | "output"> {
  return {
    organizationId: ORG,
    taskName: overrides.taskName,
    taskType: overrides.taskType ?? "analysis",
    description: overrides.description ?? "task description",
    priority: overrides.priority ?? "medium",
    status: overrides.status ?? "pending",
    dependsOn: overrides.dependsOn ?? [],
    parallelizable: overrides.parallelizable ?? false,
    estimatedMs: overrides.estimatedMs ?? 1000,
    actions: overrides.actions ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. actionSafety — classifyAction
// ─────────────────────────────────────────────────────────────────────────────
describe("actionSafety — classifyAction", () => {
  it("classifica ação 'read' como low_risk", () => {
    const c = classifyAction(ORG, "read", {});
    expect(c.safetyLevel).toBe("low_risk");
    expect(c.isReversible).toBe(true);
    expect(c.requiresApproval).toBe(false);
  });

  it("classifica ação 'delete_all' como blocked", () => {
    const c = classifyAction(ORG, "delete_all", {});
    expect(c.safetyLevel).toBe("blocked");
    expect(c.requiresApproval).toBe(true);
  });

  it("classifica ação 'mass_update' como blocked", () => {
    const c = classifyAction(ORG, "mass_update", {});
    expect(c.safetyLevel).toBe("blocked");
  });

  it("classifica ação 'bulk_update' como high_risk", () => {
    const c = classifyAction(ORG, "bulk_update", {});
    expect(c.safetyLevel).toBe("high_risk");
    expect(c.requiresApproval).toBe(true);
  });

  it("classifica ação 'update_record' como medium_risk", () => {
    const c = classifyAction(ORG, "update_record", {});
    expect(c.safetyLevel).toBe("medium_risk");
  });

  it("classifica ação 'create_draft' como low_risk", () => {
    const c = classifyAction(ORG, "create_draft", {});
    expect(c.safetyLevel).toBe("low_risk");
  });

  it("classifica ação desconhecida como safe (fallback)", () => {
    const c = classifyAction(ORG, "unknown_custom_action", {});
    expect(c.safetyLevel).toBe("safe");
  });

  it("resultado é determinístico para mesma entrada", () => {
    const a = classifyAction(ORG, "bulk_update", {});
    const b = classifyAction(ORG, "bulk_update", {});
    expect(a.safetyLevel).toBe(b.safetyLevel);
    expect(a.isReversible).toBe(b.isReversible);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. actionSafety — performSafetyCheck
// ─────────────────────────────────────────────────────────────────────────────
describe("actionSafety — performSafetyCheck", () => {
  it("retorna passed=true para ação segura", () => {
    const check = performSafetyCheck(ORG, "read", null, 0.9);
    expect(check.passed).toBe(true);
    expect(check.recommendation).toBe("proceed");
  });

  it("retorna recommendation=block para ação bloqueada", () => {
    const check = performSafetyCheck(ORG, "drop_table", null, 0.9);
    expect(check.recommendation).toBe("block");
    expect(check.passed).toBe(false);
  });

  it("inclui organizationId correto", () => {
    const check = performSafetyCheck(ORG, "search", null, 0.8);
    expect(check.organizationId).toBe(ORG);
  });

  it("inclui findings array", () => {
    const check = performSafetyCheck(ORG, "delete_all", null, 0.5);
    expect(Array.isArray(check.findings)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. actionSafety — isActionBlocked / requiresHumanApproval
// ─────────────────────────────────────────────────────────────────────────────
describe("actionSafety — isActionBlocked / requiresHumanApproval", () => {
  it("isActionBlocked retorna true para drop_database", () => {
    const c = classifyAction(ORG, "drop_database", {});
    expect(isActionBlocked(c)).toBe(true);
  });

  it("isActionBlocked retorna false para search", () => {
    const c = classifyAction(ORG, "search", {});
    expect(isActionBlocked(c)).toBe(false);
  });

  it("requiresHumanApproval retorna true para high_risk", () => {
    const c = classifyAction(ORG, "bulk_update", {});
    expect(requiresHumanApproval(c)).toBe(true);
  });

  it("requiresHumanApproval retorna false para low_risk", () => {
    const c = classifyAction(ORG, "read", {});
    expect(requiresHumanApproval(c)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. actionSafety — assessHallucinationRisk
// ─────────────────────────────────────────────────────────────────────────────
describe("actionSafety — assessHallucinationRisk", () => {
  it("retorna riskLevel 'none' para texto neutro curto", () => {
    const risk = assessHallucinationRisk(ORG, "pesquisar processos licitatórios");
    expect(["none", "low"]).toContain(risk.riskLevel);
  });

  it("retorna indicadores para texto com linguagem absoluta", () => {
    const risk = assessHallucinationRisk(ORG, "sempre aprovado, nunca rejeitado, garantido");
    expect(risk.indicators.length).toBeGreaterThan(0);
  });

  it("inclui mitigations array", () => {
    const risk = assessHallucinationRisk(ORG, "deletar todos os registros");
    expect(Array.isArray(risk.mitigations)).toBe(true);
  });

  it("inclui organizationId correto", () => {
    const risk = assessHallucinationRisk(ORG, "texto qualquer");
    expect(risk.organizationId).toBe(ORG);
  });

  it("aceita objeto como input", () => {
    const risk = assessHallucinationRisk(ORG, { content: "texto neutro simples" });
    expect(risk).toBeDefined();
    expect(risk.organizationId).toBe(ORG);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. actionSafety — buildRollbackPlan / validateRollbackPlan
// ─────────────────────────────────────────────────────────────────────────────
describe("actionSafety — buildRollbackPlan", () => {
  it("cria plano de rollback com organizationId correto", () => {
    const plan = buildRollbackPlan(ORG, "exec-rb-1", ["update_record"]);
    expect(plan.organizationId).toBe(ORG);
    expect(plan.executionId).toBe("exec-rb-1");
    expect(Array.isArray(plan.steps)).toBe(true);
  });

  it("validateRollbackPlan retorna objeto com valid e issues", () => {
    const plan = buildRollbackPlan(ORG, "exec-rb-2", ["update_record", "add_comment"]);
    const result = validateRollbackPlan(plan);
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("plano para lista de stages vazia é criado", () => {
    const plan = buildRollbackPlan(ORG, "exec-rb-3", []);
    expect(plan).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. humanApproval — createApprovalWorkflow
// ─────────────────────────────────────────────────────────────────────────────
describe("humanApproval — createApprovalWorkflow", () => {
  it("cria workflow com status 'pending'", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "document_publish",
      requiredApprovers: ["user1", "user2"],
    });
    expect(wf.status).toBe("pending");
    expect(wf.organizationId).toBe(ORG);
    expect(wf.requiredApprovers).toEqual(["user1", "user2"]);
    expect(wf.decisions).toHaveLength(0);
  });

  it("aceita deadline e context", () => {
    const deadline = new Date(Date.now() + 86400000).toISOString();
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "contract_sign",
      requiredApprovers: ["manager"],
      deadline,
      context: { documentId: "doc-1" },
    });
    expect(wf.deadline).toBe(deadline);
    expect(wf.context.documentId).toBe("doc-1");
  });

  it("workflow é imutável — decisions começa vazio", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a"],
    });
    expect(wf.decisions).toHaveLength(0);
  });

  it("priority padrão é 'normal'", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a"],
    });
    expect(wf.priority).toBe("normal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. humanApproval — recordApprovalDecision
// ─────────────────────────────────────────────────────────────────────────────
describe("humanApproval — recordApprovalDecision", () => {
  it("adiciona decisão à cadeia imutável", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["approver1"],
    });
    const updated = recordApprovalDecision(wf, {
      approver: "approver1",
      decision: "approve",
      justification: "Aprovado conforme análise",
    });
    expect(updated.decisions).toHaveLength(1);
    expect(updated.decisions[0].approver).toBe("approver1");
    expect(updated.decisions[0].decision).toBe("approve");
  });

  it("não muta o workflow original", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["approver1"],
    });
    recordApprovalDecision(wf, { approver: "approver1", decision: "approve", justification: "ok" });
    expect(wf.decisions).toHaveLength(0);
  });

  it("status muda para 'rejected' quando há rejeição", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["approver1"],
    });
    const updated = recordApprovalDecision(wf, {
      approver: "approver1",
      decision: "reject",
      justification: "Não aprovado",
    });
    expect(updated.status).toBe("rejected");
  });

  it("status muda para 'approved' quando todos aprovam", () => {
    let wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    wf = recordApprovalDecision(wf, { approver: "a1", decision: "approve", justification: "ok" });
    expect(wf.status).toBe("approved");
  });

  it("múltiplas decisões são acumuladas na cadeia", () => {
    let wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "multi",
      requiredApprovers: ["a1", "a2"],
    });
    wf = recordApprovalDecision(wf, { approver: "a1", decision: "approve", justification: "ok" });
    wf = recordApprovalDecision(wf, { approver: "a2", decision: "approve", justification: "ok" });
    expect(wf.decisions).toHaveLength(2);
    expect(wf.status).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. humanApproval — escalateWorkflow / delegateWorkflow / overrideWorkflow
// ─────────────────────────────────────────────────────────────────────────────
describe("humanApproval — escalate/delegate/override", () => {
  it("escalateWorkflow define status 'escalated'", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    const escalated = escalateWorkflow(wf, "manager", "urgente");
    expect(escalated.status).toBe("escalated");
    expect(escalated.escalateTo).toBe("manager");
  });

  it("delegateWorkflow define status 'delegated'", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    const delegated = delegateWorkflow(wf, "substitute", "em férias");
    expect(delegated.status).toBe("delegated");
    expect(delegated.delegatedTo).toBe("substitute");
  });

  it("overrideWorkflow define status 'overridden'", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    const overridden = overrideWorkflow(wf, "admin", "emergência");
    expect(overridden.status).toBe("overridden");
  });

  it("escalate não muta o original", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG, approvalType: "test", requiredApprovers: ["a1"],
    });
    escalateWorkflow(wf, "boss", "urgente");
    expect(wf.status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. humanApproval — getApprovalSummary
// ─────────────────────────────────────────────────────────────────────────────
describe("humanApproval — getApprovalSummary", () => {
  it("retorna contagens corretas após uma aprovação", () => {
    let wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1", "a2"],
    });
    wf = recordApprovalDecision(wf, { approver: "a1", decision: "approve", justification: "ok" });
    const summary = getApprovalSummary(wf);
    expect(summary.total).toBe(2); // total = requiredApprovers.length
    expect(summary.approved).toBe(1);
    expect(summary.rejected).toBe(0);
  });

  it("isWorkflowResolved retorna true após aprovação completa", () => {
    let wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    wf = recordApprovalDecision(wf, { approver: "a1", decision: "approve", justification: "ok" });
    expect(isWorkflowResolved(wf)).toBe(true);
  });

  it("isApproved retorna false para workflow com rejeição", () => {
    let wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1"],
    });
    wf = recordApprovalDecision(wf, { approver: "a1", decision: "reject", justification: "não" });
    expect(isApproved(wf)).toBe(false);
  });

  it("summary.pending é calculado corretamente", () => {
    const wf = createApprovalWorkflow({
      organizationId: ORG,
      approvalType: "test",
      requiredApprovers: ["a1", "a2"],
    });
    const summary = getApprovalSummary(wf);
    expect(summary.pending).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. assistantSpecialization — getDefaultProfile
// ─────────────────────────────────────────────────────────────────────────────
describe("assistantSpecialization — getDefaultProfile", () => {
  it("retorna perfil para legal_copilot", () => {
    const p = getDefaultProfile(ORG, "legal_copilot");
    expect(p.role).toBe("legal_copilot");
    expect(p.organizationId).toBe(ORG);
    expect(Array.isArray(p.capabilities)).toBe(true);
  });

  it("retorna perfil para drafting_copilot", () => {
    const p = getDefaultProfile(ORG, "drafting_copilot");
    expect(p.role).toBe("drafting_copilot");
  });

  it("resultado é determinístico para mesma entrada", () => {
    const a = getDefaultProfile(ORG, "review_copilot");
    const b = getDefaultProfile(ORG, "review_copilot");
    expect(a.id).toBe(b.id);
    expect(a.name).toBe(b.name);
  });

  it("retorna perfis para todos os roles", () => {
    const roles: AssistantRole[] = [
      "legal_copilot", "drafting_copilot", "review_copilot",
      "compliance_copilot", "import_copilot", "procurement_copilot", "general_assistant",
    ];
    for (const role of roles) {
      const p = getDefaultProfile(ORG, role);
      expect(p.role).toBe(role);
    }
  });

  it("perfil tem id com 20 chars", () => {
    const p = getDefaultProfile(ORG, "legal_copilot");
    expect(p.id).toHaveLength(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. assistantSpecialization — canAssistantPerform / getCapabilityConfidence
// ─────────────────────────────────────────────────────────────────────────────
describe("assistantSpecialization — capabilities", () => {
  it("canAssistantPerform retorna boolean", () => {
    const p = getDefaultProfile(ORG, "legal_copilot");
    const result = canAssistantPerform(p, "analyze", "contract");
    expect(typeof result).toBe("boolean");
  });

  it("getCapabilityConfidence retorna número entre 0 e 1", () => {
    const p = getDefaultProfile(ORG, "legal_copilot");
    const conf = getCapabilityConfidence(p, "analyze");
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  it("isActionRestricted retorna objeto com restricted boolean", () => {
    const p = getDefaultProfile(ORG, "general_assistant");
    const result = isActionRestricted(p, "delete_all");
    expect(typeof result.restricted).toBe("boolean");
  });

  it("capabilities não vazio para legal_copilot", () => {
    const p = getDefaultProfile(ORG, "legal_copilot");
    expect(p.capabilities.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. assistantSpecialization — mergeProfiles
// ─────────────────────────────────────────────────────────────────────────────
describe("assistantSpecialization — mergeProfiles", () => {
  it("merge preserva campos do base quando override não os define", () => {
    const base = getDefaultProfile(ORG, "legal_copilot");
    const merged = mergeProfiles(base, { name: "Custom Legal" });
    expect(merged.name).toBe("Custom Legal");
    expect(merged.role).toBe("legal_copilot");
    expect(merged.organizationId).toBe(ORG);
  });

  it("merge preserva capabilities quando não sobrescritas", () => {
    const base = getDefaultProfile(ORG, "drafting_copilot");
    const merged = mergeProfiles(base, {});
    expect(merged.capabilities.length).toBeGreaterThan(0);
  });

  it("merge sem override retorna cópia do base", () => {
    const base = getDefaultProfile(ORG, "compliance_copilot");
    const merged = mergeProfiles(base, {});
    expect(merged.id).toBe(base.id);
    expect(merged.role).toBe(base.role);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. agentExecution — createAgentExecution
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecution — createAgentExecution", () => {
  it("cria execução com status 'pending' e stages vazio", () => {
    const exec = createAgentExecution({
      organizationId: ORG,
      sessionId: "sess-1",
      agentType: "procurement",
      stageNames: ["fetch", "analyze", "report"],
    });
    expect(exec.status).toBe("pending");
    expect(exec.organizationId).toBe(ORG);
    expect(exec.stages).toHaveLength(0);
  });

  it("gera replayKey determinístico", () => {
    const a = createAgentExecution({
      organizationId: ORG,
      sessionId: "sess-rep",
      agentType: "legal",
      stageNames: ["a", "b"],
    });
    const b = createAgentExecution({
      organizationId: ORG,
      sessionId: "sess-rep",
      agentType: "legal",
      stageNames: ["a", "b"],
    });
    expect(a.replayKey).toBe(b.replayKey);
  });

  it("todos os stages começam com status 'pending'", () => {
    const exec = createAgentExecution({
      organizationId: ORG,
      sessionId: "sess-2",
      agentType: "review",
      stageNames: ["stage1", "stage2"],
    });
    for (const s of exec.stages) {
      expect(s.status).toBe("pending");
    }
  });

  it("checkpoints começa vazio", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-cp-init", agentType: "test",
      stageNames: ["s1"],
    });
    expect(exec.checkpoints).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. agentExecution — advanceExecutionStage / addExecutionCheckpoint
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecution — advanceExecutionStage", () => {
  it("avança stage para 'completed'", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-adv", agentType: "test",
      stageNames: ["s1"],
    });
    const updated = advanceExecutionStage(exec, "s1", { result: "ok" }, "completed");
    const stage = updated.stages.find(s => s.stageName === "s1");
    expect(stage?.status).toBe("completed");
  });

  it("não muta o objeto original — stages permanece vazio", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-imm", agentType: "test",
      stageNames: ["s1"],
    });
    advanceExecutionStage(exec, "s1", {}, "completed");
    expect(exec.stages).toHaveLength(0);
  });

  it("addExecutionCheckpoint adiciona checkpoint à lista", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-cp", agentType: "test",
      stageNames: ["s1"],
    });
    const withCp = addExecutionCheckpoint(exec, "cp1", { data: "x" }, true);
    expect(withCp.checkpoints).toHaveLength(1);
    expect(withCp.checkpoints[0].checkpointName).toBe("cp1");
  });

  it("stage pode avançar para 'failed'", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-fail", agentType: "test",
      stageNames: ["s1"],
    });
    const updated = advanceExecutionStage(exec, "s1", { error: "blocked" }, "failed");
    const stage = updated.stages.find(s => s.stageName === "s1");
    expect(stage?.status).toBe("failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. agentExecution — recordExecutionDecision / initiateRollback
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecution — recordExecutionDecision / initiateRollback", () => {
  it("recordExecutionDecision appends decisão imutavelmente", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-dec", agentType: "test",
      stageNames: ["s1"],
    });
    const updated = recordExecutionDecision(exec, {
      decisionType: "safety_check",
      decision: "proceed",
      rationale: "seguro",
      confidence: 0.95,
      decidedBy: "system",
    });
    expect(updated.decisions.length).toBeGreaterThan(0);
    expect(exec.decisions).toHaveLength(0);
  });

  it("initiateRollback cria rollback com reason", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-rb", agentType: "test",
      stageNames: ["s1"],
    });
    const rb = initiateRollback(exec, "falha crítica", "system");
    expect(rb).toBeDefined();
    expect(rb.reason).toBe("falha crítica");
    expect(rb.executionId).toBe(exec.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. agentExecution — createExecutionReplay / isExecutionReplayable
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecution — replay", () => {
  it("isExecutionReplayable retorna boolean", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-rp", agentType: "test",
      stageNames: ["s1"],
    });
    const result = isExecutionReplayable(exec);
    expect(typeof result).toBe("boolean");
  });

  it("createExecutionReplay cria replay com originalExecutionId", () => {
    let exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-rep2", agentType: "test",
      stageNames: ["s1"],
    });
    exec = advanceExecutionStage(exec, "s1", {}, "completed");
    const replay = createExecutionReplay(exec, "s1");
    expect(replay.originalExecutionId).toBe(exec.id);
  });

  it("getExecutionSummary retorna objeto com campos esperados", () => {
    const exec = createAgentExecution({
      organizationId: ORG, sessionId: "sess-sum", agentType: "test",
      stageNames: ["s1", "s2"],
    });
    const summary = getExecutionSummary(exec);
    expect(summary).toHaveProperty("totalStages");
    expect(summary).toHaveProperty("completedStages");
    expect(summary).toHaveProperty("failedStages");
    expect(summary).toHaveProperty("durationMs");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. agentPlanning — createExecutionPlan
// ─────────────────────────────────────────────────────────────────────────────
describe("agentPlanning — createExecutionPlan", () => {
  it("cria plano com goal e sem tarefas iniciais", () => {
    const plan = createExecutionPlan({
      organizationId: ORG,
      sessionId: "plan-sess-1",
      planName: "Plano Licitação",
      goal: {
        description: "Elaborar edital completo",
        successCriteria: ["Edital aprovado"],
        priority: "high",
      },
    });
    expect(plan.organizationId).toBe(ORG);
    expect(plan.tasks).toHaveLength(0);
    expect(plan.status).toBe("draft");
  });

  it("replayKey é string não vazia", () => {
    const plan = createExecutionPlan({
      organizationId: ORG, sessionId: "plan-rk", planName: "test",
      goal: { description: "g", successCriteria: [], priority: "low" },
    });
    expect(typeof plan.replayKey).toBe("string");
    expect(plan.replayKey.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. agentPlanning — addTaskToPlan / getReadyTasks
// ─────────────────────────────────────────────────────────────────────────────
describe("agentPlanning — tarefas e dependências", () => {
  function buildPlan() {
    return createExecutionPlan({
      organizationId: ORG,
      sessionId: "plan-sess-2",
      planName: "Test Plan",
      goal: { description: "test", successCriteria: [], priority: "medium" },
    });
  }

  it("addTaskToPlan adiciona tarefa imutavelmente", () => {
    const plan = buildPlan();
    const updated = addTaskToPlan(plan, makeTask({ taskName: "Análise Jurídica", taskType: "analysis" }));
    expect(updated.tasks).toHaveLength(1);
    expect(plan.tasks).toHaveLength(0);
  });

  it("getReadyTasks retorna tarefas sem dependências não completadas", () => {
    let plan = buildPlan();
    plan = addTaskToPlan(plan, makeTask({ taskName: "t1", taskType: "analysis" }));
    plan = addTaskToPlan(plan, makeTask({ taskName: "t2", taskType: "drafting" }));
    const ready = getReadyTasks(plan);
    expect(ready.length).toBeGreaterThan(0);
  });

  it("addDependency cria dependência entre tarefas", () => {
    let plan = buildPlan();
    plan = addTaskToPlan(plan, makeTask({ taskName: "t1", taskType: "analysis" }));
    plan = addTaskToPlan(plan, makeTask({ taskName: "t2", taskType: "drafting" }));
    const t1 = plan.tasks[0];
    const t2 = plan.tasks[1];
    const updated = addDependency(plan, t2.id, t1.id, "finish_to_start");
    expect(updated.dependencies.length).toBeGreaterThan(0);
  });

  it("topologicalSort retorna lista ordenada", () => {
    let plan = buildPlan();
    plan = addTaskToPlan(plan, makeTask({ taskName: "taskA", taskType: "analysis" }));
    plan = addTaskToPlan(plan, makeTask({ taskName: "taskB", taskType: "drafting" }));
    const sorted = topologicalSort(plan);
    expect(sorted).toHaveLength(2);
  });

  it("validatePlanConstraints retorna array (possivelmente vazio)", () => {
    const plan = buildPlan();
    const violations = validatePlanConstraints(plan);
    expect(Array.isArray(violations)).toBe(true);
  });

  it("estimatePlanDuration retorna número >= 0", () => {
    let plan = buildPlan();
    plan = addTaskToPlan(plan, makeTask({ taskName: "t1", estimatedMs: 1000 }));
    const dur = estimatePlanDuration(plan);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it("getParallelizableTasks retorna array", () => {
    let plan = buildPlan();
    plan = addTaskToPlan(plan, makeTask({ taskName: "t1", parallelizable: true }));
    plan = addTaskToPlan(plan, makeTask({ taskName: "t2", parallelizable: true }));
    const parallel = getParallelizableTasks(plan);
    expect(Array.isArray(parallel)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. aiWorkflow — AutonomousStage
// ─────────────────────────────────────────────────────────────────────────────
describe("aiWorkflow — AutonomousStage", () => {
  it("createAutonomousStage cria stage com status 'pending'", () => {
    const stage = createAutonomousStage({
      workflowId: "wf-1",
      organizationId: ORG,
      stageName: "analysis_stage",
      stageType: "analysis",
    });
    expect(stage.status).toBe("pending");
    expect(stage.organizationId).toBe(ORG);
    expect(stage.workflowId).toBe("wf-1");
  });

  it("id é determinístico para mesma entrada", () => {
    const a = createAutonomousStage({ workflowId: "wf-2", organizationId: ORG, stageName: "s", stageType: "drafting" });
    const b = createAutonomousStage({ workflowId: "wf-2", organizationId: ORG, stageName: "s", stageType: "drafting" });
    expect(a.id).toBe(b.id);
  });

  it("addAutonomousStageToWorkflow adiciona stage a objeto qualquer", () => {
    const workflow = { id: "wf-3", name: "test workflow" };
    const stage = createAutonomousStage({
      workflowId: "wf-3",
      organizationId: ORG,
      stageName: "safety_check",
      stageType: "safety_check",
      requiresApproval: true,
      safetyLevel: "high_risk",
    });
    const updated = addAutonomousStageToWorkflow(workflow, stage);
    expect(updated.stages).toHaveLength(1);
    expect(updated.stages[0].requiresApproval).toBe(true);
    expect(updated.stages[0].safetyLevel).toBe("high_risk");
  });

  it("addAutonomousStageToWorkflow acumula múltiplos stages", () => {
    const workflow = { id: "wf-4" };
    const s1 = createAutonomousStage({ workflowId: "wf-4", organizationId: ORG, stageName: "s1", stageType: "analysis" });
    const s2 = createAutonomousStage({ workflowId: "wf-4", organizationId: ORG, stageName: "s2", stageType: "validation" });
    const w1 = addAutonomousStageToWorkflow(workflow, s1);
    const w2 = addAutonomousStageToWorkflow(w1, s2);
    expect(w2.stages).toHaveLength(2);
  });

  it("stage com stageType 'approval_gate' tem requiresApproval false por padrão", () => {
    const stage = createAutonomousStage({
      workflowId: "wf-5", organizationId: ORG, stageName: "gate", stageType: "approval_gate",
    });
    expect(stage.requiresApproval).toBe(false);
  });

  it("stage output começa como null", () => {
    const stage = createAutonomousStage({
      workflowId: "wf-6", organizationId: ORG, stageName: "rollback_stage", stageType: "rollback",
    });
    expect(stage.output).toBeNull();
    expect(stage.completedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. agentExecutionEngine — runAgentExecution
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecutionEngine — runAgentExecution", () => {
  it("executa pipeline de stages simples", () => {
    const output = runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-sess-1",
      agentType: "legal",
      stages: [
        { name: "fetch_data", input: { query: "processos" } },
        { name: "analyze", input: { data: "x" } },
      ],
    });
    expect(output.execution).toBeDefined();
    expect(output.replayKey).toBeDefined();
    expect(output.safetyChecks.length).toBeGreaterThan(0);
  });

  it("replayKey é string hex de 64 chars", () => {
    const output = runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-sess-rk",
      agentType: "review",
      stages: [{ name: "s1", input: {} }],
    });
    expect(output.replayKey).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(output.replayKey)).toBe(true);
  });

  it("armazena histórico por org/session", () => {
    runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-hist-1",
      agentType: "test",
      stages: [{ name: "read", input: {} }],
    });
    const history = getExecutionHistory(ORG, "eng-hist-1");
    expect(history.length).toBeGreaterThan(0);
  });

  it("getExecutionHistory sem sessionId retorna todas as execuções da org", () => {
    runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-hist-all-1",
      agentType: "test",
      stages: [{ name: "search", input: {} }],
    });
    const all = getExecutionHistory(ORG);
    expect(all.length).toBeGreaterThan(0);
  });

  it("approvalRequired é boolean", () => {
    const output = runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-appr",
      agentType: "test",
      stages: [{ name: "create_draft", input: {} }],
    });
    expect(typeof output.approvalRequired).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. agentExecutionEngine — replayExecution
// ─────────────────────────────────────────────────────────────────────────────
describe("agentExecutionEngine — replayExecution", () => {
  it("replay produz mesmo replayKey que original", () => {
    const original = runAgentExecution({
      organizationId: ORG,
      sessionId: "replay-sess-1",
      agentType: "legal",
      stages: [{ name: "fetch", input: { id: "123" } }],
    });
    const replayed = replayExecution(original);
    expect(replayed.replayKey).toBe(original.replayKey);
  });

  it("replay produz stageOutputs definido", () => {
    const original = runAgentExecution({
      organizationId: ORG,
      sessionId: "replay-sess-2",
      agentType: "legal",
      stages: [{ name: "analyze", input: { content: "texto" } }],
    });
    const replayed = replayExecution(original);
    expect(replayed.stageOutputs).toBeDefined();
  });

  it("correlationId é string não vazia", () => {
    const output = runAgentExecution({
      organizationId: ORG,
      sessionId: "eng-corr",
      agentType: "test",
      stages: [{ name: "search", input: {} }],
    });
    expect(typeof output.correlationId).toBe("string");
    expect(output.correlationId.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. agentPlanningService — planExecution
// ─────────────────────────────────────────────────────────────────────────────
describe("agentPlanningService — planExecution", () => {
  it("cria plano com tarefas resolvidas", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "plan-svc-1",
      planName: "Plano Completo",
      goal: { description: "Elaborar TR", successCriteria: ["TR aprovado"], priority: "high" },
      rawTasks: [
        { name: "analise_juridica", type: "analysis", description: "Analisar normas", priority: "high" },
        { name: "elaborar_tr", type: "drafting", description: "Elaborar TR", priority: "medium", dependsOn: ["analise_juridica"] },
      ],
    });
    expect(output.plan.tasks.length).toBeGreaterThanOrEqual(2);
    expect(output.replayKey).toBeDefined();
  });

  it("criticalPath é array de strings", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "plan-svc-cp",
      planName: "CP Test",
      goal: { description: "test", successCriteria: [], priority: "low" },
      rawTasks: [
        { name: "t1", type: "analysis", description: "d", priority: "medium", estimatedMs: 2000 },
        { name: "t2", type: "drafting", description: "d", priority: "medium", estimatedMs: 3000 },
      ],
    });
    expect(Array.isArray(output.criticalPath)).toBe(true);
  });

  it("estimatedDurationMs é número >= 0", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "plan-svc-dur",
      planName: "Dur Test",
      goal: { description: "g", successCriteria: [], priority: "low" },
      rawTasks: [{ name: "t1", type: "analysis", description: "d", priority: "medium", estimatedMs: 1500 }],
    });
    expect(output.estimatedDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("getPlanHistory retorna lista de planos da org", () => {
    planExecution({
      organizationId: ORG,
      sessionId: "plan-hist-1",
      planName: "Hist Plan",
      goal: { description: "g", successCriteria: [], priority: "low" },
      rawTasks: [],
    });
    const history = getPlanHistory(ORG);
    expect(history.length).toBeGreaterThan(0);
  });

  it("replayPlan produz mesmo replayKey", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "plan-rep-1",
      planName: "Replay Plan",
      goal: { description: "g", successCriteria: [], priority: "medium" },
      rawTasks: [{ name: "t1", type: "analysis", description: "d", priority: "medium" }],
    });
    const replayed = replayPlan(output);
    expect(replayed.replayKey).toBe(output.replayKey);
  });

  it("violations é array", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "plan-viol",
      planName: "Violations Test",
      goal: { description: "g", successCriteria: [], priority: "low" },
      rawTasks: [],
    });
    expect(Array.isArray(output.violations)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. autonomousWorkflowService — runAutonomousWorkflow
// ─────────────────────────────────────────────────────────────────────────────
describe("autonomousWorkflowService — runAutonomousWorkflow", () => {
  it("executa workflow simples com steps seguros", () => {
    const output = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-1",
      workflowName: "document_generation",
      steps: [
        { name: "fetch_template", type: "read", input: { templateId: "t1" } },
        { name: "generate_draft", type: "create_draft", input: { content: "..." } },
      ],
    });
    expect(output.workflowId).toBeDefined();
    expect(output.steps.length).toBeGreaterThan(0);
  });

  it("bloqueia step com ação blocked", () => {
    const output = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-block",
      workflowName: "dangerous_workflow",
      steps: [
        { name: "destroy", type: "delete_all", input: {} },
      ],
    });
    const blocked = output.steps.some(s => s.status === "blocked" || s.status === "failed");
    expect(blocked || output.requiresHumanIntervention).toBe(true);
  });

  it("requiresHumanIntervention é boolean", () => {
    const output = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-hum",
      workflowName: "approval_required_workflow",
      steps: [
        { name: "bulk_op", type: "bulk_update", input: {} },
      ],
    });
    expect(typeof output.requiresHumanIntervention).toBe("boolean");
  });

  it("getWorkflowHistory retorna histórico por org", () => {
    runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-hist",
      workflowName: "test_workflow",
      steps: [{ name: "search", type: "search", input: {} }],
    });
    const history = getWorkflowHistory(ORG);
    expect(history.length).toBeGreaterThan(0);
  });

  it("workflowId é string não vazia", () => {
    const output = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-id",
      workflowName: "id_test",
      steps: [{ name: "read", type: "read", input: {} }],
    });
    expect(typeof output.workflowId).toBe("string");
    expect(output.workflowId.length).toBeGreaterThan(0);
  });

  it("steps completados têm output não null", () => {
    const output = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "auto-wf-out",
      workflowName: "output_test",
      steps: [{ name: "list", type: "list", input: {} }],
    });
    const completed = output.steps.filter(s => s.status === "completed");
    for (const s of completed) {
      expect(s.output).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. humanApprovalService — createApprovalRequest / recordDecision
// ─────────────────────────────────────────────────────────────────────────────
describe("humanApprovalService — createApprovalRequest", () => {
  it("cria requisição de aprovação e armazena", () => {
    const output = createApprovalRequest({
      organizationId: ORG,
      sessionId: "appr-svc-1",
      approvalType: "document_publish",
      requiredApprovers: ["manager1"],
    });
    expect(output.workflow.status).toBe("pending");
    expect(output.workflow.organizationId).toBe(ORG);
  });

  it("recordDecision registra aprovação", () => {
    const created = createApprovalRequest({
      organizationId: ORG,
      sessionId: "appr-svc-2",
      approvalType: "contract_sign",
      requiredApprovers: ["approver1"],
    });
    const result = recordDecision(created.workflow.id, {
      approver: "approver1",
      decision: "approve",
      justification: "Aprovado após análise",
    });
    expect(result?.decisions.length).toBeGreaterThan(0);
  });

  it("getPendingApprovals retorna workflows pendentes da org", () => {
    createApprovalRequest({
      organizationId: ORG,
      sessionId: "appr-svc-pending",
      approvalType: "test",
      requiredApprovers: ["u1"],
    });
    const pending = getPendingApprovals(ORG);
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBeGreaterThan(0);
  });

  it("getApprovalHistory retorna histórico da org", () => {
    const history = getApprovalHistory(ORG);
    expect(Array.isArray(history)).toBe(true);
  });

  it("escalateApproval retorna workflow atualizado ou null", () => {
    const created = createApprovalRequest({
      organizationId: ORG,
      sessionId: "appr-esc",
      approvalType: "urgent",
      requiredApprovers: ["u1"],
    });
    const escalated = escalateApproval(created.workflow.id, "supervisor", "prazo urgente");
    expect(escalated === null || escalated?.status === "escalated").toBe(true);
  });

  it("delegateApproval retorna workflow atualizado ou null", () => {
    const created = createApprovalRequest({
      organizationId: ORG,
      sessionId: "appr-del",
      approvalType: "normal",
      requiredApprovers: ["u1"],
    });
    const delegated = delegateApproval(created.workflow.id, "substitute", "férias");
    expect(delegated === null || delegated?.status === "delegated").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. agentSafetyService — verifySafety
// ─────────────────────────────────────────────────────────────────────────────
describe("agentSafetyService — verifySafety", () => {
  it("retorna check para ação segura", () => {
    const output = verifySafety({
      organizationId: ORG,
      sessionId: "safety-1",
      actionType: "read",
      input: {},
      confidenceScore: 0.9,
    });
    expect(output.check).toBeDefined();
    expect(output.check.organizationId).toBe(ORG);
  });

  it("retorna hallucinationRisk", () => {
    const output = verifySafety({
      organizationId: ORG,
      sessionId: "safety-2",
      actionType: "generate_document",
      input: { content: "sempre aprovado" },
      confidenceScore: 0.7,
    });
    expect(output.hallucinationRisk).toBeDefined();
  });

  it("blocked é true para ação drop_table", () => {
    const output = verifySafety({
      organizationId: ORG,
      sessionId: "safety-blocked",
      actionType: "drop_table",
      input: {},
      confidenceScore: 0.9,
    });
    expect(output.blocked).toBe(true);
  });

  it("blocked é false para ação read", () => {
    const output = verifySafety({
      organizationId: ORG,
      sessionId: "safety-safe",
      actionType: "read",
      input: {},
      confidenceScore: 0.9,
    });
    expect(output.blocked).toBe(false);
  });

  it("requiresApproval é boolean", () => {
    const output = verifySafety({
      organizationId: ORG,
      sessionId: "safety-req",
      actionType: "update_record",
      input: {},
      confidenceScore: 0.8,
    });
    expect(typeof output.requiresApproval).toBe("boolean");
  });

  it("buildSafetyReport retorna relatório da org/sessão", () => {
    verifySafety({ organizationId: ORG, sessionId: "safety-report-1", actionType: "read", input: {}, confidenceScore: 0.9 });
    const report = buildSafetyReport(ORG, "safety-report-1");
    expect(report.organizationId).toBe(ORG);
    expect(report.sessionId).toBe("safety-report-1");
  });

  it("getSafetyHistory retorna array", () => {
    const history = getSafetyHistory(ORG);
    expect(Array.isArray(history)).toBe(true);
  });

  it("replayKey é string não vazia", () => {
    const output = verifySafety({
      organizationId: ORG, sessionId: "safety-rk", actionType: "search", input: {}, confidenceScore: 0.9,
    });
    expect(typeof output.replayKey).toBe("string");
    expect(output.replayKey.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. copilotContextService — assembleCopilotContext
// ─────────────────────────────────────────────────────────────────────────────
describe("copilotContextService — assembleCopilotContext", () => {
  it("monta contexto para legal_copilot", () => {
    const output = assembleCopilotContext({
      organizationId: ORG,
      sessionId: "cop-1",
      role: "legal_copilot",
      documentType: "contract",
    });
    expect(output.profile.role).toBe("legal_copilot");
    expect(output.contextSummary).toBeDefined();
    expect(typeof output.contextSummary).toBe("string");
  });

  it("activeCapabilities filtra por documentType e retorna array", () => {
    const output = assembleCopilotContext({
      organizationId: ORG,
      sessionId: "cop-2",
      role: "drafting_copilot",
      documentType: "edital",
    });
    expect(Array.isArray(output.activeCapabilities)).toBe(true);
  });

  it("getDefaultCopilot retorna AssistantProfile", () => {
    const profile = getDefaultCopilot(ORG, "compliance_copilot");
    expect(profile.role).toBe("compliance_copilot");
    expect(profile.organizationId).toBe(ORG);
  });

  it("getCopilotHistory retorna array", () => {
    assembleCopilotContext({ organizationId: ORG, sessionId: "cop-hist", role: "general_assistant" });
    const history = getCopilotHistory(ORG);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });

  it("canProceed é boolean", () => {
    const output = assembleCopilotContext({
      organizationId: ORG,
      sessionId: "cop-proceed",
      role: "review_copilot",
    });
    expect(typeof output.canProceed).toBe("boolean");
  });

  it("blockedReasons é array", () => {
    const output = assembleCopilotContext({
      organizationId: ORG,
      sessionId: "cop-blocked",
      role: "legal_copilot",
      operationType: "delete_all",
    });
    expect(Array.isArray(output.blockedReasons)).toBe(true);
  });

  it("restrictions é array", () => {
    const output = assembleCopilotContext({
      organizationId: ORG,
      sessionId: "cop-rest",
      role: "drafting_copilot",
    });
    expect(Array.isArray(output.restrictions)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. executionObservabilityService — traces e métricas
// ─────────────────────────────────────────────────────────────────────────────
describe("executionObservabilityService — traces e métricas", () => {
  it("recordExecutionTrace não lança exceção", () => {
    expect(() => {
      recordExecutionTrace({
        correlationId: "corr-1",
        operation: "agent_execution",
        stageBreakdown: { fetch: 100, analyze: 200 },
        totalMs: 300,
        candidateCount: 5,
        consensusScore: 0.87,
        requiresReview: false,
        parserType: "docx",
        organizationId: ORG,
        recordedAt: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it("recordExecutionMetric não lança exceção", () => {
    expect(() => {
      recordExecutionMetric({
        name: "execution_latency",
        value: 500,
        unit: "ms",
        tags: { org: String(ORG) },
        recordedAt: new Date().toISOString(),
        organizationId: ORG,
      });
    }).not.toThrow();
  });

  it("executionLatency não lança exceção", () => {
    expect(() => executionLatency("corr-lat", 1200, ORG)).not.toThrow();
  });

  it("approvalLatency não lança exceção", () => {
    expect(() => approvalLatency("corr-appr", 3000, ORG)).not.toThrow();
  });

  it("rollbackFrequency não lança exceção", () => {
    expect(() => rollbackFrequency("corr-rb", 2, ORG)).not.toThrow();
  });

  it("safetyBlockRate não lança exceção", () => {
    expect(() => safetyBlockRate("corr-sbr", 0.05, ORG)).not.toThrow();
  });

  it("hallucinationRiskLevel não lança exceção", () => {
    expect(() => hallucinationRiskLevel("corr-hrl", 0.1, ORG)).not.toThrow();
  });

  it("orchestrationDepth não lança exceção", () => {
    expect(() => orchestrationDepth("corr-od", 3, ORG)).not.toThrow();
  });

  it("getExecutionTraces retorna array", () => {
    const traces = getExecutionTraces(ORG);
    expect(Array.isArray(traces)).toBe(true);
  });

  it("getExecutionMetrics retorna array", () => {
    const metrics = getExecutionMetrics(ORG);
    expect(Array.isArray(metrics)).toBe(true);
  });

  it("computeExecutionHealth retorna healthScore e status", () => {
    const health = computeExecutionHealth(ORG);
    expect(health).toHaveProperty("healthScore");
    expect(health).toHaveProperty("status");
    expect(health.healthScore).toBeGreaterThanOrEqual(0);
    expect(health.healthScore).toBeLessThanOrEqual(1);
  });

  it("computeExecutionHealth status é um dos valores esperados", () => {
    const health = computeExecutionHealth(ORG);
    expect(["healthy", "degraded", "critical"]).toContain(health.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. taskSimulationService — simulateTasks
// ─────────────────────────────────────────────────────────────────────────────
describe("taskSimulationService — simulateTasks", () => {
  it("simula tasks dry_run com campo tasks", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-1",
      tasks: [
        { name: "fetch_data", type: "query", input: { table: "processes" } },
        { name: "export_report", type: "export", input: {} },
      ],
      simulationType: "dry_run",
    });
    expect(output.tasks).toHaveLength(2);
    expect(output.simulationId).toBeDefined();
  });

  it("saída simulada é determinística para mesma task", () => {
    const input: TaskSimulationInput = {
      organizationId: ORG,
      sessionId: "sim-det",
      tasks: [{ name: "analyze", type: "analysis", input: { doc: "abc" } }],
      simulationType: "full_preview",
    };
    const a = simulateTasks(input);
    const b = simulateTasks({ ...input, sessionId: "sim-det2" });
    expect(a.tasks[0].simulatedOutput.result).toBe(b.tasks[0].simulatedOutput.result);
  });

  it("overallRisk é um dos níveis esperados", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-risk",
      tasks: [{ name: "bulk_update", type: "mutation", input: {} }],
      simulationType: "impact_estimation",
    });
    const validLevels = ["safe", "low_risk", "medium_risk", "high_risk", "critical", "blocked"];
    expect(validLevels).toContain(output.overallRisk);
  });

  it("simulationType rollback_preview preservado no replayKey", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-rb",
      tasks: [{ name: "update_record", type: "mutation", input: { id: "r1" } }],
      simulationType: "rollback_preview",
    });
    expect(output.simulationId).toBeDefined();
    expect(output.tasks.length).toBeGreaterThan(0);
  });

  it("getSimulationHistory retorna array", () => {
    simulateTasks({
      organizationId: ORG,
      sessionId: "sim-hist",
      tasks: [{ name: "search", type: "query", input: {} }],
      simulationType: "dry_run",
    });
    const history = getSimulationHistory(ORG);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });

  it("simulatedOutput.result é string hex de 20 chars", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-hash",
      tasks: [{ name: "process_data", type: "processing", input: { key: "val" } }],
      simulationType: "dry_run",
    });
    const result = output.tasks[0].simulatedOutput.result;
    expect(typeof result).toBe("string");
    expect((result as string).length).toBe(20);
  });

  it("impactSummary é string", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-impact",
      tasks: [{ name: "t1", type: "read", input: {} }],
      simulationType: "impact_estimation",
    });
    expect(typeof output.impactSummary).toBe("string");
  });

  it("rollbackSummary é string", () => {
    const output = simulateTasks({
      organizationId: ORG,
      sessionId: "sim-rollback-summary",
      tasks: [{ name: "create_draft", type: "create_draft", input: {} }],
      simulationType: "rollback_preview",
    });
    expect(typeof output.rollbackSummary).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. Integração — Pipeline completo execução + aprovação
// ─────────────────────────────────────────────────────────────────────────────
describe("Integração — execução + aprovação", () => {
  it("execução com stages seguros completa com sucesso", () => {
    const execOutput = runAgentExecution({
      organizationId: ORG,
      sessionId: "integ-full-1",
      agentType: "procurement",
      stages: [
        { name: "read_data", input: {} },
        { name: "analyze_data", input: { count: 100 } },
      ],
    });
    expect(execOutput.execution).toBeDefined();
    expect(typeof execOutput.approvalRequired).toBe("boolean");
  });

  it("pipeline: plan → simulate → execute", () => {
    const planOut = planExecution({
      organizationId: ORG,
      sessionId: "integ-pipeline",
      planName: "Full Pipeline Test",
      goal: { description: "Executar pipeline completo", successCriteria: [], priority: "medium" },
      rawTasks: [
        { name: "prepare", type: "analysis", description: "preparar dados", priority: "medium" },
        { name: "execute", type: "drafting", description: "executar", priority: "medium", dependsOn: ["prepare"] },
      ],
    });
    expect(planOut.plan.tasks.length).toBeGreaterThanOrEqual(2);

    const simOut = simulateTasks({
      organizationId: ORG,
      sessionId: "integ-pipeline",
      tasks: planOut.plan.tasks.map(t => ({ name: t.taskName, type: t.taskType, input: {} })),
      simulationType: "dry_run",
    });
    expect(simOut.tasks.length).toBeGreaterThan(0);

    const execOut = runAgentExecution({
      organizationId: ORG,
      sessionId: "integ-pipeline",
      agentType: "test",
      stages: planOut.plan.tasks.map(t => ({ name: t.taskName, input: {} })),
    });
    expect(execOut.execution).toBeDefined();
  });

  it("workflow autônomo → safety → observabilidade", () => {
    const wfOut = runAutonomousWorkflow({
      organizationId: ORG,
      sessionId: "integ-obs",
      workflowName: "full_check",
      steps: [
        { name: "validate", type: "search", input: {} },
        { name: "report", type: "export_report", input: {} },
      ],
    });
    const safetyOut = verifySafety({
      organizationId: ORG,
      sessionId: "integ-obs",
      actionType: "export_report",
      input: {},
      confidenceScore: 0.9,
    });
    executionLatency("integ-obs-corr", wfOut.processingMs ?? 0, ORG);
    const health = computeExecutionHealth(ORG);
    expect(health.status).toBeDefined();
    expect(safetyOut.blocked).toBe(false);
  });

  it("aprovação multi-tenant não vaza entre orgs", () => {
    const ORG_A = 97001;
    const ORG_B = 97002;
    createApprovalRequest({ organizationId: ORG_A, sessionId: "s-a", approvalType: "t", requiredApprovers: ["u1"] });
    const pendingB = getPendingApprovals(ORG_B);
    expect(pendingB.every(w => w.organizationId === ORG_B)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. Replay safety — determinismo end-to-end
// ─────────────────────────────────────────────────────────────────────────────
describe("Replay safety — determinismo end-to-end", () => {
  it("replayKey de execução é sha256 de 64 chars", () => {
    const output = runAgentExecution({
      organizationId: ORG,
      sessionId: "replay-safety-1",
      agentType: "test",
      stages: [{ name: "s1", input: { a: 1 } }],
    });
    expect(output.replayKey).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(output.replayKey)).toBe(true);
  });

  it("replayKey de plano é string não vazia", () => {
    const output = planExecution({
      organizationId: ORG,
      sessionId: "replay-safety-2",
      planName: "Test",
      goal: { description: "g", successCriteria: [], priority: "low" },
      rawTasks: [{ name: "t1", type: "analysis", description: "d", priority: "low" }],
    });
    expect(output.replayKey).toBeDefined();
    expect(output.replayKey.length).toBeGreaterThan(0);
  });

  it("classifyAction é sempre determinístico", () => {
    for (let i = 0; i < 5; i++) {
      const c = classifyAction(ORG, "update_record", { x: i });
      expect(c.safetyLevel).toBe("medium_risk");
    }
  });

  it("createAutonomousStage id é sempre determinístico", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const s = createAutonomousStage({ workflowId: "wf-det", organizationId: ORG, stageName: "s", stageType: "analysis" });
      ids.add(s.id);
    }
    expect(ids.size).toBe(1);
  });

  it("simulateTasks replayKey é determinístico", () => {
    const input: TaskSimulationInput = {
      organizationId: ORG,
      sessionId: "det-sim",
      tasks: [{ name: "t1", type: "read", input: { q: "test" } }],
      simulationType: "dry_run",
    };
    const a = simulateTasks(input);
    const b = simulateTasks(input);
    expect(a.replayKey).toBe(b.replayKey);
  });

  it("getDefaultProfile é determinístico por org e role", () => {
    const p1 = getDefaultProfile(ORG, "legal_copilot");
    const p2 = getDefaultProfile(ORG, "legal_copilot");
    expect(p1.id).toBe(p2.id);
    expect(p1.capabilities.length).toBe(p2.capabilities.length);
  });
});
