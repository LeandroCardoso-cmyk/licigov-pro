import { eq, and, desc } from "drizzle-orm";
import {
  userConsents, users, comments, notifications, processMembers,
  activityLogs, processes, documents, editalParameters, InsertUserConsent,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import { getUserById } from "./users";

export async function createUserConsent(consent: InsertUserConsent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(userConsents).values(consent);
}

export async function getUserConsents(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(desc(userConsents.createdAt));
}

export async function hasUserAcceptedConsent(userId: number, consentType: string, version: string) {
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .select()
    .from(userConsents)
    .where(
      and(
        eq(userConsents.userId, userId),
        eq(userConsents.consentType, consentType as any),
        eq(userConsents.version, version),
        eq(userConsents.accepted, true)
      )
    )
    .limit(1);
  return result.length > 0;
}

export async function deleteUserData(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(comments).where(eq(comments.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(processMembers).where(eq(processMembers.userId, userId));
  await db.delete(activityLogs).where(eq(activityLogs.userId, userId));

  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
  for (const process of userProcesses) {
    await db.delete(documents).where(eq(documents.processId, process.id));
    await db.delete(editalParameters).where(eq(editalParameters.processId, process.id));
  }
  await db.delete(processes).where(eq(processes.ownerId, userId));
  await db.delete(userConsents).where(eq(userConsents.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const user = await getUserById(userId);
  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
  const userComments = await db.select().from(comments).where(eq(comments.userId, userId));
  const userNotifications = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const userConsentsData = await getUserConsents(userId);
  const userActivities = await db.select().from(activityLogs).where(eq(activityLogs.userId, userId));

  const allDocuments = [];
  for (const process of userProcesses) {
    const docs = await db.select().from(documents).where(eq(documents.processId, process.id));
    allDocuments.push(...docs);
  }

  return {
    user,
    processes: userProcesses,
    documents: allDocuments,
    comments: userComments,
    notifications: userNotifications,
    consents: userConsentsData,
    activities: userActivities,
    exportedAt: new Date().toISOString(),
  };
}
