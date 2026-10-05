import { eq, and, or, desc, isNull, inArray } from "drizzle-orm";
import {
  activityLogs, documentSettings, processMembers, notifications, stageAssignments,
  processes, users, organizationMembers,
  InsertActivityLog, InsertDocumentSettings, InsertProcessMember, InsertNotification,
  InsertStageAssignment,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import { getProcessByIdForOrganization } from "./processes";

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

// ─── RC-SEC-PR-A — Variantes tenant-scoped de activity logs ─────────────────
// `activity_logs.processId` é nullable. Para logs vinculados a processo, o
// isolamento é feito validando o processo-pai pela organização. Cross-tenant
// e inexistente retornam o MESMO resultado externo ([]/no-op via injeção).

export async function getActivityLogsByProcessForOrganization(
  processId: number,
  organizationId: number,
) {
  const process = await getProcessByIdForOrganization(processId, organizationId);
  if (!process) return [];
  return getActivityLogsByProcess(processId);
}

/**
 * SEM-046 — relatório de atividades da ORGANIZAÇÃO em UMA consulta (antes: N+1 por processo, sem nome do ator).
 * Inclui (a) logs com `organizationId` = a organização (inclusive os org-level, sem processo) e (b) logs LEGADOS sem
 * `organizationId` cujo processo pertence à organização. Log com OUTRA organização nunca entra, mesmo que aponte para
 * um processo desta. O nome do ator vem do snapshot `actorName` (imutável) ou, na falta dele, de `users.name`.
 */
export async function getActivityReportForOrganization(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const orgProcessIds = db.select({ id: processes.id }).from(processes).where(eq(processes.organizationId, organizationId));
  const rows = await db
    .select({ log: activityLogs, userName: users.name })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .where(or(
      eq(activityLogs.organizationId, organizationId),
      and(isNull(activityLogs.organizationId), inArray(activityLogs.processId, orgProcessIds)),
    ))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id));
  return rows.map((r) => ({ ...r.log, userDisplayName: r.userName ?? null }));
}

export async function createActivityLogForOrganization(
  log: Omit<InsertActivityLog, "organizationId">,
  organizationId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(activityLogs).values({ ...log, organizationId });
}

/**
 * EXTENSÃO DOCUMENTAL da organização — TENANT-SCOPED (1 linha por organização).
 * Upsert idempotente pela chave única `organizationId` (`documentSettings_org_unique`): grava/atualiza
 * apenas os atributos de EXTENSÃO (logo/endereço/contato/rodapé), nunca por usuário. Nome/CNPJ NÃO
 * moram aqui — são canônicos em `organizations`. Enforcement de RBAC (admin/owner) e auditoria ficam
 * no router; aqui é só a persistência determinística.
 */
export async function upsertDocumentSettings(settings: InsertDocumentSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(documentSettings).values(settings).onDuplicateKeyUpdate({
    set: {
      logoUrl: settings.logoUrl, address: settings.address, phone: settings.phone,
      email: settings.email, website: settings.website, footerText: settings.footerText,
    },
  });
}

/**
 * Lê a EXTENSÃO documental da ORGANIZAÇÃO (tenant-scoped, determinística). Substitui a antiga leitura
 * per-user (chaveada por userId), fonte do defeito multi-tenant em que usuários diferentes da mesma
 * organização geravam documentos com identidades divergentes. Nome/CNPJ vêm de `organizations` (via
 * `InstitutionalIdentityService`), não daqui.
 */
