/**
 * P0 piloto — DOCUMENT INTAKE: DFD / ETP / TR importados como DOCUMENTO, dentro do MESMO Import Engine.
 *
 * "O LiciGov entra no processo no ponto em que a Prefeitura já está." A Secretaria manda o DFD/ETP/TR
 * prontos: o arquivo percorre a MESMA sessão/upload/storage/checksum/parser da ingestão (sem pipeline
 * paralelo); o worker grava a PROJEÇÃO DOCUMENTAL em `import_document_staging` e este serviço governa:
 *
 *   1. revisão humana (overlay `reviewedContent`; `rawContent`/`rawBlocks` IMUTÁVEIS) com concorrência
 *      otimista por `revision`;
 *   2. aprovação explícita do conteúdo revisado (fixa `approvedContentHash`);
 *   3. promoção GOVERNADA a rascunho em `generated_documents` (status `rascunho`, NUNCA oficial) reusando
 *      `applyDraftContentMutationTx` (lock, expectedState, hash, ledger `generated_document_edits`),
 *      idempotência e correlationId. Rascunho existente ⇒ FAIL-CLOSED; substituição só EXPLÍCITA
 *      (confirmação humana + expectedDraftContentHash + motivo), com conteúdo anterior preservado no ledger.
 *
 * Nada de IA na importação. Nada inventado: PDF escaneado não gera projeção (OCR_REQUIRED no worker).
 * Documentos oficiais emitidos (`official_documents`) nunca são tocados. Tenant-scoped; o organizationId
 * vem sempre do contexto autenticado. A chave bruta de storage nunca é exposta.
 */
import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import {
  importDocumentStaging, importSessions, importPromotions, type ImportDocumentStagingRow,
} from "../../drizzle/schema";
import {
  DOCUMENT_PROJECTION_VERSION, MAX_DOCUMENT_CHARS, documentKindForImportType, importTypeForDocumentKind,
  type DocumentImportKind, type DocumentProjection,
} from "../domain/documentProjection";
import { createGeneratedDocument, draftContentHash } from "../domain/generatedDocument";
import {
  applyDraftContentMutationTx, getGeneratedDocumentByKind, getProcess, recordProcessEvent,
} from "../db/procurement";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";
import type { ImportWarning } from "../domain/importTypes";

const log = serviceLogger("DocumentIntakeService");
const PROMOTE_OP = "procurement.document.import_promote";

export type DocumentStagingStatus = "pending_review" | "approved" | "promoted" | "rejected";
export type DocumentPromotionMode = "create" | "replace";

const KIND_LABEL: Record<DocumentImportKind, string> = { dfd: "DFD", etp: "ETP", tr: "TR" };

function affectedRows(result: unknown): number {
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  return header?.affectedRows ?? 0;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — operação recusada (nada salvo)." });
  return db;
}

// ─── Worker: persistência da projeção (imutável) ────────────────────────────────

/**
 * Grava a projeção extraída pelo parser (chamado pelo worker da fila). Idempotente por sessão
 * (UNIQUE(org, sessão)): reprocessar a MESMA sessão não sobrescreve o conteúdo bruto nem a revisão.
 */
