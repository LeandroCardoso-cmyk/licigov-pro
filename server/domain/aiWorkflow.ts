import { createHash } from "crypto";

// ─── ID generation ─────────────────────────────────────────────────────────────

let _counter = 0;

function genId(prefix: string): string {
  _counter += 1;
  const raw = `${prefix}:${_counter}:${Date.now()}`;
  return createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 20);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowStepType =
  | "ai_generation"
  | "human_review"
  | "auto_approval"
  | "override"
  | "escalation"
  | "completion"
  | "institutional_query_pipeline"
  | "context_assembly_pipeline"
  | "retrieval_orchestration"
  | "evidence_graph"
  | "grounding_graph"
  | "validation_graph"
  | "citation_pipeline"
  | "confidence_pipeline"
  | "graph_traversal"
  | "ontology_lookup"
  | "entity_resolution"
  | "graph_evidence"
  | "graph_recommendation"
  | "legal_path_reasoning"
  // Sprint 4.9 — Institutional Cognitive Copilots
  | "copilot_selection"
  | "copilot_context_assembly"
  | "copilot_reasoning"
  | "copilot_recommendation"
  | "copilot_validation"
  | "copilot_explainability";

export type WorkflowStatus =
  | "pending"
  | "active"
  | "awaiting_human"
  | "overridden"
  | "approved"
  | "rejected"
  | "escalated"
  | "completed"
  | "cancelled";

export type WorkflowEventType =
  | "created"
  | "step_started"
  | "step_completed"
  | "human_review_requested"
  | "override_applied"
  | "approved"
  | "rejected"
  | "escalated"
  | "completed"
  | "cancelled";

export type ApprovalDecision = "approve" | "reject";

export interface WorkflowStep {
  readonly id:          string;
  readonly type:        WorkflowStepType;
  readonly description: string;
  readonly actorId:     number | null;
  readonly output:      Record<string, unknown> | null;
  readonly completedAt: string | null;
  readonly durationMs:  number | null;
}

export interface WorkflowOverride {
  readonly id:            string;
  readonly overriddenBy:  number;
  readonly reason:        string;
  readonly previousValue: string;
  readonly newValue:      string;
  readonly justification: string;
  readonly createdAt:     string;
}

export interface WorkflowApproval {
  readonly id:           string;
  readonly approvedBy:   number;
  readonly decision:     ApprovalDecision;
  readonly justification: string;
  readonly confidence:   number;
  readonly createdAt:    string;
}

export interface WorkflowEvent {
  readonly id:          string;
  readonly type:        WorkflowEventType;
  readonly actor:       number | null;
  readonly description: string;
  readonly metadata:    Record<string, unknown>;
  readonly occurredAt:  string;
}

export interface AIWorkflowState {
  readonly id:                     string;
  readonly organizationId:         number;
  readonly workflowKey:            string;
  readonly currentStep:            WorkflowStepType;
  readonly status:                 WorkflowStatus;
  readonly steps:                  readonly WorkflowStep[];
  readonly overrides:              readonly WorkflowOverride[];
  readonly approvals:              readonly WorkflowApproval[];
  readonly actor:                  number;
  readonly requiresHumanApproval:  boolean;
  readonly autoApprovalThreshold:  number | null;
  readonly explanation:            string;
  readonly lineage:                readonly string[];
  readonly history:                readonly WorkflowEvent[];
  readonly createdAt:              string;
  readonly updatedAt:              string;
}

export interface WorkflowMetrics {
  total:               number;
  completed:           number;
  overridden:          number;
  pendingHumanReview:  number;
  avgCompletionMs:     number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  type:        WorkflowEventType,
  actor:       number | null,
  description: string,
  metadata:    Record<string, unknown> = {},
): WorkflowEvent {
  return {
    id:          genId("wev"),
    type,
    actor,
    description,
    metadata,
    occurredAt:  new Date().toISOString(),
  };
}

