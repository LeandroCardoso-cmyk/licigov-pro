/**
 * R2 / PR-04A — LEG-014 / FCC-01 — Persistência da importação de Pesquisa de Preços da Contratação Direta.
 *
 * Primitivas TRANSACIONAIS (recebem `tx`) com INSERT ESTRITO (sem ON DUPLICATE KEY UPDATE): uma importação
 * nunca sobrescreve outra — colisão de PK é erro estrutural (ER_DUP_ENTRY), tratado pelo serviço como
 * convergência determinística. Reusa as tabelas oficiais `price_research` / `price_research_items` (sem
 * migration). Os writers legados (`insertResearch`/`insertResearchItem` em server/db/procurement.ts, usados
 * pelo Processo Licitatório) permanecem inalterados.
 */

import { and, asc, eq } from "drizzle-orm";
import {
  directProcurementWorkspacesTable, priceResearchTable, priceResearchItemsTable,
} from "../../drizzle/schema";
import { toDbDatetime, fromDbDatetime } from "./institutionalConsultations";
import type { ProcurementExecutor } from "./procurement";
import type { PriceResearchItem, PriceResearchWorkspace } from "../domain/priceResearch";

const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
const fromDb = (v: string): string => fromDbDatetime(v) ?? v;

/**
 * Bloqueia (FOR UPDATE) o workspace de Contratação Direta DENTRO da transação, escopado a (id, org).
 * Revalida o tenant sob lock e serializa importações concorrentes do mesmo workspace. `false` ⇒ não existe
 * nesta organização (o caller devolve NOT_FOUND neutro).
 */
export async function lockDirectWorkspaceForImport(tx: ProcurementExecutor, workspaceId: string, organizationId: number): Promise<boolean> {
  const rows = await tx.select({ id: directProcurementWorkspacesTable.id }).from(directProcurementWorkspacesTable)
    .where(and(eq(directProcurementWorkspacesTable.id, workspaceId), eq(directProcurementWorkspacesTable.organizationId, organizationId)))
    .for("update").limit(1);
  return rows.length > 0;
}

export interface PersistedDirectPriceImport {
  readonly importId: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly source: string;
  readonly itemCount: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

/** Relê uma importação por (importId, org, workspace) — nunca cruza tenant/workspace. */
export async function findDirectPriceImport(
  executor: ProcurementExecutor, importId: string, organizationId: number, workspaceId: string,
): Promise<PersistedDirectPriceImport | null> {
  const rows = await executor.select().from(priceResearchTable)
    .where(and(
      eq(priceResearchTable.id, importId),
      eq(priceResearchTable.organizationId, organizationId),
      eq(priceResearchTable.processId, workspaceId),
    )).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    importId: r.id, workspaceId: r.processId, organizationId: r.organizationId, source: r.source,
    itemCount: r.itemCount, correlationId: r.correlationId, createdAt: fromDb(r.createdAt),
  };
}

/**
 * R9 / SEM-042 — pesquisas gravadas para o workspace (tenant-scoped), da mais antiga à mais recente. Inclui qualquer
 * linha de `price_research` do workspace: o CHAMADOR só confia numa linha cujo id seja o derivado do contentHash
 * recomputado das cotações (importação governada) — linhas legadas não passam nessa verificação.
 */
export async function listDirectPriceImports(
  executor: ProcurementExecutor, organizationId: number, workspaceId: string,
): Promise<PersistedDirectPriceImport[]> {
  const rows = await executor.select().from(priceResearchTable)
    .where(and(eq(priceResearchTable.organizationId, organizationId), eq(priceResearchTable.processId, workspaceId)))
    .orderBy(asc(priceResearchTable.createdAt), asc(priceResearchTable.id));
  return rows.map((r) => ({
    importId: r.id, workspaceId: r.processId, organizationId: r.organizationId, source: r.source,
    itemCount: r.itemCount, correlationId: r.correlationId, createdAt: fromDb(r.createdAt),
  }));
}

/** Cotações de uma importação (ordem estável por id de inserção/criação), escopadas ao tenant. */
export async function listDirectPriceImportItems(
  executor: ProcurementExecutor, importId: string, organizationId: number,
): Promise<Array<{ id: string; description: string; quantity: string; unit: string; value: string; supplier: string; brand: string; model: string; observations: string; source: string }>> {
  const rows = await executor.select().from(priceResearchItemsTable)
    .where(and(eq(priceResearchItemsTable.researchId, importId), eq(priceResearchItemsTable.organizationId, organizationId)))
    .orderBy(asc(priceResearchItemsTable.id));
  return rows.map((r) => ({
    id: r.id, description: r.description ?? "", quantity: String(r.quantity), unit: r.unit, value: String(r.value),
    supplier: r.supplier, brand: r.brand, model: r.model, observations: r.observations ?? "", source: r.source,
  }));
}

/**
 * INSERT ESTRITO do cabeçalho + TODAS as cotações da importação (na transação do caller). Sem upsert:
 * se a importação já existir, o banco recusa (ER_DUP_ENTRY) — nunca sobrescreve cotações existentes.
 */
export async function insertDirectPriceImportTx(
  tx: ProcurementExecutor, research: PriceResearchWorkspace, items: readonly PriceResearchItem[],
): Promise<void> {
  await tx.insert(priceResearchTable).values({
    id: research.id, organizationId: research.organizationId, processId: research.processId, source: research.source,
    itemCount: research.itemCount, correlationId: research.correlationId.slice(0, 64), createdAt: toDb(research.createdAt),
  });
  if (items.length === 0) return;
  await tx.insert(priceResearchItemsTable).values(items.map((it) => ({
    id: it.id, organizationId: it.organizationId, researchId: it.researchId, processId: it.processId,
    description: it.description, quantity: String(it.quantity), unit: it.unit, supplier: it.supplier,
    brand: it.brand, model: it.model, value: String(it.value), observations: it.observations,
    source: it.source, createdAt: toDb(it.createdAt),
  })));
}