export async function persistDocumentStaging(params: {
  session: { id: number; organizationId: number; procurementProcessId: string | null; importType: string; sourceFileName: string; checksum: string | null; correlationId: string | null };
  projection: DocumentProjection;
  parserType: string;
  parserVersion: string;
  warnings: readonly ImportWarning[];
}): Promise<{ stagingId: number; created: boolean }> {
  const { session, projection } = params;
  const kind = documentKindForImportType(session.importType);
  if (!kind) throw new Error(`importType "${session.importType}" não é documental.`);
  if (!session.procurementProcessId) throw new Error("Sessão documental sem processo canônico vinculado.");
  const db = await requireDb();

  const existing = await db.select({ id: importDocumentStaging.id }).from(importDocumentStaging)
    .where(and(eq(importDocumentStaging.organizationId, session.organizationId), eq(importDocumentStaging.importSessionId, session.id)))
    .limit(1);
  if (existing[0]) return { stagingId: existing[0].id, created: false };

  await db.insert(importDocumentStaging).values({
    organizationId: session.organizationId,
    procurementProcessId: session.procurementProcessId,
    importSessionId: session.id,
    documentKind: kind,
    originalFileName: session.sourceFileName.slice(0, 255),
    sourceChecksum: session.checksum ?? "",
    parserType: params.parserType,
    parserVersion: params.parserVersion,
    projectionVersion: projection.contractVersion,
    rawContent: projection.content,
    rawContentHash: projection.contentHash,
    rawBlocks: projection.blocks as unknown as object,
    reviewedContent: null,
    contentHash: projection.contentHash,
    revision: 0,
    status: "pending_review",
    warnings: params.warnings as unknown as object,
    correlationId: session.correlationId,
  }).onDuplicateKeyUpdate({ set: { importSessionId: session.id } }); // corrida: no-op (conteúdo bruto preservado)

  const rows = await db.select({ id: importDocumentStaging.id }).from(importDocumentStaging)
    .where(and(eq(importDocumentStaging.organizationId, session.organizationId), eq(importDocumentStaging.importSessionId, session.id)))
    .limit(1);
  log.info("document_staging_persisted", {
    sessionId: session.id, organizationId: session.organizationId, kind,
    characters: projection.stats.characters, blocks: projection.stats.blocks,
  });
  return { stagingId: rows[0].id, created: true };
}

// ─── Leitura (UI) ────────────────────────────────────────────────────────────────

export interface DocumentIntakeView {
  staging: {
    id: number;
    sessionId: number;
    kind: DocumentImportKind;
    status: DocumentStagingStatus;
    originalFileName: string;
    parser: string;
    projectionVersion: string;
    rawContent: string;
    rawContentHash: string;
    content: string;
    contentHash: string;
    revision: number;
    edited: boolean;
    warnings: Array<{ code: string; message: string }>;
    stats: { blocks: number; headings: number; tables: number; pages: number | null };
    reviewedBy: number | null; reviewedAt: string | null;
    approvedBy: number | null; approvedAt: string | null; approvedContentHash: string | null;
    promotedBy: number | null; promotedAt: string | null; promotionMode: string | null; targetDocumentId: string | null;
  } | null;
  draft: { exists: boolean; contentHash: string | null; origin: "import" | "generated" | "manual" | null; title: string | null };
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function parseJsonArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p as T[] : []; } catch { return []; } }
  return [];
}

function toView(r: ImportDocumentStagingRow): NonNullable<DocumentIntakeView["staging"]> {
  const blocks = parseJsonArr<{ type?: string; page?: number }>(r.rawBlocks);
  const pages = blocks.reduce((m, b) => (typeof b.page === "number" && b.page > m ? b.page : m), 0);
  return {
    id: r.id, sessionId: r.importSessionId, kind: r.documentKind as DocumentImportKind,
    status: r.status as DocumentStagingStatus, originalFileName: r.originalFileName,
    parser: `${r.parserType}@${r.parserVersion}`, projectionVersion: r.projectionVersion,
    rawContent: r.rawContent, rawContentHash: r.rawContentHash,
    content: r.reviewedContent ?? r.rawContent, contentHash: r.contentHash, revision: r.revision,
    edited: r.reviewedContent != null && r.contentHash !== r.rawContentHash,
    warnings: parseJsonArr<{ code?: string; message?: string }>(r.warnings).map((w) => ({ code: String(w.code ?? ""), message: String(w.message ?? "") })),
    stats: {
      blocks: blocks.length,
      headings: blocks.filter((b) => b.type === "heading").length,
      tables: blocks.filter((b) => b.type === "table").length,
      pages: pages > 0 ? pages : null,
    },
    reviewedBy: r.reviewedBy ?? null, reviewedAt: iso(r.reviewedAt),
    approvedBy: r.approvedBy ?? null, approvedAt: iso(r.approvedAt), approvedContentHash: r.approvedContentHash ?? null,
    promotedBy: r.promotedBy ?? null, promotedAt: iso(r.promotedAt), promotionMode: r.promotionMode ?? null,
    targetDocumentId: r.targetDocumentId ?? null,
  };
}

