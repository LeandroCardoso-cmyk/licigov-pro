/**
 * Pesquisa de Preços — revisão por ITEM LÓGICO (projeção de leitura + decisão em lote ATÔMICA).
 *
 * Leitura: `getPriceResearchReview` projeta o staging da sessão em itens lógicos com cotações subordinadas
 * (domain/priceResearchReviewGroups.ts). Nada é persistido; o staging continua sendo uma linha por cotação.
 *
 * Decisão sobre item(ns): `reviewPriceResearchGroups` — UMA transação:
 *   1. lock da sessão (FOR UPDATE; mesma ordem de locks da reextração ⇒ sem deadlock) + tenant/processo/tipo/estado;
 *   2. lock das linhas de staging da sessão (FOR UPDATE) e reprojeção no servidor;
 *   3. pertencimento: o cliente envia apenas `groupKey` + `expectedRevision`; os IDs das cotações afetadas são
 *      derivados AQUI (nunca aceitos do browser) ⇒ injeção de cotação de outro item/sessão/tenant é impossível;
 *   4. revisão otimista por item (membros + status + correção) ⇒ decisão sobre estado velho = CONFLICT;
 *   5. compare-and-set das cotações pendentes (contagem exata; divergência ⇒ rollback);
 *   6. auditoria append-only (activity_logs) NA MESMA transação, com cada cotação afetada (antes/depois).
 * Só cotações PENDENTES são afetadas: decisões humanas anteriores (ex.: uma cotação rejeitada) são preservadas.
 * Não promove, não aprova a sessão, não altera valores extraídos nem regras de preço de referência.
 */
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { activityLogs, importSessions, importStagingItems } from "../../drizzle/schema";
import { serviceLogger } from "./observabilityService";
import { getStagingItems } from "./importStagingService";
import {
  buildPriceResearchReviewProjection, planGroupReview, ReviewGroupKeyCollision,
  type GroupReviewAction, type GroupReviewRequest, type PriceResearchReviewProjection, type ReviewStagingRow,
} from "../domain/priceResearchReviewGroups";

const log = serviceLogger("PriceResearchReviewService");

type StagingRow = typeof importStagingItems.$inferSelect;

/** Máximo de cotações afetadas por decisão em lote (mesmo teto do reviewBulk). */
export const GROUP_REVIEW_MAX_QUOTES = 500;

export interface ReviewContext { organizationId: number; procurementProcessId?: string | null; sessionId: number; correlationId?: string | null }

function project(rows: StagingRow[], ctx: ReviewContext): PriceResearchReviewProjection {
  const started = Date.now();
  try {
    const projection = buildPriceResearchReviewProjection(rows as unknown as ReviewStagingRow[]);
    // Observabilidade: somente contagens/identificadores (nenhum conteúdo documental).
    log.info("price_research_review_grouped", {
      organizationId: ctx.organizationId, processId: ctx.procurementProcessId ?? null, sessionId: ctx.sessionId,
      logicalItemCount: projection.logicalItemCount, quoteCount: projection.quoteCount,
      unassignedQuoteCount: projection.unassignedQuotes.length, ambiguousGroupCount: projection.ambiguousGroupCount,
      warningsCount: projection.groups.reduce((a, g) => a + g.warnings.length, 0),
      durationMs: Date.now() - started, correlationId: ctx.correlationId ?? null,
    });
    return projection;
  } catch (err) {
    if (err instanceof ReviewGroupKeyCollision) {
      log.warn("price_research_review_group_collision", { organizationId: ctx.organizationId, sessionId: ctx.sessionId, correlationId: ctx.correlationId ?? null });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível agrupar as cotações com segurança (colisão de identidade). Revise as cotações individualmente." });
    }
    throw err;
  }
}

/** Projeção item-cêntrica da sessão (tenant-scoped; linhas de outro tenant nunca são lidas). */
export async function getPriceResearchReview(ctx: ReviewContext): Promise<{ projection: PriceResearchReviewProjection; rows: StagingRow[] }> {
  const rows = await getStagingItems(ctx.sessionId, ctx.organizationId);
  return { projection: project(rows, ctx), rows };
}

export interface ReviewGroupsParams extends ReviewContext {
  procurementProcessId: string;
  actorUserId: number;
  action:      GroupReviewAction;
  groups:      GroupReviewRequest[];
  note?:       string | null;
  requestId?:  string | null;
}

export interface ReviewGroupsResult {
  action:        GroupReviewAction;
  affectedQuoteCount: number;
  groups: { groupKey: string; affectedQuoteIds: number[] }[];
  projection:    PriceResearchReviewProjection;
  rows:          StagingRow[];
}

const PLAN_ERRORS: Record<string, { code: "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "BAD_REQUEST"; message: string }> = {
  GROUP_NOT_FOUND:    { code: "NOT_FOUND", message: "Item não encontrado nesta sessão. Atualize a revisão." },
  STALE_REVISION:     { code: "CONFLICT", message: "O item mudou desde a última leitura (outro revisor, correção ou reextração). Atualize a revisão e decida novamente." },
  IDENTITY_AMBIGUOUS: { code: "PRECONDITION_FAILED", message: "A identidade deste item é ambígua no documento; decida as cotações individualmente." },
  DUPLICATE_GROUP:    { code: "BAD_REQUEST", message: "Item informado mais de uma vez." },
};

