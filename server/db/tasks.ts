import { eq, and, or, like, inArray, gte, lte, lt, ne, type SQL } from "drizzle-orm";
import {
  tasks, taskComments, taskAttachments, taskHistory, taskEditLocks, InsertTask,
} from "../../drizzle/schema";
import { getDb } from "./connection";

type TaskStatusValue = (typeof tasks.$inferSelect)["status"];
type TaskPriorityValue = (typeof tasks.$inferSelect)["priority"];

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

  const conditions: SQL[] = [];

  if (filters.search) {
    conditions.push(or(like(tasks.title, `%${filters.search}%`), like(tasks.description, `%${filters.search}%`))!);
  }
  if (filters.status && filters.status.length > 0) conditions.push(inArray(tasks.status, filters.status as TaskStatusValue[]));
  if (filters.priority && filters.priority.length > 0) conditions.push(inArray(tasks.priority, filters.priority as TaskPriorityValue[]));
  if (filters.type) conditions.push(eq(tasks.type, filters.type));
  if (filters.assignedTo) conditions.push(eq(tasks.assignedTo, filters.assignedTo));
  if (filters.processId) conditions.push(eq(tasks.processId, filters.processId));
  if (filters.createdFrom) conditions.push(gte(tasks.createdAt, filters.createdFrom));
  if (filters.createdTo) conditions.push(lte(tasks.createdAt, filters.createdTo));
  if (filters.deadlineFrom) conditions.push(gte(tasks.deadline, filters.deadlineFrom));
  if (filters.deadlineTo) conditions.push(lte(tasks.deadline, filters.deadlineTo));

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  return await db.select().from(tasks).where(conditions.length > 0 ? and(...conditions) : undefined).limit(pageSize).offset((page - 1) * pageSize);
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
  await db.update(tasks).set({ status: status as TaskStatusValue }).where(eq(tasks.id, id));
}

export async function getTaskStats(assignedTo?: number) {
  const db = await getDb();
  if (!db) return { total: 0, inProgress: 0, completed: 0, overdue: 0 };
  const allTasks = await db.select().from(tasks).where(assignedTo ? eq(tasks.assignedTo, assignedTo) : undefined);
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
  const conditions: SQL[] = [lt(tasks.deadline, now), ne(tasks.status, "concluida")];
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
  mimeType?: string; // não há coluna dedicada — mantido opcional por compat.
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

// ─── RC-SEC-PR-A — Variantes tenant-scoped de tarefas ───────────────────────
// `tasks` possui organizationId próprio → filtro direto.
// task_comments / task_attachments / task_history / task_edit_locks NÃO possuem
// organizationId: o isolamento é feito validando a tarefa-pai pela organização.
// Cross-tenant e inexistente produzem o MESMO resultado externo (undefined/[]/
// no-op/false), nunca revelando existência em outra organização.

/** Retorna true se, e somente se, a tarefa pertence à organização. */
async function assertTaskInOrganization(
  taskId: number,
  organizationId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0;
}

export async function getTaskByIdForOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listTasksForOrganization(
  organizationId: number,
  filters?: {
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
  },
) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [eq(tasks.organizationId, organizationId)];

  if (filters) {
    if (filters.search) {
      conditions.push(or(like(tasks.title, `%${filters.search}%`), like(tasks.description, `%${filters.search}%`))!);
    }
    if (filters.status && filters.status.length > 0) conditions.push(inArray(tasks.status, filters.status as TaskStatusValue[]));
    if (filters.priority && filters.priority.length > 0) conditions.push(inArray(tasks.priority, filters.priority as TaskPriorityValue[]));
    if (filters.type) conditions.push(eq(tasks.type, filters.type));
    if (filters.assignedTo) conditions.push(eq(tasks.assignedTo, filters.assignedTo));
    if (filters.processId) conditions.push(eq(tasks.processId, filters.processId));
    if (filters.createdFrom) conditions.push(gte(tasks.createdAt, filters.createdFrom));
    if (filters.createdTo) conditions.push(lte(tasks.createdAt, filters.createdTo));
    if (filters.deadlineFrom) conditions.push(gte(tasks.deadline, filters.deadlineFrom));
    if (filters.deadlineTo) conditions.push(lte(tasks.deadline, filters.deadlineTo));
  }

  const baseQuery = db.select().from(tasks).where(and(...conditions));

  // Sem filtros → comportamento getAllTasks (sem paginação).
  if (!filters) return await baseQuery;

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  return await baseQuery.limit(pageSize).offset((page - 1) * pageSize);
}

export async function updateTaskForOrganization(
  id: number,
  organizationId: number,
  updates: Partial<InsertTask>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!(await assertTaskInOrganization(id, organizationId))) return false;
  const result = await db
    .update(tasks)
    .set(updates)
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}

export async function updateTaskStatusForOrganization(
  id: number,
  organizationId: number,
  status: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!(await assertTaskInOrganization(id, organizationId))) return false;
  const result = await db
    .update(tasks)
    .set({ status: status as TaskStatusValue })
    .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId)));
  return (result[0]?.affectedRows ?? 0) > 0;
}

export async function deleteTaskForOrganization(
  id: number,
  organizationId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return (await deleteTaskForOrganizationWithAttachments(id, organizationId)).deleted;
}

