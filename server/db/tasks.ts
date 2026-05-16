import { eq, and, or, like, inArray, gte, lte, lt, ne } from "drizzle-orm";
import {
  tasks, taskComments, taskAttachments, taskHistory, taskEditLocks, InsertTask,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createTask(task: InsertTask): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tasks).values(task);
  return result[0].insertId;
}

export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllTasks() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(tasks);
}

export async function listTasks(filters: {
  search?: string;
  status?: string[];
  priority?: string[];
  type?: string;
  assignedTo?: number;
  processId?: number;
  createdFrom?: Date;
  createdTo?: Date;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  tags?: string[];
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(tasks);
  const conditions = [];

  if (filters.search) {
    conditions.push(or(like(tasks.title, `%${filters.search}%`), like(tasks.description, `%${filters.search}%`)));
  }
  if (filters.status && filters.status.length > 0) conditions.push(inArray(tasks.status, filters.status as any));
  if (filters.priority && filters.priority.length > 0) conditions.push(inArray(tasks.priority, filters.priority as any));
  if (filters.type) conditions.push(eq(tasks.type, filters.type));
  if (filters.assignedTo) conditions.push(eq(tasks.assignedTo, filters.assignedTo));
  if (filters.processId) conditions.push(eq(tasks.processId, filters.processId));
  if (filters.createdFrom) conditions.push(gte(tasks.createdAt, filters.createdFrom));
  if (filters.createdTo) conditions.push(lte(tasks.createdAt, filters.createdTo));
  if (filters.deadlineFrom) conditions.push(gte(tasks.deadline, filters.deadlineFrom));
  if (filters.deadlineTo) conditions.push(lte(tasks.deadline, filters.deadlineTo));

  if (conditions.length > 0) query = query.where(and(...conditions)) as any;

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  return await query.limit(pageSize).offset((page - 1) * pageSize);
}

export async function updateTask(id: number, updates: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tasks).set(updates).where(eq(tasks.id, id));
}

export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(taskComments).where(eq(taskComments.taskId, id));
  await db.delete(taskAttachments).where(eq(taskAttachments.taskId, id));
  await db.delete(taskHistory).where(eq(taskHistory.taskId, id));
  await db.delete(taskEditLocks).where(eq(taskEditLocks.taskId, id));
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function updateTaskStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tasks).set({ status: status as any }).where(eq(tasks.id, id));
}

export async function getTaskStats(assignedTo?: number) {
  const db = await getDb();
  if (!db) return { total: 0, inProgress: 0, completed: 0, overdue: 0 };
  let query = db.select().from(tasks);
  if (assignedTo) query = query.where(eq(tasks.assignedTo, assignedTo)) as any;
  const allTasks = await query;
  const now = new Date();
  return {
    total: allTasks.length,
    inProgress: allTasks.filter((t) => t.status === "em_andamento").length,
    completed: allTasks.filter((t) => t.status === "concluida").length,
    overdue: allTasks.filter((t) => t.deadline && t.deadline < now && t.status !== "concluida").length,
  };
}

export async function getOverdueTasks(assignedTo?: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const conditions: any[] = [lt(tasks.deadline, now), ne(tasks.status, "concluida")];
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));
  return await db.select().from(tasks).where(and(...conditions));
}

export async function listTaskComments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(taskComments.createdAt);
}

export async function createTaskComment(comment: { taskId: number; userId: number; content: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taskComments).values(comment);
  return result[0].insertId;
}

export async function listTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(taskAttachments.uploadedAt);
}

export async function createTaskAttachment(attachment: {
  taskId: number;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taskAttachments).values(attachment);
  return result[0].insertId;
}

export async function deleteTaskAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(taskAttachments).where(eq(taskAttachments.id, id));
}