/** Decisão ATÔMICA sobre um ou mais itens lógicos (todas as cotações pendentes de cada item, ou nada). */
export async function reviewPriceResearchGroups(p: ReviewGroupsParams): Promise<ReviewGroupsResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });
  const org = p.organizationId;

  const outcome = await db.transaction(async (tx) => {
    const [session] = await tx.select().from(importSessions)
      .where(and(eq(importSessions.id, p.sessionId), eq(importSessions.organizationId, org))).for("update");
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });
    if (session.procurementProcessId != null && session.procurementProcessId !== p.procurementProcessId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada para este processo." });
    }
    if (session.importType !== "price_research") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Revisão por item disponível apenas para Pesquisa de Preços." });
    }
    if (session.status !== "awaiting_review") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A sessão não está aguardando revisão." });
    }
    if ((session.promotionStatus ?? "none") !== "none") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A sessão já foi promovida; a revisão está encerrada." });
    }

    const rows = await tx.select().from(importStagingItems)
      .where(and(eq(importStagingItems.importSessionId, p.sessionId), eq(importStagingItems.organizationId, org))).for("update");
    const before = project(rows, p);
    const plan = planGroupReview(before, p.groups);
    if (!plan.ok) {
      const e = PLAN_ERRORS[plan.error.code];
      throw new TRPCError({ code: e.code, message: e.message });
    }
    const ids = plan.entries.flatMap((e) => e.quoteIds);
    if (ids.length > GROUP_REVIEW_MAX_QUOTES) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Decisão afeta ${ids.length} cotações (máximo ${GROUP_REVIEW_MAX_QUOTES}); decida menos itens por vez.` });
    }

    const now = new Date();
    if (ids.length > 0) {
      const result = await tx.update(importStagingItems).set({
        reviewStatus: p.action, reviewedBy: p.actorUserId, reviewedAt: now, reviewNote: p.note ?? null,
      }).where(and(
        inArray(importStagingItems.id, ids),
        eq(importStagingItems.organizationId, org),
        eq(importStagingItems.importSessionId, p.sessionId),
        eq(importStagingItems.reviewStatus, "pending"),
      ));
      const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
      if (typeof header?.affectedRows === "number" && header.affectedRows !== ids.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Cotações do item mudaram durante a decisão; nada foi alterado. Atualize a revisão." });
      }
    }

    // Auditoria append-only NA MESMA transação: usuário, itens, cada cotação afetada (antes → depois), motivo.
    const auditGroups = plan.entries.map((e) => ({
      groupKey: e.group.groupKey,
      revisionBefore: e.group.revision,
      identifiers: e.group.identity.identifiers,
      sourceRowKeys: e.group.identity.sourceRowKeys,
      quoteCount: e.group.quoteCount,
      affectedQuotes: e.quoteIds.map((id) => ({ stagingRowId: id, from: "pending", to: p.action })),
      preservedDecisions: e.group.quotes.filter((q) => q.status !== "pending").map((q) => ({ stagingRowId: q.stagingRowId, status: q.status })),
    }));
    // Replay sem cotações pendentes (nada muda) não gera registro — a auditoria descreve efeitos reais.
    if (ids.length > 0) await tx.insert(activityLogs).values({
      organizationId: org, userId: p.actorUserId, action: "import_item_group_reviewed", sourceContext: "api",
      entityType: "import_session", entityId: p.sessionId, correlationId: p.correlationId ?? null, requestId: p.requestId ?? null,
      details: JSON.stringify({
        procurementProcessId: session.procurementProcessId ?? p.procurementProcessId, sessionId: p.sessionId,
        action: p.action, note: p.note ?? null, affectedQuoteCount: ids.length, groups: auditGroups,
        correlationId: p.correlationId ?? null, timestamp: now.toISOString(),
      }),
    });

    const affected = new Set(ids);
    const after = rows.map((r) => (affected.has(r.id) ? { ...r, reviewStatus: p.action, reviewedBy: p.actorUserId, reviewedAt: now, reviewNote: p.note ?? null } : r));
    return { ids, plan: plan.entries, rows: after };
  });

  log.info("price_research_group_reviewed", {
    organizationId: org, processId: p.procurementProcessId, sessionId: p.sessionId, action: p.action,
    groupCount: outcome.plan.length, affectedQuoteCount: outcome.ids.length, correlationId: p.correlationId ?? null,
  });
  return {
    action: p.action,
    affectedQuoteCount: outcome.ids.length,
    groups: outcome.plan.map((e) => ({ groupKey: e.group.groupKey, affectedQuoteIds: e.quoteIds })),
    projection: project(outcome.rows, p),
    rows: outcome.rows,
  };
}
