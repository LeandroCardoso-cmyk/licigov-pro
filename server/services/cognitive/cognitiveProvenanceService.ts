/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — Cognitive Provenance Service.
 *
 * Traduz os objetos ricos do engine (AIExecutionContext + CognitiveResponse) no envelope
 * IMUTÁVEL de proveniência e persiste no ledger. Contratos do fechamento final A1:
 *   - Proveniência OBRIGATÓRIA de uma execução NOVA bem-sucedida/degradada: em staging/produção,
 *     falha de persistência → FAIL-CLOSED (nunca entregar como rastreável; nunca mascarar como
 *     sucesso; nunca substituir por observability). Dev/test: comportamento controlado (degrada
 *     sem DB, avisa em falha real) — nunca finge persistência.
 *   - Falha cognitiva: a captura da proveniência da FALHA é best-effort e NUNCA lança (preserva a
 *     exceção original da execução); registra tecnicamente a falha de persistência sanitizada.
 *   - Evidence fingerprint SOMENTE com evidência REAL (EvidenceRef[]); referências declaradas ficam
 *     no INPUT fingerprint, não viram evidência. Sem evidência real → evidenceFingerprint NULL.
 *   - grounding_state honesto também na falha (usesGrounding/usesRAG reais).
 *   - Marcador de REPLAY registra o PEDIDO ATUAL (correlation/actor/task/context atuais) e referencia
 *     a execução ORIGINAL (lineage factual).
 */

import { createHash } from "crypto";
import { APP_CONFIG } from "../../config/app";
import { serviceLogger } from "../observabilityService";
import type { AIExecutionContext } from "../../domain/aiExecutionContext";
import type { CognitiveResponse } from "../../domain/cognitiveResponse";
import {
  computeInputFingerprint, computeOutputFingerprint, computeEvidenceFingerprint,
  deriveExecutionState, deriveGroundingState, classifyFailure, sanitizeFailureMessage, provenanceId,
  PROVENANCE_ORCHESTRATOR_VERSION,
  type ProvenanceEnvelope, type SemanticCognitiveInput, type EvidenceRef,
  type ExecutionStatus, type GroundingState, type ExecutionMode,
} from "../../domain/cognitiveProvenance";
import {
  insertCognitiveProvenance, getOriginalProvenanceByIdempotencyKey,
  type ProvenanceExecutor,
} from "../../db/cognitiveProvenance";

const log = serviceLogger("CognitiveProvenance");

/** Operação canônica de idempotência do replay cognitivo (distinta da geração documental). */
export const COGNITIVE_REPLAY_OP = "cognitive.execute";

/** Versão da task cognitiva (fase de fundação). Bump deliberado quando a semântica evoluir. */
export const COGNITIVE_TASK_VERSION = "1";

/**
 * Erro canônico (mensagem SANITIZADA) de falha de persistência de proveniência OBRIGATÓRIA. Sinaliza
 * FAIL-CLOSED: uma execução cognitiva bem-sucedida/degradada NÃO pode ser entregue como rastreável se
 * a proveniência mandatória não foi persistida (staging/produção). Nunca vaza SQL/segredos.
 */
export class CognitiveProvenancePersistenceError extends Error {
  constructor(message: string) {
    super(`[cognitive-provenance] proveniência obrigatória não persistida: ${message}`);
    this.name = "CognitiveProvenancePersistenceError";
  }
}

/** Insumo semântico do pedido cognitivo a partir do contexto de execução (exclui correlation/tempo/tokens). */
export function semanticInputFromContext(context: AIExecutionContext, query: string, documentRefs: readonly string[], lawRefs: readonly string[]): SemanticCognitiveInput {
  return {
    tenantId: context.request.tenantId,
    task: String(context.request.task),
    businessDomain: context.request.businessDomain,
    processId: context.request.processId,
    workspaceId: context.request.workspaceId,
    stage: context.request.stage,
    query,
    documentRefs,
    lawRefs,
  };
}

/**
 * Persiste o envelope como proveniência OBRIGATÓRIA (fail-closed fora de dev). Distingue:
 *   - insert retornou id → OK;
 *   - insert retornou null (sem DB): dev → OK (degrada honestamente); staging/produção → FAIL-CLOSED;
 *   - insert lançou (DB presente, falhou): dev → avisa e segue; staging/produção → FAIL-CLOSED.
 * Nunca mascara como sucesso silencioso. Mensagem sempre sanitizada.
 */
