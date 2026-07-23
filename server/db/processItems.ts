import { eq, and, desc, ne } from "drizzle-orm";
import { processItems, catmatSuggestions, processes } from "../../drizzle/schema";
import { getDb } from "./connection";

// ─── RC-SEC-PR-A — Variantes tenant-scoped ──────────────────────────────────
// process_items, catmat_suggestions NÃO possuem organizationId próprio: o
// isolamento é feito validando a entidade-pai (processo) pela organização.
// Cross-tenant e inexistente produzem o MESMO resultado externo (vazio/no-op),
// nunca revelando existência em outra organização.

/** Retorna o processId se, e somente se, o processo pertence à organização. */
async function assertProcessInOrganization(
  processId: number,
  organizationId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: processes.id })
    .from(processes)
    .where(and(eq(processes.id, processId), eq(processes.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0;
}

/** Retorna o processId dono do item, apenas se pertencer à organização. */
async function resolveItemProcessForOrganization(
  itemId: number,
  organizationId: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ processId: processItems.processId })
    .from(processItems)
    .innerJoin(processes, eq(processItems.processId, processes.id))
    .where(and(eq(processItems.id, itemId), eq(processes.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0 ? rows[0].processId : null;
}

export async function getProcessItemsForOrganization(processId: number, organizationId: number) {
  if (!(await assertProcessInOrganization(processId, organizationId))) return [];
  return getProcessItems(processId);
}

export async function saveProcessItemsForOrganization(
  processId: number,
  organizationId: number,
  items: Parameters<typeof saveProcessItems>[1],
): Promise<boolean> {
  if (!(await assertProcessInOrganization(processId, organizationId))) return false;
  await saveProcessItems(processId, items);
  return true;
}

export async function updateProcessItemForOrganization(
  itemId: number,
  organizationId: number,
  data: Partial<typeof processItems.$inferInsert>,
): Promise<boolean> {
  if ((await resolveItemProcessForOrganization(itemId, organizationId)) === null) return false;
  await updateProcessItem(itemId, data);
  return true;
}

export async function deleteProcessItemForOrganization(
  itemId: number,
  organizationId: number,
): Promise<boolean> {
  if ((await resolveItemProcessForOrganization(itemId, organizationId)) === null) return false;
  await deleteProcessItem(itemId);
  return true;
}

export async function createCatmatSuggestionForOrganization(
  data: Parameters<typeof createCatmatSuggestion>[0],
  organizationId: number,
): Promise<number | null> {
  if ((await resolveItemProcessForOrganization(data.processItemId, organizationId)) === null) return null;
  return createCatmatSuggestion(data);
}

export async function getCatmatSuggestionsByItemForOrganization(
  processItemId: number,
  organizationId: number,
) {
  if ((await resolveItemProcessForOrganization(processItemId, organizationId)) === null) return [];
  return getCatmatSuggestionsByItem(processItemId);
}

/** Resolve a sugestão apenas se a cadeia sugestão→item→processo→org for válida. */
export async function getCatmatSuggestionByIdForOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ suggestion: catmatSuggestions })
    .from(catmatSuggestions)
    .innerJoin(processItems, eq(catmatSuggestions.processItemId, processItems.id))
    .innerJoin(processes, eq(processItems.processId, processes.id))
    .where(and(eq(catmatSuggestions.id, id), eq(processes.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0 ? rows[0].suggestion : null;
}

export async function updateCatmatSuggestionForOrganization(
  id: number,
  organizationId: number,
  data: { status: string },
): Promise<boolean> {
  if (!(await getCatmatSuggestionByIdForOrganization(id, organizationId))) return false;
  await updateCatmatSuggestion(id, data);
  return true;
}

export async function rejectOtherSuggestionsForOrganization(
  processItemId: number,
  approvedId: number,
  organizationId: number,
): Promise<boolean> {
  if ((await resolveItemProcessForOrganization(processItemId, organizationId)) === null) return false;
  await rejectOtherSuggestions(processItemId, approvedId);
  return true;
}

export async function saveProcessItems(
  processId: number,
  items: Array<{
    itemType: "material" | "service";
    catmatCode?: string;
    catserCode?: string;
    description: string;
    unit: string;
    groupCode?: string;
    classCode?: string;
    quantity?: number;
    estimatedPrice?: number;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(processItems).where(eq(processItems.processId, processId));
  if (items.length > 0) {
    await db.insert(processItems).values(
      items.map((item) => ({
        processId,
        itemType: item.itemType,
        catmatCode: item.catmatCode ? parseInt(String(item.catmatCode)) : null,
        catserCode: item.catserCode ? parseInt(String(item.catserCode)) : null,
        description: item.description,
        unit: item.unit,
        groupCode: item.groupCode ? parseInt(String(item.groupCode)) : null,
        classCode: item.classCode ? parseInt(String(item.classCode)) : null,
        quantity: item.quantity || null,
        estimatedPrice: item.estimatedPrice || null,
      }))
    );
  }
}

export async function getProcessItems(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(processItems).where(eq(processItems.processId, processId));
}

export async function updateProcessItem(id: number, data: Partial<typeof processItems.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(processItems).set(data).where(eq(processItems.id, id));
}

export async function deleteProcessItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(processItems).where(eq(processItems.id, id));
}

export async function createCatmatSuggestion(data: {
  processItemId: number;
  catmatCode: string;
  description: string;
  confidenceScore: number;
  reasoning: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(catmatSuggestions).values({
    ...data,
    status: (data.status as any) || "pending",
  });
  return result[0].insertId;
}

export async function getCatmatSuggestionsByItem(processItemId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(catmatSuggestions)
    .where(eq(catmatSuggestions.processItemId, processItemId))
    .orderBy(desc(catmatSuggestions.confidenceScore));
}

export async function getCatmatSuggestionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(catmatSuggestions).where(eq(catmatSuggestions.id, id)).limit(1);
  return result[0];
}

export async function updateCatmatSuggestion(id: number, data: { status: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(catmatSuggestions).set({ status: data.status as any }).where(eq(catmatSuggestions.id, id));
}

export async function rejectOtherSuggestions(processItemId: number, approvedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(catmatSuggestions)
    .set({ status: "rejected" as any })
    .where(
      and(
        eq(catmatSuggestions.processItemId, processItemId),
        ne(catmatSuggestions.id, approvedId),
        eq(catmatSuggestions.status, "pending" as any)
      )
    );
}