function draftOrigin(sources: readonly string[]): "import" | "generated" | "manual" {
  if (sources.includes("origem:import")) return "import";
  if (sources.some((s) => s === "edicao_manual" || s === "edicao_humana")) return "manual";
  return "generated";
}

/**
 * Staging documental MAIS RECENTE (não rejeitado) do processo + tipo, com o estado do rascunho canônico
 * (para a UI decidir entre "Promover" e "Substituir rascunho"). Tenant-scoped.
 */
export async function getDocumentIntake(params: {
  organizationId: number; processId: string; kind: DocumentImportKind;
}): Promise<DocumentIntakeView> {
  const db = await getDb();
  const draftRow = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  const draft: DocumentIntakeView["draft"] = draftRow && draftRow.content.trim()
    ? { exists: true, contentHash: draftContentHash(draftRow.content), origin: draftOrigin(draftRow.sources), title: draftRow.title }
    : { exists: false, contentHash: null, origin: null, title: null };
  if (!db) return { staging: null, draft };
  const rows = await db.select().from(importDocumentStaging)
    .where(and(
      eq(importDocumentStaging.organizationId, params.organizationId),
      eq(importDocumentStaging.procurementProcessId, params.processId),
      eq(importDocumentStaging.documentKind, params.kind),
    ))
    .orderBy(desc(importDocumentStaging.id))
    .limit(5);
  const current = rows.find((r) => r.status !== "rejected") ?? null;
  return { staging: current ? toView(current) : null, draft };
}

async function loadStagingForUpdate(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof requireDb>>["transaction"]>[0]>[0],
  p: { organizationId: number; processId: string; stagingId: number },
): Promise<ImportDocumentStagingRow> {
  const rows = await tx.select().from(importDocumentStaging)
    .where(and(eq(importDocumentStaging.id, p.stagingId), eq(importDocumentStaging.organizationId, p.organizationId)))
    .for("update").limit(1);
  const row = rows[0];
  // Outro processo do mesmo tenant ⇒ NOT_FOUND (não vaza existência).
  if (!row || row.procurementProcessId !== p.processId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Importação de documento não encontrada para este processo." });
  }
  return row;
}

// ─── Revisão humana ──────────────────────────────────────────────────────────────

/**
 * Salva a revisão humana do conteúdo importado. `rawContent` NÃO muda. Concorrência otimista por
 * `expectedRevision` (CONFLICT se outro revisor salvou antes). Editar após aprovar DESFAZ a aprovação
 * (o que é promovido é sempre exatamente o conteúdo aprovado). Mesmo conteúdo ⇒ no-op.
 */