async function persistMandatory(env: ProvenanceEnvelope, executor: ProvenanceExecutor | undefined, ctx: Record<string, unknown>): Promise<ProvenanceEnvelope | null> {
  let persistedId: string | null;
  try {
    persistedId = await insertCognitiveProvenance(env, executor);
  } catch (e) {
    const msg = sanitizeFailureMessage(e instanceof Error ? e.message : String(e));
    if (APP_CONFIG.isDevelopment) {
      log.warn("provenance_persist_failed_dev", { ...ctx, error: msg });
      return null; // dev: comportamento controlado, nunca finge persistência (retorna null explícito)
    }
    log.error("provenance_persist_failed", { ...ctx, error: msg });
    throw new CognitiveProvenancePersistenceError(msg);
  }
  if (persistedId === null && !APP_CONFIG.isDevelopment) {
    // Sem conexão de banco fora de dev é incompatível com o contrato de rastreabilidade obrigatória.
    log.error("provenance_persist_no_db", ctx);
    throw new CognitiveProvenancePersistenceError("sem conexão de banco para persistir a proveniência");
  }
  return persistedId === null ? null : env;
}

/**
 * Captura a proveniência de uma execução cognitiva BEM-SUCEDIDA (ou DEGRADADA). Provenance OBRIGATÓRIA:
 * FAIL-CLOSED em staging/produção se a persistência falhar (lança CognitiveProvenancePersistenceError).
 * O provider/model são os REAIS usados (context.outcome). grounding_state é derivado honestamente: só há
 * `grounded`/`partially_grounded` com EVIDÊNCIA REAL (EvidenceRef[]); referências declaradas ficam no
 * INPUT fingerprint. Sem evidência real → evidenceFingerprint NULL.
 */
export async function captureCognitiveProvenance(params: {
  context: AIExecutionContext;
  response: CognitiveResponse;
  query: string;
  documentRefs: readonly string[];
  lawRefs: readonly string[];
  usesGrounding: boolean;
  usesRAG: boolean;
  finishReason: string;
  /** Evidências REAIS recuperadas/estruturadas (A2 preenche). Ausentes → evidenceFingerprint NULL. */
  evidences?: readonly EvidenceRef[];
  evidenceComplete?: boolean;
  idempotencyKey?: string | null;
  executor?: ProvenanceExecutor;
}): Promise<ProvenanceEnvelope | null> {
  const { context, response } = params;
  const evidenceCount = params.evidences?.length ?? 0;
  const evidenceComplete = params.evidenceComplete ?? false;
  const { status, degradationReason: reason, groundingState } = deriveExecutionState({
    finishReason: params.finishReason, usesGrounding: params.usesGrounding, usesRAG: params.usesRAG,
    evidenceCount, evidenceComplete,
  });

  const semantic = semanticInputFromContext(context, params.query, params.documentRefs, params.lawRefs);
  const inputFingerprint = computeInputFingerprint(semantic);
  const outputFingerprint = computeOutputFingerprint(response.content ?? "");
  // Evidence fingerprint SOMENTE de evidência REAL — nunca fabricada a partir de referências no prompt.
  const evidenceFingerprint = evidenceCount > 0 ? computeEvidenceFingerprint(params.evidences ?? []) : null;

  const env: ProvenanceEnvelope = {
    id: provenanceId({ organizationId: context.request.tenantId, executionId: context.id, replayHash: context.replayHash, isReplay: false }),
    organizationId: context.request.tenantId,
    executionId: context.id,
    correlationId: context.request.correlationId,
    task: String(context.request.task),
    executionMode: "cognitive",
    executionStatus: status,
    degradationReason: reason,
    failureClass: null,
    groundingState,
    provenanceClass: "provenanced",
    provider: context.outcome.provider,
    model: context.outcome.model,
    taskVersion: COGNITIVE_TASK_VERSION,
    promptContractVersion: response.contractVersion ?? "",
    orchestratorVersion: PROVENANCE_ORCHESTRATOR_VERSION,
    inputFingerprint,
    outputFingerprint,
    evidenceFingerprint,
    replayHash: context.replayHash,
    idempotencyKey: params.idempotencyKey ?? null,
    isReplay: false,
    replayOfExecutionId: null,
    approvalState: "generated",
    businessDomain: context.request.businessDomain ?? null,
    processId: context.request.processId ?? null,
    workspaceId: context.request.workspaceId ?? null,
    stage: context.request.stage ?? null,
    actorUserId: context.request.userId ?? null,
    failureMessage: null,
  };
  return persistMandatory(env, params.executor, {
    executionId: context.id, correlationId: context.request.correlationId, task: String(context.request.task), organizationId: context.request.tenantId,
  });
}

