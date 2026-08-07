/**
 * RC-4.0 — Cognitive Observability (infraestrutura, não dashboard).
 * RC-4.2.1 — persistência: além do cache em memória, persiste (recuperável por
 * correlationId) via Observability Repository. Nunca depende apenas de Map em memória.
 *
 * Toda execução cognitiva emite logs estruturados: execução, reasoning, provider,
 * grounding, RAG, Knowledge Graph, latência, uso de tokens e validação de Structured
 * Output. Determinístico e multi-tenant.
 */

import { createHash } from "crypto";
import type { AIExecutionContext } from "../../domain/aiExecutionContext";
import { structuredDataSize, responseShapeHash, type CognitiveResponse, type CognitiveResponseValidation, type CognitiveResponseType } from "../../domain/cognitiveResponse";
import type { CognitiveTaskId } from "../../domain/cognitiveTask";
import { splitAlternatives, type InstitutionalReasoningPlan } from "../../domain/institutionalReasoning";
import { persistObservability, recoverObservabilityRow } from "./observabilityRepository";

/** Limite de pré-visualização governada (nunca expõe conteúdo sensível integral). */
const GOVERNED_PREVIEW_MAX = 280;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s ?? "").digest("hex");
}

/** Recorta um texto para pré-visualização governada (auditoria sem exposição integral). */
function governedPreview(s: string): string {
  const t = s ?? "";
  return t.length <= GOVERNED_PREVIEW_MAX ? t : `${t.slice(0, GOVERNED_PREVIEW_MAX)}… [+${t.length - GOVERNED_PREVIEW_MAX} chars]`;
}

/**
 * PR C — Registro de GOVERNANÇA de uma execução cognitiva (tenant-aware, auditável).
 * Persistido junto da observabilidade (mesma linha `cognitive_observability`, campo `payload`),
 * portanto sem migration. NÃO contém chain-of-thought privada: apenas metadados institucionais,
 * hashes de integridade e pré-visualização governada (bounded) do insumo/saída.
 */
