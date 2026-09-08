/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — Cognitive Provenance Service.
 *
 * Orquestra a CAPTURA de proveniência (a partir do boundary cognitivo) e o CONTRATO DE
 * REPLAY (reutilizando o idempotencyService canônico — NÃO um segundo mecanismo). Traduz os
 * objetos ricos do engine (AIExecutionContext + CognitiveResponse) no envelope IMUTÁVEL de
 * proveniência e persiste no ledger. Nunca fabrica proveniência; nunca apresenta degradado/
 * não-aterrado como fundamentado; nunca re-chama o provider num replay.
 */

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import type { AIExecutionContext } from "../../domain/aiExecutionContext";
import type { CognitiveResponse } from "../../domain/cognitiveResponse";
import {
  computeInputFingerprint, computeOutputFingerprint, computeEvidenceFingerprint,
  deriveExecutionState, classifyFailure, provenanceId, evidenceRef,
  PROVENANCE_ORCHESTRATOR_VERSION,
  type ProvenanceEnvelope, type SemanticCognitiveInput, type EvidenceRef,
  type ExecutionStatus, type GroundingState, type ExecutionMode,
} from "../../domain/cognitiveProvenance";
import {
  insertCognitiveProvenance, getOriginalProvenanceByIdempotencyKey,
  type ProvenanceExecutor,
} from "../../db/cognitiveProvenance";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "../idempotencyService";

/** Operação canônica de idempotência do replay cognitivo (distinta da geração documental). */
export const COGNITIVE_REPLAY_OP = "cognitive.execute";

/** Versão da task cognitiva (fase de fundação). Bump deliberado quando a semântica evoluir. */
export const COGNITIVE_TASK_VERSION = "1";

/** Constrói o conjunto de EvidenceRefs a partir das referências declaradas (contrato A1; A2 preenche o real). */
function evidenceRefsFromDeclared(documentRefs: readonly string[], lawRefs: readonly string[]): EvidenceRef[] {
  const docs = documentRefs.map((r) => evidenceRef(r, "", r));
  const laws = lawRefs.map((r) => evidenceRef("lei", r, r));
  return [...docs, ...laws];
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
 * Captura a proveniência de uma execução cognitiva BEM-SUCEDIDA (ou DEGRADADA). Aditivo e
 * seguro (nunca lança por padrão — a proveniência não pode quebrar o pipeline). O provider/
 * model são os REAIS usados (context.outcome). grounding_state é derivado honestamente
 * (evidenceCount real; referências no prompt NÃO viram "grounded").
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
  /** Nº de evidências REAIS recuperadas/estruturadas (fase A1: 0 — A2 preenche o retrieval real). */
  evidenceCount?: number;
  evidenceComplete?: boolean;
  idempotencyKey?: string | null;
  executor?: ProvenanceExecutor;
}): Promise<ProvenanceEnvelope | null> {
  try {
    const { context, response } = params;
    const evidenceCount = params.evidenceCount ?? 0;
    const evidenceComplete = params.evidenceComplete ?? false;
    const { status, degradationReason: reason, groundingState } = deriveExecutionState({
      finishReason: params.finishReason, usesGrounding: params.usesGrounding, usesRAG: params.usesRAG,
      evidenceCount, evidenceComplete,
    });

    const semantic = semanticInputFromContext(context, params.query, params.documentRefs, params.lawRefs);
    const inputFingerprint = computeInputFingerprint(semantic);
    const outputFingerprint = computeOutputFingerprint(response.content ?? "");
    const evidenceFingerprint = computeEvidenceFingerprint(evidenceRefsFromDeclared(params.documentRefs, params.lawRefs));

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
    await insertCognitiveProvenance(env, params.executor);
    return env;
  } catch {
    // A proveniência é additiva: nunca quebra o pipeline cognitivo na captura de sucesso.
    return null;
  }
}

/**
 * Captura a proveniência de uma FALHA de execução cognitiva (status `failed` + classe de falha
 * governada + mensagem SANITIZADA). NÃO fabrica saída/evidência; provider/model são os reais
 * tentados. Falha ≠ confiança 0, falha ≠ sucesso vazio.
 */
export async function captureCognitiveFailure(params: {
  organizationId: number;
  executionId: string;
  correlationId: string;
  task: string;
  provider: string | null;
  model: string | null;
  replayHash: string;
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
      groundingState: "not_applicable",
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
    await insertCognitiveProvenance(env, params.executor);
    return env;
  } catch {
    return null;
  }
}

// ─── Contrato de REPLAY cognitivo (reusa idempotencyService) ──────────────────

/** Resultado normalizado de uma execução cognitiva sob o contrato de replay. */
export interface CognitiveReplayResult {
  readonly executionId: string;
  readonly replayHash: string;
  readonly correlationId: string;
  readonly content: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly executionStatus: ExecutionStatus | "failed";
  readonly groundingState: GroundingState;
  readonly outputFingerprint: string | null;
  readonly executionMode: ExecutionMode;
}

