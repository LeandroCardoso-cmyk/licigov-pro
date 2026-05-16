import { eq, and, gte, lte, desc } from "drizzle-orm";
import { aiUsageTracking } from "../../drizzle/schema";
import { getDb } from "./connection";

export async function trackAIUsage(data: {
  userId: number;
  processId?: number;
  operationType: "embedding" | "rag_query" | "catmat_matching" | "document_generation";
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  metadata?: any;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[AI Tracking] Database not available");
    return;
  }
  try {
    await db.insert(aiUsageTracking).values({
      userId: data.userId,
      processId: data.processId,
      operationType: data.operationType as any,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      estimatedCostUSD: data.estimatedCostUSD.toString(),
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    });
  } catch (error) {
    console.error("[AI Tracking] Failed to track usage:", error);
  }
}

export async function getAIUsageStats(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let query = db.select().from(aiUsageTracking);
  const conditions: any[] = [];
  if (filters?.startDate) conditions.push(gte(aiUsageTracking.createdAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(aiUsageTracking.createdAt, filters.endDate));
  if (filters?.userId) conditions.push(eq(aiUsageTracking.userId, filters.userId));
  if (filters?.operationType) conditions.push(eq(aiUsageTracking.operationType, filters.operationType as any));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;

  const records = await query;
  const totalCost = records.reduce((sum, r) => sum + parseFloat(r.estimatedCostUSD as string), 0);
  const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalOperations = records.length;

  const byOperationType: Record<string, { count: number; cost: number }> = {};
  records.forEach((r) => {
    const type = r.operationType;
    if (!byOperationType[type]) byOperationType[type] = { count: 0, cost: 0 };
    byOperationType[type].count++;
    byOperationType[type].cost += parseFloat(r.estimatedCostUSD as string);
  });

  const byDay: Record<string, { date: string; cost: number; operations: number }> = {};
  records.forEach((r) => {
    const date = r.createdAt.toISOString().split("T")[0];
    if (!byDay[date]) byDay[date] = { date, cost: 0, operations: 0 };
    byDay[date].cost += parseFloat(r.estimatedCostUSD as string);
    byDay[date].operations++;
  });

  return {
    totalCost, totalInputTokens, totalOutputTokens, totalOperations,
    byOperationType,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function getAIUsageHistory(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let query = db.select().from(aiUsageTracking);
  const conditions: any[] = [];
  if (filters?.startDate) conditions.push(gte(aiUsageTracking.createdAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(aiUsageTracking.createdAt, filters.endDate));
  if (filters?.userId) conditions.push(eq(aiUsageTracking.userId, filters.userId));
  if (filters?.operationType) conditions.push(eq(aiUsageTracking.operationType, filters.operationType as any));
  if (conditions.length > 0) query = query.where(and(...conditions)) as any;
  query = query.orderBy(desc(aiUsageTracking.createdAt)) as any;
  if (filters?.limit) query = query.limit(filters.limit) as any;
  if (filters?.offset) query = query.offset(filters.offset) as any;
  return await query;
}

export async function exportAIUsageCSV(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
}) {
  const records = await getAIUsageHistory(filters);
  const headers = ["ID", "Data/Hora", "Usuário ID", "Processo ID", "Tipo de Operação", "Modelo", "Tokens Entrada", "Tokens Saída", "Custo (USD)"];
  const rows = records.map((r) => [
    r.id, r.createdAt.toISOString(), r.userId, r.processId || "",
    r.operationType, r.model, r.inputTokens, r.outputTokens, r.estimatedCostUSD,
  ]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}