function assertStatus(
  current:  WorkflowStatus,
  expected: WorkflowStatus[],
  action:   string,
): void {
  if (!expected.includes(current)) {
    throw new Error(
      `Cannot ${action}: current status is '${current}', expected one of [${expected.join(", ")}]`
    );
  }
}

// ─── Factory & transitions ────────────────────────────────────────────────────

export function createWorkflow(params: {
  organizationId:         number;
  workflowKey:            string;
  actor:                  number;
  explanation:            string;
  requiresHumanApproval?: boolean;
  autoApprovalThreshold?: number | null;
  lineage?:               string[];
}): AIWorkflowState {
  const now   = new Date().toISOString();
  const event = makeEvent("created", params.actor, "Workflow created");
  return {
    id:                    genId("wf"),
    organizationId:        params.organizationId,
    workflowKey:           params.workflowKey,
    currentStep:           "ai_generation",
    status:                "pending",
    steps:                 [],
    overrides:             [],
    approvals:             [],
    actor:                 params.actor,
    requiresHumanApproval: params.requiresHumanApproval ?? true,
    autoApprovalThreshold: params.autoApprovalThreshold ?? null,
    explanation:           params.explanation,
    lineage:               params.lineage ?? [],
    history:               [event],
    createdAt:             now,
    updatedAt:             now,
  };
}

export function startStep(
  wf:          AIWorkflowState,
  stepType:    WorkflowStepType,
  description: string,
  actorId?:    number | null,
): AIWorkflowState {
  assertStatus(wf.status, ["pending", "active", "awaiting_human"], "start step");
  const step: WorkflowStep = {
    id:          genId("wst"),
    type:        stepType,
    description,
    actorId:     actorId ?? null,
    output:      null,
    completedAt: null,
    durationMs:  null,
  };
  const event = makeEvent(
    "step_started",
    actorId ?? null,
    `Step started: ${stepType}`,
    { stepId: step.id, stepType },
  );
  return {
    ...wf,
    currentStep: stepType,
    status:      "active",
    steps:       [...wf.steps, step],
    history:     [...wf.history, event],
    updatedAt:   new Date().toISOString(),
  };
}

