/**
 * PR B.2.4 — Promoção TRANSACIONAL e SUPERVISIONADA do staging aprovado ao domínio canônico.
 *
 * Regras (não negociáveis):
 *  - Só promove sessão APPROVED, vinculada ao processo canônico correto (tenant + processo validados).
 *  - Conteúdo efetivo = `raw*` IMUTÁVEL + `correctedPayload` (overlay de correção humana).
 *  - TUDO em uma única transação (research + itens + projeção da sessão + ledger). Sem gravação parcial.
 *  - Idempotente e replay-safe: UMA promoção por sessão (lock FOR UPDATE + ledger UNIQUE). Replay retorna
 *    o resultado existente sem duplicar.
 *  - Preserva lineage (org, processo, sessão, item, checksum, parser, revisão de correção, correlationId,
 *    ator, timestamp) no ledger e nas observações do item de domínio. NÃO altera/apaga staging/histórico.
 *  - NÃO marca nada como juridicamente aprovado. NÃO decide juridicamente. Só `price_research` é promovível
 *    por aqui (linhas). DFD/ETP/TR importados são DOCUMENTOS: caminho próprio e governado em
 *    documentIntakeService (projeção documental → revisão → rascunho), no MESMO motor de ingestão.
 *  - P0 piloto: a promoção também MATERIALIZA os Itens Inteligentes (mesma transação, chave lógica
 *    determinística) e dispara o enriquecimento pós-commit (degradável).
 */
import { createHash } from "crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import {
  importSessions, importStagingItems, importPromotions,
  priceResearchTable, priceResearchItemsTable,
} from "../../drizzle/schema";
import { toDbDatetime } from "../db/institutionalConsultations";
import { computeEffectiveContent, resolveEffectiveMoney, resolveEffectiveQuantity } from "../domain/importCorrectionFields";
import { createPriceResearchItem, type PriceResearchSource } from "../domain/priceResearch";
import { centsToReais, centsToDecimalString } from "../domain/money";
import type { PriceQuote } from "../domain/priceQuoteConsolidation";
import {
  materializeIntelligentItemsTx, enrichMaterializedItems, recoverStaleEnrichment, recordMaterializationSignals,
  type MaterializationResult,
} from "./itemMaterializationService";
import { recordProcessEvent } from "../db/procurement";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";
import { assertSessionPromotable, ImportInvariantViolation } from "../domain/importOutcome";

const log = serviceLogger("ImportPromotionService");
const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;

/** importTypes com contrato de promoção a um agregado de domínio REAL. Ausência ⇒ indisponível. */
export const PROMOTABLE_IMPORT_TYPES: Record<string, "price_research"> = {
  price_research: "price_research",
};
export function isPromotableImportType(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROMOTABLE_IMPORT_TYPES, t);
}

function mapParserToSource(parserType: string): PriceResearchSource {
  switch (parserType) {
    case "csv":  return "csv";
    case "xlsx": case "xls": return "xlsx";
    case "pdf":  return "pdf";
    case "docx": return "docx";
    default:     return "manual";
  }
}

export interface PromoteParams {
  sessionId:            number;
  organizationId:       number;
  procurementProcessId: string;
  actorUserId:          number;
  actorName?:           string;
  idempotencyKey:       string;
  correlationId:        string;
}

export interface PromotionResult {
  sessionId:     number;
  idempotent:    boolean;
  targetKind:    "price_research";
  targetRef:     string;   // researchId criado
  itemsPromoted: number;
  /**
   * P0 piloto — projeção canônica em Itens Inteligentes (mesma transação). Ausente em replay de promoções
   * anteriores a esta versão (o ledger não guardava esse detalhe).
   */
  intelligentItems?: {
    created: number; updated: number; unchanged: number; preserved: number; total: number;
    /** Hardening P0 — itens decididos com fonte alterada, legados reconciliados, identidades ambíguas. */
    sourceChanged?: number; reconciled?: number; reviewRequired?: number;
    /** Cotações VÁLIDAS (com preço) que compõem as médias dos itens. */
    validQuotes?: number;
  };
}

/**
 * Executa a promoção. Lança TRPCError acionável em pré-condições não satisfeitas; nunca deixa
 * estado parcial (transação). Retorna `idempotent: true` em replay (sessão já promovida).
 */
