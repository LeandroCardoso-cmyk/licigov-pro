import { eq, and, asc, desc, sql } from "drizzle-orm";
import {
  contracts, InsertContract,
  contractAmendments, InsertContractAmendment,
  contractApostilles, InsertContractApostille,
  contractDocuments, InsertContractDocument,
  contractAuditLogs, InsertContractAuditLog,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createContract(data: InsertContract) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(contracts).values(data);
  return await getContractById(result[0].insertId);
}

export async function getContractById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function listContracts(userId: number, filters?: { type?: string; status?: string; year?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [eq(contracts.createdBy, userId)];
  if (filters?.type) conditions.push(eq(contracts.type, filters.type as any));
  if (filters?.status) conditions.push(eq(contracts.status, filters.status as any));
  if (filters?.year) conditions.push(eq(contracts.year, filters.year));
  return await db.select().from(contracts).where(and(...conditions)).orderBy(desc(contracts.createdAt));
}

export async function updateContract(id: number, data: Partial<InsertContract>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(contracts).set({ ...data, updatedAt: new Date() }).where(eq(contracts.id, id));
  return await getContractById(id);
}

export async function createAmendment(data: InsertContractAmendment) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(contractAmendments).values(data);
  const amendment = await db.select().from(contractAmendments).where(eq(contractAmendments.id, result[0].insertId)).limit(1);
  return amendment.length > 0 ? amendment[0] : null;
}

export async function listAmendments(contractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contractAmendments).where(eq(contractAmendments.contractId, contractId)).orderBy(asc(contractAmendments.number));
}

export async function createApostille(data: InsertContractApostille) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(contractApostilles).values(data);
  const apostille = await db.select().from(contractApostilles).where(eq(contractApostilles.id, result[0].insertId)).limit(1);
  return apostille.length > 0 ? apostille[0] : null;
}

export async function listApostilles(contractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contractApostilles).where(eq(contractApostilles.contractId, contractId)).orderBy(asc(contractApostilles.number));
}

export async function createContractDocument(data: InsertContractDocument) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(contractDocuments).values(data);
  const doc = await db.select().from(contractDocuments).where(eq(contractDocuments.id, result[0].insertId)).limit(1);
  return doc.length > 0 ? doc[0] : null;
}

export async function listContractDocuments(contractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contractDocuments).where(eq(contractDocuments.contractId, contractId)).orderBy(desc(contractDocuments.createdAt));
}

export async function updateContractDocument(id: number, data: Partial<InsertContractDocument>) {
  const db = await getDb();
  if (!db) return null;
  await db.update(contractDocuments).set({ ...data, updatedAt: new Date() }).where(eq(contractDocuments.id, id));
  const doc = await db.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
  return doc.length > 0 ? doc[0] : null;
}

export async function createContractAuditLog(log: InsertContractAuditLog) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(contractAuditLogs).values(log);
  return (result as any)[0]?.insertId ?? result;
}

export async function getContractAuditLogs(contractId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contractAuditLogs).where(eq(contractAuditLogs.contractId, contractId)).orderBy(desc(contractAuditLogs.createdAt));
}

export async function getContractAuditLogsByAction(contractId: number, action: string) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(contractAuditLogs)
    .where(and(eq(contractAuditLogs.contractId, contractId), eq(contractAuditLogs.action, action as any)))
    .orderBy(desc(contractAuditLogs.createdAt));
}

export async function getContractsOverview() {
  const db = await getDb();
  if (!db) return null;
  const totalResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts);
  const total = totalResult[0]?.count || 0;
  const byTypeResult = await db.select({ type: contracts.type, count: sql<number>`COUNT(*)` }).from(contracts).groupBy(contracts.type);
  const byStatusResult = await db.select({ status: contracts.status, count: sql<number>`COUNT(*)` }).from(contracts).groupBy(contracts.status);
  const valueResult = await db.select({ total: sql<number>`SUM(currentValue)` }).from(contracts);
  const totalValue = valueResult[0]?.total || 0;
  const activeResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts).where(eq(contracts.status, "active"));
  const activeCount = activeResult[0]?.count || 0;
  const expiredResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts).where(eq(contracts.status, "expired"));
  const expiredCount = expiredResult[0]?.count || 0;
  const expiringSoonResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts)
    .where(and(eq(contracts.status, "active"), sql`DATEDIFF(endDate, NOW()) <= 30 AND DATEDIFF(endDate, NOW()) > 0`));
  const expiringSoonCount = expiringSoonResult[0]?.count || 0;
  return { total, byType: byTypeResult, byStatus: byStatusResult, totalValue, active: activeCount, expired: expiredCount, expiringSoon: expiringSoonCount };
}

export async function getRecentContracts(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contracts).orderBy(desc(contracts.createdAt)).limit(limit);
}