export function completeStep(
  wf:      AIWorkflowState,
  stepId:  string,
  output:  Record<string, unknown>,
  actorId?: number | null,
): AIWorkflowState {
  assertStatus(wf.status, ["active"], "complete step");
  const now  = new Date().toISOString();
  const step = wf.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step '${stepId}' not found in workflow '${wf.id}'`);
  }
  const startedAt   = wf.history.find(
    e => e.type === "step_started" && (e.metadata as Record<string, unknown>)["stepId"] === stepId
  )?.occurredAt;
  const durationMs  = startedAt ? Date.now() - new Date(startedAt).getTime() : null;

  const updatedStep: WorkflowStep = {
    ...step,
    output,
    completedAt: now,
    durationMs,
  };
  const event = makeEvent(
    "step_completed",
    actorId ?? null,
    `Step completed: ${step.type}`,
    { stepId, stepType: step.type },
  );
  return {
    ...wf,
    steps:     wf.steps.map(s => (s.id === stepId ? updatedStep : s)),
    history:   [...wf.history, event],
    updatedAt: now,
  };
}

export function requestHumanReview(
  wf:    AIWorkflowState,
  actor: number,
): AIWorkflowState {
  assertStatus(wf.status, ["active", "pending"], "request human review");
  const event = makeEvent("human_review_requested", actor, "Human review requested");
  return {
    ...wf,
    currentStep: "human_review",
    status:      "awaiting_human",
    history:     [...wf.history, event],
    updatedAt:   new Date().toISOString(),
  };
}

export function applyOverride(params: {
  wf:            AIWorkflowState;
  overriddenBy:  number;
  reason:        string;
  previousValue: string;
  newValue:      string;
  justification: string;
}): AIWorkflowState {
  const { wf, overriddenBy, reason, previousValue, newValue, justification } = params;
  if (justification.length < 10) {
    throw new Error("Override justification must be at least 10 characters");
  }
  const now      = new Date().toISOString();
  const override: WorkflowOverride = {
    id:            genId("wov"),
    overriddenBy,
    reason,
    previousValue,
    newValue,
    justification,
    createdAt:     now,
  };
  const event = makeEvent(
    "override_applied",
    overriddenBy,
    `Override applied: ${reason}`,
    { overrideId: override.id, previousValue, newValue },
  );
  return {
    ...wf,
    currentStep: "override",
    status:      "overridden",
    overrides:   [...wf.overrides, override],
    history:     [...wf.history, event],
    updatedAt:   now,
  };
}

export function addApproval(params: {
  wf:            AIWorkflowState;
  approvedBy:    number;
  decision:      ApprovalDecision;
  justification: string;
  confidence:    number;
}): AIWorkflowState {
  const { wf, approvedBy, decision, justification, confidence } = params;
  const now      = new Date().toISOString();
  const approval: WorkflowApproval = {
    id:            genId("wap"),
    approvedBy,
    decision,
    justification,
    confidence,
    createdAt:     now,
  };
  const eventType: WorkflowEventType = decision === "approve" ? "approved" : "rejected";
  const event = makeEvent(
    eventType,
    approvedBy,
    `Workflow ${decision}d by actor ${approvedBy}`,
    { approvalId: approval.id, confidence },
  );

  const updatedApprovals = [...wf.approvals, approval];

  let newStatus: WorkflowStatus = wf.status;

  if (decision === "reject") {
    newStatus = "rejected";
  } else if (
    wf.autoApprovalThreshold !== null &&
    confidence >= wf.autoApprovalThreshold
  ) {
    newStatus = "approved";
  } else if (!wf.requiresHumanApproval) {
    newStatus = "approved";
  } else {
    newStatus = "approved";
  }

  return {
    ...wf,
    status:    newStatus,
    approvals: updatedApprovals,
    history:   [...wf.history, event],
    updatedAt: now,
  };
}

export function escalateWorkflow(
  wf:     AIWorkflowState,
  actor:  number,
  reason: string,
): AIWorkflowState {
  assertStatus(wf.status, ["active", "awaiting_human", "pending"], "escalate workflow");
  const event = makeEvent(
    "escalated",
    actor,
    `Workflow escalated: ${reason}`,
    { reason },
  );
  return {
    ...wf,
    currentStep: "escalation",
    status:      "escalated",
    history:     [...wf.history, event],
    updatedAt:   new Date().toISOString(),
  };
}

export function completeWorkflow(
  wf:     AIWorkflowState,
  actor:  number,
  output: Record<string, unknown> = {},
): AIWorkflowState {
  assertStatus(wf.status, ["active", "approved", "overridden"], "complete workflow");
  const now   = new Date().toISOString();
  const event = makeEvent(
    "completed",
    actor,
    "Workflow completed",
    { output },
  );
  return {
    ...wf,
    currentStep: "completion",
    status:      "completed",
    history:     [...wf.history, event],
    updatedAt:   now,
  };
}

export function cancelWorkflow(
  wf:    AIWorkflowState,
  actor: number,
): AIWorkflowState {
  assertStatus(wf.status, ["pending", "active", "awaiting_human", "escalated"], "cancel workflow");
  const event = makeEvent("cancelled", actor, "Workflow cancelled");
  return {
    ...wf,
    status:    "cancelled",
    history:   [...wf.history, event],
    updatedAt: new Date().toISOString(),
  };
}

export function computeWorkflowMetrics(workflows: AIWorkflowState[]): WorkflowMetrics {
  const total              = workflows.length;
  const completed          = workflows.filter(w => w.status === "completed").length;
  const overridden         = workflows.filter(w => w.status === "overridden").length;
  const pendingHumanReview = workflows.filter(w => w.status === "awaiting_human").length;

  const completedWorkflows = workflows.filter(w => w.status === "completed");
  const avgCompletionMs =
    completedWorkflows.length === 0
      ? 0
      : completedWorkflows.reduce((acc, w) => {
          const created = new Date(w.createdAt).getTime();
          const updated = new Date(w.updatedAt).getTime();
          return acc + (updated - created);
        }, 0) / completedWorkflows.length;

  return { total, completed, overridden, pendingHumanReview, avgCompletionMs };
}

// ─── Sprint 4.2: Orchestration Checkpoints ───────────────────────────────────

export interface OrchestrationCheckpoint {
  id: string;
  workflowId: string;
  organizationId: number;
  stage: string;
  status: "passed" | "failed" | "warning" | "pending";
  confidenceScore: number;
  hallucinationRisk: number;
  reasoningTrace: string | null;
  contextTokensUsed: number;
  validationErrors: string[];
  approvalRequired: boolean;
  createdAt: string;
}

export function createOrchestrationCheckpoint(params: {
  workflowId: string;
  organizationId: number;
  stage: string;
  confidenceScore: number;
  hallucinationRisk: number;
  contextTokensUsed?: number;
  reasoningTrace?: string;
}): OrchestrationCheckpoint {
  const approvalRequired = params.confidenceScore < 0.8 || params.hallucinationRisk > 0.5;
  const status: OrchestrationCheckpoint["status"] =
    params.confidenceScore > 0.6 && params.hallucinationRisk < 0.7
      ? approvalRequired ? "warning" : "passed"
      : "failed";

  return {
    id: createHash("sha256")
      .update(`${params.workflowId}${params.stage}${params.confidenceScore}`)
      .digest("hex")
      .slice(0, 20),
    workflowId:        params.workflowId,
    organizationId:    params.organizationId,
    stage:             params.stage,
    status,
    confidenceScore:   params.confidenceScore,
    hallucinationRisk: params.hallucinationRisk,
    reasoningTrace:    params.reasoningTrace ?? null,
    contextTokensUsed: params.contextTokensUsed ?? 0,
    validationErrors:  [],
    approvalRequired,
    createdAt:         new Date().toISOString(),
  };
}

export function evaluateCheckpoint(checkpoint: OrchestrationCheckpoint): {
  canProceed: boolean;
  requiresHumanReview: boolean;
  reason: string;
} {
  const canProceed = checkpoint.confidenceScore > 0.6 && checkpoint.hallucinationRisk < 0.7;
  const requiresHumanReview = checkpoint.confidenceScore < 0.8 || checkpoint.hallucinationRisk > 0.5;
  const reason = !canProceed
    ? `Confidence ${checkpoint.confidenceScore.toFixed(2)} abaixo de 0.6 ou risco de alucinação ${checkpoint.hallucinationRisk.toFixed(2)} acima de 0.7`
    : requiresHumanReview
    ? "Revisão humana recomendada por limiar de confiança"
    : "Aprovado automaticamente";
  return { canProceed, requiresHumanReview, reason };
}

export function addCheckpointToHistory(
  workflow: AIWorkflowState,
  checkpoint: OrchestrationCheckpoint,
): AIWorkflowState {
  const now = new Date().toISOString();
  const event = makeEvent(
    "step_completed",
    checkpoint.organizationId,
    `Checkpoint: ${checkpoint.stage} — status: ${checkpoint.status}`,
    { checkpoint },
  );
  return {
    ...workflow,
    history:   [...workflow.history, event],
    updatedAt: now,
  };
}

// ─── Sprint 4.3: Drafting Checkpoints ─────────────────────────────────────────

export type DraftingCheckpointType =
  | "draft_initiated"
  | "template_selected"
  | "variables_resolved"
  | "clauses_validated"
  | "legal_review"
  | "compliance_check"
  | "risk_assessment"
  | "draft_approved"
  | "draft_rejected";

export interface DraftingCheckpoint {
  id: string;
  organizationId: number;
  sessionId: string;
  draftId: string;
  checkpointType: DraftingCheckpointType;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  score: number;        // 0-1 quality/completeness
  metadata: Record<string, string | number | boolean>;
  completedAt: string | null;
  failureReason: string | null;
  createdAt: string;
}

export function createDraftingCheckpoint(params: {
  organizationId: number;
  sessionId: string;
  draftId: string;
  checkpointType: DraftingCheckpointType;
  metadata?: Record<string, string | number | boolean>;
}): DraftingCheckpoint {
  const id = createHash("sha256")
    .update(`${params.organizationId}${params.sessionId}${params.draftId}${params.checkpointType}${Date.now()}`)
    .digest("hex")
    .slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    draftId: params.draftId,
    checkpointType: params.checkpointType,
    status: "pending",
    score: 0,
    metadata: params.metadata ?? {},
    completedAt: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
  };
}

export function evaluateDraftCompliance(checkpoint: DraftingCheckpoint, score: number, passed: boolean): DraftingCheckpoint {
  return {
    ...checkpoint,
    status: passed ? "completed" : "failed",
    score,
    completedAt: new Date().toISOString(),
    failureReason: passed ? null : `Score ${score.toFixed(2)} abaixo do threshold`,
  };
}

export function addDraftingCheckpointToHistory(
  history: DraftingCheckpoint[],
  checkpoint: DraftingCheckpoint,
): DraftingCheckpoint[] {
  return [...history, checkpoint];
}

// ─── Sprint 4.4: Autonomous Stages ───────────────────────────────────────────

export type AutonomousStageType =
  | "analysis"
  | "drafting"
  | "validation"
  | "approval_gate"
  | "safety_check"
  | "escalation"
  | "rollback";

export type AutonomousStageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type AutonomousSafetyLevel =
  | "safe"
  | "low_risk"
  | "medium_risk"
  | "high_risk"
  | "critical"
  | "blocked";

export interface AutonomousStage {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly stageName: string;
  readonly stageType: AutonomousStageType;
  readonly requiresApproval: boolean;
  readonly safetyLevel: AutonomousSafetyLevel;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown> | null;
  readonly status: AutonomousStageStatus;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export function createAutonomousStage(params: {
  workflowId: string;
  organizationId: number;
  stageName: string;
  stageType: AutonomousStageType;
  requiresApproval?: boolean;
  safetyLevel?: AutonomousSafetyLevel;
  input?: Record<string, unknown>;
}): AutonomousStage {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`autonomous:${params.workflowId}:${params.stageName}:${params.stageType}`)
    .digest("hex")
    .slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    stageName: params.stageName,
    stageType: params.stageType,
    requiresApproval: params.requiresApproval ?? false,
    safetyLevel: params.safetyLevel ?? "safe",
    input: params.input ?? {},
    output: null,
    status: "pending",
    createdAt: now,
    completedAt: null,
  };
}

export function addAutonomousStageToWorkflow<T extends object>(
  workflow: T,
  stage: AutonomousStage,
): T & { stages: AutonomousStage[] } {
  const existing = (workflow as Record<string, unknown>)["stages"];
  const stages = Array.isArray(existing) ? [...existing, stage] : [stage];
  return { ...workflow, stages } as T & { stages: AutonomousStage[] };
}

// ─── Sprint 4.5: Provider Orchestration ──────────────────────────────────────

export interface ProviderOrchestrationStep {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly providerId: string;
  readonly model: string;
  readonly executionType: "inference" | "embedding" | "classification" | "completion";
  readonly fallbackChain: string[]; // ordered provider IDs
  readonly snapshotKey: string | null;
  readonly lineageId: string;
  readonly createdAt: string;
}

export interface InferenceSnapshot {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly executionId: string;
  readonly snapshotKey: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

export function createProviderOrchestrationStep(params: {
  workflowId: string;
  organizationId: number;
  providerId: string;
  model: string;
  executionType?: "inference" | "embedding" | "classification" | "completion";
  fallbackChain?: string[];
}): ProviderOrchestrationStep {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`orchestration:${params.workflowId}:${params.providerId}:${params.model}`)
    .digest("hex").slice(0, 20);
  const lineageId = createHash("sha256")
    .update(`lineage:${params.organizationId}:${params.workflowId}:${now}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    providerId: params.providerId,
    model: params.model,
    executionType: params.executionType ?? "inference",
    fallbackChain: params.fallbackChain ?? [],
    snapshotKey: null,
    lineageId,
    createdAt: now,
  };
}