/**
 * PROMPT 09 — exclusão da tarefa numa TRANSAÇÃO com a linha da tarefa travada (`FOR UPDATE`): serializa com o upload de
 * anexo (que trava a mesma linha antes de inserir) e devolve os anexos efetivamente removidos — inclusive um que tenha
 * entrado depois da listagem feita pelo chamador —, para que nenhum objeto do S3 fique sem tratamento.
 */
export async function deleteTaskForOrganizationWithAttachments(
  id: number,
  organizationId: number,
): Promise<{ deleted: boolean; attachments: Array<{ id: number; taskId: number; fileUrl: string }> }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const owned = await tx.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId))).limit(1).for("update");
    if (owned.length === 0) return { deleted: false, attachments: [] };
    const attachments = await tx.select({ id: taskAttachments.id, taskId: taskAttachments.taskId, fileUrl: taskAttachments.fileUrl })
      .from(taskAttachments).where(eq(taskAttachments.taskId, id));
    // Mantém a cascata existente (comments/attachments/history/locks).
    await tx.delete(taskComments).where(eq(taskComments.taskId, id));
    await tx.delete(taskAttachments).where(eq(taskAttachments.taskId, id));
    await tx.delete(taskHistory).where(eq(taskHistory.taskId, id));
    await tx.delete(taskEditLocks).where(eq(taskEditLocks.taskId, id));
    await tx.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.organizationId, organizationId)));
    return { deleted: true, attachments };
  });
}

export async function getTaskStatsForOrganization(organizationId: number, assignedTo?: number) {
  const db = await getDb();
  if (!db) return { total: 0, inProgress: 0, completed: 0, overdue: 0 };
  const conditions: SQL[] = [eq(tasks.organizationId, organizationId)];
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));
  const allTasks = await db.select().from(tasks).where(and(...conditions));
  const now = new Date();
  return {
    total: allTasks.length,
    inProgress: allTasks.filter((t) => t.status === "em_andamento").length,
    completed: allTasks.filter((t) => t.status === "concluida").length,
    overdue: allTasks.filter((t) => t.deadline && t.deadline < now && t.status !== "concluida").length,
  };
}

export async function getOverdueTasksForOrganization(organizationId: number, assignedTo?: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const conditions: SQL[] = [
    eq(tasks.organizationId, organizationId),
    lt(tasks.deadline, now),
    ne(tasks.status, "concluida"),
  ];
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo));
  return await db.select().from(tasks).where(and(...conditions));
}

export async function listTaskCommentsForOrganization(taskId: number, organizationId: number) {
  if (!(await assertTaskInOrganization(taskId, organizationId))) return [];
  return listTaskComments(taskId);
}

export async function createTaskCommentForOrganization(
  comment: { taskId: number; userId: number; content: string },
  organizationId: number,
): Promise<number | null> {
  if (!(await assertTaskInOrganization(comment.taskId, organizationId))) return null;
  return createTaskComment(comment);
}

export async function listTaskAttachmentsForOrganization(taskId: number, organizationId: number) {
  if (!(await assertTaskInOrganization(taskId, organizationId))) return [];
  return listTaskAttachments(taskId);
}

/**
 * SEC-037 — Cria um anexo de tarefa com isolamento por tenant. Só grava se a
 * tarefa pertencer à organização (fail-closed). Cross-tenant/inexistente → null,
 * sem revelar existência em outra organização. Persiste apenas colunas válidas
 * (a referência de arquivo é a chave/URL do S3 — nunca binário no banco).
 */
export async function createTaskAttachmentForOrganization(
  attachment: {
    taskId: number;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    uploadedBy: number;
  },
  organizationId: number,
): Promise<number | null> {
  // PROMPT 09 — checagem de posse e inserção na MESMA transação, com a linha da tarefa travada: um anexo nunca é inserido
  // para tarefa já excluída (sem FK em task_attachments), nem escapa da exclusão concorrente da tarefa.
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const owned = await tx.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.id, attachment.taskId), eq(tasks.organizationId, organizationId))).limit(1).for("update");
    if (owned.length === 0) return null;
    const result = await tx.insert(taskAttachments).values(attachment);
    return result[0].insertId;
  });
}

/** PROMPT 08 / D-3 — anexo pelo id, SÓ se a tarefa-mãe pertence ao órgão (outro órgão/inexistente ⇒ null). */
export async function getTaskAttachmentForOrganization(attachmentId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: taskAttachments.id, taskId: taskAttachments.taskId, fileName: taskAttachments.fileName, fileUrl: taskAttachments.fileUrl })
    .from(taskAttachments)
    .innerJoin(tasks, eq(taskAttachments.taskId, tasks.id))
    .where(and(eq(taskAttachments.id, attachmentId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteTaskAttachmentForOrganization(
  attachmentId: number,
  organizationId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: taskAttachments.id })
    .from(taskAttachments)
    .innerJoin(tasks, eq(taskAttachments.taskId, tasks.id))
    .where(and(eq(taskAttachments.id, attachmentId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (rows.length === 0) return false;
  await deleteTaskAttachment(attachmentId);
  return true;
}