/**
 * Captura a proveniência de uma FALHA de execução cognitiva (status `failed` + classe de falha
 * governada + mensagem SANITIZADA). BEST-EFFORT: NUNCA lança (preserva a exceção original da
 * execução) — apenas registra tecnicamente uma falha de persistência sanitizada. grounding_state é
 * factual (usa usesGrounding/usesRAG): task que exige grounding sem evidência NÃO é `not_applicable`.
 */
export async function captureCognitiveFailure(params: {
  organizationId: number;
  executionId: string;
  correlationId: string;
  task: string;
  provider: string | null;
  model: string | null;
  replayHash: string;
  usesGrounding: boolean;
  usesRAG: boolean;
  evidences?: readonly EvidenceRef[];
  businessDomain?: string;
  processId?: string;
  workspaceId?: string;
  stage?: string;
  actorUserId?: string;
  semanticInput: SemanticCognitiveInput;
  error: unknown;
  idempotencyKey?: string | null;
  executor?: ProvenanceExecutor;
}): Promise<ProvenanceEnvelope | null> {
  try {
    const { failureClass, message } = classifyFailure(params.error);
    const groundingState = deriveGroundingState({
      usesGrounding: params.usesGrounding, usesRAG: params.usesRAG,
      evidenceCount: params.evidences?.length ?? 0, evidenceComplete: false,
    });
    const env: ProvenanceEnvelope = {
      id: provenanceId({ organizationId: params.organizationId, executionId: params.executionId, replayHash: params.replayHash, isReplay: false }),
      organizationId: params.organizationId,
      executionId: params.executionId,
      correlationId: params.correlationId,
      task: params.task,
      executionMode: "cognitive",
      executionStatus: "failed",
      degradationReason: null,
      failureClass,
      groundingState,
      provenanceClass: "provenanced",
      provider: params.provider,
      model: params.model,
      taskVersion: COGNITIVE_TASK_VERSION,
      promptContractVersion: "",
      orchestratorVersion: PROVENANCE_ORCHESTRATOR_VERSION,
      inputFingerprint: computeInputFingerprint(params.semanticInput),
      outputFingerprint: null,
      evidenceFingerprint: null,
      replayHash: params.replayHash,
      idempotencyKey: params.idempotencyKey ?? null,
      isReplay: false,
      replayOfExecutionId: null,
      approvalState: "generated",
      businessDomain: params.businessDomain ?? null,
      processId: params.processId ?? null,
      workspaceId: params.workspaceId ?? null,
      stage: params.stage ?? null,
      actorUserId: params.actorUserId ?? null,
      failureMessage: message,
    };
    const persisted = await insertCognitiveProvenance(env, params.executor);
    if (persisted === null && !APP_CONFIG.isDevelopment) {
      // Best-effort: NÃO lança (a exceção original da execução deve prevalecer); apenas registra.
      log.error("failure_provenance_no_db", { executionId: params.executionId, correlationId: params.correlationId });
    }
    return persisted === null ? null : env;
  } catch (e) {
    // Best-effort: registrar tecnicamente a falha de persistência SEM vazar segredos e SEM lançar
    // (não pode substituir a exceção original da execução por uma exceção de proveniência).
    log.error("failure_provenance_persist_failed", {
      executionId: params.executionId, correlationId: params.correlationId,
      error: sanitizeFailureMessage(e instanceof Error ? e.message : String(e)),
    });
    return null;
  }
}

// ─── Marcador de REPLAY (registra o PEDIDO ATUAL, referencia a ORIGINAL) ──────

