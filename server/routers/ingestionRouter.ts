/**
 * PR B.2.1 — API canônica de Ingestão (tRPC).
 *
 * Expõe o motor de importação EXISTENTE (fileIngestionService / importStagingService /
 * importQueueService) por uma superfície tenant-safe, SEM conectar interfaces, SEM promover
 * ao domínio e SEM substituir o caminho legado. Toda a superfície é gated por feature flag
 * tenant-aware (fail-closed) e não estende `processes.*` nem `documents.*`.
 *
 * Contratos: createSession · getSessionStatus · enqueueProcessing · listStagingItems ·
 *            reviewItem · reviewBulk · approveSession.
 *
 * O byte-upload NÃO trafega por aqui (proibido base64 no tRPC): é feito pela rota Express
 * server-side `POST /api/ingestion/upload/:sessionId` (ver server/routes/ingestionUploadRoute.ts).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import type { TrpcAuditCtx } from "../services/activityLogService";
import { logActivity } from "../services/activityLogService";
import {
  createImportSession,
  getImportSession,
  findActiveSessionByChecksum,
  findResumableSessionForProcess,
  updateSessionStatus,
} from "../services/fileIngestionService";
import {
  getStagingItems,
  getStagingItem,
  reviewStagingItem,
  bulkReviewStagingItems,
  getStagingSummary,
  type ReviewAction,
} from "../services/importStagingService";
import { enqueueImport } from "../services/importQueueService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "../services/idempotencyService";
import {
  assertCanonicalIngestionEnabled,
  isAllowedMime,
  buildIngestionStorageKey,
  CANONICAL_INGESTION_FLAG,
} from "../services/ingestionUploadService";
import { isFeatureEnabled } from "../services/featureFlagService";
import { parserRegistry } from "../parsers/parserRegistry";
import {
  MAX_FILE_SIZE_BYTES,
  isValidImportTransition,
  type ImportType,
} from "../domain/importTypes";

/**
 * Formatos expostos ao usuário na superfície de ingestão. `supported` é DERIVADO do
 * parserRegistry (fonte única da verdade): um formato é funcional apenas se o parser
 * resolvido NÃO for stub (parserVersion sem sufixo "-stub"). Assim a UI nunca apresenta
 * como funcional um formato cujo parser ainda é stub (PDF/DOCX até a B.2.3).
 */
