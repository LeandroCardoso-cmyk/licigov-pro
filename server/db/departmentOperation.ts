/**
 * FASE 5 — Centro de Operações Persistence Repository
 *
 * Persiste APENAS os dados próprios do Centro de Operações (registros legados/manuais,
 * eventos, marcos, timeline, publicações, config). NUNCA duplica dados dos Business
 * Domains — a consolidação lê os domínios por referência no serviço. Padrão getDb():
 * degrada sem DB. Multi-tenant por organization_id.
 */

import { and, asc, desc, eq, gt, gte, inArray, lte, max, ne, or } from "drizzle-orm";
import { getDb } from "./connection";
import { toDbDatetime, fromDbDatetime } from "./institutionalConsultations";
import {
  operationRecordsTable, operationalEventsTable, operationalMilestonesTable,
  operationalTimelineTable, publicationRecordsTable, operationalSettingsTable, organizations,
} from "../../drizzle/schema";
import type { OperationRecord } from "../domain/operationRecord";
import { createOperationalTimelineEntry } from "../domain/operationalTimeline";
import type { OperationRecordSchedule } from "../domain/operationRecordSchedule";
import {
  normalizeLifecycle, planLifecycleTransition, lifecycleTimelineSummary, LIFECYCLE_TIMELINE_ACTION,
  type LifecycleAction, type OperationRecordLifecycle,
} from "../domain/operationRecordLifecycle";
import type { OperationalEvent } from "../domain/operationalEvent";
import type { OperationalMilestone } from "../domain/operationalMilestone";
import type { OperationalTimelineEntry } from "../domain/operationalTimeline";
import type { PublicationRecord } from "../domain/publicationRecord";

const toDb = (iso: string): string => toDbDatetime(iso) ?? iso;
const fromDb = (value: string): string => fromDbDatetime(value) ?? value;

// ─── Operation records ─────────────────────────────────────────────────────────

export async function insertOperationRecord(r: OperationRecord): Promise<OperationRecord | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(operationRecordsTable).values({
    id: r.id, organizationId: r.organizationId, recordType: r.recordType, origin: r.origin, number: r.number,
    object: r.object, modality: r.modality, currentStage: r.currentStage, responsible: r.responsible,
    referenceType: r.referenceType, referenceId: r.referenceId, documentReferences: JSON.stringify(r.documentReferences),
    notes: r.notes, eventDate: r.eventDate, eventEndDate: r.eventEndDate, eventTime: r.eventTime,
    correlationId: r.correlationId, createdAt: toDb(r.createdAt), updatedAt: toDb(r.updatedAt),
  }).onDuplicateKeyUpdate({ set: { currentStage: r.currentStage, object: r.object, notes: r.notes, updatedAt: toDb(r.updatedAt) } });
  return r;
}

export interface OperationRecordListRow {
  id: string; recordType: string; origin: string; number: string; object: string;
  modality: string; currentStage: string; responsible: number | null;
  eventDate: string; eventEndDate: string; eventTime: string; createdAt: string;
  lifecycleStatus: OperationRecordLifecycle; completedAt: string | null; completedBy: number | null;
}

function mapOperationRecordRow(r: typeof operationRecordsTable.$inferSelect): OperationRecordListRow {
  return {
    id: r.id, recordType: r.recordType, origin: r.origin, number: r.number,
    object: r.object ?? "", modality: r.modality, currentStage: r.currentStage,
    responsible: r.responsible ?? null, eventDate: r.eventDate,
    eventEndDate: r.eventEndDate, eventTime: r.eventTime, createdAt: fromDb(r.createdAt),
    lifecycleStatus: normalizeLifecycle(r.lifecycleStatus),
    completedAt: r.completedAt ? fromDb(r.completedAt) : null, completedBy: r.completedBy ?? null,
  };
}

export type OperationRecordLifecycleFilter = OperationRecordLifecycle | "all";

/** Filtro de ciclo de vida: registros anteriores à 0309 são `active` (default da coluna). */
function lifecycleCondition(filter: OperationRecordLifecycleFilter) {
  if (filter === "all") return undefined;
  return filter === "completed"
    ? eq(operationRecordsTable.lifecycleStatus, "completed")
    : ne(operationRecordsTable.lifecycleStatus, "completed");
}

