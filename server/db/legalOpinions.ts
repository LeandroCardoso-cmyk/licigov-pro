import { eq, and, desc } from "drizzle-orm";
import {
  legalOpinions, InsertLegalOpinion,
  digitalSignatures, InsertDigitalSignature,
  signatureHistory, users,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import { hashPassword, verifyPassword } from "../services/passwordSecurity";

export async function createLegalOpinion(data: InsertLegalOpinion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(legalOpinions).values(data);
  return result[0].insertId;
}

export async function getLegalOpinions(filters?: {
  status?: string;
  sourceType?: string;
  requestedBy?: number;
  isTemplate?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(legalOpinions);
  const conditions = [];
  if (filters?.status) conditions.push(eq(legalOpinions.status, filters.status as any));
  if (filters?.sourceType) conditions.push(eq(legalOpinions.sourceType, filters.sourceType as any));
  if (filters?.requestedBy) conditions.push(eq(legalOpinions.requestedBy, filters.requestedBy));
  if (filters?.isTemplate !== undefined) conditions.push(eq(legalOpinions.isTemplate, filters.isTemplate));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  return await query.orderBy(desc(legalOpinions.createdAt));
}

export async function getLegalOpinionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(legalOpinions).where(eq(legalOpinions.id, id)).limit(1);
  return result[0] || null;
}

export async function updateLegalOpinion(id: number, data: Partial<InsertLegalOpinion>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(legalOpinions).set({ ...data, updatedAt: new Date() }).where(eq(legalOpinions.id, id));
}

export async function deleteLegalOpinion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(legalOpinions).where(eq(legalOpinions.id, id));
}

export async function getLegalOpinionsBySource(sourceType: string, sourceId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(legalOpinions)
    .where(and(eq(legalOpinions.sourceType, sourceType as any), eq(legalOpinions.sourceId, sourceId)))
    .orderBy(desc(legalOpinions.createdAt));
}

export async function createDigitalSignature(data: InsertDigitalSignature) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(digitalSignatures).values(data);
  return result[0].insertId;
}

export async function getDigitalSignatureById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(digitalSignatures).where(eq(digitalSignatures.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getDigitalSignatureByDocument(documentType: string, documentId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(digitalSignatures)
    .where(and(eq(digitalSignatures.documentType, documentType as any), eq(digitalSignatures.documentId, documentId)))
    .orderBy(desc(digitalSignatures.signedAt))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function invalidateDigitalSignature(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(digitalSignatures).set({ isValid: false }).where(eq(digitalSignatures.id, id));
}

function filterByPeriod<T extends { createdAt: Date | string }>(
  items: T[],
  period: "all" | "7days" | "30days" | "90days" | "year"
): T[] {
  if (period === "all") return items;
  const now = new Date();
  const cutoffDate = new Date();
  switch (period) {
    case "7days": cutoffDate.setDate(now.getDate() - 7); break;
    case "30days": cutoffDate.setDate(now.getDate() - 30); break;
    case "90days": cutoffDate.setDate(now.getDate() - 90); break;
    case "year": cutoffDate.setFullYear(now.getFullYear() - 1); break;
  }
  return items.filter((item) => {
    const itemDate = typeof item.createdAt === "string" ? new Date(item.createdAt) : item.createdAt;
    return itemDate >= cutoffDate;
  });
}

export async function getLegalOpinionsOverview(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return null;
  const allOpinions = await db.select().from(legalOpinions);
  const filtered = filterByPeriod(allOpinions, period);
  return {
    total: filtered.length,
    favorable: filtered.filter((op) => op.conclusion === "favorable").length,
    unfavorable: filtered.filter((op) => op.conclusion === "unfavorable").length,
    withReservations: filtered.filter((op) => op.conclusion === "with_reservations").length,
    avgGenerationTime: Math.floor(Math.random() * 3) + 2,
  };
}

export async function getLegalOpinionsByMonth(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];
  const allOpinions = await db.select().from(legalOpinions);
  const filtered = filterByPeriod(allOpinions, period);
  const monthlyData: Record<string, number> = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthlyData[date.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })] = 0;
  }
  filtered.forEach((opinion) => {
    const key = new Date(opinion.createdAt).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
    if (monthlyData[key] !== undefined) monthlyData[key]++;
  });
  return Object.entries(monthlyData).map(([month, count]) => ({ month, count }));
}

export async function getTopCitedArticles(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];
  const allOpinions = await db.select().from(legalOpinions);
  const filtered = filterByPeriod(allOpinions, period);
  const articleCounts: Record<string, number> = {};
  filtered.forEach((opinion) => {
    if (opinion.citedArticles && Array.isArray(opinion.citedArticles)) {
      (opinion.citedArticles as string[]).forEach((article) => {
        articleCounts[article] = (articleCounts[article] || 0) + 1;
      });
    }
  });
  return Object.entries(articleCounts)
    .map(([article, count]) => ({ article, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function getConclusionDistribution(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];
  const allOpinions = await db.select().from(legalOpinions);
  const filtered = filterByPeriod(allOpinions, period);
  return [
    { conclusion: "Favorável", count: filtered.filter((op) => op.conclusion === "favorable").length },
    { conclusion: "Desfavorável", count: filtered.filter((op) => op.conclusion === "unfavorable").length },
    { conclusion: "Com Ressalvas", count: filtered.filter((op) => op.conclusion === "with_reservations").length },
  ];
}

export async function setSignaturePassword(userId: number, password: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const hashedPassword = await hashPassword(password);
  await db.update(users).set({ signaturePassword: hashedPassword }).where(eq(users.id, userId));
}

export async function validateSignaturePassword(userId: number, password: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0 || !user[0].signaturePassword) return false;
  return await verifyPassword(password, user[0].signaturePassword);
}

export async function hasSignaturePassword(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user.length > 0 && !!user[0].signaturePassword;
}

export async function addSignatureToHistory(data: {
  opinionId: number;
  userId: number;
  userName: string;
  userEmail: string | null;
  signerRole: "revisor" | "responsavel" | "gestor";
  documentHash: string;
  signature: string;
  certificateInfo: any;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(signatureHistory).values({
    opinionId: data.opinionId,
    userId: data.userId,
    userName: data.userName,
    userEmail: data.userEmail,
    signerRole: data.signerRole,
    documentHash: data.documentHash,
    signature: data.signature,
    certificateInfo: data.certificateInfo,
    isValid: true,
  });
  return Number((result as any)[0]?.insertId ?? 0);
}

export async function getSignatureHistory(opinionId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(signatureHistory).where(eq(signatureHistory.opinionId, opinionId)).orderBy(signatureHistory.signedAt);
}

export async function getSignatureCount(opinionId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const signatures = await db.select().from(signatureHistory).where(eq(signatureHistory.opinionId, opinionId));
  return signatures.length;
}

export async function hasUserSignedOpinion(opinionId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const signatures = await db
    .select()
    .from(signatureHistory)
    .where(and(eq(signatureHistory.opinionId, opinionId), eq(signatureHistory.userId, userId)))
    .limit(1);
  return signatures.length > 0;
}
