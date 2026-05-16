import { eq, desc } from "drizzle-orm";
import { users, processes, documents, comments, auditLogs, activityLogs, InsertAuditLog } from "../../drizzle/schema";
import { getDb } from "./connection";
import { getUserById } from "./users";

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

  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
  const processIds = userProcesses.map((p) => p.id);

  let documentCount = 0;
  for (const processId of processIds) {
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));
    documentCount += docs.length;
  }

  const userComments = await db.select().from(comments).where(eq(comments.userId, userId));

  return { processCount: userProcesses.length, documentCount, commentCount: userComments.length };
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

export async function getProcessCountByStatus() {
  const db = await getDb();
  if (!db) return [];
  const allProcesses = await db.select().from(processes);
  const statusCounts: Record<string, number> = {};
  for (const process of allProcesses) {
    statusCounts[process.status] = (statusCounts[process.status] || 0) + 1;
  }
  return Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
}

export async function getDocumentCountByMonth(months: number = 6) {
  const db = await getDb();
  if (!db) return [];
  const allDocuments = await db.select().from(documents);
  const monthCounts: Record<string, number> = {};
  const now = new Date();
  for (const doc of allDocuments) {
    const docDate = new Date(doc.createdAt);
    const monthDiff =
      (now.getFullYear() - docDate.getFullYear()) * 12 + (now.getMonth() - docDate.getMonth());
    if (monthDiff < months) {
      const monthKey = `${docDate.getFullYear()}-${String(docDate.getMonth() + 1).padStart(2, "0")}`;
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    }
  }
  return Object.entries(monthCounts)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function getMostActiveMembers(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  const allActivities = await db.select().from(activityLogs);
  const userActivityCounts: Record<number, number> = {};
  for (const activity of allActivities) {
    userActivityCounts[activity.userId] = (userActivityCounts[activity.userId] || 0) + 1;
  }
  const sortedUsers = Object.entries(userActivityCounts)
    .map(([userId, count]) => ({ userId: parseInt(userId), activityCount: count }))
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, limit);
  const result = [];
  for (const { userId, activityCount } of sortedUsers) {
    const user = await getUserById(userId);
    if (user) {
      result.push({
        userId: user.id,
        userName: user.name || "Usuário sem nome",
        userEmail: user.email || "",
        activityCount,
      });
    }
  }
  return result;
}
