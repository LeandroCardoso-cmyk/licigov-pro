import { eq, and, desc, ne } from "drizzle-orm";
import { processItems, catmatSuggestions } from "../../drizzle/schema";
import { getDb } from "./connection";

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
