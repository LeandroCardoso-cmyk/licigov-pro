/**
 * Sprint 2.8 — Import Queue Service.
 *
 * Fila em memória de processamento assíncrono de imports.
 * Suporta retry com backoff exponencial e Dead Letter Queue (DLQ).
 * Sprint 3 pode substituir por BullMQ/Redis sem mudar a API pública.
 */
import { serviceLogger } from "./observabilityService";
import { getImportSession, updateSessionStatus } from "./fileIngestionService";
import { parserRegistry } from "../parsers/parserRegistry";
import { persistStagingItems } from "./importStagingService";
import type { ParseOptions } from "../parsers/baseParser";

const log = serviceLogger("ImportQueueService");

export const MAX_RETRIES    = 3;
const BASE_BACKOFF_MS = 1_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportJob {
  jobId:          string;
  sessionId:      number;
  organizationId: number;
  buffer:         Buffer;
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

const queue:  ImportJob[]           = [];
const dlq:    ImportJob[]           = [];
const jobs:   Map<string, JobRecord> = new Map();
let   running = false;

// ─── Enqueue ──────────────────────────────────────────────────────────────────

export function enqueueImport(
  sessionId:      number,
  organizationId: number,
  buffer:         Buffer,
): string {
  const jobId = `job_${sessionId}_${Date.now()}`;
  const job: ImportJob = {
    jobId,
    sessionId,
    organizationId,
    buffer,
    enqueuedAt: new Date(),
    attempts:   0,
  };

  queue.push(job);
  jobs.set(jobId, { job, status: "queued" });

  log.info("job_enqueued", { jobId, sessionId, organizationId, queueDepth: queue.length });

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
  log.info("job_processing", { jobId: job.jobId, attempt: job.attempts, sessionId: job.sessionId });

  try {
    const session = await getImportSession(job.sessionId, job.organizationId);
    if (!session) throw new Error("Sessão não encontrada.");

    await updateSessionStatus(job.sessionId, job.organizationId, "parsing", {
      progress: 10, stage: "parsing", startedAt: new Date(),
    });

    const parser = parserRegistry.resolve(session.sourceMimeType, session.sourceFileName, session.parserType as any);
    if (!parser) throw new Error(`Parser não encontrado para ${session.parserType}`);

    const opts: ParseOptions = {
      importSessionId: job.sessionId,
      sourceFileId:    session.sourceFileId,
      sourceFileName:  session.sourceFileName,
      sourceMimeType:  session.sourceMimeType,
      organizationId:  job.organizationId,
    };

    const result = await parser.safeParse(job.buffer, opts);

    if (result.errors.some(e => e.fatal)) {
      const msg = result.errors.find(e => e.fatal)?.message ?? "Erro fatal no parser.";
      throw new Error(msg);
    }

    await updateSessionStatus(job.sessionId, job.organizationId, "extracted", {
      progress: 60, stage: "extracted",
      warnings: result.warnings as any,
      extractionSummary: result.summary as any,
    });

    const stagingIds = await persistStagingItems(result.items, job.organizationId);

    await updateSessionStatus(job.sessionId, job.organizationId, "awaiting_review", {
      progress:          90,
      stage:             "awaiting_review",
      finishedAt:        new Date(),
      extractionSummary: result.summary as any,
    });

    if (rec) {
      rec.status = "done";
      rec.result = { itemCount: stagingIds.length };
    }

    log.info("job_done", {
      jobId:     job.jobId,
      sessionId: job.sessionId,
      items:     stagingIds.length,
    });

  } catch (err: any) {
    const msg = err?.message ?? "Erro desconhecido.";
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

      queue.push(job);
    } else {
      await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
        errors:   [{ code: "PARSE_ERROR", message: msg, fatal: true }],
        failedAt: new Date(),
      }).catch(() => {});

      dlq.push(job);
      if (rec) { rec.status = "dlq"; rec.error = msg; }
      log.error("job_dlq", { jobId: job.jobId, sessionId: job.sessionId, error: msg });
    }
  }
}

// ─── Introspection ────────────────────────────────────────────────────────────

export function getJobStatus(jobId: string): JobRecord | null {
  return jobs.get(jobId) ?? null;
}

export function getQueueDepth(): number {
  return queue.length;
}

export function getDlqDepth(): number {
  return dlq.length;
}

export function getDlqJobs(): ImportJob[] {
  return [...dlq];
}

export async function retryJob(jobId: string): Promise<void> {
  const dlqIdx = dlq.findIndex(j => j.jobId === jobId);
  if (dlqIdx === -1) throw new Error(`Job ${jobId} não está na DLQ.`);

  const [job] = dlq.splice(dlqIdx, 1);
  job.attempts = 0;
  job.lastError = undefined;

  const rec = jobs.get(jobId);
  if (rec) rec.status = "queued";

  queue.push(job);
  log.info("job_retried_from_dlq", { jobId });

  if (!running) {
    setImmediate(() => drainQueue());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
