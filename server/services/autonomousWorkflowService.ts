import { createHash } from "crypto";
import { classifyAction, isActionBlocked, requiresHumanApproval } from "../domain/actionSafety";
import { createApprovalWorkflow } from "../domain/humanApproval";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutonomousWorkflowInput {
  organizationId: number;
  sessionId: string;
  workflowName: string;
  steps: Array<{
    name: string;
    type: string;
    requiresApproval?: boolean;
    safetyLevel?: string;
    input?: Record<string, unknown>;
  }>;
  legalFramework?: string;
}

export interface AutonomousWorkflowStep {
  name: string;
  status: "completed" | "failed" | "pending_approval" | "blocked";
  approvalRequired: boolean;
  output: Record<string, unknown> | null;
}

export interface AutonomousWorkflowOutput {
  workflowId: string;
  steps: AutonomousWorkflowStep[];
  requiresHumanIntervention: boolean;
  pendingApprovals: string[];
  processingMs: number;
  replayKey: string;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

const _store = new Map<number, AutonomousWorkflowOutput[]>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(x: string): string {
  return createHash("sha256").update(x, "utf8").digest("hex");
}

function simulateOutput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  return { result: sha256(`wf:${name}${JSON.stringify(input)}`).slice(0, 20) };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function runAutonomousWorkflow(input: AutonomousWorkflowInput): AutonomousWorkflowOutput {
  const start = Date.now();
  const { organizationId, sessionId, workflowName, steps } = input;

  const workflowId = sha256(`wf:${organizationId}:${sessionId}:${workflowName}`).slice(0, 20);
  const resultSteps: AutonomousWorkflowStep[] = [];
  const pendingApprovals: string[] = [];

  for (const step of steps) {
    const stepInput = step.input ?? {};
    const classification = classifyAction(organizationId, step.type, stepInput);

    if (isActionBlocked(classification)) {
      resultSteps.push({ name: step.name, status: "blocked", approvalRequired: false, output: null });
      continue;
    }

    const needsApproval = step.requiresApproval === true || requiresHumanApproval(classification, 0.85);
    if (needsApproval) {
      createApprovalWorkflow({
        organizationId,
        executionId: workflowId,
        approvalType: `workflow_step_${step.name}`,
        requiredApprovers: ["manager"],
        context: { stepName: step.name, stepType: step.type },
      });
      pendingApprovals.push(step.name);
      resultSteps.push({ name: step.name, status: "pending_approval", approvalRequired: true, output: null });
    } else {
      const output = simulateOutput(step.name, stepInput);
      resultSteps.push({ name: step.name, status: "completed", approvalRequired: false, output });
    }
  }

  const requiresHumanIntervention = pendingApprovals.length > 0;

  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId, workflowName,
    stepNames: steps.map(s => s.name).sort(),
  }));

  const output: AutonomousWorkflowOutput = {
    workflowId,
    steps: resultSteps,
    requiresHumanIntervention,
    pendingApprovals,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _store.get(organizationId) ?? [];
  _store.set(organizationId, [...existing, output]);
  return output;
}

export function getWorkflowHistory(organizationId: number): AutonomousWorkflowOutput[] {
  return _store.get(organizationId) ?? [];
}
