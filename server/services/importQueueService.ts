/**
 * Sprint 2.8 / PR B.2.1 — Import Queue Service.
 *
 * Fila em memória de processamento assíncrono de imports, com retry (backoff exponencial)
 * e Dead Letter Queue (DLQ). Sprint 3 pode substituir por BullMQ/Redis sem mudar a API.
 *
 * PR B.2.1 — o job transporta APENAS identificadores/metadados seguros (nunca o Buffer do
 * arquivo). O binário é recuperado do storage durável no MOMENTO do processamento, no worker,
 * com limite rígido de tamanho. Após restart, `recoverStuckImportSessions` reidrata a fila
 * de forma determinística e replay-safe (claim atômico no banco + limite de tentativas + DLQ).
 *
 * LIMITAÇÃO documentada: os parsers atuais exigem um Buffer completo — por isso o worker
 * baixa o arquivo inteiro na memória APENAS durante o parse (nunca dentro do job/fila). A
 * evolução para parsing em streaming remove essa materialização.
 */
import { serviceLogger } from "./observabilityService";
import {
  getImportSession,
  updateSessionStatus,
  listStuckImportSessions,
  claimSessionForRecovery,
} from "./fileIngestionService";
import { parserRegistry } from "../parsers/parserRegistry";
import { persistStagingItems } from "./importStagingService";
import { storageGetBytes } from "../storage";
import { isFeatureEnabled } from "./featureFlagService";
import { CANONICAL_INGESTION_FLAG } from "./ingestionUploadService";
import { MAX_FILE_SIZE_BYTES, type ParserType } from "../domain/importTypes";
import type { ParseOptions } from "../parsers/baseParser";

const log = serviceLogger("ImportQueueService");

export const MAX_RETRIES    = 3;
const BASE_BACKOFF_MS = 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Job da fila — SOMENTE identificadores/metadados seguros. Nunca contém o arquivo. */
export interface ImportJob {
  jobId:          string;
  sessionId:      number;
  organizationId: number;
  storageKey:     string;
  correlationId?: string;
  enqueuedAt:     Date;
  attempts:       number;
  lastError?:     string;
}

type JobStatus = "queued" | "processing" | "done" | "failed" | "dlq";

interface JobRecord {
  job:       ImportJob;
  status:    JobStatus;
  result?:   { itemCount: number };
  error?:    string;
}

// ─── In-memory queue ──────────────────────────────────────────────────────────

const queue:  ImportJob[]            = [];
const dlq:    ImportJob[]            = [];
const jobs:   Map<string, JobRecord> = new Map();
/** Sessões em voo neste processo — evita enfileiramento duplicado da mesma sessão. */
const inFlight = new Set<number>();
let   running = false;
let   jobSeq  = 0;

// ─── Enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueOptions {
  correlationId?: string;
  /** Tentativas já realizadas (usado pela recuperação para preservar o limite de retry). */
  attempt?:       number;
}

/**
 * Enfileira o processamento de uma sessão. NÃO recebe bytes — apenas a storageKey; o worker
 * baixa o arquivo do storage. Idempotente por sessão dentro do processo (inFlight guard).
 * Retorna o jobId, ou null se a sessão já estava em voo.
 */
export function enqueueImport(
  sessionId:      number,
  organizationId: number,
  storageKey:     string,
  opts:           EnqueueOptions = {},
): string | null {
  if (inFlight.has(sessionId)) {
    log.info("job_enqueue_skipped_in_flight", { sessionId, organizationId });
    return null;
  }
  jobSeq += 1;
  const jobId = `job_${sessionId}_${jobSeq}`;
  const job: ImportJob = {
    jobId,
    sessionId,
    organizationId,
    storageKey,
    correlationId: opts.correlationId,
    enqueuedAt:    new Date(),
    attempts:      opts.attempt ?? 0,
  };

  inFlight.add(sessionId);
  queue.push(job);
  jobs.set(jobId, { job, status: "queued" });

  log.info("job_enqueued", { jobId, sessionId, organizationId, correlationId: opts.correlationId, queueDepth: queue.length });

  if (!running) {
    setImmediate(() => drainQueue());
  }
  return jobId;
}

// ─── Queue drain ──────────────────────────────────────────────────────────────

async function drainQueue(): Promise<void> {
  if (running || queue.length === 0) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    await processJob(job);
  }
  running = false;
}

// ─── Process ──────────────────────────────────────────────────────────────────

