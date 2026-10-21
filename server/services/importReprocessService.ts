/**
 * Reprocessamento SEGURO da extração (Layout v2) — reextrai a MESMA sessão quando nenhuma decisão humana existe.
 *
 * Fluxo (padrão "extrair fora, trocar dentro"):
 *   1. `reserveReextraction` — elegibilidade (domain/importReprocess.ts) + RESERVA atômica por UPDATE condicional
 *      (`stage = reprocessing`, status continua `awaiting_review`, staging antigo intacto). Bloqueia
 *      reprocessamentos simultâneos (dois pedidos: um ganha, o outro recebe CONFLICT).
 *   2. Worker: parse/OCR FORA de transação (importQueueService).
 *   3. `commitReextraction` — UMA transação: lock da sessão (FOR UPDATE) e reconferência da reserva/estado;
 *      ledger de promoção vazio; itens da sessão bloqueados e intocados; nenhum histórico de correção; troca
 *      atômica do staging; versão/linhagem/sumário atualizados; auditoria append-only (activity_logs) na MESMA
 *      transação. Qualquer intervenção humana no meio ⇒ nada muda (rollback) e a reserva é liberada.
 *   4. `releaseReextraction` — falha/abandono: devolve o estágio anterior e audita; o staging antigo permanece.
 * Nunca cria sessão, pesquisa, promoção, cotação ou Item Inteligente. Tudo escopado por organizationId.
 */
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { activityLogs, importItemCorrections, importPromotions, importSessions, importStagingItems } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { logActivity } from "./activityLogService";
import { replaceUntouchedStagingTx, StagingAlreadyReviewedError } from "./importStagingService";
import { isDocumentImportType } from "../domain/documentProjection";
import {
  assessProvenanceRevalidation, assessReprocessEligibility, REEXTRACTION_LEASE_MS, REEXTRACTION_STAGE,
  type ProvenanceRevalidationBlocker, type ReextractionRecord, type ReprocessEligibility,
} from "../domain/importReprocess";
import {
  assessProvenanceScan, documentFictitiousDeclaration, hasFileCoverageGap, mergeRevalidatedDeclarationWarnings, mostRestrictiveDeclaration,
  type ProvenanceRevalidationRecord, type ProvenanceScanEvidence,
} from "../domain/quoteProvenance";
import type { ExtractionSummary, ImportWarning } from "../domain/importTypes";
import type { RawExtractedItem } from "../domain/importExtraction";
import type { ExtractionLineage } from "../domain/extractionLineage";

const log = serviceLogger("ImportReprocessService");

type Session = typeof importSessions.$inferSelect;

/** Reextração/revalidação abortada no commit porque o estado mudou (outra ação ganhou) — nada foi alterado. */
export class ReextractionAbortedError extends Error {
  constructor(readonly code: "SESSION_STATE_CHANGED" | "PROMOTED" | "CORRECTION_HISTORY" | ProvenanceRevalidationBlocker, message: string) {
    super(message);
    this.name = "ReextractionAbortedError";
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });
  return db;
}

/** Linhagem registrada na sessão (versões/fingerprint da extração vigente). */
export function lineageOf(summary: unknown): ExtractionLineage | null {
  return ((summary as { extraction?: ExtractionLineage } | null)?.extraction) ?? null;
}

/** Elegibilidade da sessão (tenant-scoped). Sessão de outro tenant ⇒ null (não vaza existência). */
export async function getReprocessEligibility(sessionId: number, organizationId: number, now = new Date()): Promise<(ReprocessEligibility & { stagedCount: number }) | null> {
  const db = await getDb();
  if (!db) return null;
  const [session] = await db.select().from(importSessions)
    .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, organizationId))).limit(1);
  if (!session) return null;
  return eligibilityFor(session, now);
}

