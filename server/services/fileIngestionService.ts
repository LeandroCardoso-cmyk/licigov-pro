/**
 * Sprint 2.8 — File Ingestion Service.
 *
 * Orquestração oficial de ingestão: validação → staging → fila → dispatch.
 * Idempotent: mesmo arquivo + mesmo sessionId não cria duplicata.
 * Tenant-safe: organizationId obrigatório em todas as operações.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createHash } from "crypto";
import { getDb } from "../db/connection";
import { importSessions } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { logActivity } from "./activityLogService";
import {
  MAX_FILE_SIZE_BYTES,
  detectParserType,
  type ImportType,
  type ImportSessionStatus,
  type ExtractionSummary,
  type ImportWarning,
  type ImportError,
} from "../domain/importTypes";
import type { TrpcAuditCtx } from "./activityLogService";

const log = serviceLogger("FileIngestionService");

// ─── Validation ───────────────────────────────────────────────────────────────

export interface FileValidationResult {
  valid:      boolean;
  reason?:    string;
  parserType?: string;
  checksum:   string;
}

export function validateFile(
  buffer:   Buffer,
  mimeType: string,
  filename: string,
): FileValidationResult {
  const checksum = createHash("sha256").update(buffer).digest("hex");

  if (buffer.length === 0)
    return { valid: false, reason: "Arquivo vazio.", checksum };

  if (buffer.length > MAX_FILE_SIZE_BYTES)
    return { valid: false, reason: `Arquivo excede ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`, checksum };

  const parserType = detectParserType(mimeType, filename);
  if (!parserType)
    return { valid: false, reason: `Formato não suportado: ${mimeType}.`, checksum };

  return { valid: true, parserType, checksum };
}

// ─── Create session ───────────────────────────────────────────────────────────

export interface CreateImportSessionParams {
  sourceFileName: string;
  sourceMimeType: string;
  sourceSize:     number;
  sourceFileId:   string;
  importType:     ImportType;
  correlationId?: string;
  // PR B.2.1 — vínculo canônico + dedup
  processId?:     number | null;
  importPurpose?: string | null;
  checksum?:      string | null;
}

export async function createImportSession(
  params: CreateImportSessionParams,
  ctx:    TrpcAuditCtx,
): Promise<typeof importSessions.$inferSelect> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const orgId = ctx.organizationId;
  if (!orgId) throw new TRPCError({ code: "BAD_REQUEST", message: "organizationId obrigatório." });

  const parserType = detectParserType(params.sourceMimeType, params.sourceFileName) ?? "auto";

  const [inserted] = await db.insert(importSessions).values({
    organizationId:  orgId,
    uploadedBy:      ctx.user.id,
    sourceFileId:    params.sourceFileId,
    sourceFileName:  params.sourceFileName,
    sourceMimeType:  params.sourceMimeType,
    sourceSize:      params.sourceSize,
    importType:      params.importType,
    parserType,
    parserVersion:   "1.0.0",
    status:          "uploaded",
    progress:        0,
    retryCount:      0,
    correlationId:   params.correlationId ?? ctx.correlationId ?? null,
    processId:       params.processId     ?? null,
    importPurpose:   params.importPurpose ?? null,
    checksum:        params.checksum      ?? null,
  }).$returningId();

  await logActivity({
    organizationId: orgId,
    userId:         ctx.user.id,
    actorName:      ctx.user.name   ?? undefined,
    actorEmail:     ctx.user.email  ?? undefined,
    actorRole:      ctx.orgMembership?.role ?? undefined,
    sourceContext:  "api",
    action:         "import_session_created",
    entityType:     "import_session",
    entityId:       inserted.id,
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    details:        { fileName: params.sourceFileName, importType: params.importType, parserType },
  });

  log.info("import_session_created", {
    sessionId:  inserted.id,
    importType: params.importType,
    parserType,
    orgId,
  });

  const rows = await db.select().from(importSessions)
    .where(eq(importSessions.id, inserted.id))
    .limit(1);
  return rows[0];
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getImportSession(
  sessionId:      number,
  organizationId: number,
): Promise<typeof importSessions.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(importSessions)
    .where(and(
      eq(importSessions.id,             sessionId),
      eq(importSessions.organizationId, organizationId),
    ))
    .limit(1);

  return rows[0] ?? null;
}

export async function listImportSessions(
  organizationId: number,
  limit = 20,
): Promise<(typeof importSessions.$inferSelect)[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(importSessions)
    .where(eq(importSessions.organizationId, organizationId))
    .limit(limit);
}

/**
 * PR B.2.1 — Dedup por checksum: retorna a sessão NÃO-terminal mais recente do tenant
 * com o mesmo checksum. Sessões `rejected`/`archived` são ignoradas (re-import legítimo).
 * Usado pelo createSession para evitar duplicação de ingestão do mesmo arquivo.
 */
