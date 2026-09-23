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
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
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
  correctStagingItem,
  type ReviewAction,
} from "../services/importStagingService";
import { isImportTypeCorrectable } from "../domain/importCorrectionFields";
import { promoteApprovedSessionToDomain } from "../services/importPromotionService";
import {
  getDocumentIntake, saveDocumentReview, approveDocumentStaging, rejectDocumentStaging, promoteDocumentToDraft,
  getDocumentReviewHistory,
} from "../services/documentIntakeService";
import { isDocumentImportType } from "../domain/documentProjection";
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
 * parserRegistry (fonte única da verdade): um formato é funcional apenas quando o parser
 * resolvido declara `capabilityStatus: "supported"`. Na B.2.3 CSV/XLS/XLSX/PDF/DOCX são
 * suportados (extração real); OCR de PDF escaneado permanece não suportado (limitação declarada).
 */
const USER_FACING_FORMATS: ReadonlyArray<{
  key: string; label: string; extensions: string[]; mimeTypes: string[];
}> = [
  { key: "csv",  label: "CSV",          extensions: [".csv", ".txt"], mimeTypes: ["text/csv", "application/csv", "text/plain"] },
  { key: "xlsx", label: "Excel (XLSX)", extensions: [".xlsx"],        mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  { key: "xls",  label: "Excel (XLS)",  extensions: [".xls"],         mimeTypes: ["application/vnd.ms-excel"] },
  { key: "pdf",  label: "PDF",          extensions: [".pdf"],         mimeTypes: ["application/pdf"] },
  { key: "docx", label: "Word (DOCX)",  extensions: [".docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
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

/** Hash CANÔNICO do payload estrutural de createSession (chaves ordenadas; tenant sempre do contexto). */
export function createSessionPayloadHash(p: {
  organizationId: number; procurementProcessId: string; importType: string; checksum: string;
  sourceMimeType: string; sourceSize: number; importPurpose: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify([
    "ingestion.createSession/v2", p.organizationId, p.procurementProcessId, p.importType,
    p.checksum.toLowerCase(), p.sourceMimeType, p.sourceSize, p.importPurpose,
  ])).digest("hex");
}

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

const IMPORT_TYPE = z.enum([
  "price_research", "tr_items", "catmat", "generic",
  // P0 piloto — importação DOCUMENTAL (DFD/ETP/TR) no MESMO motor (projeção documental, não linhas).
  "document_dfd", "document_etp", "document_tr",
]);
const DOCUMENT_KIND = z.enum(["dfd", "etp", "tr"]);
/** Documentos só entram por PDF com texto ou DOCX (projeção documental real; sem OCR). */
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
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
    // PR B.2.4 — estado de promoção ao domínio (gate da ação de promoção na UI).
    promotionStatus: s.promotionStatus ?? "none",
    promotionRef:    s.promotionRef ?? null,
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
  createSession: orgRoleProcedure("operator")
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
      if (isDocumentImportType(input.importType) && !DOCUMENT_MIMES.has(input.sourceMimeType)) {
        throw new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Para importar DFD/ETP/TR envie PDF (com texto) ou DOCX." });
      }

      // Autorização por processo (processId + organizationId) é validada no serviço
      // createImportSession — fonte autoritativa, independente do caller.

      // Idempotência (replay-safe) — hardening P0: o payload é o CONJUNTO ESTRUTURAL da sessão (tenant do
      // contexto, processo, tipo, checksum, mime, tamanho, finalidade), não só o checksum. Mesma chave com
      // outro processo/tipo/arquivo ⇒ IDEMPOTENCY_CONFLICT (antes devolvia a sessão de outro processo/tipo).
      const payloadHash = createSessionPayloadHash({
        organizationId: orgId, procurementProcessId: input.procurementProcessId, importType: input.importType,
        checksum: input.checksum, sourceMimeType: input.sourceMimeType, sourceSize: input.sourceSize,
        importPurpose: input.importPurpose ?? null,
      });
      const idem = await checkIdempotency(
        input.idempotencyKey, ctx.user!.id, orgId, "ingestion.createSession", payloadHash,
      );
      if (idem.status === "completed") {
        if (idem.payloadMismatch) {
          throw new TRPCError({ code: "CONFLICT", message: "IDEMPOTENCY_CONFLICT: idempotencyKey já usada com outro arquivo, processo ou tipo." });
        }
        return idem.response as { sessionId: number; uploadPath: string; duplicate: boolean };
      }
      if (idem.status === "processing") {
        throw new TRPCError({ code: "CONFLICT", message: "Requisição idêntica em andamento." });
      }

      try {
        // Dedup por checksum ESCOPADO ao processo canônico (nunca reutiliza entre processos).
        // P0 piloto — e ao MESMO importType (o mesmo arquivo como "TR" não adota a sessão de "Pesquisa").
        const existing = await findActiveSessionByChecksum(orgId, input.checksum, input.procurementProcessId, input.importType);
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
    .input(z.object({
      procurementProcessId: z.string().min(1).max(20),
      // P0 piloto — retomada escopada ao workspace (Pesquisa ≠ DFD ≠ ETP ≠ TR). Opcional por compatibilidade.
      importType: IMPORT_TYPE.optional(),
    }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      const session = await findResumableSessionForProcess(orgId, input.procurementProcessId, input.importType ?? null);
      if (!session) return { session: null, staging: null };
      const summary = await getStagingSummary(session.id, orgId);
      return { session: toSessionStatus(session), staging: summary };
    }),

  /**
   * Enfileira o processamento (parse → staging). Replay-safe/idempotente por status:
   * já em andamento/processado → retorna estado corrente sem re-enfileirar; terminal → conflito.
   * Lê os bytes do storage durável (não recebe binário por tRPC).
   */
  enqueueProcessing: orgRoleProcedure("operator")
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
        // Hardening P0 — valor NATIVO de células numéricas (o que o contrato monetário usa).
        rawTypedValues:     i.rawTypedValues ?? null,
        rawSupplier:        i.rawSupplier ?? null,
        rawBrand:           i.rawBrand ?? null,
        rawModel:           i.rawModel ?? null,
        rawNotes:           i.rawNotes ?? null,
        rawSource:          i.rawSource ?? null,
        sourceLocation:     i.sourceLocation,
        confidenceMetadata: i.confidenceMetadata,
        extractionWarnings: i.extractionWarnings,
        reviewStatus:       i.reviewStatus,
        reviewedBy:         i.reviewedBy,
        reviewedAt:         i.reviewedAt,
        reviewNote:         i.reviewNote,
        // Correção humana (overlay sobre os raw* imutáveis) — o cliente computa o efetivo.
        correctionRevision: i.correctionRevision,
        correctedPayload:   i.correctedPayload,
        correctedAt:        i.correctedAt,
        correctedByUserId:  i.correctedByUserId,
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
  reviewItem: orgRoleProcedure("operator")
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

  /**
   * PR B.2.2 — Correção humana AUDITÁVEL de um item de staging. Valida tenant + processo canônico +
   * sessão + item; valida campos permitidos por importType (rejeita chaves desconhecidas e raw);
   * exige justificativa; concorrência otimista por expectedRevision (CONFLICT acionável); idempotente
   * por idempotencyKey; grava histórico before/after. NÃO aprova o item nem promove ao domínio.
   */
  correctItem: orgRoleProcedure("operator")
    .input(z.object({
      sessionId:            z.number().int().positive(),
      procurementProcessId: z.string().min(1).max(20),
      itemId:               z.number().int().positive(),
      expectedRevision:     z.number().int().nonnegative(),
      corrections:          z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      justification:        z.string().min(1).max(1000),
      idempotencyKey:       z.string().min(8).max(64),
      correlationId:        z.string().max(36).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);

      if (!isImportTypeCorrectable(session.importType)) {
        throw new TRPCError({ code: "FORBIDDEN", message: `Correção não disponível para o tipo "${session.importType}".` });
      }

      const result = await correctStagingItem({
        itemId:               input.itemId,
        organizationId:       orgId,
        importSessionId:      input.sessionId,
        procurementProcessId: session.procurementProcessId ?? input.procurementProcessId,
        importType:           session.importType,
        actorUserId:          ctx.user!.id,
        corrections:          input.corrections,
        justification:        input.justification,
        expectedRevision:     input.expectedRevision,
        idempotencyKey:       input.idempotencyKey,
        correlationId:        ctx.correlationId ?? input.correlationId ?? null,
      });

      await logActivity({
        organizationId: orgId,
        userId:         ctx.user!.id,
        action:         result.idempotent ? "import_item_correction_replayed" : "import_item_corrected",
        entityType:     "import_staging_item",
        entityId:       input.itemId,
        correlationId:  ctx.correlationId,
        requestId:      ctx.requestId,
        // Sem overlay/conteúdo — apenas identificadores seguros.
        details:        { sessionId: input.sessionId, revision: result.revision, idempotent: result.idempotent },
      });

      return { itemId: input.itemId, revision: result.revision, idempotent: result.idempotent };
    }),

  /** Revisão em lote de itens PENDENTES da sessão. Só afeta pendentes (idempotente por natureza). */
  reviewBulk: orgRoleProcedure("operator")
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
  approveSession: orgRoleProcedure("operator")
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

      if (isDocumentImportType(session.importType)) {
        // Documento: a aprovação é do CONTEÚDO revisado (hash), não de linhas — use approveDocument.
        throw new TRPCError({ code: "BAD_REQUEST", message: "Importação de documento: aprove o conteúdo revisado (approveDocument)." });
      }
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

  /**
   * PR B.2.4 — Promoção TRANSACIONAL e supervisionada da sessão APROVADA ao domínio canônico.
   * Precondição = pós-condição de approveSession (status 'approved', zero pendentes). Só `price_research`
   * é promovível por aqui (linhas → pesquisa + Itens Inteligentes). DFD/ETP/TR importados são DOCUMENTOS e
   * seguem o caminho documental governado (approveDocument → promoteDocument a rascunho).
   * Idempotente (uma promoção por sessão) e escopada por tenant + processo. Não faz merge nem decide juridicamente.
   * Exige papel institucional mínimo 'manager' (segregação de deveres: operador revisa; gestor promove ao domínio).
   */
  promoteSession: orgRoleProcedure("manager")
    .input(z.object({
      sessionId:            z.number().int().positive(),
      procurementProcessId: z.string().min(1).max(20),
      idempotencyKey:       z.string().min(8).max(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);

      const session = await getImportSession(input.sessionId, orgId);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
      assertSessionProcess(session, input.procurementProcessId);

      return await promoteApprovedSessionToDomain({
        sessionId:            input.sessionId,
        organizationId:       orgId,
        procurementProcessId: input.procurementProcessId,
        actorUserId:          ctx.user!.id,
        actorName:            ctx.user!.name ?? undefined,
        idempotencyKey:       input.idempotencyKey,
        correlationId:        ctx.correlationId ?? "",
      });
    }),
  // ─── P0 piloto — DOCUMENT INTAKE (DFD/ETP/TR) ─────────────────────────────────────
  // Mesma sessão/upload/storage/checksum/parser; projeção documental revisada por humano e promovida a
  // RASCUNHO governado (nunca oficial). Leitura: tenant; mutações: operator+ (revisar/aprovar/promover a
  // rascunho não é emissão — a emissão oficial segue exigindo manager + SoD).

  /** Staging documental vigente do processo + tipo e o estado do rascunho canônico (sem storageKey). */
  getDocumentIntake: tenantProcedure
    .input(z.object({ procurementProcessId: z.string().min(1).max(20), kind: DOCUMENT_KIND }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return getDocumentIntake({ organizationId: orgId, processId: input.procurementProcessId, kind: input.kind });
    }),

  /**
   * Hardening P0 — histórico APPEND-ONLY da revisão documental (extraído → revisões → aprovação/invalidação →
   * descarte/promoção). `includeContent` devolve cada versão integral (reconstrução completa). Tenant + processo.
   */
  documentReviewHistory: tenantProcedure
    .input(z.object({
      procurementProcessId: z.string().min(1).max(20),
      stagingId:            z.number().int().positive(),
      includeContent:       z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return getDocumentReviewHistory({ organizationId: orgId, processId: input.procurementProcessId, stagingId: input.stagingId, includeContent: input.includeContent });
    }),

  /** Salva a revisão humana (rawContent imutável; concorrência otimista por revision). */
  saveDocumentReview: orgRoleProcedure("operator")
    .input(z.object({
      procurementProcessId: z.string().min(1).max(20),
      stagingId:            z.number().int().positive(),
      expectedRevision:     z.number().int().nonnegative(),
      content:              z.string().min(1).max(1_500_000),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return saveDocumentReview({
        organizationId: orgId, processId: input.procurementProcessId, stagingId: input.stagingId,
        expectedRevision: input.expectedRevision, content: input.content,
        actorUserId: ctx.user!.id, correlationId: ctx.correlationId ?? "",
      });
    }),

  /** Aprovação humana explícita do conteúdo revisado (expectedContentHash = o que o revisor viu). */
  approveDocument: orgRoleProcedure("operator")
    .input(z.object({
      procurementProcessId: z.string().min(1).max(20),
      stagingId:            z.number().int().positive(),
      expectedContentHash:  SHA256,
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return approveDocumentStaging({
        organizationId: orgId, processId: input.procurementProcessId, stagingId: input.stagingId,
        expectedContentHash: input.expectedContentHash, actorUserId: ctx.user!.id, correlationId: ctx.correlationId ?? "",
      });
    }),

  /** Descarta a importação documental (não promovida). */
  rejectDocument: orgRoleProcedure("operator")
    .input(z.object({
      procurementProcessId: z.string().min(1).max(20),
      stagingId:            z.number().int().positive(),
      reason:               z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return rejectDocumentStaging({
        organizationId: orgId, processId: input.procurementProcessId, stagingId: input.stagingId,
        actorUserId: ctx.user!.id, correlationId: ctx.correlationId ?? "", reason: input.reason ?? null,
      });
    }),

  /**
   * Promove o conteúdo APROVADO a rascunho canônico. `create` falha (CONFLICT) se já houver rascunho;
   * `replace` exige confirmação do rascunho atual (hash) + motivo. Idempotente por idempotencyKey.
   */
  promoteDocument: orgRoleProcedure("operator")
    .input(z.object({
      procurementProcessId:     z.string().min(1).max(20),
      stagingId:                z.number().int().positive(),
      mode:                     z.enum(["create", "replace"]),
      expectedDraftContentHash: SHA256.optional(),
      reason:                   z.string().max(1000).optional(),
      idempotencyKey:           z.string().min(8).max(64),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.organizationId!;
      await assertCanonicalIngestionEnabled(orgId);
      return promoteDocumentToDraft({
        organizationId: orgId, processId: input.procurementProcessId, stagingId: input.stagingId,
        mode: input.mode, expectedDraftContentHash: input.expectedDraftContentHash ?? null, reason: input.reason ?? null,
        actorUserId: ctx.user!.id, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId ?? "",
      });
    }),
});
