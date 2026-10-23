/**
 * FASE 5 — Operation Record Service (Centro de Operações)
 *
 * Gerencia os dados PRÓPRIOS do Centro de Operações: registros legados/manuais,
 * importação assistida, marcos externos, publicações (status+data) e a geração
 * AUTOMÁTICA de eventos de vencimento (contrato/aditivo/ata) com alertas. Registra
 * tudo na timeline operacional (append-only). Nunca duplica dados dos domínios.
 * Degrada sem DB. Determinístico, multi-tenant, replay-safe.
 */

import {
  createOperationRecord, createLegacyImportRecord, expirationKindFor, type OperationRecordType, type OperationOrigin,
} from "../domain/operationRecord";
import { createExpirationEvents, createOperationalEvent, type OperationalEventType } from "../domain/operationalEvent";
import { createOperationalMilestone, type MilestoneType } from "../domain/operationalMilestone";
import { createOperationalTimelineEntry } from "../domain/operationalTimeline";
import { createPublicationRecord, type PublicationChannel, type PublicationStatus } from "../domain/publicationRecord";
import { assertOperationRecordSchedule, validLocalDate, validLocalTime, type OperationRecordSchedule } from "../domain/operationRecordSchedule";
import {
  insertOperationRecord, insertOperationalEvent, insertOperationalMilestone,
  countOperationalTimeline, insertOperationalTimelineEntry, upsertPublicationRecord,
  setOperationRecordSchedule, insertManualOperationalEvent, transitionOperationRecordLifecycle,
  getCurrentExpirationDate, replaceExpirationEvents, linkOperationRecordReference,
} from "../db/departmentOperation";
import { COMPLETION_REASON_MAX, type LifecycleAction } from "../domain/operationRecordLifecycle";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("OperationRecordService");

/** Registra um evento na timeline operacional (append-only), calculando a ordem. */
async function recordTimeline(params: { organizationId: number; actor: string; action: string; referenceType?: string; referenceId?: string; summary: string; correlationId: string }): Promise<void> {
  const order = await countOperationalTimeline(params.organizationId);
  await insertOperationalTimelineEntry(createOperationalTimelineEntry({
    organizationId: params.organizationId, order, actor: params.actor, action: params.action,
    referenceType: params.referenceType, referenceId: params.referenceId, summary: params.summary, correlationId: params.correlationId,
  }));
}

/** Cadastro Rápido / registro manual (legado ou externo). Parte ou processo completo. */
export async function createRecord(params: {
  organizationId: number;
  recordType: OperationRecordType;
  origin?: OperationOrigin;
  number?: string;
  object?: string;
  modality?: string;
  currentStage?: string;
  responsible?: number | null;
  documentReferences?: string[];
  notes?: string;
  eventDate?: string;
  eventEndDate?: string;
  eventTime?: string;
  /** Término da vigência (contrato/aditivo/ata externos): gera vencimento + alertas automaticamente. */
  expirationDate?: string;
  actor: string;
  correlationId: string;
}): Promise<ReturnType<typeof createOperationRecord>> {
  const expirationKind = params.expirationDate ? expirationKindFor(params.recordType) : null;
  if (params.expirationDate && (!expirationKind || !validLocalDate(params.expirationDate))) {
    throw new Error("Término de vigência inválido para este tipo de registro.");
  }
  const schedule = { eventDate: params.eventDate ?? "", eventEndDate: params.eventEndDate ?? "", eventTime: params.eventTime ?? "" };
  assertOperationRecordSchedule(schedule);
  const record = createOperationRecord({
    organizationId: params.organizationId, recordType: params.recordType, origin: params.origin,
    number: params.number, object: params.object, modality: params.modality, currentStage: params.currentStage,
    responsible: params.responsible, documentReferences: params.documentReferences, notes: params.notes,
    ...schedule, correlationId: params.correlationId,
  });
  await insertOperationRecord(record);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "registro_criado", referenceType: "operation_record", referenceId: record.id, summary: `Registro operacional criado (${params.recordType}, origem ${record.origin}).`, correlationId: params.correlationId });
  if (expirationKind && params.expirationDate) {
    await registerExpiration({
      organizationId: params.organizationId, kind: expirationKind, referenceId: record.id,
      title: record.number || record.object || params.recordType, expirationDate: params.expirationDate,
      actor: params.actor, correlationId: params.correlationId,
    });
  }
  return record;
}

export async function updateRecordSchedule(params: {
  organizationId: number; recordId: string; schedule: OperationRecordSchedule;
  actor: string; correlationId: string;
}) {
  assertOperationRecordSchedule(params.schedule);
  return setOperationRecordSchedule(params);
}

/**
 * Concluir / reabrir um registro operacional (transição auditada, nunca exclusão). Idempotente: repetir a
 * mesma ação devolve o estado atual sem nova escrita nem nova entrada de timeline.
 */