const USER_FACING_FORMATS: ReadonlyArray<{
  key: string; label: string; extensions: string[]; mimeTypes: string[];
}> = [
  { key: "csv",  label: "CSV",          extensions: [".csv", ".txt"], mimeTypes: ["text/csv", "application/csv", "text/plain"] },
  { key: "xlsx", label: "Excel (XLSX)", extensions: [".xlsx"],        mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  { key: "xls",  label: "Excel (XLS)",  extensions: [".xls"],         mimeTypes: ["application/vnd.ms-excel"] },
  { key: "pdf",  label: "PDF",          extensions: [".pdf"],         mimeTypes: ["application/pdf"] },
  { key: "docx", label: "Word (DOCX)",  extensions: [".docx", ".doc"],mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"] },
];

/** Metadado de capacidade EXPLÍCITO do parser que atende o formato (fonte da verdade). */
function formatCapability(mimeType: string, sampleExt: string): {
  supported: boolean;
  capabilityStatus: "supported" | "stub" | "disabled" | "unknown";
  supportsStructuredExtraction: boolean;
  parserVersion: string | null;
  limitations: string[];
} {
  const parser = parserRegistry.resolve(mimeType, `amostra${sampleExt}`);
  if (!parser) {
    return { supported: false, capabilityStatus: "unknown", supportsStructuredExtraction: false, parserVersion: null, limitations: [] };
  }
  const c = parser.capabilities;
  return {
    supported: c.capabilityStatus === "supported",
    capabilityStatus: c.capabilityStatus,
    supportsStructuredExtraction: c.supportsStructuredExtraction,
    parserVersion: c.parserVersion,
    limitations: c.limitations ?? [],
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Constrói o contexto de auditoria a partir do contexto tRPC autenticado + tenant. */
function toAuditCtx(ctx: TrpcContext & { organizationId: number }): TrpcAuditCtx {
  return {
    organizationId: ctx.organizationId,
    user:           { id: ctx.user!.id, name: ctx.user!.name, email: ctx.user!.email },
    correlationId:  ctx.correlationId,
    requestId:      ctx.requestId,
    orgMembership:  ctx.orgMembership ? { role: ctx.orgMembership.role } : null,
  };
}

const IMPORT_TYPE = z.enum(["price_research", "tr_items", "catmat", "generic"]);
const REVIEW_ACTION = z.enum(["approved", "rejected", "skipped"]);
const SHA256 = z.string().regex(/^[a-fA-F0-9]{64}$/, "checksum sha256 inválido");

/** Serializa a sessão para o cliente, ocultando nada sensível (não há segredos aqui). */
function toSessionStatus(s: NonNullable<Awaited<ReturnType<typeof getImportSession>>>) {
  return {
    id:            s.id,
    status:        s.status,
    stage:         s.stage,
    progress:      s.progress,
    importType:    s.importType,
    importPurpose: s.importPurpose,
    processId:     s.processId,
    procurementProcessId: s.procurementProcessId ?? null,
    parserType:    s.parserType,
    parserVersion: s.parserVersion,
    retryCount:    s.retryCount,
    // correlationId de rastreabilidade (para suporte/observabilidade — não é segredo/PII).
    correlationId: s.correlationId ?? null,
    // Erros/avisos são mensagens controladas internamente (sem PII/segredo); expõe code+message.
    warnings:      Array.isArray(s.warnings) ? s.warnings : [],
    errors:        Array.isArray(s.errors)
      ? (s.errors as Array<{ code?: string; message?: string }>).map(e => ({ code: e.code, message: e.message }))
      : [],
    createdAt:     s.createdAt,
    startedAt:     s.startedAt,
    finishedAt:    s.finishedAt,
    failedAt:      s.failedAt,
    updatedAt:     s.updatedAt,
  };
}

/**
 * PR B.2.2 — Guarda de vínculo com o processo canônico. Uma sessão que pertence a um processo
 * (procurementProcessId != null — todas as sessões canônicas da B.2.2) NÃO pode ser operada no
 * contexto de OUTRO processo do mesmo tenant: exige que o chamador informe o mesmo id. Sessões sem
 * processo (legado/B.2.1) mantêm a validação apenas por tenant. Retorna NOT_FOUND (não vaza existência).
 */
function assertSessionProcess(
  session: { procurementProcessId: string | null },
  procurementProcessId: string | undefined,
): void {
  if (session.procurementProcessId != null && session.procurementProcessId !== procurementProcessId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada para este processo." });
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────────

export const ingestionRouter = router({
  /**
   * Capacidades da ingestão canônica para o tenant. Query read-only usada pelo frontend
   * para GATEAR a superfície (sem flag → interface não exposta) e refletir a capacidade REAL:
   *  - `enabled`: estado da feature flag tenant-aware existente (fail-closed; NÃO cria flag nova);
   *  - `formats`: cada formato com `supported` derivado do parserRegistry (stub ⇒ não funcional).
   * NÃO lança quando desabilitada (diferente das demais): reporta `enabled:false` para a UI ocultar.
   * O backend continua autorizando cada operação individualmente (não confia no frontend).
   */
  getCapabilities: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const enabled = await isFeatureEnabled(CANONICAL_INGESTION_FLAG, orgId);
      const formats = USER_FACING_FORMATS.map(f => {
        const cap = formatCapability(f.mimeTypes[0], f.extensions[0]);
        return {
          key:              f.key,
          label:            f.label,
          extensions:       f.extensions,
          mimeTypes:        f.mimeTypes,
          supported:        cap.supported,
          capabilityStatus: cap.capabilityStatus,
          supportsStructuredExtraction: cap.supportsStructuredExtraction,
          parserVersion:    cap.parserVersion,
          limitations:      cap.limitations,
        };
      });
      return {
        enabled,
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
        formats,
        supportedFormats: formats.filter(f => f.supported),
      };
    }),

  /**
   * Cria uma sessão de ingestão (metadados). NÃO recebe bytes: gera a chave de storage
   * server-side onde o upload subsequente gravará o arquivo. Idempotente por idempotencyKey
   * e deduplicado por checksum (sessão ativa com mesmo checksum é reutilizada).
   */
  createSession: tenantProcedure
    .input(z.object({
      importType:     IMPORT_TYPE,
      sourceFileName: z.string().min(1).max(255),
      sourceMimeType: z.string().min(1).max(100),
      sourceSize:     z.number().int().nonnegative().max(MAX_FILE_SIZE_BYTES),
      checksum:       SHA256,
      idempotencyKey: z.string().min(8).max(64),
      // PR B.2.2 — vínculo OBRIGATÓRIO com o processo canônico (id string). Semanticamente
      // separado do `processId` legado (int), mantido opcional apenas por compatibilidade.
      procurementProcessId: z.string().min(1).max(20),
      processId:      z.number().int().positive().optional(),
      importPurpose:  z.string().min(1).max(50).optional(),
      correlationId:  z.string().max(36).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      if (!isAllowedMime(input.sourceMimeType)) {
        throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Formato não suportado." });
      }

      // Autorização por processo (processId + organizationId) é validada no serviço
      // createImportSession — fonte autoritativa, independente do caller.

      // Idempotência (replay-safe): payloadHash = checksum garante mesmo arquivo sob mesma chave.
      const idem = await checkIdempotency(
        input.idempotencyKey, ctx.user!.id, orgId, "ingestion.createSession", input.checksum,
      );
      if (idem.status === "completed") {
        if (idem.payloadMismatch) {
          throw new TRPCError({ code: "CONFLICT", message: "idempotencyKey já usada com outro arquivo." });
        }
        return idem.response as { sessionId: number; uploadPath: string; duplicate: boolean };
      }
      if (idem.status === "processing") {
        throw new TRPCError({ code: "CONFLICT", message: "Requisição idêntica em andamento." });
      }

      try {
        // Dedup por checksum ESCOPADO ao processo canônico (nunca reutiliza entre processos).
        const existing = await findActiveSessionByChecksum(orgId, input.checksum, input.procurementProcessId);
        if (existing) {
          const dupResult = {
            sessionId:  existing.id,
            uploadPath: `/api/ingestion/upload/${existing.id}`,
            duplicate:  true,
          };
          await saveIdempotencyResult(input.idempotencyKey, ctx.user!.id, orgId, dupResult);
          return dupResult;
        }

        const storageKey = buildIngestionStorageKey(orgId, input.sourceFileName, new Date());

        const session = await createImportSession(
          {
            sourceFileName: input.sourceFileName,
            sourceMimeType: input.sourceMimeType,
            sourceSize:     input.sourceSize,
            sourceFileId:   storageKey,
            importType:     input.importType as ImportType,
            correlationId:  input.correlationId,
            processId:      input.processId ?? null,
            procurementProcessId: input.procurementProcessId,
            importPurpose:  input.importPurpose ?? null,
            checksum:       input.checksum,
          },
          toAuditCtx({ ...ctx, organizationId: orgId }),
        );

        const result = {
          sessionId:  session.id,
          uploadPath: `/api/ingestion/upload/${session.id}`,
          duplicate:  false,
        };
        await saveIdempotencyResult(input.idempotencyKey, ctx.user!.id, orgId, result);
        return result;
      } catch (err) {
        await failIdempotencyKey(input.idempotencyKey, ctx.user!.id, orgId).catch(() => {});
        throw err;
      }
    }),

  /** Estado atual da sessão: status, progresso, parser, warnings, erro sanitizado, timestamps. */
  getSessionStatus: tenantProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      procurementProcessId: z.string().max(20).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);
      const summary = await getStagingSummary(input.sessionId, orgId);
      return { session: toSessionStatus(session), staging: summary };
    }),

  /**
   * PR B.2.2 — Retomada por processo: retorna a sessão RESUMÍVEL (não-terminal) mais recente do
   * processo canônico + tenant, ou null. Usada no reload para retomar SOMENTE a sessão daquele
   * processo. Não lança quando não há sessão (retorna null).
   */
  getActiveSession: tenantProcedure
    .input(z.object({ procurementProcessId: z.string().min(1).max(20) }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      const session = await findResumableSessionForProcess(orgId, input.procurementProcessId);
      if (!session) return { session: null, staging: null };
      const summary = await getStagingSummary(session.id, orgId);
      return { session: toSessionStatus(session), staging: summary };
    }),

  /**
   * Enfileira o processamento (parse → staging). Replay-safe/idempotente por status:
   * já em andamento/processado → retorna estado corrente sem re-enfileirar; terminal → conflito.
   * Lê os bytes do storage durável (não recebe binário por tRPC).
   */
  enqueueProcessing: tenantProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

      // Já em processamento ou processada → idempotente (não re-enfileira).
      if (["queued", "parsing", "extracted", "normalized", "awaiting_review"].includes(session.status)) {
        return { sessionId: session.id, status: session.status, enqueued: false, alreadyInFlight: true };
      }
      // Terminal/revisada → não reprocessa por aqui.
      if (["approved", "archived", "rejected"].includes(session.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Sessão em estado terminal (${session.status}).` });
      }
      // Apenas 'uploaded' (arquivo já armazenado) ou 'failed' (retry) seguem.
      if (session.stage !== "file_stored" && session.status !== "failed") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Arquivo ainda não enviado para esta sessão." });
      }

      // Enfileira por storageKey (o worker recupera os bytes do storage — nunca trafega Buffer aqui).
      const jobId = enqueueImport(session.id, orgId, session.sourceFileId, { correlationId: ctx.correlationId });
      if (jobId === null) {
        // Já em voo neste processo (corrida) — idempotente, não re-enfileira.
        return { sessionId: session.id, status: session.status, enqueued: false, alreadyInFlight: true };
      }
      await updateSessionStatus(session.id, orgId, "queued", { progress: 5, stage: "queued" });

      await logActivity({
        organizationId: orgId,
        userId:         ctx.user!.id,
        action:         "import_enqueued",
        entityType:     "import_session",
        entityId:       session.id,
        correlationId:  ctx.correlationId,
        requestId:      ctx.requestId,
        details:        { jobId },
      });

      return { sessionId: session.id, status: "queued" as const, enqueued: true, jobId };
    }),

  /** Lista itens de staging da sessão (paginado, tenant-safe) com confiança/proveniência/avisos. */
  listStagingItems: tenantProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      procurementProcessId: z.string().max(20).optional(),
      page:      z.number().int().positive().default(1),
      pageSize:  z.number().int().positive().max(200).default(50),
      reviewStatus: z.enum(["pending", "approved", "rejected", "skipped"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);

      const all = await getStagingItems(input.sessionId, orgId);
      const filtered = input.reviewStatus
        ? all.filter(i => i.reviewStatus === input.reviewStatus)
        : all;

      const total = filtered.length;
      const start = (input.page - 1) * input.pageSize;
      const items = filtered.slice(start, start + input.pageSize).map(i => ({
        id:                 i.id,
        rawDescription:     i.rawDescription,
        rawQuantity:        i.rawQuantity,
        rawUnit:            i.rawUnit,
        rawUnitPrice:       i.rawUnitPrice,
        rawTotalPrice:      i.rawTotalPrice,
        sourceLocation:     i.sourceLocation,
        confidenceMetadata: i.confidenceMetadata,
        extractionWarnings: i.extractionWarnings,
        reviewStatus:       i.reviewStatus,
        reviewedBy:         i.reviewedBy,
        reviewedAt:         i.reviewedAt,
        reviewNote:         i.reviewNote,
      }));

      return {
        items,
        page:       input.page,
        pageSize:   input.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
      };
    }),

  /** Revisa um item de staging (aceitar/rejeitar/pular). Idempotente e auditável. */
  reviewItem: tenantProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      procurementProcessId: z.string().max(20).optional(),
      itemId:    z.number().int().positive(),
      action:    REVIEW_ACTION,
      note:      z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      // Vínculo com o processo canônico: valida que a sessão pertence ao processo informado.
      if (input.procurementProcessId != null) {
        const session = await getImportSession(input.sessionId, orgId);
        if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
        assertSessionProcess(session, input.procurementProcessId);
      }

      const item = await getStagingItem(input.itemId, orgId);
      if (!item || item.importSessionId !== input.sessionId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item de staging não encontrado." });
      }

      // Idempotente: reaplicar a MESMA ação é no-op de sucesso.
      if (item.reviewStatus === input.action) {
        return { itemId: item.id, action: input.action, idempotent: true };
      }
      // Já revisado com ação diferente → conflito (não sobrescreve decisão humana).
      if (item.reviewStatus !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `Item já revisado como '${item.reviewStatus}'.` });
      }

      await reviewStagingItem(input.itemId, orgId, ctx.user!.id, input.action as ReviewAction, input.note);

      await logActivity({
        organizationId: orgId,
        userId:         ctx.user!.id,
        action:         "import_item_reviewed",
        entityType:     "import_staging_item",
        entityId:       input.itemId,
        correlationId:  ctx.correlationId,
        requestId:      ctx.requestId,
        details:        { sessionId: input.sessionId, from: "pending", to: input.action, note: input.note ?? null },
      });

      return { itemId: item.id, action: input.action, idempotent: false };
    }),

  /** Revisão em lote de itens PENDENTES da sessão. Só afeta pendentes (idempotente por natureza). */
  reviewBulk: tenantProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      procurementProcessId: z.string().max(20).optional(),
      itemIds:   z.array(z.number().int().positive()).min(1).max(500),
      action:    REVIEW_ACTION,
      note:      z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);

      // Garante que todos os itens pertencem à sessão + tenant (defesa contra IDs cruzados).
      const owned = await getStagingItems(input.sessionId, orgId);
      const ownedIds = new Set(owned.map(i => i.id));
      const invalid = input.itemIds.filter(id => !ownedIds.has(id));
      if (invalid.length > 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Um ou mais itens não pertencem a esta sessão." });
      }

      const affected = await bulkReviewStagingItems(input.itemIds, orgId, ctx.user!.id, input.action as ReviewAction, input.note);

      await logActivity({
        organizationId: orgId,
        userId:         ctx.user!.id,
        action:         "import_items_bulk_reviewed",
        entityType:     "import_session",
        entityId:       input.sessionId,
        correlationId:  ctx.correlationId,
        requestId:      ctx.requestId,
        details:        { action: input.action, requested: input.itemIds.length },
      });

      return { sessionId: input.sessionId, action: input.action, requested: input.itemIds.length, affected };
    }),

  /**
   * Aprova a sessão APÓS revisão humana completa. NÃO promove ao domínio (diferido).
   * Exige status `awaiting_review` e zero itens pendentes (aprovação sem revisão é bloqueada).
   */
  approveSession: tenantProcedure
    .input(z.object({
      sessionId: z.number().int().positive(),
      procurementProcessId: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);

      if (session.status === "approved") {
        return { sessionId: session.id, status: "approved" as const, idempotent: true };
      }
      if (session.status !== "awaiting_review" || !isValidImportTransition(session.status, "approved")) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sessão não está aguardando revisão." });
      }

      const summary = await getStagingSummary(input.sessionId, orgId);
      if (summary.pending > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Revisão incompleta: ${summary.pending} item(ns) pendente(s).`,
        });
      }

      await updateSessionStatus(input.sessionId, orgId, "approved", { progress: 100, stage: "approved", finishedAt: new Date() });

      await logActivity({
        organizationId: orgId,
        userId:         ctx.user!.id,
        action:         "import_session_approved",
        entityType:     "import_session",
        entityId:       input.sessionId,
        correlationId:  ctx.correlationId,
        requestId:      ctx.requestId,
        details:        { approved: summary.approved, rejected: summary.rejected, skipped: summary.skipped },
      });

      return { sessionId: session.id, status: "approved" as const, idempotent: false, summary };
    }),
});