/** Lineage FACTUAL da execução ORIGINAL (usado só como referência no marcador de replay). */
export interface ReplayOriginalLineage {
  readonly executionId: string;
  readonly replayHash: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly outputFingerprint: string | null;
  readonly groundingState: GroundingState;
  readonly executionStatus: ExecutionStatus | "failed";
  readonly executionMode: ExecutionMode;
}

/**
 * Registra a proveniência de um REPLAY (is_replay=1). O marcador descreve o PEDIDO ATUAL
 * (correlation/actor/task/context atuais + idempotencyKey) e REFERENCIA a execução ORIGINAL
 * (`replayOfExecutionId` + provider/model/outputFingerprint só como lineage factual). O id
 * determinístico incorpora original + chave + correlationId ATUAL: pedidos de replay distintos
 * não colapsam; o mesmo pedido (mesmo correlationId) retried é idempotente.
 *
 * OBRIGATÓRIO (mesma filosofia/erro canônico da proveniência original): em staging/produção, falha
 * ao persistir o marcador → FAIL-CLOSED (`CognitiveProvenancePersistenceError`). O chamador NÃO pode
 * entregar o conteúdo replayado como sucesso sem registrar a correlação atual. Dev/test degrada de
 * forma controlada (retorna null; nunca finge persistência).
 */
export async function recordReplayMarker(params: {
  organizationId: number;
  idempotencyKey: string;
  inputFingerprint: string;
  current: {
    correlationId: string;
    actorUserId?: string | null;
    task: string;
    businessDomain?: string | null;
    processId?: string | null;
    workspaceId?: string | null;
    stage?: string | null;
  };
  original: ReplayOriginalLineage;
}): Promise<ProvenanceEnvelope | null> {
  {
    // executionId do marcador: determinístico por (original, chave, correlationId ATUAL) — pedidos
    // de replay distintos não colapsam; o mesmo correlationId retried é idempotente.
    const markerExecId = createHash("sha256")
      .update(`replay:${params.organizationId}:${params.original.executionId}:${params.idempotencyKey}:${params.current.correlationId}`)
      .digest("hex").slice(0, 20);
    const env: ProvenanceEnvelope = {
      id: provenanceId({ organizationId: params.organizationId, executionId: markerExecId, replayHash: params.original.replayHash, isReplay: true }),
      organizationId: params.organizationId,
      executionId: markerExecId,
      correlationId: params.current.correlationId,
      task: params.current.task,
      executionMode: params.original.executionMode,
      executionStatus: params.original.executionStatus === "failed" ? "failed" : params.original.executionStatus,
      degradationReason: null,
      failureClass: null,
      groundingState: params.original.groundingState,
      provenanceClass: "provenanced",
      provider: params.original.provider,
      model: params.original.model,
      taskVersion: COGNITIVE_TASK_VERSION,
      promptContractVersion: "",
      orchestratorVersion: PROVENANCE_ORCHESTRATOR_VERSION,
      inputFingerprint: params.inputFingerprint,
      outputFingerprint: params.original.outputFingerprint,
      evidenceFingerprint: null,
      replayHash: params.original.replayHash,
      idempotencyKey: params.idempotencyKey,
      isReplay: true,
      replayOfExecutionId: params.original.executionId,
      approvalState: "generated",
      businessDomain: params.current.businessDomain ?? null,
      processId: params.current.processId ?? null,
      workspaceId: params.current.workspaceId ?? null,
      stage: params.current.stage ?? null,
      actorUserId: params.current.actorUserId ?? null,
      failureMessage: null,
    };
    // OBRIGATÓRIO (mesma filosofia da proveniência original): staging/produção → FAIL-CLOSED se não
    // persistir; dev → controlado (null). O chamador NÃO entrega o replay como sucesso sem registrar.
    return persistMandatory(env, undefined, {
      replayMarker: true, correlationId: params.current.correlationId,
      replayOfExecutionId: params.original.executionId, organizationId: params.organizationId,
    });
  }
}

/** Recupera a proveniência ORIGINAL de uma chave (tenant-scoped) — base de auditoria/replay. */
export async function getOriginalProvenance(organizationId: number, idempotencyKey: string) {
  return getOriginalProvenanceByIdempotencyKey(organizationId, idempotencyKey);
}