export async function getDocumentSettingsByOrg(organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(documentSettings)
    .where(eq(documentSettings.organizationId, organizationId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Resolve o `organizationId` (tenant) de um processo pelo id. Usado por superfícies que precisam da
 * identidade institucional TENANT-SCOPED do processo (ex.: metadados de publicação) sem depender de
 * configuração pessoal de usuário. Retorna null quando o processo não existe ou não tem organização.
 */
export async function getProcessOrganizationId(processId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({ organizationId: processes.organizationId })
    .from(processes)
    .where(eq(processes.id, processId))
    .limit(1);
  return result.length > 0 ? (result[0].organizationId ?? null) : null;
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

/**
 * R1 / SEM-001 — membros do processo VISÍVEIS no tenant: só associações cujo usuário tem membership (ativa ou não)
 * na organização do contexto. Associações HISTÓRICAS com usuário de outro órgão nunca têm identidade exposta: são
 * omitidas da lista (nada é apagado — saneamento é operação governada à parte) e contadas em `hiddenCount` para o
 * aviso de integridade sem PII. O chamador DEVE ter resolvido o processo no mesmo `organizationId`.
 */
export async function getProcessMembersForOrganization(processId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return { members: [], hiddenCount: 0 };
  const rows = await db
    .select({
      id: processMembers.id, userId: processMembers.userId,
      permission: processMembers.permission,
      functionalRole: processMembers.functionalRole,
      invitedBy: processMembers.invitedBy,
      createdAt: processMembers.createdAt, userName: users.name, userEmail: users.email,
      tenantMembershipId: organizationMembers.id,
    })
    .from(processMembers)
    .leftJoin(organizationMembers, and(
      eq(organizationMembers.userId, processMembers.userId),
      eq(organizationMembers.organizationId, organizationId),
    ))
    .leftJoin(users, eq(processMembers.userId, users.id))
    .where(eq(processMembers.processId, processId))
    .orderBy(desc(processMembers.createdAt));
  const members = rows.filter((r) => r.tenantMembershipId !== null).map(({ tenantMembershipId: _t, ...m }) => m);
  return { members, hiddenCount: rows.length - members.length };
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
    .set({ functionalRole })
    .where(and(eq(processMembers.processId, processId), eq(processMembers.userId, userId)));
}

// ─── R1 / PR-01A (NEW-001) — atribuição de etapa ATÔMICA ─────────────────────────────────────────────────
// Primitivas que RECEBEM o executor da transação (nunca chamam `getDb()` por dentro): atribuição, notificação e
// activity log são escritas LOCAIS correlacionadas e precisam compartilhar a MESMA conexão/transação. A
// orquestração (transação + regra de replay) fica em `services/stageAssignmentService.ts`.

type CollaborationDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type CollaborationExecutor = CollaborationDb | Parameters<Parameters<CollaborationDb["transaction"]>[0]>[0];
export type StageDocType = InsertStageAssignment["docType"];

/**
 * Lock da linha-pai `processes` (mutex por processo, mesmo padrão do `documentVersionService`), re-verificando o
 * tenant DENTRO da transação. `stage_assignments` não tem chave única em (processId, docType); serializar pelo
 * processo impede que duas atribuições concorrentes da mesma etapa insiram linhas duplicadas.
 */
export async function lockProcessForOrganizationTx(tx: CollaborationExecutor, processId: number, organizationId: number) {
  const rows = await tx
    .select({ id: processes.id })
    .from(processes)
    .where(and(eq(processes.id, processId), eq(processes.organizationId, organizationId)))
    .for("update");
  return rows.length > 0;
}

export async function getStageAssignmentRowsTx(tx: CollaborationExecutor, processId: number, docType: StageDocType) {
  return tx
    .select({ id: stageAssignments.id, assignedUserId: stageAssignments.assignedUserId, note: stageAssignments.note })
    .from(stageAssignments)
    .where(and(eq(stageAssignments.processId, processId), eq(stageAssignments.docType, docType)));
}

export async function insertStageAssignmentTx(tx: CollaborationExecutor, assignment: InsertStageAssignment) {
  await tx.insert(stageAssignments).values(assignment);
}

/** Converge TODAS as linhas da etapa (inclusive duplicatas históricas) ao estado pedido — nenhuma é apagada. */
export async function updateStageAssignmentTx(
  tx: CollaborationExecutor,
  processId: number,
  docType: StageDocType,
  set: { assignedUserId: number; assignedBy: number; note: string | null },
) {
  await tx
    .update(stageAssignments)
    .set(set)
    .where(and(eq(stageAssignments.processId, processId), eq(stageAssignments.docType, docType)));
}

export async function insertNotificationTx(tx: CollaborationExecutor, notification: InsertNotification) {
  await tx.insert(notifications).values(notification);
}

export async function insertActivityLogForOrganizationTx(
  tx: CollaborationExecutor,
  log: Omit<InsertActivityLog, "organizationId">,
  organizationId: number,
) {
  await tx.insert(activityLogs).values({ ...log, organizationId });
}

export async function removeStageAssignment(
  processId: number,
  docType: "dfd" | "etp" | "tr" | "edital" | "contrato" | "ata" | "parecer"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(stageAssignments)
    .where(and(eq(stageAssignments.processId, processId), eq(stageAssignments.docType, docType)));
}

/**
 * R1 / SEM-001 — atribuições de etapa VISÍVEIS no tenant (mesmo contrato de `getProcessMembersForOrganization`):
 * atribuição histórica a usuário de outro órgão é omitida (id/nome nunca expostos) e contada em `hiddenCount`.
 */
export async function getStageAssignmentsForOrganization(processId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return { assignments: [], hiddenCount: 0 };
  const rows = await db
    .select({
      id: stageAssignments.id,
      processId: stageAssignments.processId,
      docType: stageAssignments.docType,
      assignedUserId: stageAssignments.assignedUserId,
      assignedBy: stageAssignments.assignedBy,
      note: stageAssignments.note,
      createdAt: stageAssignments.createdAt,
      assignedUserName: users.name,
      tenantMembershipId: organizationMembers.id,
    })
    .from(stageAssignments)
    .leftJoin(organizationMembers, and(
      eq(organizationMembers.userId, stageAssignments.assignedUserId),
      eq(organizationMembers.organizationId, organizationId),
    ))
    .leftJoin(users, eq(stageAssignments.assignedUserId, users.id))
    .where(eq(stageAssignments.processId, processId));
  const assignments = rows.filter((r) => r.tenantMembershipId !== null).map(({ tenantMembershipId: _t, ...a }) => a);
  return { assignments, hiddenCount: rows.length - assignments.length };
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

export async function markNotificationAsRead(notificationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Escopo por dono: um usuário só marca como lida a PRÓPRIA notificação (no-op para as de outrem).
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}