export async function listOperationRecords(orgId: number, limit = 100, lifecycle: OperationRecordLifecycleFilter = "all"): Promise<OperationRecordListRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationRecordsTable)
    .where(and(eq(operationRecordsTable.organizationId, orgId), lifecycleCondition(lifecycle)))
    .orderBy(desc(operationRecordsTable.updatedAt)).limit(limit);
  return rows.map(mapOperationRecordRow);
}

/** Quantidade de registros concluídos do tenant (métrica de histórico, separada dos ativos). */
export async function countCompletedOperationRecords(orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: operationRecordsTable.id }).from(operationRecordsTable)
    .where(and(eq(operationRecordsTable.organizationId, orgId), eq(operationRecordsTable.lifecycleStatus, "completed")));
  return rows.length;
}

/**
 * Somente registros ATIVOS cuja agenda intercepta a janela, sempre isolados por tenant. A agenda base de um
 * registro concluído sai do calendário operacional (permanece persistida; eventos vinculados seguem próprios).
 */
export async function listScheduledOperationRecords(orgId: number, from: string, to: string, limit = 2000): Promise<OperationRecordListRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationRecordsTable).where(and(
    eq(operationRecordsTable.organizationId, orgId),
    lifecycleCondition("active"),
    gt(operationRecordsTable.eventDate, ""),
    lte(operationRecordsTable.eventDate, to),
    or(and(eq(operationRecordsTable.eventEndDate, ""), gte(operationRecordsTable.eventDate, from)),
      gte(operationRecordsTable.eventEndDate, from)),
  )).orderBy(asc(operationRecordsTable.eventDate)).limit(limit);
  return rows.map(mapOperationRecordRow);
}

/** Atualização idempotente e auditada da agenda de um registro existente. */
export async function setOperationRecordSchedule(params: {
  organizationId: number; recordId: string; schedule: OperationRecordSchedule;
  actor: string; correlationId: string;
}): Promise<{ record: OperationRecordListRow; changed: boolean } | null> {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, params.organizationId)).for("update").limit(1);
    if (!organization) return null;
    const rows = await tx.select().from(operationRecordsTable).where(and(
      eq(operationRecordsTable.organizationId, params.organizationId), eq(operationRecordsTable.id, params.recordId),
    )).for("update").limit(1);
    const before = rows[0];
    if (!before) return null;
    const { eventDate, eventEndDate, eventTime } = params.schedule;
    if (before.eventDate === eventDate && before.eventEndDate === eventEndDate && before.eventTime === eventTime) {
      return { record: mapOperationRecordRow(before), changed: false };
    }
    const updatedAt = toDb(new Date().toISOString());
    await tx.update(operationRecordsTable).set({ eventDate, eventEndDate, eventTime, updatedAt })
      .where(and(eq(operationRecordsTable.organizationId, params.organizationId), eq(operationRecordsTable.id, params.recordId)));
    const [orderRow] = await tx.select({ value: max(operationalTimelineTable.eventOrder) })
      .from(operationalTimelineTable).where(eq(operationalTimelineTable.organizationId, params.organizationId));
    const entry = createOperationalTimelineEntry({
      organizationId: params.organizationId, order: Number(orderRow?.value ?? -1) + 1,
      actor: params.actor, action: "agenda_registro_atualizada", referenceType: "operation_record",
      referenceId: params.recordId, summary: eventDate
        ? `Agenda do registro definida para ${eventDate}${eventEndDate ? ` a ${eventEndDate}` : ""}${eventTime ? ` às ${eventTime}` : " (dia inteiro)"}.`
        : "Agenda do registro removida.", correlationId: params.correlationId,
    });
    await tx.insert(operationalTimelineTable).values({
      id: entry.id, organizationId: entry.organizationId, eventOrder: entry.order,
      actor: entry.actor, action: entry.action, referenceType: entry.referenceType,
      referenceId: entry.referenceId, summary: entry.summary, correlationId: entry.correlationId,
      createdAt: toDb(entry.createdAt),
    });
    return { record: mapOperationRecordRow({ ...before, eventDate, eventEndDate, eventTime, updatedAt }), changed: true };
  });
}

