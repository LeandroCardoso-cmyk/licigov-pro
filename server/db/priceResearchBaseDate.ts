/**
 * Data-base do orçamento estimado (PR #288): derivada da PESQUISA DE PREÇOS que originou os Itens Inteligentes APROVADOS do processo
 * (`intelligent_items.source_research_id` → `price_research.created_at`). Mais recente entre elas; tenant-scoped; somente leitura.
 * Sem pesquisa vinculada a item aprovado ⇒ `null` (a pendência é registrada NA Pesquisa de Preços, nunca no Edital).
 * A data é convertida para o calendário de Brasília (America/Sao_Paulo); `created_at` é guardado em UTC.
 */
import { and, eq, inArray } from "drizzle-orm";
import { intelligentItemsTable, priceResearchTable } from "../../drizzle/schema";
import { getDb } from "./connection";

const SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** `YYYY-MM-DD HH:MM:SS(.fff)` (UTC) → `YYYY-MM-DD` no calendário de Brasília; formato inválido ⇒ null. */
export function brasiliaDateOf(utcDatetime: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(utcDatetime);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(d.getTime()) ? null : SP.format(d);
}

export async function readPriceResearchBaseDate(organizationId: number, processId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const items = await db.select({ researchId: intelligentItemsTable.sourceResearchId }).from(intelligentItemsTable)
    .where(and(eq(intelligentItemsTable.organizationId, organizationId), eq(intelligentItemsTable.processId, processId), eq(intelligentItemsTable.status, "aprovado")));
  const ids = [...new Set(items.map((i) => i.researchId).filter((id) => id && id !== ""))];
  if (ids.length === 0) return null;
  const rows = await db.select({ createdAt: priceResearchTable.createdAt }).from(priceResearchTable)
    .where(and(eq(priceResearchTable.organizationId, organizationId), eq(priceResearchTable.processId, processId), inArray(priceResearchTable.id, ids)));
  const dates = rows.map((r) => brasiliaDateOf(String(r.createdAt))).filter((d): d is string => d !== null).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
