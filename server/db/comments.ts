import { eq, desc } from "drizzle-orm";
import { comments, InsertComment } from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createComment(comment: InsertComment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(comments).values(comment);
}

export async function getCommentsByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(comments)
    .where(eq(comments.documentId, documentId))
    .orderBy(desc(comments.createdAt));
}

export async function updateComment(commentId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(comments).set({ content, updatedAt: new Date() }).where(eq(comments.id, commentId));
}

export async function deleteComment(commentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(comments).where(eq(comments.id, commentId));
}

export async function getCommentById(commentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