async function eligibilityFor(session: Session, now: Date): Promise<ReprocessEligibility & { stagedCount: number }> {
  const db = await requireDb();
  const org = session.organizationId;
  const items = await db.select({ reviewStatus: importStagingItems.reviewStatus, correctionRevision: importStagingItems.correctionRevision })
    .from(importStagingItems)
    .where(and(eq(importStagingItems.importSessionId, session.id), eq(importStagingItems.organizationId, org)));
  const [{ corrections }] = await db.select({ corrections: sql<number>`COUNT(*)` }).from(importItemCorrections)
    .where(and(eq(importItemCorrections.importSessionId, session.id), eq(importItemCorrections.organizationId, org)));
  const ledger = await db.select({ id: importPromotions.id }).from(importPromotions)
    .where(and(eq(importPromotions.importSessionId, session.id), eq(importPromotions.organizationId, org))).limit(1);
  const count = (s: string) => items.filter((i) => i.reviewStatus === s).length;
  const eligibility = assessReprocessEligibility({
    status: session.status, isDocumentImport: isDocumentImportType(session.importType),
    promotionStatus: session.promotionStatus ?? "none", hasPromotionLedger: ledger.length > 0,
    stage: session.stage ?? null, updatedAt: session.updatedAt ?? null, now,
    staging: {
      total: items.length, pending: count("pending"), approved: count("approved"), rejected: count("rejected"), skipped: count("skipped"),
      corrected: items.filter((i) => (i.correctionRevision ?? 0) > 0).length,
    },
    correctionHistory: Number(corrections ?? 0),
  });
  return { ...eligibility, stagedCount: items.length };
}

export interface ReserveParams {
  sessionId:      number;
  organizationId: number;
  actorUserId:    number;
  reason:         string;
  correlationId:  string | null;
  requestId?:     string | null;
}

/**
 * Reserva a reextração (atômica). Lança PRECONDITION_FAILED (inelegível: decisão humana/promoção/estado) ou
 * CONFLICT (reprocessamento já em andamento / corrida perdida). Retorna o estágio anterior (para liberar).
 */
export async function reserveReextraction(p: ReserveParams): Promise<{ previousStage: string | null; stagedCount: number; session: Session }> {
  const db = await requireDb();
  const now = new Date();
  const [session] = await db.select().from(importSessions)
    .where(and(eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId))).limit(1);
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

  const elig = await eligibilityFor(session, now);
  if (!elig.eligible) {
    const inProgress = elig.blockers.includes("REPROCESS_IN_PROGRESS");
    throw new TRPCError({ code: inProgress ? "CONFLICT" : "PRECONDITION_FAILED", message: `REPROCESS_FORBIDDEN: ${elig.message}` });
  }

  // Reserva atômica: o UPDATE condicional é resolvido pelo row-lock do MySQL — só um pedido vence.
  const staleBefore = new Date(now.getTime() - REEXTRACTION_LEASE_MS);
  const result = await db.update(importSessions).set({ stage: REEXTRACTION_STAGE }).where(and(
    eq(importSessions.id, p.sessionId),
    eq(importSessions.organizationId, p.organizationId),
    eq(importSessions.status, "awaiting_review"),
    eq(importSessions.promotionStatus, "none"),
    or(isNull(importSessions.stage), ne(importSessions.stage, REEXTRACTION_STAGE), lt(importSessions.updatedAt, staleBefore)),
  ));
  const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
  if ((header?.affectedRows ?? 0) !== 1) {
    throw new TRPCError({ code: "CONFLICT", message: "REPROCESS_FORBIDDEN: Já existe um reprocessamento em andamento para esta sessão." });
  }

  const lineage = lineageOf(session.extractionSummary);
  await logActivity({
    organizationId: p.organizationId, userId: p.actorUserId, action: "import_reextraction_requested",
    entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? undefined, requestId: p.requestId ?? undefined,
    details: {
      procurementProcessId: session.procurementProcessId ?? null, sourceChecksum: session.checksum ?? null, reason: p.reason,
      previousParserVersion: session.parserVersion, previousLayoutVersion: lineage?.layoutVersion ?? null,
      previousStagedCount: elig.stagedCount, requestedAt: now.toISOString(),
    },
  });
  log.info("import_reextraction_reserved", { sessionId: p.sessionId, organizationId: p.organizationId, correlationId: p.correlationId });
  return { previousStage: session.stage ?? null, stagedCount: elig.stagedCount, session };
}