export async function saveDocumentReview(params: {
  organizationId: number; processId: string; stagingId: number; expectedRevision: number;
  content: string; actorUserId: number; correlationId: string;
}): Promise<{ revision: number; contentHash: string; changed: boolean; status: DocumentStagingStatus }> {
  const content = params.content.replace(/\r\n/g, "\n");
  if (!content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "O conteúdo revisado não pode ficar vazio." });
  if (content.length > MAX_DOCUMENT_CHARS) throw new TRPCError({ code: "BAD_REQUEST", message: "Conteúdo excede o limite permitido." });
  const db = await requireDb();
  const newHash = draftContentHash(content);

  const out = await db.transaction(async (tx) => {
    const row = await loadStagingForUpdate(tx, params);
    if (row.status === "promoted") {
      throw new TRPCError({ code: "CONFLICT", message: "Este documento já foi promovido a rascunho — edite-o no workspace do processo." });
    }
    if (row.status === "rejected") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Importação descartada — envie o arquivo novamente." });
    }
    if (row.revision !== params.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "A revisão mudou desde o carregamento — recarregue antes de salvar." });
    }
    if (newHash === row.contentHash) {
      return { revision: row.revision, contentHash: row.contentHash, changed: false, status: row.status as DocumentStagingStatus, previousHash: row.contentHash, sessionId: row.importSessionId };
    }
    const result = await tx.update(importDocumentStaging).set({
      reviewedContent: content, contentHash: newHash, revision: row.revision + 1,
      status: "pending_review", approvedBy: null, approvedAt: null, approvedContentHash: null,
      reviewedBy: params.actorUserId, reviewedAt: new Date(),
    }).where(and(
      eq(importDocumentStaging.id, row.id), eq(importDocumentStaging.organizationId, params.organizationId),
      eq(importDocumentStaging.revision, params.expectedRevision),
    ));
    if (affectedRows(result) !== 1) {
      throw new TRPCError({ code: "CONFLICT", message: "A revisão mudou desde o carregamento — recarregue antes de salvar." });
    }
    // Aprovação desfeita pela edição ⇒ a sessão volta a aguardar revisão.
    if (row.status === "approved") {
      await tx.update(importSessions).set({ status: "awaiting_review", stage: "awaiting_review" })
        .where(and(eq(importSessions.id, row.importSessionId), eq(importSessions.organizationId, params.organizationId)));
    }
    return { revision: row.revision + 1, contentHash: newHash, changed: true, status: "pending_review" as const, previousHash: row.contentHash, sessionId: row.importSessionId };
  });

  if (out.changed) {
    logActivity({
      organizationId: params.organizationId, userId: params.actorUserId, action: "import_document_reviewed",
      entityType: "import_document_staging", entityId: params.stagingId, correlationId: params.correlationId,
      // Somente hashes/identificadores — nunca o conteúdo.
      details: { sessionId: out.sessionId, revision: out.revision, previousHash: out.previousHash, newHash: out.contentHash },
    }).catch(() => {});
  }
  return { revision: out.revision, contentHash: out.contentHash, changed: out.changed, status: out.status };
}

/**
 * Aprovação HUMANA explícita do conteúdo revisado (`expectedContentHash` = o que o revisor viu).
 * Idempotente para o mesmo hash. Leva a sessão de importação a `approved`.
 */
export async function approveDocumentStaging(params: {
  organizationId: number; processId: string; stagingId: number; expectedContentHash: string;
  actorUserId: number; correlationId: string;
}): Promise<{ status: DocumentStagingStatus; approvedContentHash: string; idempotent: boolean }> {
  const db = await requireDb();
  const out = await db.transaction(async (tx) => {
    const row = await loadStagingForUpdate(tx, params);
    if (row.contentHash !== params.expectedContentHash) {
      throw new TRPCError({ code: "CONFLICT", message: "O conteúdo mudou desde a revisão — recarregue e revise a versão vigente." });
    }
    if ((row.status === "approved" || row.status === "promoted") && row.approvedContentHash === row.contentHash) {
      return { status: row.status as DocumentStagingStatus, approvedContentHash: row.contentHash, idempotent: true, sessionId: row.importSessionId };
    }
    if (row.status !== "pending_review") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Importação não está aguardando revisão." });
    }
    await tx.update(importDocumentStaging).set({
      status: "approved", approvedBy: params.actorUserId, approvedAt: new Date(), approvedContentHash: row.contentHash,
    }).where(and(eq(importDocumentStaging.id, row.id), eq(importDocumentStaging.organizationId, params.organizationId)));
    await tx.update(importSessions).set({ status: "approved", stage: "approved", progress: 100, finishedAt: new Date() })
      .where(and(eq(importSessions.id, row.importSessionId), eq(importSessions.organizationId, params.organizationId)));
    return { status: "approved" as const, approvedContentHash: row.contentHash, idempotent: false, sessionId: row.importSessionId };
  });
  if (!out.idempotent) {
    logActivity({
      organizationId: params.organizationId, userId: params.actorUserId, action: "import_document_approved",
      entityType: "import_document_staging", entityId: params.stagingId, correlationId: params.correlationId,
      details: { sessionId: out.sessionId, contentHash: out.approvedContentHash },
    }).catch(() => {});
  }
  return { status: out.status, approvedContentHash: out.approvedContentHash, idempotent: out.idempotent };
}

