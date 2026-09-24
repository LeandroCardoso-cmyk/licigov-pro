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
import { replaceUnreviewedStagingItems, StagingAlreadyReviewedError } from "./importStagingService";
import { storageGetBytes, storagePut } from "../storage";
import { getOcrAdapter } from "../providers/ocr";
import { OCR_CONFIG } from "../config/ocr";
import {
  classifyRowsOutcome, isDeterministicParserError, OUTCOME_MESSAGE, OUTCOME_STAGE, type ImportOutcomeState,
} from "../domain/importOutcome";
import type { ExtractionLineage } from "../domain/extractionLineage";
import type { ExtractionSummary } from "../domain/importTypes";
import { isFeatureEnabled } from "./featureFlagService";
import { CANONICAL_INGESTION_FLAG } from "./ingestionUploadService";
import { MAX_FILE_SIZE_BYTES, type ParserType } from "../domain/importTypes";
import type { ParseOptions } from "../parsers/baseParser";
import { isDocumentImportType } from "../domain/documentProjection";
import { persistDocumentStaging } from "./documentIntakeService";

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

    // P0 piloto — DFD/ETP/TR importados como DOCUMENTO: mesmo pipeline (sessão/storage/checksum/parser),
    // projeção documental em vez de linhas. Sem IA; sem OCR (escaneado ⇒ falha terminal explícita).
    const documentMode = isDocumentImportType(session.importType);
    if (documentMode) opts.extractionMode = "document";

    // U2A-OCR — OCR governado só no modo de LINHAS (Pesquisa de Preços/itens). Porta resolvida na
    // infraestrutura (kill-switch OCR_ENABLED); o parser não conhece o motor. OCR roda AQUI, no worker da
    // fila existente, fora de qualquer transação de banco; o estágio "ocr_processing" fica observável.
    const ocrPort = documentMode ? null : getOcrAdapter();
    if (ocrPort) {
      opts.ocr = {
        port: ocrPort, maxPages: OCR_CONFIG.maxPages, timeoutMs: OCR_CONFIG.timeoutMs,
        renderWidth: OCR_CONFIG.renderWidth, minConfidence: OCR_CONFIG.minConfidence,
      };
      opts.onStage = async (stage) => {
        await updateSessionStatus(job.sessionId, job.organizationId, "parsing", { progress: 30, stage }).catch(() => {});
        log.info("job_stage", { jobId: job.jobId, sessionId: job.sessionId, organizationId: job.organizationId, correlationId: job.correlationId, stage });
      };
    }

    const startedAtIso = new Date().toISOString();
    const result = await parser.safeParse(buffer, opts);
    const fatal = result.errors.find(e => e.fatal);

    if (fatal && (documentMode || !isDeterministicParserError(fatal.code))) {
      // Falha possivelmente TRANSITÓRIA → retry/backoff existente (e DLQ ao esgotar).
      throw new Error(fatal.message ?? "Erro fatal no parser.");
    }

    if (documentMode) {
      const projection = result.documentProjection;
      const ocr = result.warnings.some(w => w.code === "OCR_REQUIRED");
      if (!projection || ocr || projection.stats.characters === 0) {
        // Falha DETERMINÍSTICA (reprocessar não muda o resultado): sem retry, sem extração fingida.
        const code = ocr ? "OCR_REQUIRED" : projection ? "NO_TEXT_EXTRACTED" : "DOCUMENT_MODE_UNSUPPORTED";
        const message = ocr
          ? "O PDF parece ser digitalizado (somente imagem). Esta versão não faz OCR — envie o PDF original com texto ou o DOCX."
          : projection
            ? "Nenhum texto legível foi encontrado no documento."
            : "Formato não suportado para importação de documento — envie PDF com texto ou DOCX.";
        await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
          stage: "failed", warnings: result.warnings, extractionSummary: result.summary,
          errors: [{ code, message, fatal: true }], failedAt: new Date(),
        });
        if (rec) { rec.status = "failed"; rec.error = code; }
        inFlight.delete(job.sessionId);
        log.warn("job_document_unextractable", { jobId: job.jobId, sessionId: job.sessionId, code });
        return;
      }
      await persistDocumentStaging({
        session, projection, parserType: parser.parserType,
        parserVersion: parser.capabilities.parserVersion, warnings: result.warnings,
      });
      await updateSessionStatus(job.sessionId, job.organizationId, "awaiting_review", {
        progress: 90, stage: "awaiting_review", finishedAt: new Date(),
        warnings: result.warnings, extractionSummary: result.summary,
      });
      if (rec) { rec.status = "done"; rec.result = { itemCount: 0 }; }
      inFlight.delete(job.sessionId);
      log.info("job_done_document", { jobId: job.jobId, sessionId: job.sessionId, characters: projection.stats.characters });
      return;
    }

    // ── U2A — desfecho EXPLÍCITO da extração de linhas (nunca "revisão" com zero itens) ─────────────
    const lineage: ExtractionLineage | undefined = result.extraction
      ? { ...result.extraction, correlationId: job.correlationId ?? session.correlationId ?? null, startedAt: startedAtIso, finishedAt: new Date().toISOString() }
      : undefined;
    const summary: ExtractionSummary = { ...result.summary, ...(lineage ? { extraction: lineage } : {}) };

    // Artefato DERIVADO do OCR (texto bruto por página) — gravado ao lado do original, que é imutável.
    // Fora de transação; falha não derruba a extração (cada item já preserva o texto bruto da sua linha).
    if (result.ocrArtifact && lineage?.ocr) {
      const artifactKey = `${job.storageKey}.ocr-${lineage.fingerprint.slice(0, 16)}.json`;
      try {
        await storagePut(artifactKey, JSON.stringify({ lineage, pages: result.ocrArtifact.pages }), "application/json");
        lineage.ocr.artifactKey = artifactKey;
      } catch {
        lineage.ocr.artifactKey = null;
        log.warn("ocr_artifact_not_stored", { jobId: job.jobId, sessionId: job.sessionId, organizationId: job.organizationId });
      }
    }

    const outcome = classifyRowsOutcome({
      itemCount:    result.items.length,
      warningCodes: result.warnings.map(w => w.code),
      fatalCode:    fatal?.code,
      itemsNeedAttention:
        (lineage?.extractionMode ?? "native_text") !== "native_text" ||
        result.warnings.some(w => w.code === "OCR_REQUIRED_PARTIAL" || w.code === "OCR_FAILED" || w.code === "OCR_PAGE_LIMIT") ||
        result.items.some(i => i.extractionWarnings.some(w => w.severity === "warning")),
    });

    const observe = (state: ImportOutcomeState, items: number) => log.info("import_extraction_outcome", {
      jobId: job.jobId, correlationId: job.correlationId ?? session.correlationId ?? null,
      organizationId: job.organizationId, processId: session.procurementProcessId ?? null, sessionId: job.sessionId,
      checksum: session.checksum ?? null, extractionMode: lineage?.extractionMode ?? null,
      ocrEngine: lineage?.ocr?.engine ?? null, ocrEngineVersion: lineage?.ocr?.engineVersion ?? null,
      ocrFailure: lineage?.ocr?.failure?.code ?? null, pageCount: lineage?.pageCount ?? result.summary.pagesProcessed ?? null,
      ocrPages: lineage?.ocrPages ?? 0, durationMs: result.summary.processingMs, ocrDurationMs: lineage?.ocr?.durationMs ?? null,
      warningsCount: result.warnings.length, items, finalState: state, fingerprint: lineage?.fingerprint ?? null,
    });

    if (outcome !== "REVIEW_REQUIRED" && outcome !== "READY_FOR_REVIEW") {
      // Terminal SEM staging: não aprovável, não promovível. Reprocessar/reenviar reutiliza a sessão (sem
      // itens revisados) — o checksum nunca fica bloqueado. Sem auto-retry (resultado determinístico ou OCR
      // pesado: a nova tentativa é explícita, via enqueueProcessing).
      const state = outcome ?? "PARSER_FAILED";
      const code = state === "PARSER_FAILED" && fatal ? fatal.code : state;
      await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
        progress: 100, stage: OUTCOME_STAGE[state], warnings: result.warnings, extractionSummary: summary,
        errors: [{ code, message: OUTCOME_MESSAGE[state as keyof typeof OUTCOME_MESSAGE], fatal: true }],
        failedAt: new Date(),
      });
      if (rec) { rec.status = "failed"; rec.error = code; }
      inFlight.delete(job.sessionId);
      observe(state, 0);
      return;
    }

    await updateSessionStatus(job.sessionId, job.organizationId, "extracted", {
      progress: 60, stage: "extracted",
      warnings: result.warnings,
      extractionSummary: summary,
    });

    let stagingIds: number[];
    try {
      ({ ids: stagingIds } = await replaceUnreviewedStagingItems(job.sessionId, job.organizationId, result.items));
    } catch (err) {
      if (!(err instanceof StagingAlreadyReviewedError)) throw err;
      // Decisão humana já registrada: nunca sobrescrever. Falha explícita, sem retry.
      await updateSessionStatus(job.sessionId, job.organizationId, "failed", {
        stage: "staging_already_reviewed", failedAt: new Date(),
        errors: [{ code: "STAGING_ALREADY_REVIEWED", message: err.message, fatal: true }],
      });
      if (rec) { rec.status = "failed"; rec.error = "STAGING_ALREADY_REVIEWED"; }
      inFlight.delete(job.sessionId);
      log.warn("job_staging_already_reviewed", { jobId: job.jobId, sessionId: job.sessionId, organizationId: job.organizationId });
      return;
    }

    await updateSessionStatus(job.sessionId, job.organizationId, "awaiting_review", {
      progress:          90,
      stage:             OUTCOME_STAGE[outcome],
      finishedAt:        new Date(),
      warnings:          result.warnings,
      extractionSummary: summary,
      errors:            [],
    });

    if (rec) { rec.status = "done"; rec.result = { itemCount: stagingIds.length }; }
    inFlight.delete(job.sessionId);
    observe(outcome, stagingIds.length);
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
        stage:    OUTCOME_STAGE.PARSER_FAILED,
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
