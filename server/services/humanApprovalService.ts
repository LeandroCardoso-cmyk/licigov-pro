import { createHash } from "crypto";
import {
  type ApprovalWorkflow,
  type ApprovalPriority,
  createApprovalWorkflow,
  recordApprovalDecision,
  escalateWorkflow,
  delegateWorkflow,
  getApprovalSummary,
} from "../domain/humanApproval";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalServiceInput {
  organizationId: number;
  sessionId: string;
  executionId?: string;
  planId?: string;
  approvalType: string;
  requiredApprovers: string[];
  priority?: ApprovalPriority;
  deadline?: string;
  context?: Record<string, unknown>;
}

export interface ApprovalServiceOutput {
  workflow: ApprovalWorkflow;
  summary: ReturnType<typeof getApprovalSummary>;
  processingMs: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, ApprovalServiceOutput[]>();
const _workflowById = new Map<string, ApprovalWorkflow>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function createApprovalRequest(input: ApprovalServiceInput): ApprovalServiceOutput {
  const start = Date.now();
  const { organizationId, sessionId } = input;

  const workflow = createApprovalWorkflow({
    organizationId,
    executionId: input.executionId,
    planId: input.planId,
    approvalType: input.approvalType,
    requiredApprovers: input.requiredApprovers,
    priority: input.priority,
    deadline: input.deadline,
    context: input.context,
  });

  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId,
    approvalType: input.approvalType,
    requiredApprovers: [...input.requiredApprovers].sort(),
  }));

  const output: ApprovalServiceOutput = {
    workflow,
    summary: getApprovalSummary(workflow),
    processingMs: Date.now() - start,
    replayKey,
  };

  _workflowById.set(workflow.id, workflow);
  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function recordDecision(
  workflowId: string,
  decision: { approver: string; decision: "approve" | "reject" | "delegate" | "escalate"; justification: string },
): ApprovalWorkflow | null {
  const workflow = _workflowById.get(workflowId);
  if (!workflow) return null;
  const updated = recordApprovalDecision(workflow, decision);
  _workflowById.set(workflowId, updated);
  return updated;
}

export function escalateApproval(workflowId: string, escalateTo: string, reason: string): ApprovalWorkflow | null {
  const workflow = _workflowById.get(workflowId);
  if (!workflow) return null;
  const updated = escalateWorkflow(workflow, escalateTo, reason);
  _workflowById.set(workflowId, updated);
  return updated;
}

export function delegateApproval(workflowId: string, delegateTo: string, reason: string): ApprovalWorkflow | null {
  const workflow = _workflowById.get(workflowId);
  if (!workflow) return null;
  const updated = delegateWorkflow(workflow, delegateTo, reason);
  _workflowById.set(workflowId, updated);
  return updated;
}

export function getApprovalHistory(organizationId: number): ApprovalServiceOutput[] {
  return _store.get(organizationId) ?? [];
}

export function getPendingApprovals(organizationId: number): ApprovalWorkflow[] {
  return [..._workflowById.values()].filter(
    w => w.organizationId === organizationId && w.status === "pending"
  );
}
