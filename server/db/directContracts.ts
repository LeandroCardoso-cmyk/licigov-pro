import { eq, and, asc, desc, sql } from "drizzle-orm";
import {
  directContractLegalArticles, directContracts, InsertDirectContract,
  directContractDocuments, InsertDirectContractDocument,
  directContractQuotations, InsertDirectContractQuotation,
  platforms, platformChecklists,
  directContractAuditLogs, InsertDirectContractAuditLog,
  directContractChecklistProgress, InsertDirectContractChecklistProgress,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function getLegalArticles(type?: "dispensa" | "inexigibilidade") {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [eq(directContractLegalArticles.isActive, true)];
  if (type) conditions.push(eq(directContractLegalArticles.type, type) as any);
  return await db.select().from(directContractLegalArticles).where(and(...conditions));
}

export async function getLegalArticleById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(directContractLegalArticles).where(eq(directContractLegalArticles.id, id)).limit(1);
  return result[0] || null;
}

export async function createDirectContract(data: InsertDirectContract) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(directContracts).values(data);
  return await getDirectContractById(result[0].insertId);
}

export async function getDirectContractById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ directContract: directContracts, legalArticle: directContractLegalArticles, platform: platforms })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .where(eq(directContracts.id, id))
    .limit(1);
  if (!result[0]) return null;
  return { ...result[0].directContract, legalArticle: result[0].legalArticle, platform: result[0].platform };
}

export async function listDirectContracts(userId: number, filters?: {
  type?: "dispensa" | "inexigibilidade";
  status?: string;
  year?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [eq(directContracts.createdBy, userId)];
  if (filters?.type) conditions.push(eq(directContracts.type, filters.type));
  if (filters?.status) conditions.push(eq(directContracts.status, filters.status as any));
  if (filters?.year) conditions.push(eq(directContracts.year, filters.year));
  const results = await db
    .select({ directContract: directContracts, legalArticle: directContractLegalArticles, platform: platforms })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .where(and(...conditions))
    .orderBy(desc(directContracts.createdAt));
  return results.map((row) => ({ ...row.directContract, legalArticle: row.legalArticle, platform: row.platform }));
}

export async function updateDirectContract(id: number, data: Partial<InsertDirectContract>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(directContracts).set({ ...data, updatedAt: new Date() }).where(eq(directContracts.id, id));
  return await getDirectContractById(id);
}

export async function createDirectContractDocument(data: InsertDirectContractDocument) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(directContractDocuments).values(data);
  const doc = await db.select().from(directContractDocuments).where(eq(directContractDocuments.id, result[0].insertId)).limit(1);
  return doc[0] || null;
}

export async function getDirectContractDocuments(directContractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(directContractDocuments)
    .where(eq(directContractDocuments.directContractId, directContractId))
    .orderBy(desc(directContractDocuments.createdAt));
}

export async function updateDirectContractDocument(id: number, data: Partial<InsertDirectContractDocument>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(directContractDocuments).set({ ...data, updatedAt: new Date() }).where(eq(directContractDocuments.id, id));
  const doc = await db.select().from(directContractDocuments).where(eq(directContractDocuments.id, id)).limit(1);
  return doc[0] || null;
}

export async function createQuotation(data: InsertDirectContractQuotation) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(directContractQuotations).values(data);
  const quotation = await db.select().from(directContractQuotations).where(eq(directContractQuotations.id, result[0].insertId)).limit(1);
  return quotation[0] || null;
}

export async function listQuotations(directContractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(directContractQuotations)
    .where(eq(directContractQuotations.directContractId, directContractId))
    .orderBy(asc(directContractQuotations.value));
}

export async function updateQuotation(id: number, data: Partial<InsertDirectContractQuotation>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(directContractQuotations).set({ ...data, updatedAt: new Date() }).where(eq(directContractQuotations.id, id));
  const quotation = await db.select().from(directContractQuotations).where(eq(directContractQuotations.id, id)).limit(1);
  return quotation[0] || null;
}

export async function listPlatforms() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(platforms).where(eq(platforms.isActive, true)).orderBy(asc(platforms.displayOrder));
}

export async function getPlatformChecklists(platformId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(platformChecklists).where(eq(platformChecklists.platformId, platformId)).orderBy(asc(platformChecklists.stepNumber));
}

export async function createDirectContractAuditLog(log: InsertDirectContractAuditLog) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(directContractAuditLogs).values(log);
  return (result as any)[0]?.insertId ?? result;
}

export async function getDirectContractAuditLogs(directContractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(directContractAuditLogs)
    .where(eq(directContractAuditLogs.directContractId, directContractId))
    .orderBy(desc(directContractAuditLogs.createdAt));
}

export async function getDirectContractAuditLogsByAction(directContractId: number, action: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(directContractAuditLogs)
    .where(and(eq(directContractAuditLogs.directContractId, directContractId), eq(directContractAuditLogs.action, action as any)))
    .orderBy(desc(directContractAuditLogs.createdAt));
}