/** Próxima ordem da timeline do tenant, dentro da transação corrente. */
async function nextTimelineOrder(tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0], orgId: number): Promise<number> {
  const [orderRow] = await tx.select({ value: max(operationalTimelineTable.eventOrder) })
    .from(operationalTimelineTable).where(eq(operationalTimelineTable.organizationId, orgId));
  return Number(orderRow?.value ?? -1) + 1;
}

export interface LifecycleTransitionResult {
  record: OperationRecordListRow;
  changed: boolean;
  from: OperationRecordLifecycle;
  to: OperationRecordLifecycle;
}

/**
 * Concluir/reabrir um registro do tenant: transação com lock da organização e do registro, transição
 * idempotente (repetir não escreve nem duplica timeline) e entrada append-only na timeline com estado
 * anterior/posterior, ator e correlationId. NÃO apaga agenda, eventos vinculados nem histórico.
 * Registro de outro tenant ⇒ null (não vaza existência).
 */
export async function transitionOperationRecordLifecycle(params: {
  organizationId: number; recordId: string; action: LifecycleAction;
  actorUserId: number; reason: string; correlationId: string;
}): Promise<LifecycleTransitionResult | null> {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, params.organizationId)).for("update").limit(1);
    if (!organization) return null;
    const [before] = await tx.select().from(operationRecordsTable).where(and(
      eq(operationRecordsTable.organizationId, params.organizationId), eq(operationRecordsTable.id, params.recordId),
    )).for("update").limit(1);
    if (!before) return null;
    const plan = planLifecycleTransition(before.lifecycleStatus, params.action);
    if (plan.kind === "noop") return { record: mapOperationRecordRow(before), changed: false, from: plan.state, to: plan.state };
    const now = toDb(new Date().toISOString());
    const patch = plan.to === "completed"
      ? { lifecycleStatus: "completed", completedAt: now, completedBy: params.actorUserId, completionReason: params.reason || null, updatedAt: now }
      : { lifecycleStatus: "active", completedAt: null, completedBy: null, completionReason: null, updatedAt: now };
    await tx.update(operationRecordsTable).set(patch).where(and(
      eq(operationRecordsTable.organizationId, params.organizationId), eq(operationRecordsTable.id, params.recordId),
    ));
    const entry = createOperationalTimelineEntry({
      organizationId: params.organizationId, order: await nextTimelineOrder(tx, params.organizationId),
      actor: String(params.actorUserId), action: LIFECYCLE_TIMELINE_ACTION[params.action], referenceType: "operation_record",
      referenceId: params.recordId, summary: lifecycleTimelineSummary(plan.from, plan.to, params.reason), correlationId: params.correlationId,
    });
    await tx.insert(operationalTimelineTable).values({
      id: entry.id, organizationId: entry.organizationId, eventOrder: entry.order,
      actor: entry.actor, action: entry.action, referenceType: entry.referenceType,
      referenceId: entry.referenceId, summary: entry.summary, correlationId: entry.correlationId,
      createdAt: toDb(entry.createdAt),
    });
    return { record: mapOperationRecordRow({ ...before, ...patch }), changed: true, from: plan.from, to: plan.to };
  });
}

/** Todos os registros do tenant (sem limite de página) para o planejamento do backfill. */
export async function listOperationRecordsForBackfill(orgId: number): Promise<Array<OperationRecordListRow>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationRecordsTable).where(eq(operationRecordsTable.organizationId, orgId));
  return rows.map(mapOperationRecordRow);
}

/** Eventos vinculados a registros operacionais do tenant (conferência de equivalência antes de criar). */
export async function listRecordLinkedEvents(orgId: number): Promise<Array<{ id: string; eventType: string; title: string; eventDate: string; eventTime: string; referenceId: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationalEventsTable).where(and(
    eq(operationalEventsTable.organizationId, orgId), eq(operationalEventsTable.referenceType, "operation_record"),
  ));
  return rows.map((r) => ({ id: r.id, eventType: r.eventType, title: r.title, eventDate: r.eventDate, eventTime: r.eventTime, referenceId: r.referenceId }));
}