export async function findActiveSessionByChecksum(
  organizationId: number,
  checksum:       string,
): Promise<typeof importSessions.$inferSelect | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(importSessions)
    .where(and(
      eq(importSessions.organizationId, organizationId),
      eq(importSessions.checksum,       checksum),
    ));

  const active = rows.filter(r => r.status !== "rejected" && r.status !== "archived");
  // Mais recente primeiro (id crescente = criação crescente).
  active.sort((a, b) => b.id - a.id);
  return active[0] ?? null;
}

/**
 * PR B.2.1 — Registra que o binário foi persistido no storage (após storagePut na rota
 * de upload). Atualiza tamanho real e checksum verificado server-side; mantém a sessão em
 * `uploaded` (o enqueueProcessing é um passo explícito e replay-safe). Tenant-safe.
 */
export async function attachStoredFile(
  sessionId:      number,
  organizationId: number,
  params:         { sourceSize: number; checksum: string; stage?: string },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  await db.update(importSessions).set({
    sourceSize: params.sourceSize,
    checksum:   params.checksum,
    stage:      params.stage ?? "file_stored",
    progress:   3,
  }).where(and(
    eq(importSessions.id,             sessionId),
    eq(importSessions.organizationId, organizationId),
  ));

  log.info("import_file_stored", { sessionId, organizationId, size: params.sourceSize });
}

// ─── Status transitions ───────────────────────────────────────────────────────

export async function updateSessionStatus(
  sessionId:      number,
  organizationId: number,
  status:         ImportSessionStatus,
  extras?: {
    progress?:          number;
    stage?:             string;
    confidenceScore?:   number;
    extractionSummary?: ExtractionSummary;
    warnings?:          ImportWarning[];
    errors?:            ImportError[];
    failedAt?:          Date;
    finishedAt?:        Date;
    startedAt?:         Date;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  await db.update(importSessions).set({
    status,
    ...(extras?.progress          !== undefined ? { progress:          extras.progress }          : {}),
    ...(extras?.stage             !== undefined ? { stage:             extras.stage }             : {}),
    ...(extras?.confidenceScore   !== undefined ? { confidenceScore:   String(extras.confidenceScore) } : {}),
    ...(extras?.extractionSummary !== undefined ? { extractionSummary: extras.extractionSummary }       : {}),
    ...(extras?.warnings          !== undefined ? { warnings:          extras.warnings }   : {}),
    ...(extras?.errors            !== undefined ? { errors:            extras.errors }     : {}),
    ...(extras?.failedAt          !== undefined ? { failedAt:          extras.failedAt }          : {}),
    ...(extras?.finishedAt        !== undefined ? { finishedAt:        extras.finishedAt }        : {}),
    ...(extras?.startedAt         !== undefined ? { startedAt:         extras.startedAt }         : {}),
  }).where(and(
    eq(importSessions.id,             sessionId),
    eq(importSessions.organizationId, organizationId),
  ));

  log.debug("session_status_updated", { sessionId, status, organizationId });
}

// ─── Ingestion dispatch ────────────────────────────────────────────────────────

export async function startIngestion(
  sessionId:      number,
  organizationId: number,
  buffer:         Buffer,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const session = await getImportSession(sessionId, organizationId);
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

  const validation = validateFile(buffer, session.sourceMimeType, session.sourceFileName);
  if (!validation.valid) {
    await updateSessionStatus(sessionId, organizationId, "failed", {
      errors: [{ code: "UNSUPPORTED_FORMAT", message: validation.reason ?? "Arquivo inválido.", fatal: true }],
      failedAt: new Date(),
    });
    throw new TRPCError({ code: "BAD_REQUEST", message: validation.reason ?? "Arquivo inválido." });
  }

  // Atualiza para queued — a fila de importação pega daqui
  await updateSessionStatus(sessionId, organizationId, "queued", { progress: 5, stage: "queued" });

  log.info("ingestion_dispatched", { sessionId, parserType: session.parserType, orgId: organizationId });
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelImportSession(
  sessionId:      number,
  organizationId: number,
  _ctx:           TrpcAuditCtx,
): Promise<void> {
  const session = await getImportSession(sessionId, organizationId);
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

  if (["approved", "archived"].includes(session.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sessão em estado terminal não pode ser cancelada." });
  }

  await updateSessionStatus(sessionId, organizationId, "archived");
  log.info("import_session_cancelled", { sessionId, orgId: organizationId });
}
