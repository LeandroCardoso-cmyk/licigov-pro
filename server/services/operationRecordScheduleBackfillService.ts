/**
 * Backfill ONE-OFF (genérico) da agenda de registros operacionais já existentes + eventos vinculados.
 *
 * O dataset é EXTERNO (arquivo local/stdin — nunca versionado). Fluxo:
 *   plan  → lê TODOS os registros e eventos vinculados do tenant, classifica cada entrada
 *           (MATCH / ALREADY_CORRECT / CONFLICT / NOT_FOUND / AMBIGUOUS) — nenhuma escrita (dry-run);
 *   apply → replaneja no momento da execução, exige o gate (nada bloqueado e contagem esperada), grava a
 *           agenda dos MATCH em UMA transação (reconferindo que continuam vazias) com timeline, e cria os
 *           eventos MATCH pelo fluxo existente e idempotente de eventos manuais (timeline incluída).
 * Nunca cria nem duplica registro; nunca sobrescreve agenda existente; replay ⇒ ALREADY_CORRECT.
 */
import {
  applyOperationRecordScheduleBackfill as applyScheduleBackfillTx, listOperationRecordsForBackfill, listRecordLinkedEvents,
} from "../db/departmentOperation";
import { planScheduleBackfill, type ScheduleBackfillDataset, type ScheduleBackfillPlan } from "../domain/operationRecordScheduleBackfill";
import { createManualEvent } from "./operationRecordService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("OperationRecordScheduleBackfill");

export async function planOperationRecordScheduleBackfill(params: {
  organizationId: number; dataset: ScheduleBackfillDataset; correlationId: string;
}): Promise<ScheduleBackfillPlan> {
  const [records, linked] = await Promise.all([
    listOperationRecordsForBackfill(params.organizationId),
    listRecordLinkedEvents(params.organizationId),
  ]);
  const plan = planScheduleBackfill(params.dataset, records, linked);
  log.info("operation_record_schedule_backfill_planned", {
    organizationId: params.organizationId, correlationId: params.correlationId, recordsScanned: records.length,
    schedules: plan.scheduleSummary, events: plan.eventSummary, canApply: plan.canApply,
  });
  return plan;
}

export interface BackfillApplyResult {
  plan: ScheduleBackfillPlan;
  applied: boolean;
  updatedRecordIds: string[];
  createdEvents: Array<{ item: string; number: string; eventId: string }>;
}

export async function applyOperationRecordScheduleBackfill(params: {
  organizationId: number; dataset: ScheduleBackfillDataset; actor: string; correlationId: string;
}): Promise<BackfillApplyResult> {
  const plan = await planOperationRecordScheduleBackfill(params);
  if (!plan.canApply) {
    log.warn("operation_record_schedule_backfill_blocked", { organizationId: params.organizationId, correlationId: params.correlationId, blockers: plan.blockers });
    return { plan, applied: false, updatedRecordIds: [], createdEvents: [] };
  }
  const updates = plan.schedules.filter((r) => r.status === "MATCH")
    .map((r) => ({ recordId: r.recordId!, eventDate: params.dataset.schedules.find((e) => String(Number(e.item)) === r.item)!.eventDate }));
  const res = await applyScheduleBackfillTx({
    organizationId: params.organizationId, updates, actor: params.actor, correlationId: params.correlationId,
  });
  if (!res) throw new Error("Banco de dados indisponível.");

  const createdEvents: BackfillApplyResult["createdEvents"] = [];
  for (const row of plan.events.filter((r) => r.status === "MATCH")) {
    const event = await createManualEvent({
      organizationId: params.organizationId, eventType: row.eventType as "certame" | "sessao_publica", title: row.title!,
      eventDate: row.eventDate, eventTime: row.eventTime, referenceType: "operation_record", referenceId: row.recordId!,
      actor: params.actor, correlationId: params.correlationId,
    });
    createdEvents.push({ item: row.item, number: row.number, eventId: event.id });
  }
  log.info("operation_record_schedule_backfill_applied", {
    organizationId: params.organizationId, correlationId: params.correlationId,
    updated: res.updated.length, alreadyCorrect: plan.scheduleSummary.ALREADY_CORRECT,
    eventsCreated: createdEvents.length, eventsAlreadyCorrect: plan.eventSummary.ALREADY_CORRECT,
  });
  return { plan, applied: true, updatedRecordIds: res.updated, createdEvents };
}