export interface CommitParams {
  sessionId:       number;
  organizationId:  number;
  actorUserId:     number;
  reason:          string;
  correlationId:   string | null;
  items:           RawExtractedItem[];
  parserVersion:   string;
  outcomeStage:    string;
  warnings:        ImportWarning[];
  summary:         ExtractionSummary;
}

export interface CommitResult { previousStagedCount: number; newStagedCount: number; record: ReextractionRecord }

/**
 * Troca ATÔMICA do staging não revisado + atualização da sessão + auditoria (uma transação). Lança
 * `StagingAlreadyReviewedError` (item revisado/corrigido no meio) ou `ReextractionAbortedError` (estado mudou);
 * em ambos os casos a transação é revertida e NADA muda.
 */
export async function commitReextraction(p: CommitParams): Promise<CommitResult> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(importSessions)
      .where(and(eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId))).for("update");
    if (!session || session.status !== "awaiting_review" || session.stage !== REEXTRACTION_STAGE || (session.promotionStatus ?? "none") !== "none") {
      throw new ReextractionAbortedError("SESSION_STATE_CHANGED", "A sessão mudou de estado durante o reprocessamento; nada foi alterado.");
    }
    const ledger = await tx.select({ id: importPromotions.id }).from(importPromotions)
      .where(and(eq(importPromotions.importSessionId, p.sessionId), eq(importPromotions.organizationId, p.organizationId))).limit(1);
    if (ledger.length > 0) throw new ReextractionAbortedError("PROMOTED", "A sessão já possui promoção registrada; nada foi alterado.");
    const [{ corrections }] = await tx.select({ corrections: sql<number>`COUNT(*)` }).from(importItemCorrections)
      .where(and(eq(importItemCorrections.importSessionId, p.sessionId), eq(importItemCorrections.organizationId, p.organizationId)));
    if (Number(corrections ?? 0) > 0) throw new ReextractionAbortedError("CORRECTION_HISTORY", "Há correção humana registrada nesta sessão; nada foi alterado.");

    const { ids, replaced } = await replaceUntouchedStagingTx(tx, p.sessionId, p.organizationId, p.items);

    const previous = lineageOf(session.extractionSummary);
    const next = p.summary.extraction ?? null;
    const now = new Date();
    const record: ReextractionRecord = {
      at: now.toISOString(), actorUserId: p.actorUserId, reason: p.reason, correlationId: p.correlationId,
      sourceChecksum: session.checksum ?? null,
      previous: { parserVersion: session.parserVersion ?? null, layoutVersion: previous?.layoutVersion ?? null, fingerprint: previous?.fingerprint ?? null, stagedCount: replaced },
      next:     { parserVersion: p.parserVersion, layoutVersion: next?.layoutVersion ?? null, fingerprint: next?.fingerprint ?? null, stagedCount: ids.length },
    };
    const history = (session.extractionSummary as { reextractions?: ReextractionRecord[] } | null)?.reextractions ?? [];
    await tx.update(importSessions).set({
      parserVersion:     p.parserVersion,
      stage:             p.outcomeStage,
      warnings:          p.warnings,
      // P1-C — o histórico de revalidações de proveniência sobrevive à reextração (a evidência, não: é da nova extração).
      extractionSummary: {
        ...p.summary, reextractions: [...history, record],
        ...((session.extractionSummary as ExtractionSummary | null)?.provenanceRevalidations
          ? { provenanceRevalidations: (session.extractionSummary as ExtractionSummary).provenanceRevalidations } : {}),
      } as unknown as object,
      errors:            [],
      finishedAt:        now,
    }).where(and(eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId)));

    // Auditoria append-only NA MESMA transação (sem conteúdo do documento).
    await tx.insert(activityLogs).values({
      organizationId: p.organizationId, userId: p.actorUserId, action: "import_reextracted", sourceContext: "job",
      entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? null,
      details: JSON.stringify({
        procurementProcessId: session.procurementProcessId ?? null, sessionId: p.sessionId, sourceChecksum: session.checksum ?? null,
        previousParserVersion: record.previous.parserVersion, previousLayoutVersion: record.previous.layoutVersion,
        newParserVersion: record.next.parserVersion, newLayoutVersion: record.next.layoutVersion,
        previousStagedCount: replaced, newStagedCount: ids.length, reason: p.reason, correlationId: p.correlationId,
        timestamp: record.at,
      }),
    });
    return { previousStagedCount: replaced, newStagedCount: ids.length, record };
  });
}