export class BackfillStateChangedError extends Error {
  constructor(readonly recordId: string) {
    super(`O registro ${recordId} mudou desde o planejamento (agenda não está mais vazia ou saiu do tenant); nada foi gravado.`);
    this.name = "BackfillStateChangedError";
  }
}

/**
 * Aplica, em UMA transação, a agenda de dia inteiro nos registros planejados como MATCH: lock da organização
 * e dos registros; reconfere que cada agenda continua VAZIA (senão rollback total); atualiza e registra uma
 * entrada de timeline por registro com o correlationId da execução. Nunca insere registro.
 */
export async function applyOperationRecordScheduleBackfill(params: {
  organizationId: number; updates: Array<{ recordId: string; eventDate: string }>;
  actor: string; correlationId: string;
}): Promise<{ updated: string[] } | null> {
  const db = await getDb();
  if (!db) return null;
  if (params.updates.length === 0) return { updated: [] };
  return db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, params.organizationId)).for("update").limit(1);
    if (!organization) throw new Error("Organização não encontrada.");
    const ids = params.updates.map((u) => u.recordId);
    const rows = await tx.select().from(operationRecordsTable).where(and(
      eq(operationRecordsTable.organizationId, params.organizationId), inArray(operationRecordsTable.id, ids),
    )).for("update");
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const u of params.updates) {
      const r = byId.get(u.recordId);
      if (!r || r.eventDate || r.eventEndDate || r.eventTime) throw new BackfillStateChangedError(u.recordId);
    }
    let order = await nextTimelineOrder(tx, params.organizationId);
    const updatedAt = toDb(new Date().toISOString());
    for (const u of params.updates) {
      await tx.update(operationRecordsTable).set({ eventDate: u.eventDate, eventEndDate: "", eventTime: "", updatedAt }).where(and(
        eq(operationRecordsTable.organizationId, params.organizationId), eq(operationRecordsTable.id, u.recordId),
        eq(operationRecordsTable.eventDate, ""), eq(operationRecordsTable.eventEndDate, ""), eq(operationRecordsTable.eventTime, ""),
      ));
      const entry = createOperationalTimelineEntry({
        organizationId: params.organizationId, order: order++, actor: params.actor, action: "agenda_registro_atualizada",
        referenceType: "operation_record", referenceId: u.recordId,
        summary: `Agenda do registro definida para ${u.eventDate} (dia inteiro) — preenchimento em lote conferido.`,
        correlationId: params.correlationId,
      });
      await tx.insert(operationalTimelineTable).values({
        id: entry.id, organizationId: entry.organizationId, eventOrder: entry.order,
        actor: entry.actor, action: entry.action, referenceType: entry.referenceType,
        referenceId: entry.referenceId, summary: entry.summary, correlationId: entry.correlationId,
        createdAt: toDb(entry.createdAt),
      });
    }
    return { updated: ids };
  });
}

// ─── Events ────────────────────────────────────────────────────────────────────

export async function insertOperationalEvent(e: OperationalEvent): Promise<OperationalEvent | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(operationalEventsTable).values({
    id: e.id, organizationId: e.organizationId, eventType: e.eventType, title: e.title, eventDate: e.eventDate,
    eventTime: e.eventTime, referenceType: e.referenceType, referenceId: e.referenceId,
    autoGenerated: e.autoGenerated ? 1 : 0, alertOffsetDays: e.alertOffsetDays, correlationId: e.correlationId, createdAt: toDb(e.createdAt),
  }).onDuplicateKeyUpdate({ set: { title: e.title, eventDate: e.eventDate, eventTime: e.eventTime } });
  return e;
}