/** Normaliza o snapshot cacheado (objeto no MySQL 8 / string no MariaDB). */
function reviveSnapshot(raw: unknown): CognitiveReplayResult {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as CognitiveReplayResult;
}

/**
 * Executa uma cognição sob o CONTRATO DE REPLAY, reutilizando o idempotencyService canônico:
 *   - mesma (org, actor, key) + payload semanticamente equivalente → REPLAY SEGURO: NÃO re-chama
 *     o provider, devolve o resultado autoritativo original, registra um marcador de replay que
 *     REFERENCIA a execução original (preserva correlação/linhagem), sem duplicar a proveniência original;
 *   - mesma key + payload DIFERENTE → CONFLICT (fail-closed, sem chamada ao provider);
 *   - operação em andamento (corrida) → CONFLICT;
 *   - `new`/`failed` → executa `exec()` uma vez, captura a proveniência ORIGINAL e cacheia o snapshot.
 * Degrada com segurança sem DB (executa `exec()` normalmente).
 *
 * `exec` deve devolver o resultado normalizado + a proveniência já capturada (ou capturável) da execução.
 */
export async function runReplaySafeCognition(
  params: { organizationId: number; actorUserId: number; idempotencyKey: string; input: SemanticCognitiveInput },
  exec: () => Promise<CognitiveReplayResult>,
): Promise<{ result: CognitiveReplayResult; replayed: boolean }> {
  const payloadHash = computeInputFingerprint(params.input);
  const check = await checkIdempotency(params.idempotencyKey, params.actorUserId, params.organizationId, COGNITIVE_REPLAY_OP, payloadHash);

  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key cognitiva reutilizada com payload diferente — execução recusada." });
    }
    // REPLAY SEGURO: não re-chama o provider. Registra o marcador de replay referenciando a original.
    const original = reviveSnapshot(check.response);
    await recordReplayMarker(params.organizationId, params.idempotencyKey, original, payloadHash);
    return { result: { ...original, executionMode: original.executionMode }, replayed: true };
  }

  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Execução cognitiva idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }

  // "new"/"failed": executa uma vez (provider chamado no máximo 1x aqui).
  try {
    const result = await exec();
    await saveIdempotencyResult(params.idempotencyKey, params.actorUserId, params.organizationId, result);
    return { result, replayed: false };
  } catch (err) {
    await failIdempotencyKey(params.idempotencyKey, params.actorUserId, params.organizationId);
    throw err;
  }
}

/**
 * Registra a PROVENIÊNCIA de um REPLAY (is_replay=1) referenciando a execução ORIGINAL. Não é
 * duplicata da original: é o registro do PEDIDO de replay (auditável), preservando correlação/
 * linhagem. Idempotente (id determinístico). Nunca lança.
 */
async function recordReplayMarker(organizationId: number, idempotencyKey: string, original: CognitiveReplayResult, inputFingerprint: string): Promise<void> {
  try {
    // executionId do marcador: deriva do original + chave (determinístico, distinto da original).
    const markerExecId = createHash("sha256").update(`replay:${organizationId}:${original.executionId}:${idempotencyKey}`).digest("hex").slice(0, 20);
    const env: ProvenanceEnvelope = {
      id: provenanceId({ organizationId, executionId: markerExecId, replayHash: original.replayHash, isReplay: true }),
      organizationId,
      executionId: markerExecId,
      correlationId: original.correlationId,
      task: "",
      executionMode: original.executionMode,
      executionStatus: original.executionStatus === "failed" ? "failed" : original.executionStatus,
      degradationReason: null,
      failureClass: null,
      groundingState: original.groundingState,
      provenanceClass: "provenanced",
      provider: original.provider,
      model: original.model,
      taskVersion: COGNITIVE_TASK_VERSION,
      promptContractVersion: "",
      orchestratorVersion: PROVENANCE_ORCHESTRATOR_VERSION,
      inputFingerprint,
      outputFingerprint: original.outputFingerprint,
      evidenceFingerprint: null,
      replayHash: original.replayHash,
      idempotencyKey,
      isReplay: true,
      replayOfExecutionId: original.executionId,
      approvalState: "generated",
      businessDomain: null,
      processId: null,
      workspaceId: null,
      stage: null,
      actorUserId: null,
      failureMessage: null,
    };
    await insertCognitiveProvenance(env);
  } catch { /* marcador de replay é auditoria; nunca quebra o fluxo */ }
}

/** Recupera a proveniência ORIGINAL de uma chave (tenant-scoped) — base de auditoria/replay. */
export async function getOriginalProvenance(organizationId: number, idempotencyKey: string) {
  return getOriginalProvenanceByIdempotencyKey(organizationId, idempotencyKey);
}
