import { createHash } from "crypto";
import { type ProviderExecution, createProviderExecution, completeExecution, failExecution, triggerFallback, createReplaySnapshot } from "../domain/providerExecution";
import { routeWithFallback, selectProviderForOrg } from "./providerRoutingService";
import { registerDefaultProviders, getAvailableProviders } from "./providerRegistryService";
import { mockAdapter } from "../providers/mock/mockAdapter";
import { openaiAdapter } from "../providers/openai/openaiAdapter";
import { claudeAdapter } from "../providers/claude/claudeAdapter";
import { geminiAdapter } from "../providers/gemini/geminiAdapter";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

const _history = new Map<number, ProviderExecution[]>();
const _byCorrelation = new Map<string, ProviderExecution>();

const ADAPTERS: Record<string, typeof mockAdapter> = { openai: openaiAdapter, claude: claudeAdapter, gemini: geminiAdapter, mock: mockAdapter };

export interface InferenceInput {
  organizationId: number;
  workflowId: string;
  model: string;
  prompt: string;
  executionType?: "inference" | "embedding" | "classification" | "completion";
  correlationId?: string;
  capability?: string;
}

export function executeInference(input: InferenceInput): ProviderExecution {
  const { organizationId } = input;

  // Idempotência: mesmo correlationId → retorna existente se completada
  if (input.correlationId) {
    const existing = _byCorrelation.get(input.correlationId);
    if (existing && existing.executionStatus === "completed") return existing;
  }

  // Garantir providers registrados
  const available = getAvailableProviders(organizationId);
  if (available.length === 0) registerDefaultProviders(organizationId);

  const chain = routeWithFallback(organizationId, input.capability);
  const provider = chain[0] ?? { id: "mock", providerType: "mock" };

  const exec = createProviderExecution({
    organizationId,
    workflowId: input.workflowId,
    providerId: provider.id,
    model: input.model,
    executionType: input.executionType ?? "inference",
    requestPayload: { model: input.model, prompt: input.prompt, capability: input.capability },
    correlationId: input.correlationId,
  });

  const adapter = ADAPTERS[(provider as any).providerType ?? "mock"] ?? mockAdapter;
  const adapterResult = adapter.execute({ model: input.model, prompt: input.prompt, organizationId });

  const completed = completeExecution(exec, {
    responsePayload: { content: adapterResult.content, metadata: adapterResult.metadata },
    tokenUsage: { promptTokens: adapterResult.promptTokens, completionTokens: adapterResult.completionTokens, totalTokens: adapterResult.promptTokens + adapterResult.completionTokens },
    latencyMs: adapterResult.latencyMs,
    reasoningTrace: `Executed via ${adapter.providerType} adapter, model=${input.model}`,
    explainabilityData: { provider: adapter.providerType, model: input.model, deterministic: adapter.providerType === "mock" },
  });

  const withSnapshot = createReplaySnapshot(completed);

  const orgHistory = _history.get(organizationId) ?? [];
  _history.set(organizationId, [...orgHistory, withSnapshot]);
  if (input.correlationId) _byCorrelation.set(input.correlationId, withSnapshot);

  return withSnapshot;
}

export function replayExecution(organizationId: number, originalExecutionId: string): ProviderExecution | null {
  const history = _history.get(organizationId) ?? [];
  const original = history.find(e => e.id === originalExecutionId);
  if (!original || !original.replaySnapshot) return null;

  // Replay usa stored snapshot — não re-executa no provider
  const replayExec: ProviderExecution = {
    ...original,
    id: sha256(`replay:${original.id}:${Date.now()}`).slice(0,20),
    executionStatus: "replay",
    replaySnapshot: { originalExecutionId: original.id, snapshotKey: original.replaySnapshot.snapshotKey, snapshotedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  };

  const orgHistory = _history.get(organizationId) ?? [];
  _history.set(organizationId, [...orgHistory, replayExec]);
  return replayExec;
}

export function getExecutionHistory(organizationId: number): ProviderExecution[] {
  return _history.get(organizationId) ?? [];
}