export function addInferenceSnapshot<T extends object>(
  workflow: T,
  snapshot: InferenceSnapshot,
): T & { inferenceSnapshots: InferenceSnapshot[] } {
  const existing = (workflow as Record<string, unknown>)["inferenceSnapshots"];
  const snapshots = Array.isArray(existing) ? [...existing, snapshot] : [snapshot];
  return { ...workflow, inferenceSnapshots: snapshots } as T & { inferenceSnapshots: InferenceSnapshot[] };
}

// ─── Sprint 4.6: Semantic Vector Infrastructure ──────────────────────────────

export interface RetrievalOrchestrationStep {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly corpusId: string;
  readonly queryText: string;
  readonly retrievalStrategy: string;
  readonly embeddingVersion: string;
  readonly resultCount: number;
  readonly latencyMs: number;
  readonly rerankingApplied: boolean;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface SemanticEvidenceGraph {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly retrievalSessionId: string;
  readonly evidenceNodes: { chunkId: string; score: number; type: string }[];
  readonly provenanceChain: string[];
  readonly createdAt: string;
}

export function createRetrievalOrchestrationStep(params: {
  workflowId: string;
  organizationId: number;
  corpusId: string;
  queryText: string;
  retrievalStrategy?: string;
  embeddingVersion?: string;
  resultCount?: number;
  latencyMs?: number;
  rerankingApplied?: boolean;
  correlationId: string;
}): RetrievalOrchestrationStep {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`retorch:${params.workflowId}:${params.corpusId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    corpusId: params.corpusId,
    queryText: params.queryText,
    retrievalStrategy: params.retrievalStrategy ?? "vector_similarity",
    embeddingVersion: params.embeddingVersion ?? "v1",
    resultCount: params.resultCount ?? 0,
    latencyMs: params.latencyMs ?? 0,
    rerankingApplied: params.rerankingApplied ?? false,
    correlationId: params.correlationId,
    createdAt: now,
  };
}

export function createSemanticEvidenceGraph(params: {
  workflowId: string;
  organizationId: number;
  retrievalSessionId: string;
  evidenceNodes: { chunkId: string; score: number; type: string }[];
  provenanceChain?: string[];
}): SemanticEvidenceGraph {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`sevg:${params.workflowId}:${params.retrievalSessionId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    retrievalSessionId: params.retrievalSessionId,
    evidenceNodes: params.evidenceNodes,
    provenanceChain: params.provenanceChain ?? [],
    createdAt: now,
  };
}

// ─── Sprint 4.7: Institutional RAG Engine ────────────────────────────────────

export interface PromptContextInput {
  readonly institutionalContext: string;
  readonly documents: string[];
  readonly evidence: string[];
  readonly history: string[];
  readonly legislation: string[];
  readonly constraints: string[];
  readonly workflowInstructions: string;
}

export function buildPromptContext(input: PromptContextInput): string {
  const sections: string[] = [];

  sections.push("=== CONTEXTO INSTITUCIONAL ===");
  sections.push(input.institutionalContext);

  if (input.legislation.length > 0) {
    sections.push("\n=== LEGISLAÇÃO APLICÁVEL ===");
    sections.push(input.legislation.join("\n"));
  }

  if (input.documents.length > 0) {
    sections.push("\n=== DOCUMENTOS RELACIONADOS ===");
    sections.push(input.documents.join("\n"));
  }

  if (input.evidence.length > 0) {
    sections.push("\n=== EVIDÊNCIAS ===");
    sections.push(input.evidence.join("\n"));
  }

  if (input.history.length > 0) {
    sections.push("\n=== HISTÓRICO ===");
    sections.push(input.history.join("\n"));
  }

  if (input.constraints.length > 0) {
    sections.push("\n=== RESTRIÇÕES ===");
    sections.push(input.constraints.join("\n"));
  }

  sections.push("\n=== INSTRUÇÕES DO WORKFLOW ===");
  sections.push(input.workflowInstructions);

  return sections.join("\n");
}

// ─── Sprint 4.8: Procurement Knowledge Graph ─────────────────────────────────

export interface GraphTraversalStep {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly startNodeId: string;
  readonly strategy: string;
  readonly maxDepth: number;
  readonly nodesVisited: number;
  readonly edgesTraversed: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface GraphRecommendation {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly queryNodeId: string;
  readonly recommendedNodes: readonly string[];
  readonly pathExplanation: string;
  readonly score: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createGraphTraversalStep(params: {
  workflowId: string;
  organizationId: number;
  startNodeId: string;
  strategy?: string;
  maxDepth?: number;
  nodesVisited?: number;
  edgesTraversed?: number;
  correlationId: string;
}): GraphTraversalStep {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`gts:${params.workflowId}:${params.startNodeId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    startNodeId: params.startNodeId,
    strategy: params.strategy ?? "bfs",
    maxDepth: params.maxDepth ?? 3,
    nodesVisited: params.nodesVisited ?? 0,
    edgesTraversed: params.edgesTraversed ?? 0,
    correlationId: params.correlationId,
    createdAt: now,
  };
}

export function createGraphRecommendation(params: {
  workflowId: string;
  organizationId: number;
  queryNodeId: string;
  recommendedNodes: string[];
  pathExplanation?: string;
  score?: number;
  correlationId: string;
}): GraphRecommendation {
  const now = new Date().toISOString();
  const id = createHash("sha256")
    .update(`gr:${params.workflowId}:${params.queryNodeId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    queryNodeId: params.queryNodeId,
    recommendedNodes: params.recommendedNodes,
    pathExplanation: params.pathExplanation ?? "",
    score: params.score ?? 0,
    correlationId: params.correlationId,
    createdAt: now,
  };
}

// ─── Sprint 4.9 — Institutional Cognitive Copilots ───────────────────────────

/** Ordem oficial do pipeline cognitivo de um copiloto. */
export const COPILOT_PIPELINE: readonly WorkflowStepType[] = [
  "copilot_selection",
  "copilot_context_assembly",
  "graph_traversal",
  "retrieval_orchestration",
  "copilot_reasoning",
  "copilot_recommendation",
  "copilot_validation",
  "copilot_explainability",
];

export interface CopilotPipelineStep {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly copilotId: string;
  readonly stepType: WorkflowStepType;
  readonly order: number;
  readonly summary: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createCopilotPipelineStep(params: {
  workflowId: string;
  organizationId: number;
  copilotId: string;
  stepType: WorkflowStepType;
  order: number;
  summary?: string;
  correlationId: string;
}): CopilotPipelineStep {
  const id = createHash("sha256")
    .update(`cpstep:${params.workflowId}:${params.copilotId}:${params.stepType}:${params.order}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workflowId: params.workflowId,
    organizationId: params.organizationId,
    copilotId: params.copilotId,
    stepType: params.stepType,
    order: params.order,
    summary: params.summary ?? "",
    correlationId: params.correlationId,
    createdAt: new Date().toISOString(),
  };
}