export async function changeRecordLifecycle(params: {
  organizationId: number; recordId: string; action: LifecycleAction;
  actorUserId: number; reason?: string; correlationId: string;
}) {
  const reason = (params.reason ?? "").replace(/\s+/g, " ").trim().slice(0, COMPLETION_REASON_MAX);
  const result = await transitionOperationRecordLifecycle({ ...params, reason });
  if (result) {
    log.info(params.action === "complete" ? "operation_record_completed" : "operation_record_reopened", {
      organizationId: params.organizationId, recordId: params.recordId, from: result.from, to: result.to,
      changed: result.changed, actorUserId: params.actorUserId, correlationId: params.correlationId,
    });
  }
  return result;
}

/** Importação Assistida de processo/contrato legado (PDF/DOCX → texto → confirmação). */
export async function importLegacyRecord(params: {
  organizationId: number;
  recordType: OperationRecordType;
  rawText: string;
  actor: string;
  correlationId: string;
}): Promise<{ record: ReturnType<typeof createOperationRecord>; disclaimer: string; confidence: number }> {
  const result = createLegacyImportRecord({ organizationId: params.organizationId, recordType: params.recordType, rawText: params.rawText, correlationId: params.correlationId });
  await insertOperationRecord(result.record);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "importacao_assistida", referenceType: "operation_record", referenceId: result.record.id, summary: `Importação assistida (${params.recordType}), confiança ${Math.round(result.confidence * 100)}% — pendente de confirmação.`, correlationId: params.correlationId });
  return result;
}

/**
 * Gera AUTOMATICAMENTE o evento de vencimento + alertas (90/60/30/15/7 dias) para
 * contrato/aditivo/ata. Nunca cadastrado manualmente. Idempotente por referência+data.
 */
export async function registerExpiration(params: {
  organizationId: number;
  kind: "contrato" | "aditivo" | "ata";
  referenceId: string;
  title: string;
  expirationDate: string;
  actor: string;
  correlationId: string;
}): Promise<{ events: ReturnType<typeof createExpirationEvents> }> {
  const events = createExpirationEvents({
    organizationId: params.organizationId, kind: params.kind, referenceId: params.referenceId,
    title: params.title, expirationDate: params.expirationDate, correlationId: params.correlationId,
  });
  for (const e of events) await insertOperationalEvent(e);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "vencimento_agendado", referenceType: params.kind, referenceId: params.referenceId, summary: `Evento de vencimento e alertas (90/60/30/15/7d) gerados para ${params.title}.`, correlationId: params.correlationId });
  return { events };
}

/**
 * REAGENDA o vencimento e os alertas (90/60/30/15/7d) de um contrato/aditivo/ata quando a vigência muda (ex.: aditivo de
 * prazo): substitui, numa transação, os eventos AUTOMÁTICOS da referência pelos do novo término — o calendário nunca mostra o
 * vencimento antigo nem alertas duplicados, e o indicador continua contando a referência UMA vez. Eventos manuais não são
 * tocados. Idempotente (mesmo término ⇒ mesmos ids ⇒ nada muda). Auditoria na timeline operacional.
 */
export async function rescheduleExpiration(params: {
  organizationId: number; kind: "contrato" | "aditivo" | "ata"; referenceId: string; title: string;
  expirationDate: string; actor: string; correlationId: string; reason: string;
}): Promise<{ previousDate: string | null; newDate: string; changed: boolean }> {
  if (!validLocalDate(params.expirationDate)) throw new Error("Término de vigência inválido.");
  const previousDate = await getCurrentExpirationDate(params.organizationId, params.kind, params.referenceId);
  const events = createExpirationEvents({
    organizationId: params.organizationId, kind: params.kind, referenceId: params.referenceId, title: params.title,
    expirationDate: params.expirationDate, correlationId: params.correlationId,
  });
  await replaceExpirationEvents({ organizationId: params.organizationId, referenceType: params.kind, referenceId: params.referenceId, events });
  const changed = previousDate !== params.expirationDate;
  if (changed) {
    await recordTimeline({
      organizationId: params.organizationId, actor: params.actor, action: "vigencia_reagendada", referenceType: params.kind, referenceId: params.referenceId,
      summary: `Vigência de ${params.title} ${previousDate ? `reagendada de ${previousDate} para ${params.expirationDate}` : `agendada para ${params.expirationDate}`} (${params.reason}); vencimento e alertas (90/60/30/15/7d) regenerados.`,
      correlationId: params.correlationId,
    });
  }
  return { previousDate, newDate: params.expirationDate, changed };
}

/**
 * Passagem de um CONTRATO EXTERNO já monitorado (cadastro rápido) para o contrato completo: remove os eventos automáticos do
 * registro (a vigência passa a viver SOB O CONTRATO) — sem isso o mesmo contrato teria dois vencimentos/alertas e contaria
 * duas vezes no indicador. Devolve o término que o registro monitorava (para reaproveitar quando o usuário não informar outro).
 */