/**
 * Libera a reserva (falha, extração sem item válido, decisão humana concorrente): devolve o estágio anterior só
 * se a reserva ainda for desta sessão, e audita o motivo. O staging antigo permanece intacto.
 */
export async function releaseReextraction(p: {
  sessionId: number; organizationId: number; previousStage: string | null; actorUserId: number;
  correlationId: string | null; code: string; message: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(importSessions).set({ stage: p.previousStage ?? "awaiting_review" }).where(and(
    eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId),
    eq(importSessions.stage, REEXTRACTION_STAGE),
  ));
  await logActivity({
    organizationId: p.organizationId, userId: p.actorUserId, action: "import_reextraction_not_applied", sourceContext: "job",
    entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? undefined,
    details: { code: p.code, message: p.message.slice(0, 300) },
  });
  log.warn("import_reextraction_released", { sessionId: p.sessionId, organizationId: p.organizationId, code: p.code, correlationId: p.correlationId });
}

// ─── M8 (P1-C) — revalidação da análise de proveniência ──────────────────────────────────────────────────────────────

async function provenanceRevalidationFacts(session: Session, hasLedger: boolean, now: Date) {
  return assessProvenanceRevalidation({
    importType: session.importType, status: session.status, promotionStatus: session.promotionStatus ?? "none",
    hasPromotionLedger: hasLedger, stage: session.stage ?? null, updatedAt: session.updatedAt ?? null, now,
    checksum: session.checksum ?? null, scanCurrent: assessProvenanceScan(session.extractionSummary, session.checksum).ok,
    fileCoverageGap: hasFileCoverageGap(session.warnings),
  });
}

/**
 * Elegibilidade da revalidação (tenant-scoped; sessão de outro órgão ⇒ NOT_FOUND). Lança PRECONDITION_FAILED acionável;
 * o enfileiramento fica com o chamador e o COMMIT revalida tudo sob lock.
 */
export async function assertProvenanceRevalidationAllowed(sessionId: number, organizationId: number): Promise<Session> {
  const db = await requireDb();
  const [session] = await db.select().from(importSessions)
    .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, organizationId))).limit(1);
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
  const ledger = await db.select({ id: importPromotions.id }).from(importPromotions)
    .where(and(eq(importPromotions.importSessionId, sessionId), eq(importPromotions.organizationId, organizationId))).limit(1);
  const elig = await provenanceRevalidationFacts(session, ledger.length > 0, new Date());
  if (!elig.eligible) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `PROVENANCE_REVALIDATION_FORBIDDEN: ${elig.message}` });
  return session;
}

/**
 * Grava a evidência da revalidação + avisos de declaração do documento (UMA transação, lock da sessão FOR UPDATE).
 * Reconfere sob lock: mesma sessão/órgão, ainda revisável e não promovida, sem reextração em andamento, MESMO arquivo e
 * evidência ainda não vigente. Staging, correções e decisões humanas não são tocados. Estado mudou ⇒ nada muda.
 */