async function processJob(job: ImportJob): Promise<void> {
  const rec = jobs.get(job.jobId);
  if (rec) rec.status = "processing";

  job.attempts++;
  log.info("job_processing", { jobId: job.jobId, attempt: job.attempts, sessionId: job.sessionId, correlationId: job.correlationId });

  try {
    const session = await getImportSession(job.sessionId, job.organizationId);
    if (!session) throw new Error("Sessão não encontrada.");

    await updateSessionStatus(job.sessionId, job.organizationId, "parsing", {
      progress: 10, stage: "parsing", startedAt: new Date(),
    });

    // Recuperação do binário do storage durável — SOMENTE aqui, no worker (nunca no job).
    const buffer = await storageGetBytes(job.storageKey);
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new Error("Arquivo excede o limite permitido.");
    }

    const parser = parserRegistry.resolve(session.sourceMimeType, session.sourceFileName, session.parserType as ParserType);
    if (!parser) throw new Error(`Parser não encontrado para ${session.parserType}`);

    const opts: ParseOptions = {
      importSessionId: job.sessionId,
      sourceFileId:    session.sourceFileId,
      sourceFileName:  session.sourceFileName,
      sourceMimeType:  session.sourceMimeType,
      sourceChecksum:  session.checksum ?? "",
      organizationId:  job.organizationId,
    };

    const result = await parser.safeParse(buffer, opts);

    if (result.errors.some(e => e.fatal)) {
      const msg = result.errors.find(e => e.fatal)?.message ?? "Erro fatal no parser.";
      throw new Error(msg);
    }

    await updateSessionStatus(job.sessionId, job.organizationId, "extracted", {
      progress: 60, stage: "extracted",
      warnings: result.warnings,
      extractionSummary: result.summary,
    });

    const stagingIds = await persistStagingItems(result.items, job.organizationId);

    await updateSessionStatus(job.sessionId, job.organizationId, "awaiting_review", {
      progress:          90,
      stage:             "awaiting_review",
      finishedAt:        new Date(),
      extractionSummary: result.summary,
    });

    if (rec) { rec.status = "done"; rec.result = { itemCount: stagingIds.length }; }
    inFlight.delete(job.sessionId);
    log.info("job_done", { jobId: job.jobId, sessionId: job.sessionId, items: stagingIds.length });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido.";
    job.lastError = msg;

    if (job.attempts < MAX_RETRIES) {
      const delayMs = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
      log.warn("job_retry_scheduled", { jobId: job.jobId, attempt: job.attempts, delayMs });

      await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
        errors:   [{ code: "PARSE_ERROR", message: msg, fatal: false }],
        failedAt: new Date(),
      }).catch(() => {});

      await sleep(delayMs);

      await updateSessionStatus(job.sessionId, job.organizationId, "queued", {
        progress: 0, stage: "retry",
      }).catch(() => {});

      queue.push(job); // continua em voo (inFlight mantido)
    } else {
      await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
        errors:   [{ code: "PARSE_ERROR", message: msg, fatal: true }],
        failedAt: new Date(),
      }).catch(() => {});

      dlq.push(job);
      if (rec) { rec.status = "dlq"; rec.error = msg; }
      inFlight.delete(job.sessionId);
      log.error("job_dlq", { jobId: job.jobId, sessionId: job.sessionId, error: msg });
    }
  }
}

// ─── Recovery (replay-safe) ─────────────────────────────────────────────────────

/**
 * PR B.2.1 — Recuperação determinística de sessões presas em `queued`/`parsing` após restart
 * (a fila in-memory é volátil). Para cada sessão:
 *  - respeita a feature flag por tenant (fail-closed em produção);
 *  - encaminha para DLQ se excedeu o limite de tentativas;
 *  - faz um CLAIM atômico no banco (impede execução concorrente duplicada);
 *  - reenfileira preservando correlationId/lineage e a contagem de tentativas.
 */
export async function recoverStuckImportSessions(): Promise<{ recovered: number; skipped: number; dlq: number }> {
  const stuck = await listStuckImportSessions();
  let recovered = 0, skipped = 0, toDlq = 0;

  for (const s of stuck) {
    // Fail-closed por tenant: não reprocessa se a ingestão canônica não está habilitada.
    if (!(await isFeatureEnabled(CANONICAL_INGESTION_FLAG, s.organizationId))) { skipped++; continue; }

    // Limite de tentativas → falha terminal + DLQ (sem reprocessar em loop).
    if (s.retryCount >= MAX_RETRIES) {
      await updateSessionStatus(s.id, s.organizationId, "failed", {
        errors:   [{ code: "RECOVERY_EXHAUSTED", message: "Tentativas esgotadas na recuperação.", fatal: true }],
        failedAt: new Date(),
      }).catch(() => {});
      toDlq++; continue;
    }

    // Claim atômico: apenas um recuperador ganha a sessão.
    const claimed = await claimSessionForRecovery(s.id, s.organizationId);
    if (!claimed) { skipped++; continue; }

    const jobId = enqueueImport(s.id, s.organizationId, s.sourceFileId, {
      correlationId: s.correlationId ?? undefined,
      attempt:       s.retryCount,
    });
    if (jobId) recovered++; else skipped++;
  }

  log.info("import_recovery_ran", { total: stuck.length, recovered, skipped, dlq: toDlq });
  return { recovered, skipped, dlq: toDlq };
}

// ─── Introspection ────────────────────────────────────────────────────────────

export function getJobStatus(jobId: string): JobRecord | null { return jobs.get(jobId) ?? null; }
export function getQueueDepth(): number { return queue.length; }
export function getDlqDepth(): number { return dlq.length; }
export function getDlqJobs(): ImportJob[] { return [...dlq]; }

export async function retryJob(jobId: string): Promise<void> {
  const dlqIdx = dlq.findIndex(j => j.jobId === jobId);
  if (dlqIdx === -1) throw new Error(`Job ${jobId} não está na DLQ.`);

  const [job] = dlq.splice(dlqIdx, 1);
  job.attempts = 0;
  job.lastError = undefined;

  const rec = jobs.get(jobId);
  if (rec) rec.status = "queued";

  inFlight.add(job.sessionId);
  queue.push(job);
  log.info("job_retried_from_dlq", { jobId });

  if (!running) {
    setImmediate(() => drainQueue());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
