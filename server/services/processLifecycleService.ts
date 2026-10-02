/**
 * Pilot Reset B2/B3 — orquestração do lifecycle governado do Processo Licitatório.
 *
 * `previewLifecycle` — READ-ONLY: snapshot + elegibilidade + digest (nenhuma escrita, nenhum lock).
 * `executeLifecycle` — uma transação LOCAL e determinística (sem IA, S3, HTTP, e-mail ou provider remoto):
 *   1. replay por chave de idempotência (mesmo pedido ⇒ mesmo resultado; pedido diferente ⇒ CONFLICT);
 *   2. lock da geração (`FOR UPDATE`) e recomputação do snapshot SOB lock;
 *   3. CAS da revisão do lifecycle e comparação do digest com o do preview (mudou ⇒ STALE_PREVIEW);
 *   4. elegibilidade recomputada (inelegível ⇒ PRECONDITION_FAILED com códigos estáveis);
 *   5. escrita: estado/número da geração por CAS + eventos append-only; RESET cria a NOVA geração (id opaco)
 *      e supera a antiga — os filhos ficam na geração antiga, nada é apagado nem reapontado.
 * Ninguém além de manager+ executa (router). IA não tem caminho até aqui.
 */
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { recordProcessEvent } from "../db/procurement";
import {
  LifecycleWriteRaceError, getGenerationRow, getLifecycleEventsByKey, insertLifecycleEvent, insertNextGeneration,
  loadLifecycleSnapshot, updateGenerationLifecycle, type LifecycleEventRow,
} from "../db/processLifecycle";
import {
  LIFECYCLE_IDEMPOTENCY_CONFLICT, LIFECYCLE_MESSAGES, PROCESS_NUMBER_TAKEN, STALE_PREVIEW, STALE_REVISION, TARGET_STATE,
  eligibilityDigest, evaluateEligibility, generationProcessId, lifecycleEventId, lifecycleRequestHash, lineageIdFor,
  validateLifecycleRequest, type Eligibility, type LifecycleAction, type LifecycleRequest, type LifecycleSnapshot,
} from "../domain/processLifecycle";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("processLifecycleService");

export interface LifecyclePreview {
  readonly action: LifecycleAction;
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  readonly reasons: readonly string[];
  readonly affected: { readonly formal: LifecycleSnapshot["formal"]; readonly work: LifecycleSnapshot["work"] };
  readonly generation: { readonly processId: string; readonly lineageId: string | null; readonly generationNo: number };
  readonly lifecycleState: LifecycleSnapshot["lifecycleState"];
  readonly revision: number;
  readonly digest: string;
  /** O que a execução fará, em termos institucionais (sem efeito colateral). */
  readonly effect: string;
}

const EFFECT: Record<LifecycleAction, string> = {
  CORRECT_NUMBER: "Corrige o número administrativo desta geração; o antes/depois fica no histórico. Nenhum dado é apagado.",
  DISCARD_DRAFT: "Marca este rascunho como descartado (histórico, imutável). Nenhum dado é apagado.",
  RESET_DRAFT: "Encerra esta geração como substituída (histórico, imutável, com todos os seus dados) e inicia uma NOVA geração limpa com o mesmo número. Nada é apagado nem movido.",
  CANCEL: "Encerra esta geração como cancelada (histórico, imutável). Nenhum dado é apagado.",
  ARCHIVE: "Encerra esta geração como arquivada (histórico, imutável). Nenhum dado é apagado.",
};

function previewOf(s: LifecycleSnapshot, action: LifecycleAction, e: Eligibility): LifecyclePreview {
  return {
    action, eligible: e.eligible, blockers: e.blockers, reasons: e.reasons, affected: { formal: s.formal, work: s.work },
    generation: { processId: s.processId, lineageId: s.lineageId, generationNo: s.generationNo },
    lifecycleState: s.lifecycleState, revision: s.lifecycleRevision, digest: eligibilityDigest(s, action), effect: EFFECT[action],
  };
}

const NOT_FOUND = () => new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });

/** Pré-visualização READ-ONLY. */
export async function previewLifecycle(organizationId: number, processId: string, action: LifecycleAction): Promise<LifecyclePreview> {
  const s = await loadLifecycleSnapshot(null, organizationId, processId);
  if (!s) throw NOT_FOUND();
  return previewOf(s, action, evaluateEligibility(s, action));
}

