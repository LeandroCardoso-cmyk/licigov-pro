/**
 * R6 / PR-14 (SEM-012, INV-16) — KPI de valor da Contratação Direta (legado `direct_contracts`), tenant-scoped.
 *
 * `direct_contracts.value` é o valor ESTIMADO em CENTAVOS. O KPI institucional soma só as contratações que seguem
 * (rascunho e cancelada NÃO entram) e é rotulado como "Valor estimado" — nunca "Valor Total Contratado".
 */
import { and, eq, notInArray, sql } from "drizzle-orm";
import { directContracts } from "../../drizzle/schema";
import { getDb } from "./connection";

export const EXCLUDED_FROM_ESTIMATED_KPI = ["draft", "cancelled"] as const;

export async function getEstimatedActiveValueCents(organizationId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ total: sql<number>`COALESCE(SUM(${directContracts.value}), 0)` }).from(directContracts)
    .where(and(eq(directContracts.organizationId, organizationId), notInArray(directContracts.status, [...EXCLUDED_FROM_ESTIMATED_KPI])));
  return Number(rows[0]?.total ?? 0);
}
