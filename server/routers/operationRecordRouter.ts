/**
 * FASE 5 — Operation Record Router (Centro de Operações, operacional).
 *
 * Cadastro de registros legados/manuais, importação assistida, eventos manuais,
 * marcos externos, publicações e vencimentos automáticos. Sempre registra na
 * timeline operacional. tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import {
  createRecord, importLegacyRecord, registerExpiration, createManualEvent,
  registerMilestone, setPublicationStatus, updateRecordSchedule, changeRecordLifecycle,
} from "../services/operationRecordService";
import { COMPLETION_REASON_MAX } from "../domain/operationRecordLifecycle";
import { validLocalDate, validLocalTime } from "../domain/operationRecordSchedule";
import { listOperationRecords, listOperationalMilestones, listPublicationRecords, getOperationalSettings, upsertOperationalSettings } from "../db/departmentOperation";

const RECORD_TYPES = ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo", "aditivo_externo", "ata_externa", "parecer_externo", "reuniao", "evento", "tarefa", "outro"] as const;
const ORIGINS = ["interna", "externa"] as const;
const EVENT_TYPES = ["sessao_publica", "certame", "reuniao", "audiencia", "visita_tecnica", "assinatura", "tarefa", "manual"] as const;
const MILESTONE_TYPES = ["certame", "homologacao", "assinatura", "sessao_publica", "outro"] as const;
const CHANNELS = ["pncp", "orgao_oficial", "diario_oficial", "portal", "jornal"] as const;
const PUB_STATUSES = ["nao_iniciado", "pendente", "publicado"] as const;
const EXPIRATION_KINDS = ["contrato", "aditivo", "ata"] as const;

const scheduleFields = {
  eventDate: z.string().optional(), eventEndDate: z.string().optional(), eventTime: z.string().optional(),
};
function checkSchedule(value: { eventDate?: string; eventEndDate?: string; eventTime?: string }, ctx: z.RefinementCtx) {
  const start = value.eventDate ?? "";
  const end = value.eventEndDate ?? "";
  const time = value.eventTime ?? "";
  if (!start && (end || time)) ctx.addIssue({ code: "custom", path: ["eventDate"], message: "Informe a data do evento primeiro." });
  if (start && !validLocalDate(start)) ctx.addIssue({ code: "custom", path: ["eventDate"], message: "Data do evento inválida." });
  if (end && (!validLocalDate(end) || end < start)) ctx.addIssue({ code: "custom", path: ["eventEndDate"], message: "A data final deve ser igual ou posterior à inicial." });
  if (time && !validLocalTime(time)) ctx.addIssue({ code: "custom", path: ["eventTime"], message: "Horário inválido." });
}

export const operationRecordRouter = router({
  /** Cadastro Rápido / registro manual (legado ou externo, parte ou processo completo). */
  createRecord: tenantProcedure
    .input(z.object({
      recordType: z.enum(RECORD_TYPES),
      origin: z.enum(ORIGINS).optional(),
      number: z.string().optional(),
      object: z.string().optional(),
      modality: z.string().optional(),
      currentStage: z.string().optional(),
      responsible: z.number().optional(),
      documentReferences: z.array(z.string()).optional(),
      notes: z.string().optional(),
      ...scheduleFields,
    }).superRefine(checkSchedule))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const record = await createRecord({ organizationId: orgId, ...input, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { record };
    }),

  /** Ajusta a agenda de um registro existente sem recriá-lo. */
  setSchedule: tenantProcedure
    .input(z.object({ recordId: z.string().length(20), ...scheduleFields }).superRefine(checkSchedule))
    .mutation(async ({ input, ctx }) => {
      const result = await updateRecordSchedule({
        organizationId: ctx.organizationId!, recordId: input.recordId,
        schedule: { eventDate: input.eventDate ?? "", eventEndDate: input.eventEndDate ?? "", eventTime: input.eventTime ?? "" },
        actor: String(ctx.user.id), correlationId: ctx.correlationId,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado nesta organização." });
      return result;
    }),

  /** Importação Assistida de processo/contrato legado (PDF/DOCX → texto → confirmação). */
  importLegacy: tenantProcedure
    .input(z.object({ recordType: z.enum(RECORD_TYPES), rawText: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return importLegacyRecord({ organizationId: orgId, recordType: input.recordType, rawText: input.rawText, actor: String(ctx.user.id), correlationId: ctx.correlationId });
    }),

  /** Registros do tenant. Padrão: somente ATIVOS (concluídos ficam no histórico: `completed` / `all`). */
  listRecords: tenantProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).optional(),
      lifecycle: z.enum(["active", "completed", "all"]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const records = await listOperationRecords(orgId, input?.limit ?? 100, input?.lifecycle ?? "active");
      return { records, total: records.length };
    }),

  /**
   * Conclui um registro operacional (transição auditada — nunca exclusão). Agenda, eventos vinculados e
   * histórico permanecem; a agenda base sai das superfícies operacionais ativas. operator+; tenant do
   * contexto autenticado; repetir é idempotente.
   */
  complete: orgRoleProcedure("operator")
    .input(z.object({ recordId: z.string().length(20), reason: z.string().trim().max(COMPLETION_REASON_MAX).optional() }))
    .mutation(async ({ input, ctx }) => {
      const result = await changeRecordLifecycle({
        organizationId: ctx.organizationId!, recordId: input.recordId, action: "complete",
        actorUserId: ctx.user!.id, reason: input.reason, correlationId: ctx.correlationId,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado nesta organização." });
      return result;
    }),

  /** Reabre um registro concluído por engano (volta a ACTIVE; nada é recriado). operator+; idempotente. */
  reopen: orgRoleProcedure("operator")
    .input(z.object({ recordId: z.string().length(20) }))
    .mutation(async ({ input, ctx }) => {
      const result = await changeRecordLifecycle({
        organizationId: ctx.organizationId!, recordId: input.recordId, action: "reopen",
        actorUserId: ctx.user!.id, correlationId: ctx.correlationId,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado nesta organização." });
      return result;
    }),

  /** Gera automaticamente o evento de vencimento + alertas (90/60/30/15/7 dias). */
  registerExpiration: tenantProcedure
    .input(z.object({ kind: z.enum(EXPIRATION_KINDS), referenceId: z.string().min(1), title: z.string().min(1), expirationDate: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const { events } = await registerExpiration({ organizationId: orgId, kind: input.kind, referenceId: input.referenceId, title: input.title, expirationDate: input.expirationDate, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { events, total: events.length };
    }),

  /** Cria um evento manual do calendário. */
  createEvent: tenantProcedure
    .input(z.object({ eventType: z.enum(EVENT_TYPES), title: z.string().trim().min(1).max(500), eventDate: z.string().refine(validLocalDate, "Data inválida."), eventTime: z.string().refine(v => !v || validLocalTime(v), "Horário inválido.").optional(), referenceType: z.string().optional(), referenceId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const event = await createManualEvent({ organizationId: orgId, ...input, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { event };
    }),

  /** Registra um marco externo (certame, homologação, assinatura). */
  registerMilestone: tenantProcedure
    .input(z.object({ referenceType: z.string().min(1), referenceId: z.string().min(1), milestoneType: z.enum(MILESTONE_TYPES), date: z.string().optional(), time: z.string().optional(), result: z.string().optional(), observation: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const milestone = await registerMilestone({ organizationId: orgId, ...input, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { milestone };
    }),

  listMilestones: tenantProcedure
    .input(z.object({ referenceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const milestones = await listOperationalMilestones(input.referenceId, orgId);
      return { milestones };
    }),

  /** Atualiza status/data de uma publicação (status + data apenas). */
  setPublication: tenantProcedure
    .input(z.object({ referenceType: z.string().min(1), referenceId: z.string().min(1), channel: z.enum(CHANNELS), status: z.enum(PUB_STATUSES), date: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const record = await setPublicationStatus({ organizationId: orgId, ...input, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { record };
    }),

  listPublications: tenantProcedure
    .input(z.object({ referenceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const publications = await listPublicationRecords(input.referenceId, orgId);
      return { publications };
    }),

  /** Configuração dos canais de publicação (nomes por município; PNCP é fixo). */
  getSettings: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const settings = await getOperationalSettings(orgId);
      return { settings: settings ?? { orgaoOficialName: "Órgão Oficial do Município", jornalName: "Jornal de Grande Circulação", portalName: "Portal Eletrônico" } };
    }),

  updateSettings: tenantProcedure
    .input(z.object({ orgaoOficialName: z.string().min(1), jornalName: z.string().min(1), portalName: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await upsertOperationalSettings({ organizationId: orgId, ...input, correlationId: ctx.correlationId, updatedAt: new Date().toISOString() });
      return { success: true, settings: input };
    }),
});