/** Evento manual + timeline em um commit; repetir a mesma solicitação não duplica auditoria. */
export async function insertManualOperationalEvent(e: OperationalEvent, actor: string): Promise<boolean | null> {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async (tx) => {
    const [organization] = await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, e.organizationId)).for("update").limit(1);
    if (!organization) throw new Error("Organização não encontrada.");
    if (e.referenceType === "operation_record") {
      const [record] = await tx.select({ id: operationRecordsTable.id }).from(operationRecordsTable)
        .where(and(eq(operationRecordsTable.organizationId, e.organizationId), eq(operationRecordsTable.id, e.referenceId))).limit(1);
      if (!record) throw new Error("Registro de referência não encontrado nesta organização.");
    }
    const [existing] = await tx.select().from(operationalEventsTable)
      .where(eq(operationalEventsTable.id, e.id)).for("update").limit(1);
    if (existing) {
      if (existing.organizationId !== e.organizationId || existing.eventType !== e.eventType ||
          existing.title !== e.title || existing.eventDate !== e.eventDate || existing.eventTime !== e.eventTime ||
          existing.referenceType !== e.referenceType || existing.referenceId !== e.referenceId || existing.autoGenerated !== 0) {
        throw new Error("Já existe um evento diferente para este registro, tipo e data.");
      }
      return false;
    }
    const peers = await tx.select({ id: operationalEventsTable.id }).from(operationalEventsTable).where(and(
      eq(operationalEventsTable.organizationId, e.organizationId),
      eq(operationalEventsTable.eventType, e.eventType),
      eq(operationalEventsTable.eventDate, e.eventDate),
      eq(operationalEventsTable.referenceType, e.referenceType),
      eq(operationalEventsTable.referenceId, e.referenceId),
    )).for("update");
    if (peers.length > 0) throw new Error("Já existe um evento para este registro, tipo e data.");
    await tx.insert(operationalEventsTable).values({
      id: e.id, organizationId: e.organizationId, eventType: e.eventType, title: e.title,
      eventDate: e.eventDate, eventTime: e.eventTime, referenceType: e.referenceType,
      referenceId: e.referenceId, autoGenerated: 0, alertOffsetDays: 0,
      correlationId: e.correlationId, createdAt: toDb(e.createdAt),
    });
    const [orderRow] = await tx.select({ value: max(operationalTimelineTable.eventOrder) })
      .from(operationalTimelineTable).where(eq(operationalTimelineTable.organizationId, e.organizationId));
    const entry = createOperationalTimelineEntry({
      organizationId: e.organizationId, order: Number(orderRow?.value ?? -1) + 1,
      actor, action: "evento_criado", referenceType: "operational_event", referenceId: e.id,
      summary: `Evento "${e.title}" cadastrado no calendário.`, correlationId: e.correlationId,
    });
    await tx.insert(operationalTimelineTable).values({
      id: entry.id, organizationId: entry.organizationId, eventOrder: entry.order,
      actor: entry.actor, action: entry.action, referenceType: entry.referenceType,
      referenceId: entry.referenceId, summary: entry.summary, correlationId: entry.correlationId,
      createdAt: toDb(entry.createdAt),
    });
    return true;
  });
}

export async function listOperationalEvents(orgId: number, opts: { from?: string; to?: string; limit?: number } = {}): Promise<Array<{ id: string; eventType: string; title: string; eventDate: string; eventTime: string; referenceType: string; referenceId: string; autoGenerated: boolean; alertOffsetDays: number }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationalEventsTable)
    .where(and(eq(operationalEventsTable.organizationId, orgId),
      opts.from ? gte(operationalEventsTable.eventDate, opts.from) : undefined,
      opts.to ? lte(operationalEventsTable.eventDate, opts.to) : undefined,
    )).orderBy(asc(operationalEventsTable.eventDate)).limit(opts.limit ?? 200);
  return rows.map(r => ({ id: r.id, eventType: r.eventType, title: r.title, eventDate: r.eventDate, eventTime: r.eventTime, referenceType: r.referenceType, referenceId: r.referenceId, autoGenerated: r.autoGenerated === 1, alertOffsetDays: r.alertOffsetDays }));
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export async function insertOperationalMilestone(m: OperationalMilestone): Promise<OperationalMilestone | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(operationalMilestonesTable).values({
    id: m.id, organizationId: m.organizationId, referenceType: m.referenceType, referenceId: m.referenceId,
    milestoneType: m.milestoneType, date: m.date, time: m.time, result: m.result, observation: m.observation,
    correlationId: m.correlationId, createdAt: toDb(m.createdAt),
  }).onDuplicateKeyUpdate({ set: { date: m.date, time: m.time, result: m.result, observation: m.observation } });
  return m;
}

