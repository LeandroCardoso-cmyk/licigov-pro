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
 *    hoje (DFD/ETP são documentos, não contêineres de linhas — capacidade indisponível, registrada).
 */
import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import {
  importSessions, importStagingItems, importPromotions,
  priceResearchTable, priceResearchItemsTable,
} from "../../drizzle/schema";
import { toDbDatetime } from "../db/institutionalConsultations";
import { computeEffectiveContent, normalizeDecimal } from "../domain/importCorrectionFields";
import { createPriceResearchItem, type PriceResearchSource } from "../domain/priceResearch";
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
}

/**
 * Executa a promoção. Lança TRPCError acionável em pré-condições não satisfeitas; nunca deixa
 * estado parcial (transação). Retorna `idempotent: true` em replay (sessão já promovida).
 */
export async function promoteApprovedSessionToDomain(params: PromoteParams): Promise<PromotionResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco de dados indisponível." });
  const { sessionId, organizationId: org, procurementProcessId, actorUserId, idempotencyKey, correlationId } = params;

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

    // 7) Itens de domínio a partir do conteúdo EFETIVO (raw + overlay de correção).
    for (let i = 0; i < approved.length; i++) {
      const it = approved[i];
      const eff = computeEffectiveContent(it as unknown as Record<string, unknown> & { correctedPayload?: unknown }, "price_research");
      const description = (eff.description ?? it.rawDescription ?? "").toString().trim();
      if (!description) continue; // não fabrica linha sem descrição
      const quantity = toNumber(eff.quantity);
      const unitPrice = toNumber(eff.unitPrice); // price_research_items tem uma única coluna `value` (unitário)
      const dom = createPriceResearchItem({
        researchId, processId, organizationId: org, description,
        quantity, unit: (eff.unit ?? "un").toString() || "un", value: unitPrice,
        // Lineage no próprio item de domínio (sem conteúdo sensível): sessão/item/revisão de correção.
        observations: `origem: ingestão sessão ${sessionId}, item ${it.id}, correção rev ${it.correctionRevision}`,
        source: `import:${session.importType}`, index: i, createdAt: nowIso,
      });
      await tx.insert(priceResearchItemsTable).values({
        id: dom.id, organizationId: org, researchId, processId,
        description: dom.description, quantity: String(dom.quantity), unit: dom.unit,
        supplier: dom.supplier, brand: dom.brand, model: dom.model, value: String(dom.value),
        observations: dom.observations, source: dom.source, createdAt: toDb(dom.createdAt),
      }).onDuplicateKeyUpdate({ set: { value: String(dom.value), quantity: String(dom.quantity), description: dom.description } });
    }

    // 8) Projeção do estado de promoção na sessão (não altera status jurídico; permanece 'approved').
    await tx.update(importSessions)
      .set({ promotionStatus: "promoted", promotedAt: new Date(nowIso), promotedByUserId: actorUserId, promotionRef: researchId })
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.organizationId, org)));

    // 9) Ledger imutável (UNIQUE(org, sessão) impede dupla promoção; UNIQUE(org, chave) dá idempotência).
    await tx.insert(importPromotions).values({
      organizationId: org, procurementProcessId: processId, importSessionId: sessionId,
      importType: session.importType, targetKind: "price_research", targetRef: researchId,
      itemsPromoted: approved.length, idempotencyKey, correlationId, actorUserId,
    });

    return { sessionId, idempotent: false, targetKind: "price_research", targetRef: researchId, itemsPromoted: approved.length };
  });

  // Pós-commit (best-effort, não altera o resultado): auditoria + timeline do processo.
  if (!result.idempotent) {
    logActivity({
      organizationId: org, userId: actorUserId, action: "import_session_promoted",
      entityType: "import_session", entityId: sessionId, correlationId,
      details: { targetKind: result.targetKind, targetRef: result.targetRef, itemsPromoted: result.itemsPromoted },
    }).catch(() => {});
    recordProcessEvent({
      organizationId: org, processId: procurementProcessId, eventType: "change",
      actor: String(actorUserId), summary: `Pesquisa de preços promovida da ingestão (${result.itemsPromoted} itens).`,
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