export interface CognitiveGovernanceRecord {
  readonly actorUserId: string;
  readonly operation: string;
  readonly module: string;
  readonly provider: string;
  readonly model: string;
  readonly promptTemplateId: string;
  readonly promptContractVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly inputChars: number;
  readonly outputChars: number;
  readonly inputPreview: string;
  readonly outputPreview: string;
  readonly processId: string | null;
  readonly documentRefs: readonly string[];
  readonly reviewState: "pending_human_review" | "invalid" | "failed";
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface CognitiveObservability {
  readonly correlationId: string;
  readonly task: CognitiveTaskId;
  readonly executionLog: string;
  readonly reasoningLog: string;
  readonly providerLog: string;
  readonly groundingLog: string;
  readonly ragLog: string;
  readonly knowledgeGraphLog: string;
  readonly latencyMs: number;
  readonly tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** RAG-QUALITY-002 — motivo de término do provider ("max_tokens" = geração cortada). Auditável. */
  readonly finishReason: "stop" | "tool_calls" | "max_tokens" | "other";
  readonly structuredOutputValid: boolean;
  readonly structuredOutputErrors: readonly string[];
  // RC-4.0.1 — contrato universal
  readonly responseType: CognitiveResponseType;
  readonly structuredDataPresent: boolean;
  readonly structuredDataSize: number;
  readonly responseShapeHash: string;
  readonly contractVersion: string;
  // RC-4.2 — Institutional Reasoning
  readonly reasoningPlanId: string;
  readonly reasoningPlanHash: string;
  readonly appliedRules: readonly string[];
  readonly alternativePaths: readonly string[];
  readonly discardedPaths: readonly string[];
  readonly knowledgeSources: readonly string[];
  readonly groundingUsed: boolean;
  // PR C — Governança cognitiva (ator, operação, módulo, model, hashes, refs, estado de revisão).
  readonly governance: CognitiveGovernanceRecord;
}

const _byCorrelation = new Map<string, CognitiveObservability>();

/**
 * Constrói e registra a observabilidade de uma execução cognitiva a partir do
 * contexto, da resposta e da validação de Structured Output.
 */
export function recordCognitiveObservability(params: {
  context: AIExecutionContext;
  response: CognitiveResponse;
  validation: CognitiveResponseValidation;
  reasoningPlan?: InstitutionalReasoningPlan;
}): CognitiveObservability {
  const { context, response, validation, reasoningPlan } = params;
  const g = context.grounding;
  const dataSize = structuredDataSize(response.structuredData);
  const alt = reasoningPlan ? splitAlternatives(reasoningPlan) : { recommended: "", discarded: [] };

  // PR C — Registro de governança (metadados institucionais + integridade, sem chain-of-thought).
  const governedInput = context.request.prompt ?? "";
  const governedOutput = response.content ?? "";
  const governance: CognitiveGovernanceRecord = {
    actorUserId: context.request.userId,
    operation: String(context.request.task),
    module: context.request.businessDomain ?? "unspecified",
    provider: context.outcome.provider,
    model: context.outcome.model,
    promptTemplateId: `prompt-builder:${String(context.request.task)}`,
    promptContractVersion: response.contractVersion,
    inputHash: sha256Hex(governedInput),
    outputHash: sha256Hex(governedOutput),
    inputChars: governedInput.length,
    outputChars: governedOutput.length,
    inputPreview: governedPreview(governedInput),
    outputPreview: governedPreview(governedOutput),
    processId: context.request.processId ?? null,
    documentRefs: g.documentsUsed,
    reviewState: validation.valid ? "pending_human_review" : "invalid",
    error: validation.valid ? null : { code: "STRUCTURED_OUTPUT_INVALID", message: validation.errors.join("; ") },
  };

  const obs: CognitiveObservability = {
    correlationId: context.request.correlationId,
    task: context.request.task,
    executionLog: `task=${context.request.task} tenant=${context.request.tenantId} ctx=${context.id} replay=${context.replayHash.slice(0, 8)}`,
    reasoningLog: context.outcome.reasoning,
    providerLog: `provider=${context.outcome.provider} model=${context.outcome.model}`,
    groundingLog: `grounding=${g.groundingApplied} docs=${g.documentsUsed.length} laws=${g.lawsUsed.length} copilot=${g.copilot}`,
    ragLog: `rag=${g.ragApplied}`,
    knowledgeGraphLog: `kg=${g.knowledgeGraphApplied} nodes=${g.knowledgeGraphNodes.length}`,
    latencyMs: context.outcome.latencyMs,
    tokenUsage: response.tokens,
    finishReason: context.outcome.finishReason,
    structuredOutputValid: validation.valid,
    structuredOutputErrors: validation.errors,
    responseType: response.responseType,
    structuredDataPresent: response.structuredData !== undefined && response.structuredData !== null,
    structuredDataSize: dataSize,
    responseShapeHash: responseShapeHash(response, dataSize),
    contractVersion: response.contractVersion,
    reasoningPlanId: reasoningPlan?.id ?? "",
    reasoningPlanHash: reasoningPlan?.replayHash ?? "",
    appliedRules: reasoningPlan?.rules ?? [],
    alternativePaths: reasoningPlan?.alternatives ?? [],
    discardedPaths: alt.discarded.map(d => d.alternative),
    knowledgeSources: [...g.documentsUsed, ...g.lawsUsed],
    groundingUsed: g.groundingApplied,
    governance,
  };

  _byCorrelation.set(context.request.correlationId, obs);

  // Persistência (recuperável por correlationId) — nunca depende só do Map. Fire-and-forget
  // seguro: degrada sem DB e jamais quebra o pipeline cognitivo.
  void persistObservability(obs, {
    tenantId: context.request.tenantId, replayHash: context.replayHash, provider: context.outcome.provider,
    executionStatus: validation.valid ? "completed" : "invalid",
  });

  // Emissão estruturada (infraestrutura). Nunca lança.
  try {
    console.info("[cognitive-observability]", JSON.stringify({
      correlationId: obs.correlationId, task: obs.task, provider: context.outcome.provider,
      responseType: obs.responseType, structuredData: obs.structuredDataPresent, contract: obs.contractVersion,
      latencyMs: obs.latencyMs, tokens: obs.tokenUsage.totalTokens, structuredOutputValid: obs.structuredOutputValid,
      finishReason: obs.finishReason,
    }));
  } catch { /* noop */ }

  return obs;
}

/**
 * PR C — Persiste uma FALHA de execução cognitiva no ledger de governança (status + erro
 * estruturado), tenant-aware. Fire-and-forget seguro: nunca lança, nunca altera o fluxo do
 * engine (que continua propagando o erro original). Não há resposta/validação; grava apenas
 * os metadados institucionais disponíveis antes da resposta + o erro classificado.
 */
export function recordCognitiveFailure(params: {
  tenantId: number;
  actorUserId: string;
  correlationId: string;
  task: CognitiveTaskId;
  module?: string;
  provider: string;
  model: string;
  processId?: string;
  governedInput?: string;
  latencyMs?: number;
  replayHash?: string;
  error: { code: string; message: string };
}): void {
  const governedInput = params.governedInput ?? "";
  const governance: CognitiveGovernanceRecord = {
    actorUserId: params.actorUserId,
    operation: String(params.task),
    module: params.module ?? "unspecified",
    provider: params.provider,
    model: params.model,
    promptTemplateId: `prompt-builder:${String(params.task)}`,
    promptContractVersion: "",
    inputHash: sha256Hex(governedInput),
    outputHash: sha256Hex(""),
    inputChars: governedInput.length,
    outputChars: 0,
    inputPreview: governedPreview(governedInput),
    outputPreview: "",
    processId: params.processId ?? null,
    documentRefs: [],
    reviewState: "failed",
    error: params.error,
  };
  void persistObservability(
    {
      correlationId: params.correlationId,
      task: params.task,
      executionLog: `task=${String(params.task)} tenant=${params.tenantId} status=failed`,
      reasoningLog: "",
      providerLog: `provider=${params.provider} model=${params.model}`,
      groundingLog: "",
      ragLog: "",
      knowledgeGraphLog: "",
      latencyMs: params.latencyMs ?? 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: "other",
      structuredOutputValid: false,
      structuredOutputErrors: [params.error.message],
      responseType: "text",
      structuredDataPresent: false,
      structuredDataSize: 0,
      responseShapeHash: "",
      contractVersion: "",
      reasoningPlanId: "",
      reasoningPlanHash: "",
      appliedRules: [],
      alternativePaths: [],
      discardedPaths: [],
      knowledgeSources: [],
      groundingUsed: false,
      governance,
    },
    { tenantId: params.tenantId, replayHash: params.replayHash ?? params.correlationId, provider: params.provider, executionStatus: "failed" },
  );
}

/** Recuperação rápida (cache em memória do processo). */
export function getCognitiveObservability(correlationId: string): CognitiveObservability | null {
  return _byCorrelation.get(correlationId) ?? null;
}

/**
 * Recuperação COMPLETA por correlationId: memória primeiro; se ausente (ex.: após
 * restart / outra instância), recupera do repositório persistente.
 */
export async function recoverCognitiveObservability(correlationId: string): Promise<CognitiveObservability | null> {
  const cached = _byCorrelation.get(correlationId);
  if (cached) return cached;
  const row = await recoverObservabilityRow(correlationId);
  return row && row.payload ? (row.payload as CognitiveObservability) : null;
}
