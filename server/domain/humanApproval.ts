import { createHash } from "crypto";

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "escalated"
  | "delegated"
  | "expired"
  | "overridden";

export type ApprovalPriority = "urgent" | "high" | "normal" | "low";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ApprovalDecision {
  readonly id: string;
  readonly workflowId: string;
  readonly organizationId: number;
  readonly approver: string;
  readonly decision: "approve" | "reject" | "delegate" | "escalate";
  readonly justification: string;
  readonly conditions: string[];
  readonly decidedAt: string;
}

export interface ApprovalGate {
  readonly id: string;
  readonly organizationId: number;
  readonly gateName: string;
  readonly requiredApprovers: string[];
  readonly minApprovals: number;
  readonly maxWaitMs: number;
  readonly autoEscalateAfterMs: number | null;
  readonly onTimeout: "reject" | "escalate" | "auto_approve";
  readonly legalBasis: string;
}

export interface ApprovalWorkflow {
  readonly id: string;
  readonly organizationId: number;
  readonly executionId: string | null;
  readonly planId: string | null;
  readonly approvalType: string;
  readonly requiredApprovers: string[];
  readonly currentApprovers: string[];
  readonly decisions: ApprovalDecision[];
  readonly status: ApprovalStatus;
  readonly priority: ApprovalPriority;
  readonly deadline: string | null;
  readonly escalateTo: string | null;
  readonly delegatedTo: string | null;
  readonly context: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
}

// ─── Functions ────────────────────────────────────────────────────────────────

export function createApprovalWorkflow(params: {
  organizationId: number;
  executionId?: string;
  planId?: string;
  approvalType: string;
  requiredApprovers: string[];
  priority?: ApprovalPriority;
  deadline?: string;
  context?: Record<string, unknown>;
}): ApprovalWorkflow {
  const now = new Date().toISOString();
  const id = sha256(
    `approvalwf:${params.organizationId}:${params.approvalType}:${params.executionId ?? ""}:${now}`
  ).slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    executionId: params.executionId ?? null,
    planId: params.planId ?? null,
    approvalType: params.approvalType,
    requiredApprovers: params.requiredApprovers,
    currentApprovers: [],
    decisions: [],
    status: "pending",
    priority: params.priority ?? "normal",
    deadline: params.deadline ?? null,
    escalateTo: null,
    delegatedTo: null,
    context: params.context ?? {},
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
}

export function recordApprovalDecision(
  workflow: ApprovalWorkflow,
  decision: {
    approver: string;
    decision: ApprovalDecision["decision"];
    justification: string;
    conditions?: string[];
  },
): ApprovalWorkflow {
  const now = new Date().toISOString();
  const decisionId = sha256(
    `approvaldec:${workflow.id}:${decision.approver}:${workflow.decisions.length}`
  ).slice(0, 20);
  const newDecision: ApprovalDecision = {
    id: decisionId,
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    approver: decision.approver,
    decision: decision.decision,
    justification: decision.justification,
    conditions: decision.conditions ?? [],
    decidedAt: now,
  };
  const newDecisions = [...workflow.decisions, newDecision];
  const newCurrentApprovers = [...new Set([...workflow.currentApprovers, decision.approver])];

  // Determine new status
  const approvalCount = newDecisions.filter(d => d.decision === "approve").length;
  const rejectCount = newDecisions.filter(d => d.decision === "reject").length;
  let newStatus: ApprovalStatus = workflow.status;

  if (rejectCount > 0) {
    newStatus = "rejected";
  } else if (approvalCount >= workflow.requiredApprovers.length) {
    newStatus = "approved";
  }

  return {
    ...workflow,
    decisions: newDecisions,
    currentApprovers: newCurrentApprovers,
    status: newStatus,
    updatedAt: now,
    resolvedAt: newStatus !== "pending" ? now : workflow.resolvedAt,
  };
}

export function isWorkflowResolved(workflow: ApprovalWorkflow): boolean {
  return workflow.status !== "pending" && workflow.status !== "escalated" && workflow.status !== "delegated";
}

export function isApproved(workflow: ApprovalWorkflow): boolean {
  return workflow.status === "approved" || workflow.status === "overridden";
}

export function escalateWorkflow(
  workflow: ApprovalWorkflow,
  escalateTo: string,
  reason: string,
): ApprovalWorkflow {
  const now = new Date().toISOString();
  const decisionId = sha256(`escalate:${workflow.id}:${escalateTo}:${now}`).slice(0, 20);
  const escalationDecision: ApprovalDecision = {
    id: decisionId,
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    approver: "system",
    decision: "escalate",
    justification: reason,
    conditions: [],
    decidedAt: now,
  };
  return {
    ...workflow,
    status: "escalated",
    escalateTo,
    decisions: [...workflow.decisions, escalationDecision],
    updatedAt: now,
  };
}

export function delegateWorkflow(
  workflow: ApprovalWorkflow,
  delegateTo: string,
  reason: string,
): ApprovalWorkflow {
  const now = new Date().toISOString();
  const decisionId = sha256(`delegate:${workflow.id}:${delegateTo}:${now}`).slice(0, 20);
  const delegateDecision: ApprovalDecision = {
    id: decisionId,
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    approver: "system",
    decision: "delegate",
    justification: reason,
    conditions: [],
    decidedAt: now,
  };
  return {
    ...workflow,
    status: "delegated",
    delegatedTo: delegateTo,
    decisions: [...workflow.decisions, delegateDecision],
    updatedAt: now,
  };
}

export function overrideWorkflow(
  workflow: ApprovalWorkflow,
  overriddenBy: string,
  reason: string,
): ApprovalWorkflow {
  const now = new Date().toISOString();
  const decisionId = sha256(`override:${workflow.id}:${overriddenBy}:${now}`).slice(0, 20);
  const overrideDecision: ApprovalDecision = {
    id: decisionId,
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    approver: overriddenBy,
    decision: "approve",
    justification: `OVERRIDE DE EMERGÊNCIA: ${reason}`,
    conditions: ["emergency_override"],
    decidedAt: now,
  };
  return {
    ...workflow,
    status: "overridden",
    decisions: [...workflow.decisions, overrideDecision],
    updatedAt: now,
    resolvedAt: now,
  };
}

export function isWorkflowExpired(workflow: ApprovalWorkflow): boolean {
  if (!workflow.deadline) return false;
  return new Date() > new Date(workflow.deadline);
}

export function getApprovalSummary(workflow: ApprovalWorkflow): {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  isExpired: boolean;
} {
  const approved = workflow.decisions.filter(d => d.decision === "approve").length;
  const rejected = workflow.decisions.filter(d => d.decision === "reject").length;
  const total = workflow.requiredApprovers.length;
  const pending = Math.max(0, total - workflow.currentApprovers.length);
  return { total, approved, rejected, pending, isExpired: isWorkflowExpired(workflow) };
}
