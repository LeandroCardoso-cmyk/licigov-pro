import { eq, and, desc, ne } from "drizzle-orm";
import { documentTemplates, InsertDocumentTemplate } from "../../drizzle/schema";
import { getDb } from "./connection";

export async function getTemplatesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(documentTemplates).where(eq(documentTemplates.userId, userId)).orderBy(desc(documentTemplates.createdAt));
}

export async function getTemplateById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documentTemplates).where(eq(documentTemplates.id, id)).limit(1);
  return result[0];
}

export async function createTemplate(template: InsertDocumentTemplate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (template.isDefault === 1) {
    await db
      .update(documentTemplates)
      .set({ isDefault: 0 })
      .where(and(eq(documentTemplates.userId, template.userId), eq(documentTemplates.type, template.type)));
  }
  const result = await db.insert(documentTemplates).values(template);
  return result[0].insertId;
}

export async function updateTemplate(id: number, updates: Partial<InsertDocumentTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (updates.isDefault === 1 && updates.userId && updates.type) {
    await db
      .update(documentTemplates)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(documentTemplates.userId, updates.userId),
          eq(documentTemplates.type, updates.type),
          ne(documentTemplates.id, id)
        )
      );
  }
  await db.update(documentTemplates).set(updates).where(eq(documentTemplates.id, id));
}

export async function deleteTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(documentTemplates).where(eq(documentTemplates.id, id));
}

export async function getDefaultTemplate(userId: number, type: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.userId, userId),
        eq(documentTemplates.type, type as any),
        eq(documentTemplates.isDefault, 1)
      )
    )
    .limit(1);
  return result[0];
}
