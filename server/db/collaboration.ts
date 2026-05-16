import { eq, and, desc } from "drizzle-orm";
import {
  activityLogs, documentSettings, processMembers, notifications, stageAssignments,
  processes, users,
  InsertActivityLog, InsertDocumentSettings, InsertProcessMember, InsertNotification,
  InsertStageAssignment,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createActivityLog(log: InsertActivityLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(activityLogs).values(log);
}

export async function getActivityLogsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.processId, processId))
    .orderBy(desc(activityLogs.createdAt));
}

export async function upsertDocumentSettings(settings: InsertDocumentSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(documentSettings).values(settings).onDuplicateKeyUpdate({
    set: {
      organizationName: settings.organizationName, logoUrl: settings.logoUrl,
      address: settings.address, cnpj: settings.cnpj, phone: settings.phone,
      email: settings.email, website: settings.website, footerText: settings.footerText,
    },
  });
}

export async function getDocumentSettingsByUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documentSettings)
    .where(eq(documentSettings.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function addProcessMember(member: InsertProcessMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(processMembers).values(member);
}

export async function removeProcessMember(processId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(processMembers)
    .where(and(eq(processMembers.processId, processId), eq(processMembers.userId, userId)));
}

export async function updateProcessMemberPermission(
  processId: number,
  userId: number,
  permission: "viewer" | "editor" | "approver" | "owner"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(processMembers)
    .set({ permission })
    .where(and(eq(processMembers.processId, processId), eq(processMembers.userId, userId)));
}

export async function getProcessMembers(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: processMembers.id, userId: processMembers.userId,
      permission: processMembers.permission,
      functionalRole: processMembers.functionalRole,
      invitedBy: processMembers.invitedBy,
      createdAt: processMembers.createdAt, userName: users.name, userEmail: users.email,
    })
    .from(processMembers)
    .leftJoin(users, eq(processMembers.userId, users.id))
    .where(eq(processMembers.processId, processId))
    .orderBy(desc(processMembers.createdAt));
}

export async function updateProcessMemberFunctionalRole(
  processId: number,
  userId: number,
  functionalRole: "solicitante" | "compras" | "juridico" | "controle_interno" | "gestor" | "fiscal" | "administrador" | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(processMembers)
    .set({ functionalRole: functionalRole as any })
    .where(and(eq(processMembers.processId, processId), eq(processMembers.userId, userId)));
}

export async function upsertStageAssignment(assignment: InsertStageAssignment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(stageAssignments)
    .values(assignment)
    .onDuplicateKeyUpdate({
      set: {
        assignedUserId: assignment.assignedUserId,
        assignedBy: assignment.assignedBy,
        note: assignment.note,
      },
    });
}

export async function removeStageAssignment(processId: number, docType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(stageAssignments)
    .where(and(eq(stageAssignments.processId, processId), eq(stageAssignments.docType, docType as any)));
}

export async function getStageAssignments(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select({
      id: stageAssignments.id,
      processId: stageAssignments.processId,
      docType: stageAssignments.docType,
      assignedUserId: stageAssignments.assignedUserId,
      assignedBy: stageAssignments.assignedBy,
      note: stageAssignments.note,
      createdAt: stageAssignments.createdAt,
      assignedUserName: users.name,
      assignedUserEmail: users.email,
    })
    .from(stageAssignments)
    .leftJoin(users, eq(stageAssignments.assignedUserId, users.id))
    .where(eq(stageAssignments.processId, processId));
}

export async function getProcessMember(processId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(processMembers)
    .where(and(eq(processMembers.processId, processId), eq(processMembers.userId, userId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserProcesses(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const ownedProcesses = await db
    .select()
    .from(processes)
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));

  const memberProcessIds = await db
    .select({ processId: processMembers.processId })
    .from(processMembers)
    .where(eq(processMembers.userId, userId));

  if (memberProcessIds.length === 0) return ownedProcesses;

  const memberProcesses = await db
    .select()
    .from(processes)
    .where(and(...memberProcessIds.map((m) => eq(processes.id, m.processId))))
    .orderBy(desc(processes.updatedAt));

  const allProcesses = [...ownedProcesses, ...memberProcesses];
  return Array.from(new Map(allProcesses.map((p) => [p.id, p])).values());
}

export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(notifications).values(notification);
}

export async function getUserNotifications(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationsCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return result.length;
}

export async function markNotificationAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, notificationId));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}
