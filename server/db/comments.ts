import { eq, and, desc } from "drizzle-orm";
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

// ─── RC-SEC-PR-A — Variantes tenant-scoped de comentários ───────────────────
// `comments` possui organizationId próprio → filtro direto. Cross-tenant e
// inexistente retornam o MESMO resultado externo (undefined/[]/no-op).

export async function getCommentByIdForOrganization(commentId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.organizationId, organizationId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getCommentsByDocumentForOrganization(documentId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(comments)
    .where(and(eq(comments.documentId, documentId), eq(comments.organizationId, organizationId)))
    .orderBy(desc(comments.createdAt));
}

export async function createCommentForOrganization(
  comment: Omit<InsertComment, "organizationId">,
  organizationId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(comments).values({ ...comment, organizationId });
}

export async function updateCommentForOrganization(
  commentId: number,
  organizationId: number,
  content: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .update(comments)
    .set({ content, updatedAt: new Date() })
    .where(and(eq(comments.id, commentId), eq(comments.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}

export async function deleteCommentForOrganization(
  commentId: number,
  organizationId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db
    .delete(comments)
    .where(and(eq(comments.id, commentId), eq(comments.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}