export interface LifecycleResult {
  readonly action: LifecycleAction;
  readonly processId: string;
  readonly lineageId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly revision: number;
  /** RESET_DRAFT: id da nova geração ativa. */
  readonly newProcessId: string | null;
  readonly replayed: boolean;
}

type Outcome =
  | { kind: "done"; result: LifecycleResult }
  | { kind: "replay"; result: LifecycleResult }
  | { kind: "error"; code: "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND"; reason: string; message: string };

export async function executeLifecycle(req: LifecycleRequest, correlationId: string): Promise<LifecycleResult> {
  const startedAt = Date.now();
  const base = { organizationId: req.organizationId, processId: req.processId, action: req.action, actorUserId: req.actorUserId, correlationId };
  const v = validateLifecycleRequest(req);
  if (!v.ok) {
    log.warn("process_lifecycle_rejected", { ...base, reason: v.code, fields: v.fields });
    throw new TRPCError({ code: "BAD_REQUEST", message: LIFECYCLE_MESSAGES[v.code] });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível — nada foi alterado (fail-closed)." });
  const key = req.idempotencyKey.trim();
  const requestHash = lifecycleRequestHash(req);

  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (tx): Promise<Outcome> => {
      // 1. Replay: mesma chave ⇒ mesmo resultado (sem escrita) ou CONFLICT.
      const prior = await getLifecycleEventsByKey(tx, req.organizationId, key);
      if (prior.length > 0) {
        const primary = prior.find((e) => e.resultJson) ?? prior[0];
        if (prior.some((e) => e.requestHash !== requestHash)) {
          return { kind: "error", code: "CONFLICT", reason: LIFECYCLE_IDEMPOTENCY_CONFLICT, message: LIFECYCLE_MESSAGES[LIFECYCLE_IDEMPOTENCY_CONFLICT] };
        }
        return { kind: "replay", result: { ...(JSON.parse(primary.resultJson ?? "{}") as LifecycleResult), replayed: true } };
      }
      // 2. Lock + snapshot sob lock.
      const s = await loadLifecycleSnapshot(tx, req.organizationId, req.processId, { forUpdate: true });
      if (!s) return { kind: "error", code: "NOT_FOUND", reason: "NOT_FOUND", message: "Processo não encontrado nesta organização." };
      // 3. CAS + digest do preview.
      if (s.lifecycleRevision !== req.expectedRevision) {
        return { kind: "error", code: "CONFLICT", reason: STALE_REVISION, message: LIFECYCLE_MESSAGES[STALE_REVISION] };
      }
      const digest = eligibilityDigest(s, req.action);
      if (digest !== req.expectedEligibilityDigest) {
        return { kind: "error", code: "CONFLICT", reason: STALE_PREVIEW, message: LIFECYCLE_MESSAGES[STALE_PREVIEW] };
      }
      // 4. Elegibilidade recomputada.
      const e = evaluateEligibility(s, req.action);
      if (!e.eligible) {
        return {
          kind: "error", code: "PRECONDITION_FAILED", reason: e.blockers.join(","),
          message: `${e.reasons.join(" ")} Nada foi alterado (${e.blockers.join(", ")}).`,
        };
      }
      // 5. Escrita.
      const lineageId = s.lineageId ?? lineageIdFor(s.organizationId, s.processId);
      const toState = TARGET_STATE[req.action];
      const before = { processNumber: s.processNumber, lifecycleState: s.lifecycleState, lineageId: s.lineageId, generationNo: s.generationNo, revision: s.lifecycleRevision };
      let newProcessId: string | null = null;
      let newNumber = s.processNumber;
      if (req.action === "CORRECT_NUMBER") {
        newNumber = (req.newProcessNumber ?? "").trim();
        if (newNumber === s.processNumber) {
          return { kind: "error", code: "PRECONDITION_FAILED", reason: "NUMBER_UNCHANGED", message: "O novo número é igual ao atual; nada foi alterado (NUMBER_UNCHANGED)." };
        }
      }
      const ok = await updateGenerationLifecycle(tx, {
        organizationId: s.organizationId, processId: s.processId, expectedRevision: s.lifecycleRevision,
        set: {
          lineageId, ...(toState !== s.lifecycleState ? { lifecycleState: toState } : {}),
          ...(req.action === "CORRECT_NUMBER" ? { processNumber: newNumber } : {}),
        },
      });
      if (!ok) return { kind: "error", code: "CONFLICT", reason: STALE_REVISION, message: LIFECYCLE_MESSAGES[STALE_REVISION] };

      if (req.action === "RESET_DRAFT") {
        const row = await getGenerationRow(tx, s.organizationId, s.processId);
        const generationNo = s.generationNo + 1;
        newProcessId = generationProcessId(s.organizationId, lineageId, generationNo);
        await insertNextGeneration(tx, {
          id: newProcessId, organizationId: s.organizationId, processNumber: s.processNumber, object: row?.object ?? null,
          startOption: row?.startOption ?? "criar_dfd", responsibleUser: row?.responsibleUser ?? req.actorUserId,
          correlationId, lineageId, generationNo, supersedesProcessId: s.processId,
        });
        await recordProcessEvent({
          organizationId: s.organizationId, processId: newProcessId, eventType: "workspace_created", actor: String(req.actorUserId),
          summary: `Nova geração ${generationNo} iniciada por reset governado (substitui a geração ${s.generationNo}).`,
          refId: s.processId, correlationId, idempotencyKey: "initial",
        }, tx);
      }
      const result: LifecycleResult = {
        action: req.action, processId: s.processId, lineageId, fromState: s.lifecycleState, toState,
        revision: s.lifecycleRevision + 1, newProcessId, replayed: false,
      };
      const after = { processNumber: newNumber, lifecycleState: toState, lineageId, generationNo: s.generationNo, revision: s.lifecycleRevision + 1, newProcessId };
      const event = (eventType: string, processId: string, fromState: string, to: string, extra: Partial<LifecycleEventRow> = {}): LifecycleEventRow => ({
        id: lifecycleEventId(s.organizationId, key, eventType), organizationId: s.organizationId, lineageId, processId,
        action: req.action, eventType, fromState, toState: to, beforeJson: JSON.stringify(before), afterJson: JSON.stringify(after),
        reason: req.reason.trim(), actorUserId: req.actorUserId, eligibilityDigest: digest, revisionBefore: s.lifecycleRevision,
        revisionAfter: s.lifecycleRevision + 1, idempotencyKey: key, requestHash, resultJson: null, correlationId, ...extra,
      });
      await insertLifecycleEvent(tx, event(req.action, s.processId, s.lifecycleState, toState, { resultJson: JSON.stringify(result) }));
      if (newProcessId) await insertLifecycleEvent(tx, event("GENERATION_STARTED", newProcessId, "none", "active"));
      await recordProcessEvent({
        organizationId: s.organizationId, processId: s.processId, eventType: "lifecycle", actor: String(req.actorUserId),
        summary: `Lifecycle: ${req.action} (${s.lifecycleState} → ${toState}).`, refId: lifecycleEventId(s.organizationId, key, req.action),
        correlationId, idempotencyKey: `lifecycle:${key}`,
      }, tx);
      return { kind: "done", result };
    });
  } catch (err) {
    if (err instanceof LifecycleWriteRaceError) {
      const reason = err.detail === "number" ? PROCESS_NUMBER_TAKEN : STALE_REVISION;
      log.warn("process_lifecycle_conflict", { ...base, reason, outcome: "CONFLICT", durationMs: Date.now() - startedAt });
      throw new TRPCError({ code: "CONFLICT", message: LIFECYCLE_MESSAGES[reason] });
    }
    throw err;
  }

  if (outcome.kind === "error") {
    log.warn("process_lifecycle_refused", { ...base, reason: outcome.reason, outcome: outcome.code, durationMs: Date.now() - startedAt });
    throw new TRPCError({ code: outcome.code, message: outcome.message });
  }
  log.info(outcome.kind === "replay" ? "process_lifecycle_replayed" : "process_lifecycle_executed", {
    ...base, lineageId: outcome.result.lineageId, fromState: outcome.result.fromState, toState: outcome.result.toState,
    newProcessId: outcome.result.newProcessId, outcome: outcome.kind === "replay" ? "IDEMPOTENT_CONVERGENCE" : "EXECUTED",
    durationMs: Date.now() - startedAt,
  });
  return outcome.result;
}
