/**
 * Sprint 4.9 — Copilot Decision Trace
 *
 * Cadeia completa de reasoning de um copiloto: cada etapa (intent, seleção, KG,
 * RAG, contexto, reasoning, recomendação, validação, explainability) é
 * registrada para auditabilidade, explainability e replay determinístico.
 */

import { createHash } from "crypto";

export type TraceStepType =
  | "intent_classification"
  | "copilot_selection"
  | "knowledge_graph"
  | "institutional_rag"
  | "context_assembly"
  | "reasoning"
  | "recommendation"
  | "validation"
  | "explainability";

export interface TraceStep {
  readonly order: number;
  readonly type: TraceStepType;
  readonly summary: string;
  readonly inputRef: string;
  readonly outputRef: string;
  readonly evidenceCount: number;
}

export interface CopilotDecisionTrace {
  readonly id: string;
  readonly organizationId: number;
  readonly sessionId: string;
  readonly reasoningId: string;
  readonly steps: readonly TraceStep[];
  readonly replaySnapshot: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createCopilotDecisionTrace(params: {
  organizationId: number;
  sessionId: string;
  reasoningId: string;
  correlationId: string;
  createdAt?: string;
}): CopilotDecisionTrace {
  const id = createHash("sha256")
    .update(`ctr:${params.organizationId}:${params.sessionId}:${params.reasoningId}`)
    .digest("hex").slice(0, 20);
  const base: CopilotDecisionTrace = {
    id,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    reasoningId: params.reasoningId,
    steps: [],
    replaySnapshot: "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
  return { ...base, replaySnapshot: computeReplaySnapshot(base) };
}

export function appendTraceStep(
  trace: CopilotDecisionTrace,
  step: Omit<TraceStep, "order">,
): CopilotDecisionTrace {
  const nextStep: TraceStep = { ...step, order: trace.steps.length };
  const steps = [...trace.steps, nextStep];
  const updated: CopilotDecisionTrace = { ...trace, steps };
  return { ...updated, replaySnapshot: computeReplaySnapshot(updated) };
}

export function computeReplaySnapshot(trace: CopilotDecisionTrace): string {
  const canonical = {
    correlationId: trace.correlationId,
    organizationId: trace.organizationId,
    reasoningId: trace.reasoningId,
    sessionId: trace.sessionId,
    steps: trace.steps.map(s => `${s.order}:${s.type}:${s.inputRef}:${s.outputRef}`),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

export function verifyReplay(trace: CopilotDecisionTrace, snapshot: string): boolean {
  return computeReplaySnapshot(trace) === snapshot;
}
