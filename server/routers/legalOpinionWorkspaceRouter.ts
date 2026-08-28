/**
 * FASE 5 — Legal Opinion Workspace Router (Parecer Jurídico, operacional).
 *
 * O Procurador trabalha EXCLUSIVAMENTE dentro deste Workspace/Caixa Institucional
 * — nunca abre um Processo Licitatório diretamente. A Caixa lista o que o
 * Institutional Request Engine encaminhou para o domínio parecer_juridico; a
 * resposta retorna automaticamente à origem. tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { listPendingForDomain } from "../db/institutionalRequests";
import {
  listLegalOpinionWorkspaces, getLegalOpinionWorkspace, listLawyerAssignments,
} from "../db/legalOpinionWorkspace";
import {
  openWorkspaceFromRequest, loadWorkspaceContext, createOpinionDraft,
  updateOpinionDraft, signOpinion, returnOpinion, archiveWorkspace,
} from "../services/legalOpinionWorkspaceService";

const DOMAIN = "parecer_juridico" as const;
const OPINION_TYPES = ["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL"] as const;
const CONCLUSIONS = ["favoravel", "desfavoravel", "com_ressalvas", "parcialmente_favoravel"] as const;
const SIGNATURE_METHODS = ["manual", "icp_brasil", "gov_br", "certificado_a1"] as const;

async function requireWorkspace(id: string, orgId: number) {
  const ws = await getLegalOpinionWorkspace(id, orgId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace de parecer não encontrado nesta organização." });
  return ws;
}

export const legalOpinionWorkspaceRouter = router({
  /** Caixa Institucional: solicitações pendentes encaminhadas ao domínio. */
  listInbox: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const [requests, workspaces] = await Promise.all([
        listPendingForDomain(orgId, DOMAIN, input?.limit ?? 50),
        listLegalOpinionWorkspaces(orgId, { activeOnly: true, limit: input?.limit ?? 50 }),
      ]);
      return { requests, workspaces, total: requests.length };
    }),

  /** Lista os workspaces (trabalhos) do domínio, ativos ou todos. */
  listWorkspaces: tenantProcedure
    .input(z.object({ activeOnly: z.boolean().optional(), limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspaces = await listLegalOpinionWorkspaces(orgId, { activeOnly: input?.activeOnly ?? false, limit: input?.limit ?? 50 });
      return { workspaces, total: workspaces.length };
    }),

  /** Recebe uma solicitação da caixa e abre o Workspace do Procurador. */
  receiveRequest: tenantProcedure
    .input(z.object({ requestId: z.string().min(1), sector: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await openWorkspaceFromRequest({
        requestId: input.requestId, organizationId: orgId, lawyerId: ctx.user.id,
        sector: input.sector, correlationId: ctx.correlationId,
      });
      return { workspace };
    }),

  /** Carrega automaticamente todo o contexto (documentos, timeline, reasoning…). */
  loadContext: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const context = await loadWorkspaceContext({
        workspaceId: input.workspaceId, organizationId: orgId, correlationId: ctx.correlationId,
      });
      return context;
    }),

  /** Cria o rascunho do parecer (editável, nunca automático). */
  createDraft: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      opinionType: z.enum(OPINION_TYPES),
      report: z.string().optional(),
      foundation: z.string().optional(),
      conclusion: z.string().optional(),
      conclusionType: z.enum(CONCLUSIONS).optional(),
      recommendations: z.array(z.string()).optional(),
      reservations: z.array(z.string()).optional(),
      attachments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const result = await createOpinionDraft({
        workspaceId: input.workspaceId, organizationId: orgId, author: ctx.user.id,
        opinionType: input.opinionType, report: input.report, foundation: input.foundation,
        conclusion: input.conclusion, conclusionType: input.conclusionType ?? null,
        recommendations: input.recommendations, reservations: input.reservations,
        attachments: input.attachments, correlationId: ctx.correlationId,
      });
      return result;
    }),

  /** Atualiza o conteúdo do parecer, gerando nova versão. */
  updateOpinion: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      report: z.string().optional(),
      foundation: z.string().optional(),
      conclusion: z.string().optional(),
      conclusionType: z.enum(CONCLUSIONS).optional(),
      recommendations: z.array(z.string()).optional(),
      reservations: z.array(z.string()).optional(),
      attachments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const { workspaceId, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const draft = await updateOpinionDraft({
        workspaceId, organizationId: orgId, author: ctx.user.id, patch, correlationId: ctx.correlationId,
      });
      return { draft };
    }),

  /** Assina o parecer (apenas MANUAL implementado nesta fase). */
  signOpinion: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), method: z.enum(SIGNATURE_METHODS).optional(), idempotencyKey: z.string().min(8).max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      try {
        const result = await signOpinion({
          workspaceId: input.workspaceId, organizationId: orgId, signedBy: ctx.user.id,
          method: input.method, idempotencyKey: input.idempotencyKey, correlationId: ctx.correlationId,
        });
        return result;
      } catch (e) {
        // Preserva códigos institucionais (CONFLICT etc.); só o inesperado vira BAD_REQUEST.
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao assinar." });
      }
    }),

  /** Devolve o parecer à origem via Institutional Request Engine. */
  returnOpinion: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      try {
        const result = await returnOpinion({
          workspaceId: input.workspaceId, organizationId: orgId, responder: ctx.user.id, correlationId: ctx.correlationId,
        });
        return { success: true, workspaceId: result.workspace.id, responseId: result.responseId, status: "RETURNED" as const };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao devolver." });
      }
    }),

  /** Arquiva o parecer. */
  archiveOpinion: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWorkspace(input.workspaceId, orgId);
      const workspace = await archiveWorkspace({ workspaceId: input.workspaceId, organizationId: orgId, userId: ctx.user.id });
      return { success: true, workspaceId: workspace.id, status: "ARCHIVED" as const };
    }),

  /** Painel do Procurador: seus trabalhos atribuídos. */
  lawyerDashboard: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const [assignments, workspaces] = await Promise.all([
        listLawyerAssignments(orgId, ctx.user.id),
        listLegalOpinionWorkspaces(orgId, { activeOnly: false, limit: 100 }),
      ]);
      return { assignments, workspaces, total: assignments.length };
    }),
});