/** Descarta a importação (não promovida). O conteúdo bruto permanece para auditoria. */
export async function rejectDocumentStaging(params: {
  organizationId: number; processId: string; stagingId: number; actorUserId: number; correlationId: string; reason?: string | null;
}): Promise<{ status: DocumentStagingStatus; idempotent: boolean }> {
  const db = await requireDb();
  const out = await db.transaction(async (tx) => {
    const row = await loadStagingForUpdate(tx, params);
    if (row.status === "rejected") return { idempotent: true, sessionId: row.importSessionId };
    if (row.status === "promoted") {
      throw new TRPCError({ code: "CONFLICT", message: "Documento já promovido a rascunho — não pode ser descartado aqui." });
    }
    await tx.update(importDocumentStaging).set({ status: "rejected", reviewedBy: params.actorUserId, reviewedAt: new Date() })
      .where(and(eq(importDocumentStaging.id, row.id), eq(importDocumentStaging.organizationId, params.organizationId)));
    await tx.update(importSessions).set({ status: "rejected", stage: "rejected", finishedAt: new Date() })
      .where(and(eq(importSessions.id, row.importSessionId), eq(importSessions.organizationId, params.organizationId)));
    return { idempotent: false, sessionId: row.importSessionId };
  });
  if (!out.idempotent) {
    logActivity({
      organizationId: params.organizationId, userId: params.actorUserId, action: "import_document_rejected",
      entityType: "import_document_staging", entityId: params.stagingId, correlationId: params.correlationId,
      details: { sessionId: out.sessionId, reason: params.reason ? params.reason.slice(0, 200) : null },
    }).catch(() => {});
  }
  return { status: "rejected", idempotent: out.idempotent };
}

// ─── Promoção governada a rascunho ─────────────────────────────────────────────────

export interface DocumentPromotionResult {
  documentId: string;
  kind: DocumentImportKind;
  mode: DocumentPromotionMode;
  contentHash: string;
  created: boolean;
  replaced: boolean;
  replayed: boolean;
}

/** Marcadores de LINEAGE do rascunho importado (sem chave de storage; checksum abreviado). */
export function importLineageMarkers(p: {
  sessionId: number; checksum: string; parserType: string; parserVersion: string; kind: DocumentImportKind; projectionVersion: string;
}): string[] {
  return [
    "origem:import",
    `import:${p.sessionId}`,
    ...(p.checksum ? [`checksum:${p.checksum.slice(0, 12)}`] : []),
    `parser:${p.parserType}@${p.parserVersion}`,
    `kind:${p.kind}`,
    `projection:${p.projectionVersion || DOCUMENT_PROJECTION_VERSION}`,
  ];
}

/**
 * Promove o conteúdo APROVADO a rascunho canônico (`generated_documents`, status `rascunho`).
 *  - `create`: exige AUSÊNCIA de rascunho (existente ⇒ CONFLICT com orientação — fail-closed);
 *  - `replace`: substituição explícita — exige `expectedDraftContentHash` (o rascunho que o humano viu) e
 *    `reason`; conteúdo anterior preservado no ledger (`import_replace`); rascunho mudou ⇒ CONFLICT.
 * Idempotente por `idempotencyKey`; uma promoção por sessão (ledger import_promotions). Nunca emite.
 */