export async function promoteApprovedSessionToDomain(params: PromoteParams): Promise<PromotionResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
  const { sessionId, organizationId: org, procurementProcessId, actorUserId, idempotencyKey, correlationId } = params;

  let intelligentItems: PromotionResult["intelligentItems"];
  let materialization: MaterializationResult | null = null;
  let toEnrich: string[] = [];
  let result: PromotionResult;
  try {
  result = await db.transaction(async (tx): Promise<PromotionResult> => {
    // 1) Lock da sessão (serializa promoções concorrentes da mesma sessão).
    const sessRows = await tx.select().from(importSessions)
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, org)))
      .for("update");
    const session = sessRows[0];
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada." });

    // 2) Escopo canônico: processo vinculado deve coincidir (não vaza existência entre processos).
    if (session.procurementProcessId != null && session.procurementProcessId !== procurementProcessId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sessão não encontrada para este processo." });
    }
    const processId = session.procurementProcessId ?? procurementProcessId;

    // 3) Idempotência / dupla promoção: ledger é UNIQUE(org, sessão).
    const existing = await tx.select().from(importPromotions)
      .where(and(eq(importPromotions.organizationId, org), eq(importPromotions.importSessionId, sessionId)))
      .limit(1);
    if (existing[0]) {
      return { sessionId, idempotent: true, targetKind: "price_research", targetRef: existing[0].targetRef ?? "", itemsPromoted: existing[0].itemsPromoted };
    }

    // 4) Pré-condições de estado (re-checadas sob o lock).
    if (session.status !== "approved") {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sessão não está aprovada; promoção não permitida." });
    }
    if (!isPromotableImportType(session.importType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Promoção ao domínio indisponível para o tipo "${session.importType}".` });
    }

    // 4b) O MESMO arquivo (checksum) já promovido para este processo em outra sessão ⇒ CONFLICT. Sem isso,
    //     reimportar a mesma planilha duplicaria cotações (quoteIds novos por sessão) nos Itens Inteligentes.
    if (session.checksum) {
      const dup = await tx.select({ id: importSessions.id }).from(importSessions).where(and(
        eq(importSessions.organizationId, org),
        eq(importSessions.procurementProcessId, processId),
        eq(importSessions.importType, session.importType),
        eq(importSessions.checksum, session.checksum),
        eq(importSessions.promotionStatus, "promoted"),
        ne(importSessions.id, sessionId),
      )).limit(1);
      if (dup[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Este mesmo arquivo já foi promovido para este processo em outra importação; as cotações não serão duplicadas." });
      }
    }

    // 4c) RESERVA COMPARTILHADA (hardening P0): o ledger import_promotions é gravado AGORA, antes de qualquer
    //     efeito, com UNIQUE(org, processo, tipo, checksum). Duas sessões concorrentes do MESMO arquivo: a
    //     segunda bloqueia no índice até a primeira commitar e então recebe ER_DUP_ENTRY → CONFLICT sem
    //     nenhuma mutação (a transação inteira é revertida). A contagem final é atualizada no passo 9.
    await tx.insert(importPromotions).values({
      organizationId: org, procurementProcessId: processId, importSessionId: sessionId,
      importType: session.importType, targetKind: "price_research", targetRef: null,
      itemsPromoted: 0, idempotencyKey, correlationId, actorUserId,
      sourceChecksum: session.checksum ?? null,
    });

    // 5) Itens: nenhum pendente; ao menos um aprovado.
    const [{ pending }] = await tx.select({ pending: sql<number>`SUM(${importStagingItems.reviewStatus} = 'pending')` })
      .from(importStagingItems).where(and(eq(importStagingItems.importSessionId, sessionId), eq(importStagingItems.organizationId, org)));
    if (Number(pending) > 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Há itens pendentes de revisão; promoção não permitida." });
    }
    const approved = await tx.select().from(importStagingItems)
      .where(and(eq(importStagingItems.importSessionId, sessionId), eq(importStagingItems.organizationId, org), eq(importStagingItems.reviewStatus, "approved")))
      .orderBy(importStagingItems.id);
    if (approved.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "NO_VALID_ITEMS_TO_PROMOTE: Nenhum item aprovado para promover." });
    }

    // 6) Research workspace (id determinístico por SESSÃO → replay-safe e isolado por sessão).
    const nowIso = new Date().toISOString();
    const researchId = createResearchId(org, sessionId);
    await tx.insert(priceResearchTable).values({
      id: researchId, organizationId: org, processId, source: mapParserToSource(session.parserType),
      itemCount: approved.length, correlationId, createdAt: toDb(nowIso),
    }).onDuplicateKeyUpdate({ set: { itemCount: approved.length } });

    // 7) Itens de domínio a partir do conteúdo EFETIVO (raw + overlay de correção). Cotação de 1ª classe:
    //    fornecedor/marca/modelo/observação/fonte preservados; valores pelo CONTRATO MONETÁRIO (money.ts).
    const quotes: PriceQuote[] = [];
    for (let i = 0; i < approved.length; i++) {
      const it = approved[i];
      const eff = computeEffectiveContent(it as unknown as Record<string, unknown> & { correctedPayload?: unknown }, "price_research");
      const description = (eff.description ?? it.rawDescription ?? "").toString().trim();
      if (!description) continue; // não fabrica linha sem descrição
      // Contrato monetário TIPADO: correção → canônico; célula numérica nativa → canônico; texto → pt-BR.
      const qty = resolveEffectiveQuantity(it as unknown as Record<string, unknown>);
      const quantity = qty === null ? 0 : Number(qty);
      const price = resolveEffectiveMoney(it as unknown as Record<string, unknown>, "unitPrice");
      if (price.reason === "ambiguous") {
        // Fail-closed: nunca "adivinhar" 1,234 (mil? um vírgula dois?). O revisor corrige no staging.
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Valor unitário ambíguo no item ${it.id} ("${String(eff.unitPrice).slice(0, 30)}"). Corrija o valor no staging antes de promover.` });
      }
      const unitCents = price.cents !== null && price.cents > 0 ? price.cents : null;
      const text = (v: string | null | undefined, max: number): string => (v ?? "").toString().replace(/\s+/g, " ").trim().slice(0, max);
      const supplier = text(eff.supplier, 255);
      const notes = text(eff.notes, 1500);
      const dom = createPriceResearchItem({
        researchId, processId, organizationId: org, description,
        quantity, unit: (eff.unit ?? "un").toString() || "un", value: unitCents !== null ? centsToReais(unitCents) : 0,
        supplier, brand: text(eff.brand, 255), model: text(eff.model, 255),
        // Lineage no próprio item de domínio (sem conteúdo sensível): sessão/item/revisão de correção.
        observations: `${notes ? `${notes} — ` : ""}origem: ingestão sessão ${sessionId}, item ${it.id}, correção rev ${it.correctionRevision}`,
        source: text(eff.source, 200) || `import:${session.importType}`, index: i, createdAt: nowIso,
      });
      await tx.insert(priceResearchItemsTable).values({
        id: dom.id, organizationId: org, researchId, processId,
        description: dom.description, quantity: String(dom.quantity), unit: dom.unit,
        supplier: dom.supplier, brand: dom.brand, model: dom.model,
        value: unitCents !== null ? centsToDecimalString(unitCents) : "0.00",
        observations: dom.observations, source: dom.source, createdAt: toDb(dom.createdAt),
      }).onDuplicateKeyUpdate({ set: {
        value: unitCents !== null ? centsToDecimalString(unitCents) : "0.00", quantity: String(dom.quantity), description: dom.description,
        unit: dom.unit, supplier: dom.supplier, brand: dom.brand, model: dom.model, observations: dom.observations, source: dom.source,
      } });
      quotes.push({
        quoteId: dom.id, researchId, description: dom.description, quantity: dom.quantity, unit: dom.unit,
        supplier: dom.supplier, brand: dom.brand, model: dom.model, source: dom.source, valueCents: unitCents,
      });
    }
    // U2A — invariante de domínio: validItemCount === 0 ⇒ promoção PROIBIDA (a transação inteira é revertida,
    // inclusive a reserva no ledger — nenhuma pesquisa/Item Inteligente vazio é materializado).
    try {
      assertSessionPromotable(quotes.length);
    } catch (err) {
      if (err instanceof ImportInvariantViolation) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `${err.message} (nenhum item aprovado com descrição)` });
      throw err;
    }
    await tx.update(priceResearchTable).set({ itemCount: quotes.length })
      .where(and(eq(priceResearchTable.id, researchId), eq(priceResearchTable.organizationId, org)));

    // 7b) Projeção canônica → Itens Inteligentes (MESMA transação; determinística; sem IA; sem fuzzy).
    const mat = await materializeIntelligentItemsTx(tx, { organizationId: org, processId, researchId, quotes, correlationId });
    intelligentItems = {
      created: mat.created.length, updated: mat.updated.length, unchanged: mat.unchanged.length,
      preserved: mat.preserved.length, total: mat.items.length,
      sourceChanged: mat.sourceChanged.length, reconciled: mat.reconciled.length, reviewRequired: mat.reviewRequired.length,
      validQuotes: mat.items.reduce((a, i) => a + i.quoteCount, 0),
    };
    materialization = mat;
    toEnrich = [...mat.created, ...mat.updated];

    // 8) Projeção do estado de promoção na sessão (não altera status jurídico; permanece 'approved').
    await tx.update(importSessions)
      .set({ promotionStatus: "promoted", promotedAt: new Date(nowIso), promotedByUserId: actorUserId, promotionRef: researchId })
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, org)));

    // 9) Ledger (reservado no passo 4c) recebe o resultado efetivo. Timeline na MESMA transação: o
    //    perdedor de uma corrida não deixa evento.
    await tx.update(importPromotions).set({ targetRef: researchId, itemsPromoted: quotes.length })
      .where(and(eq(importPromotions.organizationId, org), eq(importPromotions.importSessionId, sessionId)));
    await recordProcessEvent({
      organizationId: org, processId, eventType: "change", actor: String(actorUserId),
      summary: `Pesquisa de preços promovida da ingestão: ${quotes.length} cotação(ões) → ${mat.items.length} Item(ns) Inteligente(s).`,
      refId: researchId, correlationId,
    }, tx);

    return { sessionId, idempotent: false, targetKind: "price_research", targetRef: researchId, itemsPromoted: quotes.length, intelligentItems };
  });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Corrida perdida. Mesma sessão → replay do resultado vencedor; outra sessão com o mesmo arquivo → CONFLICT.
    const same = await db.select().from(importPromotions)
      .where(and(eq(importPromotions.organizationId, org), eq(importPromotions.importSessionId, sessionId))).limit(1);
    if (same[0]) {
      return { sessionId, idempotent: true, targetKind: "price_research", targetRef: same[0].targetRef ?? "", itemsPromoted: same[0].itemsPromoted };
    }
    log.info("import_promotion_race_lost", { sessionId, organizationId: org, correlationId });
    throw new TRPCError({ code: "CONFLICT", message: "Este mesmo arquivo já foi promovido para este processo em outra importação; as cotações não serão duplicadas." });
  }

  // Replay: retoma enriquecimento pendente/travado do processo (recuperação durável, replay-safe).
  if (result.idempotent) {
    await recoverStaleEnrichment({ organizationId: org, processId: procurementProcessId, staleMs: 0, correlationId })
      .catch((err) => log.warn("item_enrichment_recovery_failed", { sessionId, organizationId: org, correlationId, error: err instanceof Error ? err.message : String(err) }));
  }

  // Pós-commit (best-effort, não altera o resultado): enriquecimento degradável + auditoria + sinalizações.
  if (!result.idempotent) {
    if (materialization) {
      await recordMaterializationSignals({ organizationId: org, processId: procurementProcessId, result: materialization, actorUserId, correlationId });
    }
    if (toEnrich.length > 0) {
      await enrichMaterializedItems({ organizationId: org, processId: procurementProcessId, itemIds: toEnrich, correlationId })
        .catch((err) => log.warn("item_enrichment_dispatch_failed", { sessionId, organizationId: org, correlationId, error: err instanceof Error ? err.message : String(err) }));
    }
    logActivity({
      organizationId: org, userId: actorUserId, action: "import_session_promoted",
      entityType: "import_session", entityId: sessionId, correlationId,
      details: { targetKind: result.targetKind, targetRef: result.targetRef, itemsPromoted: result.itemsPromoted, intelligentItems: result.intelligentItems },
    }).catch(() => {});
    log.info("import_session_promoted", { sessionId, organizationId: org, targetRef: result.targetRef, itemsPromoted: result.itemsPromoted, correlationId });
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ER_DUP_ENTRY (1062) do MySQL/MariaDB, inclusive encapsulado pelo driver/drizzle. */
function isDuplicateKeyError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; errno?: number; cause?: unknown };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
    e = x.cause;
  }
  return false;
}

/** Id determinístico do research por sessão (replay-safe, isolado por sessão). */
function createResearchId(org: number, sessionId: number): string {
  return createHash("sha256").update(`promo:${org}:${sessionId}`).digest("hex").slice(0, 20);
}
