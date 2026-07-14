/**
 * FASE 5 — Operation Record Router (Centro de Operações, operacional).
 *
 * Cadastro de registros legados/manuais, importação assistida, eventos manuais,
 * marcos externos, publicações e vencimentos automáticos. Sempre registra na
 * timeline operacional. tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import {
  createRecord, importLegacyRecord, registerExpiration, createManualEvent,
  registerMilestone, setPublicationStatus,
} from "../services/operationRecordService";
import { listOperationRecords, listOperationalMilestones, listPublicationRecords, getOperationalSettings, upsertOperationalSettings } from "../db/departmentOperation";

const RECORD_TYPES = ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo", "aditivo_externo", "ata_externa", "parecer_externo", "reuniao", "evento", "tarefa", "outro"] as const;
const ORIGINS = ["interna", "externa"] as const;
const EVENT_TYPES = ["sessao_publica", "certame", "reuniao", "audiencia", "visita_tecnica", "assinatura", "tarefa", "manual"] as const;
const MILESTONE_TYPES = ["certame", "homologacao", "assinatura", "sessao_publica", "outro"] as const;
const CHANNELS = ["pncp", "orgao_oficial", "diario_oficial", "portal", "jornal"] as const;
const PUB_STATUSES = ["nao_iniciado", "pendente", "publicado"] as const;
const EXPIRATION_KINDS = ["contrato", "aditivo", "ata"] as const;

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
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const record = await createRecord({ organizationId: orgId, ...input, actor: String(ctx.user.id), correlationId: ctx.correlationId });
      return { record };
    }),

  /** Importação Assistida de processo/contrato legado (PDF/DOCX → texto → confirmação). */
  importLegacy: tenantProcedure
    .input(z.object({ recordType: z.enum(RECORD_TYPES), rawText: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return importLegacyRecord({ organizationId: orgId, recordType: input.recordType, rawText: input.rawText, actor: String(ctx.user.id), correlationId: ctx.correlationId });
    }),

  listRecords: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const records = await listOperationRecords(orgId, input?.limit ?? 100);
      return { records, total: records.length };
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
    .input(z.object({ eventType: z.enum(EVENT_TYPES), title: z.string().min(1), eventDate: z.string().min(1), eventTime: z.string().optional(), referenceType: z.string().optional(), referenceId: z.string().optional() }))
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