export async function promoteDocumentToDraft(params: {
  organizationId: number; processId: string; stagingId: number;
  mode: DocumentPromotionMode; expectedDraftContentHash?: string | null; reason?: string | null;
  actorUserId: number; idempotencyKey: string; correlationId: string;
}): Promise<DocumentPromotionResult> {
  const reason = (params.reason ?? "").trim();
  if (params.mode === "replace") {
    if (!params.expectedDraftContentHash) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Substituição exige a confirmação do rascunho atual (hash)." });
    }
    if (reason.length < 5) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Informe o motivo da substituição do rascunho (mín. 5 caracteres)." });
    }
  }
  const process = await getProcess(params.processId, params.organizationId);
  if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado." });

  const db = await requireDb();
  // Pré-leitura (fora da tx) só para o payload da idempotência; tudo é revalidado sob lock.
  const pre = await db.select().from(importDocumentStaging)
    .where(and(eq(importDocumentStaging.id, params.stagingId), eq(importDocumentStaging.organizationId, params.organizationId)))
    .limit(1);
  if (!pre[0] || pre[0].procurementProcessId !== params.processId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Importação de documento não encontrada para este processo." });
  }
  const payloadHash = createHash("sha256").update(JSON.stringify({
    op: PROMOTE_OP, o: params.organizationId, p: params.processId, s: params.stagingId,
    h: pre[0].approvedContentHash ?? pre[0].contentHash, m: params.mode, exp: params.expectedDraftContentHash ?? null,
  })).digest("hex");

  const check = await checkIdempotency(params.idempotencyKey, params.actorUserId, params.organizationId, PROMOTE_OP, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com outro conteúdo — promoção recusada." });
    }
    const cached = (typeof check.response === "string" ? JSON.parse(check.response) : check.response) as DocumentPromotionResult;
    return { ...cached, replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Promoção idêntica em processamento — aguarde a conclusão." });
  }

  try {
    let result!: DocumentPromotionResult;
    await db.transaction(async (tx) => {
      const row = await loadStagingForUpdate(tx, params);
      const kind = row.documentKind as DocumentImportKind;
      if (row.status === "promoted") {
        throw new TRPCError({ code: "CONFLICT", message: "Este documento importado já foi promovido a rascunho." });
      }
      if (row.status !== "approved" || !row.approvedContentHash || row.approvedContentHash !== row.contentHash) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Aprove o conteúdo revisado antes de promovê-lo a rascunho." });
      }
      const sessRows = await tx.select().from(importSessions)
        .where(and(eq(importSessions.id, row.importSessionId), eq(importSessions.organizationId, params.organizationId)))
        .for("update").limit(1);
      const session = sessRows[0];
      if (!session || session.importType !== importTypeForDocumentKind(kind)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sessão de importação não encontrada." });
      }
      const ledger = await tx.select({ id: importPromotions.id }).from(importPromotions)
        .where(and(eq(importPromotions.organizationId, params.organizationId), eq(importPromotions.importSessionId, session.id)))
        .limit(1);
      if (ledger[0]) throw new TRPCError({ code: "CONFLICT", message: "Esta importação já foi promovida." });

      // Estado do rascunho canônico (revalidado SOB LOCK pelo primitive).
      const draft = await getGeneratedDocumentByKind(params.processId, params.organizationId, kind);
      const draftHasContent = !!draft && draft.content.trim().length > 0;
      if (params.mode === "create" && draft) {
        throw new TRPCError({
          code: "CONFLICT",
          message: draftHasContent
            ? `Já existe um rascunho de ${KIND_LABEL[kind]} neste processo. Para usar o documento importado, escolha "Substituir rascunho" e confirme.`
            : `Já existe um registro de ${KIND_LABEL[kind]} neste processo — recarregue e use "Substituir rascunho".`,
        });
      }
      if (params.mode === "replace") {
        if (!draft) throw new TRPCError({ code: "CONFLICT", message: "Não há rascunho para substituir — recarregue e use \"Promover a rascunho\"." });
        if (draft.status !== "rascunho") {
          throw new TRPCError({ code: "CONFLICT", message: "O rascunho atual não está em edição (status diferente de rascunho) — substituição recusada." });
        }
      }

      const content = row.reviewedContent ?? row.rawContent;
      const doc = createGeneratedDocument({
        organizationId: params.organizationId, processId: params.processId, kind,
        title: `${KIND_LABEL[kind]} — ${process.object}`,
        content,
        sources: importLineageMarkers({
          sessionId: session.id, checksum: row.sourceChecksum, parserType: row.parserType,
          parserVersion: row.parserVersion, kind, projectionVersion: row.projectionVersion,
        }),
        authorUserId: params.actorUserId, lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });
      const mutation = await applyDraftContentMutationTx(tx, {
        organizationId: params.organizationId, processId: params.processId, kind,
        actorUserId: params.actorUserId, doc,
        operation: params.mode === "replace" ? "import_replace" : "import_promote",
        expectedState: params.mode === "replace"
          ? { type: "present", contentHash: params.expectedDraftContentHash! }
          : { type: "absent" },
        idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
        reason: params.mode === "replace" ? reason.slice(0, 1000) : `Importação ${session.id} (${row.originalFileName.slice(0, 120)})`,
        ledgerOnCreate: true,
      });

      const now = new Date();
      await tx.update(importDocumentStaging).set({
        status: "promoted", promotedBy: params.actorUserId, promotedAt: now,
        promotionMode: params.mode, targetDocumentId: mutation.document.id,
      }).where(and(eq(importDocumentStaging.id, row.id), eq(importDocumentStaging.organizationId, params.organizationId)));
      await tx.update(importSessions).set({
        promotionStatus: "promoted", promotedAt: now, promotedByUserId: params.actorUserId, promotionRef: mutation.document.id,
      }).where(and(eq(importSessions.id, session.id), eq(importSessions.organizationId, params.organizationId)));
      await tx.insert(importPromotions).values({
        organizationId: params.organizationId, procurementProcessId: params.processId, importSessionId: session.id,
        importType: session.importType, targetKind: kind, targetRef: mutation.document.id,
        itemsPromoted: 1, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId.slice(0, 36),
        actorUserId: params.actorUserId,
      });
      await recordProcessEvent({
        organizationId: params.organizationId, processId: params.processId, eventType: "change",
        actor: String(params.actorUserId),
        summary: params.mode === "replace"
          ? `${KIND_LABEL[kind]} importado substituiu o rascunho (motivo registrado).`
          : `${KIND_LABEL[kind]} importado promovido a rascunho (revisão humana).`,
        refId: mutation.document.id, correlationId: params.correlationId,
      }, tx);

      result = {
        documentId: mutation.document.id, kind, mode: params.mode,
        contentHash: draftContentHash(mutation.document.content),
        created: mutation.created, replaced: params.mode === "replace" && mutation.changed, replayed: false,
      };
      await saveIdempotencyResult(params.idempotencyKey, params.actorUserId, params.organizationId, result, tx);
    });

    logActivity({
      organizationId: params.organizationId, userId: params.actorUserId, action: "import_document_promoted",
      entityType: "import_document_staging", entityId: params.stagingId, correlationId: params.correlationId,
      details: { kind: result.kind, mode: result.mode, documentId: result.documentId, contentHash: result.contentHash },
    }).catch(() => {});
    log.info("import_document_promoted", {
      organizationId: params.organizationId, processId: params.processId, kind: result.kind, mode: result.mode, correlationId: params.correlationId,
    });
    return result;
  } catch (err) {
    await failIdempotencyKey(params.idempotencyKey, params.actorUserId, params.organizationId).catch(() => {});
    throw err;
  }
}
