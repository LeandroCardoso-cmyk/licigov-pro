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
  return await getContractByIdForOrganization(result[0].insertId, data.organizationId ?? -1);
}

/**
 * RC-C0.1A.1 — INSEGURA (sem filtro de organização). Mantida apenas para o único
 * consumidor externo pré-existente (`legalOpinionsRouter.ts::generateOpinion`, ele
 * mesmo `protectedProcedure` sem contexto de tenant — fora do escopo desta sprint,
 * que corrige exclusivamente `contractsRouter`). NÃO usar em nenhum código novo.
 * Todo o `contractsRouter` usa `getContractByIdForOrganization` abaixo.
 */
export async function getContractById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/** RC-C0.1A.1 — organizationId sempre exigido; nunca aceitar do cliente sem resolução no servidor. */
export async function getContractByIdForOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.organizationId, organizationId)))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function listContractsByOrganization(organizationId: number, filters?: { type?: string; status?: string; year?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [eq(contracts.organizationId, organizationId)];
  if (filters?.type) conditions.push(eq(contracts.type, filters.type as any));
  if (filters?.status) conditions.push(eq(contracts.status, filters.status as any));
  if (filters?.year) conditions.push(eq(contracts.year, filters.year));
  return await db.select().from(contracts).where(and(...conditions)).orderBy(desc(contracts.createdAt));
}

/** Retorna null se o contrato não existir OU não pertencer à organização (nunca revela a diferença). */
export async function updateContractForOrganization(id: number, organizationId: number, data: Partial<InsertContract>) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getContractByIdForOrganization(id, organizationId);
  if (!existing) return null;
  await db.update(contracts).set({ ...data, updatedAt: new Date() }).where(eq(contracts.id, id));
  return await getContractByIdForOrganization(id, organizationId);
}

/** Retorna null se o contrato-pai não existir OU não pertencer à organização. */
export async function createAmendmentForOrganization(data: InsertContractAmendment, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const parent = await getContractByIdForOrganization(data.contractId, organizationId);
  if (!parent) return null;
  const result = await db.insert(contractAmendments).values(data);
  const amendment = await db.select().from(contractAmendments).where(eq(contractAmendments.id, result[0].insertId)).limit(1);
  return amendment.length > 0 ? amendment[0] : null;
}

/** Retorna [] se o contrato-pai não existir OU não pertencer à organização (contract_amendments não tem coluna organizationId própria). */
export async function listAmendmentsForOrganization(contractId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const parent = await getContractByIdForOrganization(contractId, organizationId);
  if (!parent) return [];
  return await db.select().from(contractAmendments).where(eq(contractAmendments.contractId, contractId)).orderBy(asc(contractAmendments.number));
}

export async function createApostilleForOrganization(data: InsertContractApostille, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const parent = await getContractByIdForOrganization(data.contractId, organizationId);
  if (!parent) return null;
  const result = await db.insert(contractApostilles).values(data);
  const apostille = await db.select().from(contractApostilles).where(eq(contractApostilles.id, result[0].insertId)).limit(1);
  return apostille.length > 0 ? apostille[0] : null;
}

export async function listApostillesForOrganization(contractId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const parent = await getContractByIdForOrganization(contractId, organizationId);
  if (!parent) return [];
  return await db.select().from(contractApostilles).where(eq(contractApostilles.contractId, contractId)).orderBy(asc(contractApostilles.number));
}

export async function createContractDocumentForOrganization(data: InsertContractDocument, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const parent = await getContractByIdForOrganization(data.contractId, organizationId);
  if (!parent) return null;
  const result = await db.insert(contractDocuments).values(data);
  const doc = await db.select().from(contractDocuments).where(eq(contractDocuments.id, result[0].insertId)).limit(1);
  return doc.length > 0 ? doc[0] : null;
}

export async function listContractDocumentsForOrganization(contractId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const parent = await getContractByIdForOrganization(contractId, organizationId);
  if (!parent) return [];
  return await db.select().from(contractDocuments).where(eq(contractDocuments.contractId, contractId)).orderBy(desc(contractDocuments.createdAt));
}

/** Documento não referencia organizationId diretamente — resolve o contrato-pai a partir do próprio documento antes de autorizar. */
export async function updateContractDocumentForOrganization(id: number, organizationId: number, data: Partial<InsertContractDocument>) {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(contractDocuments).where(eq(contractDocuments.id, id)).limit(1);
  if (existing.length === 0) return null;
  const parent = await getContractByIdForOrganization(existing[0].contractId, organizationId);
  if (!parent) return null;
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

export async function getContractAuditLogsForOrganization(contractId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const parent = await getContractByIdForOrganization(contractId, organizationId);
  if (!parent) return [];
  return await db.select().from(contractAuditLogs).where(eq(contractAuditLogs.contractId, contractId)).orderBy(desc(contractAuditLogs.createdAt));
}

export async function getContractAuditLogsByActionForOrganization(contractId: number, organizationId: number, action: string) {
  const db = await getDb();
  if (!db) return [];
  const parent = await getContractByIdForOrganization(contractId, organizationId);
  if (!parent) return [];
  return await db
    .select()
    .from(contractAuditLogs)
    .where(and(eq(contractAuditLogs.contractId, contractId), eq(contractAuditLogs.action, action as any)))
    .orderBy(desc(contractAuditLogs.createdAt));
}

/**
 * RC-C0.1A — MAINTENANCE_ONLY (correção de segurança). Escopo tenant-scoped:
 * organizationId é obrigatório e sempre resolvido no servidor (nunca aceito do
 * cliente) — ver contractsRouter.ts:analytics.getOverview. Contratos legados com
 * organizationId=NULL (pré-multi-tenant) não são atribuíveis a nenhuma org e por
 * isso não aparecem em nenhum agregado — comportamento correto de isolamento,
 * não um bug.
 */
export async function getContractsOverview(organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const orgFilter = eq(contracts.organizationId, organizationId);
  const totalResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts).where(orgFilter);
  const total = totalResult[0]?.count || 0;
  const byTypeResult = await db.select({ type: contracts.type, count: sql<number>`COUNT(*)` }).from(contracts).where(orgFilter).groupBy(contracts.type);
  const byStatusResult = await db.select({ status: contracts.status, count: sql<number>`COUNT(*)` }).from(contracts).where(orgFilter).groupBy(contracts.status);
  const valueResult = await db.select({ total: sql<number>`SUM(currentValue)` }).from(contracts).where(orgFilter);
  const totalValue = valueResult[0]?.total || 0;
  const activeResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts).where(and(orgFilter, eq(contracts.status, "active")));
  const activeCount = activeResult[0]?.count || 0;
  const expiredResult = await db.select({ count: sql<number>`COUNT(*)` }).from(contracts).where(and(orgFilter, eq(contracts.status, "expired")));
  const expiredCount = expiredResult[0]?.count || 0;
  const expiringSoonResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts)
    .where(and(orgFilter, eq(contracts.status, "active"), sql`DATEDIFF(endDate, NOW()) <= 30 AND DATEDIFF(endDate, NOW()) > 0`));
  const expiringSoonCount = expiringSoonResult[0]?.count || 0;
  return { total, byType: byTypeResult, byStatus: byStatusResult, totalValue, active: activeCount, expired: expiredCount, expiringSoon: expiringSoonCount };
}

export async function getRecentContractsForOrganization(organizationId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(contracts)
    .where(eq(contracts.organizationId, organizationId))
    .orderBy(desc(contracts.createdAt))
    .limit(limit);
}
