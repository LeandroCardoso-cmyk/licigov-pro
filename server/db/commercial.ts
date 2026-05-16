import { eq, desc } from "drizzle-orm";
import {
  proposalRequests, companyDocuments,
  InsertProposalRequest, InsertCompanyDocument,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createProposalRequest(data: InsertProposalRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(proposalRequests).values(data);
  return result[0].insertId;
}

export async function getProposalRequestById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(proposalRequests).where(eq(proposalRequests.id, id)).limit(1);
  return result[0];
}

export async function getAllProposalRequests() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.select().from(proposalRequests).orderBy(desc(proposalRequests.createdAt));
}

export async function updateProposalRequestStatus(
  id: number,
  status: "pending" | "documents_sent" | "empenho_received" | "activated" | "cancelled"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(proposalRequests).set({ status, updatedAt: new Date() }).where(eq(proposalRequests.id, id));
}

export async function updateProposalWithEmpenho(
  id: number,
  numeroEmpenho: string,
  dataEmpenho: Date,
  valorEmpenho: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(proposalRequests)
    .set({ numeroEmpenho, dataEmpenho, valorEmpenho, status: "empenho_received", updatedAt: new Date() })
    .where(eq(proposalRequests.id, id));
}

export async function updateProposalRequest(id: number, data: Partial<InsertProposalRequest>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(proposalRequests).set({ ...data, updatedAt: new Date() }).where(eq(proposalRequests.id, id));
}

export async function createCompanyDocument(data: InsertCompanyDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(companyDocuments).values(data);
  return result[0].insertId;
}

export async function getAllCompanyDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.select().from(companyDocuments).orderBy(desc(companyDocuments.createdAt));
}

export async function getCompanyDocumentsByType(type: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .select()
    .from(companyDocuments)
    .where(eq(companyDocuments.type, type as any))
    .orderBy(desc(companyDocuments.version));
}

export async function getLatestCompanyDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const allDocs = await db.select().from(companyDocuments).orderBy(desc(companyDocuments.version));
  const latestDocs = new Map();
  for (const doc of allDocs) {
    if (!latestDocs.has(doc.type)) latestDocs.set(doc.type, doc);
  }
  return Array.from(latestDocs.values());
}

export async function updateCompanyDocumentStatus(id: number, status: "valid" | "expiring_soon" | "expired") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(companyDocuments).set({ status, updatedAt: new Date() }).where(eq(companyDocuments.id, id));
}

export async function deleteCompanyDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(companyDocuments).where(eq(companyDocuments.id, id));
}
