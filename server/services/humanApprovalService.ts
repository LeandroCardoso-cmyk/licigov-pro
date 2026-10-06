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

/**
 * SEM-077 — escrita de aprovação SEMPRE com a organização do contexto: workflow inexistente ou de OUTRA organização ⇒
 * `null` (mesmo resultado externo; nada é lido nem alterado). Nunca resolve o workflow só pelo id.
 */
function workflowOfOrganization(workflowId: string, organizationId: number): ApprovalWorkflow | null {
  const workflow = _workflowById.get(workflowId);
  if (!workflow || workflow.organizationId !== organizationId) return null;
  return workflow;
}

/** Token estável: o aprovador autenticado não consta entre os aprovadores exigidos do workflow. */
export const APPROVER_NOT_DESIGNATED = "APPROVER_NOT_DESIGNATED";

/**
 * Decide se o aprovador autenticado pode decidir o workflow. Sem aprovadores exigidos ⇒ qualquer membro do tenant
 * (limiar de 1 aprovador distinto). Com aprovadores exigidos ⇒ precisa constar por uma das referências do
 * próprio usuário autenticado (`user:<id>`, id numérico ou e-mail) — nunca por texto livre informado no input.
 */
export function isDesignatedApprover(workflow: ApprovalWorkflow, approverRefs: readonly string[]): boolean {
  if (workflow.requiredApprovers.length === 0) return true;
  const wanted = new Set(approverRefs.map(r => r.trim().toLowerCase()).filter(Boolean));
  return workflow.requiredApprovers.some(r => wanted.has(r.trim().toLowerCase()));
}

/**
 * Registra a decisão de um aprovador AUTENTICADO. `approver.ref` (ex.: `user:42`) é a identidade registrada na cadeia
 * (nunca texto do cliente); `approver.aliases` são outras referências do MESMO usuário (e-mail, id) usadas só para
 * conferir a designação. Retorna `null` para workflow inexistente/de outra organização; lança
 * `APPROVER_NOT_DESIGNATED` se o aprovador não for um dos exigidos.
 */
export function recordDecision(
  workflowId: string,
  decision: { approver: { ref: string; aliases?: readonly string[] }; decision: "approve" | "reject"; justification: string },
  organizationId: number,
): ApprovalWorkflow | null {
  const workflow = workflowOfOrganization(workflowId, organizationId);
  if (!workflow) return null;
  if (!isDesignatedApprover(workflow, [decision.approver.ref, ...(decision.approver.aliases ?? [])])) {
    throw new Error(`${APPROVER_NOT_DESIGNATED}: ${decision.approver.ref} não é um aprovador exigido deste workflow.`);
  }
  const updated = recordApprovalDecision(workflow, {
    approver: decision.approver.ref, decision: decision.decision, justification: decision.justification,
  });
  _workflowById.set(workflowId, updated);
  return updated;
}

export function escalateApproval(workflowId: string, escalateTo: string, reason: string, organizationId: number, actor?: string): ApprovalWorkflow | null {
  const workflow = workflowOfOrganization(workflowId, organizationId);
  if (!workflow) return null;
  const updated = escalateWorkflow(workflow, escalateTo, reason, actor);
  _workflowById.set(workflowId, updated);
  return updated;
}

export function delegateApproval(workflowId: string, delegateTo: string, reason: string, organizationId: number, actor?: string): ApprovalWorkflow | null {
  const workflow = workflowOfOrganization(workflowId, organizationId);
  if (!workflow) return null;
  const updated = delegateWorkflow(workflow, delegateTo, reason, actor);
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
