/**
 * Sprint 3.2 — Institutional Workflow Domain.
 *
 * Workflow institucional da administracao publica brasileira para aprovacao
 * de Termos de Referencia e documentos de contratacao.
 *
 * PRINCIPIOS:
 *   - Immutable history: transicoes nunca sao editadas.
 *   - Role-aware transitions: apenas atores designados podem avancar.
 *   - Replay-safe: mesma sequencia de avancos => mesmo estado final.
 *   - Multi-tenant: organizationId obrigatorio.
 *
 * Embasamento: segregacao de funcoes e controle (Lei 14.133/2021, art. 7-9).
 */

import { createHash } from "crypto";
import type { ReviewActor } from "./importReviewState";

// --- Workflow stages ----------------------------------------------------------

export type WorkflowStage =
  | "elaboration"
  | "technical_review"
  | "legal_review"
  | "authority_approval"
  | "director_approval"
  | "publication"
  | "completed"
  | "cancelled";

const STAGE_ORDER: WorkflowStage[] = [
  "elaboration",
  "technical_review",
  "legal_review",
  "authority_approval",
  "director_approval",
  "publication",
  "completed",
];

// --- Types -------------------------------------------------------------------

export interface WorkflowTransition {
  id: string;
  from: WorkflowStage;
  to: WorkflowStage;
  actor: ReviewActor;
  reason: string;
  evidenceRefs: string[];
  occurredAt: string;
}

export interface EscalationRule {
  stageId: WorkflowStage;
  maxDurationHours: number;
  escalateTo: number[];
  notifyOn: string[];
}

export interface ApprovalChain {
  id: string;
  organizationId: number;
  processId: number;
  stages: WorkflowStage[];
  currentStage: WorkflowStage;
  assignedTo: Record<string, number[]>;
  deadlines: Record<string, string>;
  history: WorkflowTransition[];
  escalationRules: EscalationRule[];
  createdAt: string;
  updatedAt: string;
}

// --- Factory -----------------------------------------------------------------

export function createApprovalChain(params: {
  organizationId: number;
  processId: number;
  stages?: WorkflowStage[];
  assignedTo?: Record<string, number[]>;
  deadlines?: Record<string, string>;
  escalationRules?: EscalationRule[];
}): ApprovalChain {
  const now = new Date().toISOString();
  const stages = params.stages ?? [...STAGE_ORDER];
  const seed = JSON.stringify({
    organizationId: params.organizationId,
    processId: params.processId,
  });
  const id = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);

  return {
    id,
    organizationId: params.organizationId,
    processId: params.processId,
    stages,
    currentStage: stages[0],
    assignedTo: params.assignedTo ?? {},
    deadlines: params.deadlines ?? {},
    history: [],
    escalationRules: params.escalationRules ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

// --- Advance workflow --------------------------------------------------------

function nextStage(chain: ApprovalChain): WorkflowStage | null {
  const idx = chain.stages.indexOf(chain.currentStage);
  if (idx < 0 || idx >= chain.stages.length - 1) return null;
  return chain.stages[idx + 1];
}

export function canAdvance(
  chain: ApprovalChain,
  actor: ReviewActor,
): { allowed: boolean; reason: string } {
  if (chain.currentStage === "completed") {
    return { allowed: false, reason: "Workflow ja concluido." };
  }
  if (chain.currentStage === "cancelled") {
    return { allowed: false, reason: "Workflow cancelado." };
  }
  const next = nextStage(chain);
  if (!next) {
    return { allowed: false, reason: "Nenhum estagio seguinte disponivel." };
  }
  const assignees = chain.assignedTo[chain.currentStage];
  if (assignees && assignees.length > 0) {
    if (actor.userId == null || !assignees.includes(actor.userId)) {
      return { allowed: false, reason: `Ator (userId=${actor.userId ?? "null"}) nao esta designado para o estagio "${chain.currentStage}".` };
    }
  }
  return { allowed: true, reason: "OK" };
}

export function advanceWorkflow(
  chain: ApprovalChain,
  actor: ReviewActor,
  reason: string,
): ApprovalChain {
  const check = canAdvance(chain, actor);
  if (!check.allowed) {
    throw new Error(check.reason);
  }
  const next = nextStage(chain)!;
  const now = new Date().toISOString();
  const transitionId = createHash("sha256")
    .update(`${chain.id}:${chain.currentStage}:${next}:${chain.history.length}`, "utf8")
    .digest("hex")
    .slice(0, 32);

  const transition: WorkflowTransition = {
    id: transitionId,
    from: chain.currentStage,
    to: next,
    actor,
    reason,
    evidenceRefs: [],
    occurredAt: now,
  };

  return {
    ...chain,
    currentStage: next,
    history: [...chain.history, transition],
    updatedAt: now,
  };
}

// --- Overdue -----------------------------------------------------------------

export function isOverdue(chain: ApprovalChain): boolean {
  const deadline = chain.deadlines[chain.currentStage];
  if (!deadline) return false;
  return new Date().toISOString() > deadline;
}

// --- Escalations -------------------------------------------------------------

export function getEscalations(chain: ApprovalChain): EscalationRule[] {
  return chain.escalationRules.filter(r => r.stageId === chain.currentStage);
}

// --- Route to department -----------------------------------------------------

export function routeToDepartment(
  chain: ApprovalChain,
  department: WorkflowStage,
  userIds: number[],
): ApprovalChain {
  return {
    ...chain,
    assignedTo: {
      ...chain.assignedTo,
      [department]: userIds,
    },
    updatedAt: new Date().toISOString(),
  };
}

// --- Current stage assignees -------------------------------------------------

export function currentStageAssignees(chain: ApprovalChain): number[] {
  return chain.assignedTo[chain.currentStage] ?? [];
}