export async function saveChecklistProgress(progress: InsertDirectContractChecklistProgress) {
  const db = await getDb();
  if (!db) return null;
  const existing = await db
    .select()
    .from(directContractChecklistProgress)
    .where(and(
      eq(directContractChecklistProgress.directContractId, progress.directContractId),
      eq(directContractChecklistProgress.stepNumber, progress.stepNumber)
    ))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(directContractChecklistProgress)
      .set({
        isCompleted: progress.isCompleted,
        completedBy: progress.completedBy,
        completedAt: progress.isCompleted ? new Date() : null,
        notes: progress.notes,
      })
      .where(eq(directContractChecklistProgress.id, existing[0].id));
    return existing[0].id;
  } else {
    const result = await db.insert(directContractChecklistProgress).values({
      ...progress,
      completedAt: progress.isCompleted ? new Date() : undefined,
    });
    return (result as any)[0]?.insertId ?? result;
  }
}

export async function getChecklistProgress(directContractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(directContractChecklistProgress)
    .where(eq(directContractChecklistProgress.directContractId, directContractId))
    .orderBy(asc(directContractChecklistProgress.stepNumber));
}

export async function deleteChecklistProgress(directContractId: number, stepNumber: number) {
  const db = await getDb();
  if (!db) return null;
  await db
    .delete(directContractChecklistProgress)
    .where(and(
      eq(directContractChecklistProgress.directContractId, directContractId),
      eq(directContractChecklistProgress.stepNumber, stepNumber)
    ));
  return true;
}

export async function getDirectContractsOverview() {
  const db = await getDb();
  if (!db) return null;
  const totalResult = await db.select({ count: sql<number>`COUNT(*)` }).from(directContracts);
  const total = totalResult[0]?.count || 0;
  const byTypeResult = await db.select({ type: directContracts.type, count: sql<number>`COUNT(*)` }).from(directContracts).groupBy(directContracts.type);
  const byStatusResult = await db.select({ status: directContracts.status, count: sql<number>`COUNT(*)` }).from(directContracts).groupBy(directContracts.status);
  const valueResult = await db.select({ total: sql<number>`SUM(value)` }).from(directContracts);
  const totalValue = valueResult[0]?.total || 0;
  const avgTimeResult = await db.select({ avgDays: sql<number>`AVG(DATEDIFF(updatedAt, createdAt))` }).from(directContracts).where(eq(directContracts.status, "completed"));
  const avgCompletionTime = avgTimeResult[0]?.avgDays || 0;
  const approvedResult = await db.select({ count: sql<number>`COUNT(*)` }).from(directContracts).where(eq(directContracts.status, "approved"));
  const approvedCount = approvedResult[0]?.count || 0;
  const approvalRate = total > 0 ? (approvedCount / total) * 100 : 0;
  return { total, byType: byTypeResult, byStatus: byStatusResult, totalValue, avgCompletionTime: Math.round(avgCompletionTime), approvalRate: Math.round(approvalRate * 10) / 10 };
}

export async function getDirectContractsChartData() {
  const db = await getDb();
  if (!db) return null;
  const monthlyResult = await db
    .select({ month: sql<string>`DATE_FORMAT(createdAt, '%Y-%m')`, type: directContracts.type, count: sql<number>`COUNT(*)`, totalValue: sql<number>`SUM(value)` })
    .from(directContracts)
    .where(sql`createdAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)`)
    .groupBy(sql`DATE_FORMAT(createdAt, '%Y-%m')`, directContracts.type)
    .orderBy(sql`DATE_FORMAT(createdAt, '%Y-%m')`);
  const byPlatformResult = await db
    .select({ platformId: directContracts.platformId, platformName: platforms.name, count: sql<number>`COUNT(*)`, totalValue: sql<number>`SUM(${directContracts.value})` })
    .from(directContracts)
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .groupBy(directContracts.platformId, platforms.name);
  const byStatusResult = await db
    .select({ status: directContracts.status, count: sql<number>`COUNT(*)` })
    .from(directContracts)
    .groupBy(directContracts.status);
  return { monthly: monthlyResult, byPlatform: byPlatformResult, byStatus: byStatusResult };
}

export async function getTopSuppliers() {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({ supplierName: directContracts.supplierName, supplierCNPJ: directContracts.supplierCNPJ, count: sql<number>`COUNT(*)`, totalValue: sql<number>`SUM(value)` })
    .from(directContracts)
    .where(sql`supplierName IS NOT NULL AND supplierName != ''`)
    .groupBy(directContracts.supplierName, directContracts.supplierCNPJ)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);
}

export async function getTopLegalArticles() {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({ articleId: directContracts.legalArticleId, articleNumber: directContractLegalArticles.article, articleDescription: directContractLegalArticles.description, count: sql<number>`COUNT(*)` })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .where(sql`${directContracts.legalArticleId} IS NOT NULL`)
    .groupBy(directContracts.legalArticleId, directContractLegalArticles.article, directContractLegalArticles.description)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);
}

export async function getRecentDirectContracts(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(directContracts).orderBy(desc(directContracts.createdAt)).limit(limit);
}
