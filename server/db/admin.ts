import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import {
  users, comments, auditLogs, activityLogs, procurementProcessesTable, generatedDocumentsTable, InsertAuditLog,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import { monthWindowStartUtc, toMonthCounts, toStageCounts } from "../domain/canonicalAnalytics";

// R9 / SEM-074 — TODAS as métricas abaixo leem as fontes CANÔNICAS que recebem escrita hoje:
//   processos  → `procurement_processes` (criados por procurementProcess.createProcess / insertProcess);
//   documentos → `generated_documents`   (working copy canônica DFD/ETP/TR/Edital, um registro por tipo e processo).
// As tabelas legadas `processes`/`documents` não recebem novas escritas (pipeline legado cortado — PR B) e
// deixavam o painel congelado. Agregação em SQL (COUNT/GROUP BY, parâmetros Drizzle), nunca em memória.

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return { processCount: 0, documentCount: 0, commentCount: 0 };

  // R9 / SEM-074 — processos sob responsabilidade do usuário e documentos canônicos DESSES processos (o join exige
  // o mesmo órgão: o id do processo é por tenant). Antes: `processes.ownerId` + N consultas em `documents`.
  const [proc] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(procurementProcessesTable)
    .where(eq(procurementProcessesTable.responsibleUser, userId));
  const [docs] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(generatedDocumentsTable)
    .innerJoin(procurementProcessesTable, and(
      eq(procurementProcessesTable.id, generatedDocumentsTable.processId),
      eq(procurementProcessesTable.organizationId, generatedDocumentsTable.organizationId),
    ))
    .where(eq(procurementProcessesTable.responsibleUser, userId));
  const [cmts] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(comments)
    .where(eq(comments.userId, userId));

  return { processCount: Number(proc?.n ?? 0), documentCount: Number(docs?.n ?? 0), commentCount: Number(cmts?.n ?? 0) };
}

export async function createAuditLog(log: InsertAuditLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(auditLogs).values(log);
}

export async function getAuditLogs(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export async function getAuditLogsByAdmin(adminId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.adminId, adminId))
    .orderBy(desc(auditLogs.createdAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregações. As variantes sem sufixo são GLOBAIS (plataforma — sem consumidor de router hoje; mantidas com o
// mesmo escopo, agora sobre as fontes canônicas). O overview institucional usa as variantes `ForOrg`.
// ─────────────────────────────────────────────────────────────────────────────

/** Processos canônicos por ETAPA (`current_stage`), opcionalmente restritos a um órgão. */
async function countProcessesByStage(organizationId: number | null) {
  const db = await getDb();
  if (!db) return [];
  const where: SQL | undefined = organizationId !== null ? eq(procurementProcessesTable.organizationId, organizationId) : undefined;
  const rows = await db
    .select({ stage: procurementProcessesTable.currentStage, count: sql<number>`COUNT(*)` })
    .from(procurementProcessesTable)
    .where(where)
    .groupBy(procurementProcessesTable.currentStage);
  return toStageCounts(rows);
}

/** Documentos canônicos criados por mês (UTC) na janela de `months` meses, opcionalmente por órgão. */
async function countDocumentsByMonth(organizationId: number | null, months: number) {
  const db = await getDb();
  if (!db) return [];
  const since = monthWindowStartUtc(new Date(), months);
  const y = sql<number>`YEAR(${generatedDocumentsTable.createdAt})`;
  const m = sql<number>`MONTH(${generatedDocumentsTable.createdAt})`;
  const inWindow = gte(generatedDocumentsTable.createdAt, since);
  const rows = await db
    .select({ y, m, count: sql<number>`COUNT(*)` })
    .from(generatedDocumentsTable)
    .where(organizationId !== null ? and(eq(generatedDocumentsTable.organizationId, organizationId), inWindow) : inWindow)
    .groupBy(y, m);
  return toMonthCounts(rows);
}

/** Ranking de atividade (activity_logs — fonte viva) com nome/e-mail do usuário, em uma consulta. */
async function rankActiveMembers(organizationId: number | null, limit: number) {
  const db = await getDb();
  if (!db) return [];
  const activityCount = sql<number>`COUNT(*)`;
  const rows = await db
    .select({ userId: activityLogs.userId, name: users.name, email: users.email, activityCount })
    .from(activityLogs)
    .innerJoin(users, eq(users.id, activityLogs.userId))
    .where(organizationId !== null ? eq(activityLogs.organizationId, organizationId) : undefined)
    .groupBy(activityLogs.userId, users.name, users.email)
    .orderBy(desc(activityCount), asc(activityLogs.userId))
    .limit(limit);
  return rows.map(r => ({
    userId: r.userId,
    userName: r.name || "Usuário sem nome",
    userEmail: r.email || "",
    activityCount: Number(r.activityCount),
  }));
}

export async function getProcessCountByStatus() {
  return countProcessesByStage(null);
}

export async function getDocumentCountByMonth(months: number = 6) {
  return countDocumentsByMonth(null, months);
}

export async function getMostActiveMembers(limit: number = 10) {
  return rankActiveMembers(null, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT-SCOPED analytics (correção de vazamento cross-tenant no analyticsRouter).
// O overview institucional por organização DEVE derivar `organizationId` do contexto do servidor e filtrar toda
// agregação — nenhum tenant enxerga processos/documentos/atividade de outro. Invariante multi-tenant do
// PRODUCT_NORTH_STAR. Retornam vazio sem DB (leitura, degradação graciosa).
// R9 / SEM-074 — fontes canônicas (procurement_processes / generated_documents), agregadas em SQL.
// ─────────────────────────────────────────────────────────────────────────────

export async function getProcessCountByStatusForOrg(organizationId: number) {
  return countProcessesByStage(organizationId);
}

export async function getDocumentCountByMonthForOrg(organizationId: number, months: number = 6) {
  return countDocumentsByMonth(organizationId, months);
}

export async function getMostActiveMembersForOrg(organizationId: number, limit: number = 10) {
  return rankActiveMembers(organizationId, limit);
}
