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
  createOperationRecord, createLegacyImportRecord, type OperationRecordType, type OperationOrigin,
} from "../domain/operationRecord";
import { createExpirationEvents, createOperationalEvent, type OperationalEventType } from "../domain/operationalEvent";
import { createOperationalMilestone, type MilestoneType } from "../domain/operationalMilestone";
import { createOperationalTimelineEntry } from "../domain/operationalTimeline";
import { createPublicationRecord, type PublicationChannel, type PublicationStatus } from "../domain/publicationRecord";
import {
  insertOperationRecord, insertOperationalEvent, insertOperationalMilestone,
  countOperationalTimeline, insertOperationalTimelineEntry, upsertPublicationRecord,
} from "../db/departmentOperation";

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
  actor: string;
  correlationId: string;
}): Promise<ReturnType<typeof createOperationRecord>> {
  const record = createOperationRecord({
    organizationId: params.organizationId, recordType: params.recordType, origin: params.origin,
    number: params.number, object: params.object, modality: params.modality, currentStage: params.currentStage,
    responsible: params.responsible, documentReferences: params.documentReferences, notes: params.notes, correlationId: params.correlationId,
  });
  await insertOperationRecord(record);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "registro_criado", referenceType: "operation_record", referenceId: record.id, summary: `Registro operacional criado (${params.recordType}, origem ${record.origin}).`, correlationId: params.correlationId });
  return record;
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
  const event = createOperationalEvent({
    organizationId: params.organizationId, eventType: params.eventType, title: params.title, eventDate: params.eventDate,
    eventTime: params.eventTime, referenceType: params.referenceType, referenceId: params.referenceId, autoGenerated: false, correlationId: params.correlationId,
  });
  await insertOperationalEvent(event);
  await recordTimeline({ organizationId: params.organizationId, actor: params.actor, action: "evento_criado", referenceType: "operational_event", referenceId: event.id, summary: `Evento "${params.title}" cadastrado no calendário.`, correlationId: params.correlationId });
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