export async function listOperationalMilestones(referenceId: string, orgId: number): Promise<Array<{ id: string; milestoneType: string; date: string; time: string; result: string; observation: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationalMilestonesTable)
    .where(and(eq(operationalMilestonesTable.referenceId, referenceId), eq(operationalMilestonesTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, milestoneType: r.milestoneType, date: r.date, time: r.time, result: r.result, observation: r.observation ?? "" }));
}

// ─── Operational timeline ──────────────────────────────────────────────────────

export async function countOperationalTimeline(orgId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ id: operationalTimelineTable.id }).from(operationalTimelineTable)
    .where(eq(operationalTimelineTable.organizationId, orgId));
  return rows.length;
}

export async function insertOperationalTimelineEntry(e: OperationalTimelineEntry): Promise<OperationalTimelineEntry | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(operationalTimelineTable).values({
    id: e.id, organizationId: e.organizationId, eventOrder: e.order, actor: e.actor, action: e.action,
    referenceType: e.referenceType, referenceId: e.referenceId, summary: e.summary, correlationId: e.correlationId, createdAt: toDb(e.createdAt),
  }).onDuplicateKeyUpdate({ set: { summary: e.summary } });
  return e;
}

export async function listOperationalTimeline(orgId: number, limit = 100): Promise<Array<{ id: string; order: number; actor: string; action: string; referenceType: string; referenceId: string; summary: string; createdAt: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(operationalTimelineTable)
    .where(eq(operationalTimelineTable.organizationId, orgId)).orderBy(desc(operationalTimelineTable.eventOrder)).limit(limit);
  return rows.map(r => ({ id: r.id, order: r.eventOrder, actor: r.actor, action: r.action, referenceType: r.referenceType, referenceId: r.referenceId, summary: r.summary ?? "", createdAt: fromDb(r.createdAt) }));
}

// ─── Publications ──────────────────────────────────────────────────────────────

export async function upsertPublicationRecord(p: PublicationRecord): Promise<PublicationRecord | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(publicationRecordsTable).values({
    id: p.id, organizationId: p.organizationId, referenceType: p.referenceType, referenceId: p.referenceId,
    channel: p.channel, status: p.status, date: p.date, correlationId: p.correlationId, createdAt: toDb(p.createdAt), updatedAt: toDb(p.updatedAt),
  }).onDuplicateKeyUpdate({ set: { status: p.status, date: p.date, updatedAt: toDb(p.updatedAt) } });
  return p;
}

export async function listPublicationRecords(referenceId: string, orgId: number): Promise<Array<{ id: string; channel: string; status: string; date: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(publicationRecordsTable)
    .where(and(eq(publicationRecordsTable.referenceId, referenceId), eq(publicationRecordsTable.organizationId, orgId)));
  return rows.map(r => ({ id: r.id, channel: r.channel, status: r.status, date: r.date }));
}

// ─── Settings (canais configuráveis) ─────────────────────────────────────────

export async function getOperationalSettings(orgId: number): Promise<{ orgaoOficialName: string; jornalName: string; portalName: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(operationalSettingsTable)
    .where(eq(operationalSettingsTable.organizationId, orgId)).limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { orgaoOficialName: r.orgaoOficialName, jornalName: r.jornalName, portalName: r.portalName };
}

export async function upsertOperationalSettings(params: { organizationId: number; orgaoOficialName: string; jornalName: string; portalName: string; correlationId: string; updatedAt: string }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = `opset:${params.organizationId}`.slice(0, 20);
  await db.insert(operationalSettingsTable).values({
    id, organizationId: params.organizationId, orgaoOficialName: params.orgaoOficialName, jornalName: params.jornalName,
    portalName: params.portalName, correlationId: params.correlationId, createdAt: toDb(params.updatedAt), updatedAt: toDb(params.updatedAt),
  }).onDuplicateKeyUpdate({ set: { orgaoOficialName: params.orgaoOficialName, jornalName: params.jornalName, portalName: params.portalName, updatedAt: toDb(params.updatedAt) } });
}