export async function commitProvenanceRevalidation(p: {
  sessionId: number; organizationId: number; actorUserId: number; correlationId: string | null;
  scan: ProvenanceScanEvidence; warnings: ImportWarning[];
}): Promise<ProvenanceRevalidationRecord> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(importSessions)
      .where(and(eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId))).for("update");
    if (!session) throw new ReextractionAbortedError("SESSION_STATE_CHANGED", "Sessão não encontrada; nada foi alterado.");
    const ledger = await tx.select({ id: importPromotions.id }).from(importPromotions)
      .where(and(eq(importPromotions.importSessionId, p.sessionId), eq(importPromotions.organizationId, p.organizationId))).limit(1);
    const now = new Date();
    const elig = await provenanceRevalidationFacts(session, ledger.length > 0, now);
    if (!elig.eligible) throw new ReextractionAbortedError(elig.blockers[0], `${elig.message} Nada foi alterado.`);
    if ((session.checksum ?? "").toLowerCase() !== p.scan.sourceChecksum) {
      throw new ReextractionAbortedError("SESSION_STATE_CHANGED", "O arquivo da sessão mudou durante a revalidação; nada foi alterado.");
    }
    const summary = (session.extractionSummary ?? {}) as ExtractionSummary;
    // União: a revalidação nunca REMOVE uma declaração já registrada; o veredito é o mais restritivo.
    const warnings = mergeRevalidatedDeclarationWarnings<ImportWarning>(session.warnings, p.warnings);
    const seenAtReview = documentFictitiousDeclaration(session.warnings);
    const declaration = mostRestrictiveDeclaration(p.scan.declaration, documentFictitiousDeclaration(warnings));
    // Declaração NOVA (o revisor não a viu ao aprovar) ⇒ a aprovação da sessão deixa de corresponder: volta à revisão
    // (compare-and-set sob o lock, como na correção supervisionada). Itens, correções e decisões por item permanecem.
    const reopen = session.status === "approved" && declaration !== null && declaration !== seenAtReview;
    const record: ProvenanceRevalidationRecord = {
      at: now.toISOString(), actorUserId: p.actorUserId, correlationId: p.correlationId, sourceChecksum: p.scan.sourceChecksum,
      previousScanVersion: typeof summary.provenanceScan?.version === "number" ? summary.provenanceScan.version : null,
      declaration, approvalReopened: reopen,
    };
    const res = await tx.update(importSessions).set({
      warnings,
      extractionSummary: { ...summary, provenanceScan: { ...p.scan, declaration }, provenanceRevalidations: [...(summary.provenanceRevalidations ?? []), record] } as unknown as object,
      ...(reopen ? { status: "awaiting_review" as const, stage: "awaiting_review", progress: 90 } : {}),
    }).where(and(
      eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, p.organizationId),
      eq(importSessions.status, session.status), eq(importSessions.promotionStatus, "none"),
    ));
    const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number } | undefined;
    if ((header?.affectedRows ?? 0) !== 1) throw new ReextractionAbortedError("SESSION_STATE_CHANGED", "A sessão mudou durante a revalidação; nada foi alterado.");
    await tx.insert(activityLogs).values({
      organizationId: p.organizationId, userId: p.actorUserId, action: "import_provenance_revalidated", sourceContext: "job",
      entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? null,
      details: JSON.stringify({
        procurementProcessId: session.procurementProcessId ?? null, sessionId: p.sessionId, sourceChecksum: p.scan.sourceChecksum,
        scanVersion: p.scan.version, previousScanVersion: record.previousScanVersion, parserType: p.scan.parserType,
        parserVersion: p.scan.parserVersion, declaration, approvalReopened: reopen, correlationId: p.correlationId, timestamp: record.at,
      }),
    });
    return record;
  });
}

/** Revalidação não aplicada (falha/estado mudou): só auditoria — a sessão e a promoção bloqueada permanecem como estavam. */
export async function recordProvenanceRevalidationNotApplied(p: {
  sessionId: number; organizationId: number; actorUserId: number; correlationId: string | null; code: string; message: string;
}): Promise<void> {
  await logActivity({
    organizationId: p.organizationId, userId: p.actorUserId, action: "import_provenance_revalidation_not_applied", sourceContext: "job",
    entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? undefined,
    details: { code: p.code, message: p.message.slice(0, 300) },
  });
  log.warn("import_provenance_revalidation_not_applied", { sessionId: p.sessionId, organizationId: p.organizationId, code: p.code, correlationId: p.correlationId });
}

export { StagingAlreadyReviewedError };
