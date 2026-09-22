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
import { computeEffectiveContent, normalizeDecimal } from "../domain/importCorrectionFields";
import { createPriceResearchItem, type PriceResearchSource } from "../domain/priceResearch";
import { parseBRLDetailed, centsToReais, centsToDecimalString } from "../domain/money";
import type { PriceQuote } from "../domain/priceQuoteConsolidation";
import { materializeIntelligentItemsTx, enrichMaterializedItems } from "./itemMaterializationService";
import { recordProcessEvent } from "../db/procurement";
import { logActivity } from "./activityLogService";
import { serviceLogger } from "./observabilityService";

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
  intelligentItems?: { created: number; updated: number; unchanged: number; preserved: number; total: number };
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
  let toEnrich: string[] = [];
  const result = await db.transaction(async (tx): Promise<PromotionResult> => {
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
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhum item aprovado para promover." });
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
      const quantity = toNumber(eff.quantity);
      const price = parseBRLDetailed(eff.unitPrice);
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
      }).onDuplicateKeyUpdate({ set: { value: unitCents !== null ? centsToDecimalString(unitCents) : "0.00", quantity: String(dom.quantity), description: dom.description } });
      quotes.push({
        quoteId: dom.id, researchId, description: dom.description, quantity: dom.quantity, unit: dom.unit,
        supplier: dom.supplier, brand: dom.brand, model: dom.model, source: dom.source, valueCents: unitCents,
      });
    }
    if (quotes.length === 0) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Nenhum item aprovado com descrição para promover." });
    }
    await tx.update(priceResearchTable).set({ itemCount: quotes.length })
      .where(and(eq(priceResearchTable.id, researchId), eq(priceResearchTable.organizationId, org)));

    // 7b) Projeção canônica → Itens Inteligentes (MESMA transação; determinística; sem IA; sem fuzzy).
    const mat = await materializeIntelligentItemsTx(tx, { organizationId: org, processId, researchId, quotes, correlationId });
    intelligentItems = {
      created: mat.created.length, updated: mat.updated.length, unchanged: mat.unchanged.length,
      preserved: mat.preserved.length, total: mat.items.length,
    };
    toEnrich = [...mat.created, ...mat.updated];

    // 8) Projeção do estado de promoção na sessão (não altera status jurídico; permanece 'approved').
    await tx.update(importSessions)
      .set({ promotionStatus: "promoted", promotedAt: new Date(nowIso), promotedByUserId: actorUserId, promotionRef: researchId })
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, org)));

    // 9) Ledger imutável (UNIQUE(org, sessão) impede dupla promoção; UNIQUE(org, chave) dá idempotência).
    await tx.insert(importPromotions).values({
      organizationId: org, procurementProcessId: processId, importSessionId: sessionId,
      importType: session.importType, targetKind: "price_research", targetRef: researchId,
      itemsPromoted: quotes.length, idempotencyKey, correlationId, actorUserId,
    });

    return { sessionId, idempotent: false, targetKind: "price_research", targetRef: researchId, itemsPromoted: quotes.length, intelligentItems };
  });

  // Pós-commit (best-effort, não altera o resultado): enriquecimento degradável + auditoria + timeline.
  if (!result.idempotent) {
    if (toEnrich.length > 0) {
      await enrichMaterializedItems({ organizationId: org, processId: procurementProcessId, itemIds: toEnrich, correlationId })
        .catch((err) => log.warn("item_enrichment_dispatch_failed", { sessionId, organizationId: org, correlationId, error: err instanceof Error ? err.message : String(err) }));
    }
    logActivity({
      organizationId: org, userId: actorUserId, action: "import_session_promoted",
      entityType: "import_session", entityId: sessionId, correlationId,
      details: { targetKind: result.targetKind, targetRef: result.targetRef, itemsPromoted: result.itemsPromoted, intelligentItems: result.intelligentItems },
    }).catch(() => {});
    recordProcessEvent({
      organizationId: org, processId: procurementProcessId, eventType: "change",
      actor: String(actorUserId), summary: `Pesquisa de preços promovida da ingestão: ${result.itemsPromoted} cotação(ões) → ${result.intelligentItems?.total ?? 0} Item(ns) Inteligente(s).`,
      refId: result.targetRef, correlationId,
    }).catch(() => {});
    log.info("import_session_promoted", { sessionId, organizationId: org, targetRef: result.targetRef, itemsPromoted: result.itemsPromoted, correlationId });
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Id determinístico do research por sessão (replay-safe, isolado por sessão). */
function createResearchId(org: number, sessionId: number): string {
  return createHash("sha256").update(`promo:${org}:${sessionId}`).digest("hex").slice(0, 20);
}
function toNumber(v: string | null): number {
  if (v == null) return 0;
  const n = normalizeDecimal(String(v));
  return n === null ? 0 : Number(n);
}