export async function releaseRecordExpiration(params: {
  organizationId: number; recordId: string; actor: string; correlationId: string; toContractId: string;
}): Promise<{ releasedDate: string | null }> {
  const releasedDate = await getCurrentExpirationDate(params.organizationId, "contrato", params.recordId);
  if (releasedDate === null) return { releasedDate: null };
  await replaceExpirationEvents({ organizationId: params.organizationId, referenceType: "contrato", referenceId: params.recordId, events: [] });
  await recordTimeline({
    organizationId: params.organizationId, actor: params.actor, action: "vigencia_transferida", referenceType: "operation_record", referenceId: params.recordId,
    summary: `Vencimento (${releasedDate}) transferido para o contrato ${params.toContractId}; os alertas deste registro foram retirados para não duplicar.`,
    correlationId: params.correlationId,
  });
  return { releasedDate };
}

/** Liga o registro operacional ao contrato (complementa; nunca duplica) e registra o vínculo na timeline operacional. */
export async function linkRecordToContract(params: {
  organizationId: number; recordId: string; contractId: string; actor: string; correlationId: string;
}): Promise<{ status: "linked" | "already_linked" } | { status: "conflict"; referenceId: string } | { status: "not_found" }> {
  const res = await linkOperationRecordReference({ organizationId: params.organizationId, recordId: params.recordId, referenceType: "contract_workspace", referenceId: params.contractId });
  if (res.status === "linked") {
    await recordTimeline({
      organizationId: params.organizationId, actor: params.actor, action: "registro_vinculado_contrato", referenceType: "operation_record", referenceId: params.recordId,
      summary: `Registro vinculado ao contrato ${params.contractId} (dados reaproveitados do registro; informação DECLARADA, não verificada).`, correlationId: params.correlationId,
    });
  }
  return res.status === "conflict" ? { status: "conflict", referenceId: res.referenceId } : res;
}

/** Cria um evento manual do calendário (reunião, audiência, visita técnica…). */
export async function createManualEvent(params: {
  organizationId: number;
  eventType: OperationalEventType;
  title: string;
  eventDate: string;
  eventTime?: string;
  referenceType?: string;
  referenceId?: string;
  actor: string;
  correlationId: string;
}): Promise<ReturnType<typeof createOperationalEvent>> {
  if (!validLocalDate(params.eventDate) || (params.eventTime && !validLocalTime(params.eventTime))) {
    throw new Error("Data ou horário do evento inválido.");
  }
  const event = createOperationalEvent({
    organizationId: params.organizationId, eventType: params.eventType, title: params.title, eventDate: params.eventDate,
    eventTime: params.eventTime, referenceType: params.referenceType, referenceId: params.referenceId, autoGenerated: false, correlationId: params.correlationId,
  });
  const persisted = await insertManualOperationalEvent(event, params.actor);
  if (persisted === null) throw new Error("Banco de dados indisponível para registrar o evento.");
  return event;
}

/** Registra um marco externo (data do certame, homologação, assinatura). */
export async function registerMilestone(params: {
  organizationId: number;
  referenceType: string;
  referenceId: string;
  milestoneType: MilestoneType;
  date?: string;
  time?: string;
  result?: string;
  observation?: string;
  actor: string;
  correlationId: string;
}): Promise<ReturnType<typeof createOperationalMilestone>> {
  const milestone = createOperationalMilestone({
    organizationId: params.organizationId, referenceType: params.referenceType, referenceId: params.referenceId,
    milestoneType: params.milestoneType, date: params.date, time: params.time, result: params.result, observation: params.observation, correlationId: params.correlationId,
  });
  await insertOperationalMilestone(milestone);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "marco_registrado", referenceType: params.referenceType, referenceId: params.referenceId, summary: `Marco "${params.milestoneType}" registrado.`, correlationId: params.correlationId });
  return milestone;
}

/** Atualiza o status/data de uma publicação (status + data apenas). */
export async function setPublicationStatus(params: {
  organizationId: number;
  referenceType: string;
  referenceId: string;
  channel: PublicationChannel;
  status: PublicationStatus;
  date?: string;
  actor: string;
  correlationId: string;
}): Promise<ReturnType<typeof createPublicationRecord>> {
  const record = createPublicationRecord({
    organizationId: params.organizationId, referenceType: params.referenceType, referenceId: params.referenceId,
    channel: params.channel, status: params.status, date: params.date, correlationId: params.correlationId,
  });
  await upsertPublicationRecord(record);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "publicacao_atualizada", referenceType: params.referenceType, referenceId: params.referenceId, summary: `Publicação ${params.channel}: ${params.status}.`, correlationId: params.correlationId });
  return record;
}
