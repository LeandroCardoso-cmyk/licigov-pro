/**
 * Kernel — Institutional Request Router (operational).
 *
 * Endpoints do Institutional Request Engine. Toda comunicação entre Business
 * Domains passa por aqui. tenantProcedure, multi-tenant (jamais cruza organizações).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { assignTo, transition } from "../domain/institutionalRequest";
import {
  requestInstitutionalReview, receiveRequest, respondRequest, archiveRequest,
} from "../services/institutionalRequestService";
import {
  getRequest, updateRequestStatus, insertAssignment,
  listPendingForDomain, listCompletedForDomain, listRequestTimeline, listDocumentReferences, getResponseForRequest,
} from "../db/institutionalRequests";
import { createRequestAssignment } from "../domain/requestAssignment";

const DOMAINS = ["processo_licitatorio", "contratacao_direta", "contratos", "parecer_juridico", "gestao_departamento", "controle_interno"] as const;
const REQUEST_TYPES = ["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL", "CONTROL_REVIEW", "TECHNICAL_REVIEW", "DOCUMENT_REVIEW", "APPROVAL", "SIGNATURE", "INFORMATION_REQUEST", "CORRECTION_REQUEST"] as const;
const PRIORITIES = ["baixa", "media", "alta", "urgente"] as const;
const RESPONSE_TYPES = ["parecer", "revisao", "aprovacao", "informacao", "correcao", "assinatura"] as const;
const RESPONSE_STATUSES = ["favoravel", "desfavoravel", "com_ressalvas", "informativo", "concluido"] as const;
const SIGNATURE_METHODS = ["manual", "icp_brasil", "gov_br", "certificado_a1"] as const;

async function requireRequest(id: string, orgId: number) {
  const r = await getRequest(id, orgId);
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitação não encontrada nesta organização." });
  return r;
}

export const institutionalRequestRouter = router({
  createRequest: tenantProcedure
    .input(z.object({
      sourceDomain: z.enum(DOMAINS),
      destinationDomain: z.enum(DOMAINS),
      requestType: z.enum(REQUEST_TYPES),
      referenceProcessId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      documents: z.array(z.object({ documentId: z.string(), title: z.string().optional(), version: z.number().optional() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      if (input.sourceDomain === input.destinationDomain) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Origem e destino não podem ser o mesmo domínio." });
      }
      const result = await requestInstitutionalReview({
        organizationId: orgId, sourceDomain: input.sourceDomain, destinationDomain: input.destinationDomain,
        requestType: input.requestType, referenceProcessId: input.referenceProcessId, title: input.title,
        description: input.description, priority: input.priority, requestedBy: ctx.user.id,
        documents: input.documents, correlationId: ctx.correlationId,
      });
      return result;
    }),

  assignRequest: tenantProcedure
    .input(z.object({ requestId: z.string().min(1), userId: z.number(), sector: z.string().optional(), queue: z.string().optional(), priority: z.enum(PRIORITIES).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const req = await requireRequest(input.requestId, orgId);
      const assignment = createRequestAssignment({
        requestId: req.id, organizationId: orgId, userId: input.userId, sector: input.sector, queue: input.queue,
        priority: input.priority, correlationId: ctx.correlationId,
      });
      await insertAssignment(assignment);
      const assigned = assignTo(req, input.userId);
      await updateRequestStatus(req.id, orgId, req.status, input.userId, assigned.updatedAt);
      return { assignment, requestId: req.id };
    }),

  receiveRequest: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireRequest(input.requestId, orgId);
      const request = await receiveRequest(input.requestId, orgId, ctx.user.id);
      return { request };
    }),

  listPending: tenantProcedure
    .input(z.object({ domain: z.enum(DOMAINS), limit: z.number().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const requests = await listPendingForDomain(orgId, input.domain, input.limit ?? 50);
      return { requests, total: requests.length };
    }),

  listCompleted: tenantProcedure
    .input(z.object({ domain: z.enum(DOMAINS), asSource: z.boolean().optional(), limit: z.number().min(1).max(100).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const requests = await listCompletedForDomain(orgId, input.domain, input.asSource ?? false, input.limit ?? 50);
      return { requests, total: requests.length };
    }),

  respond: tenantProcedure
    .input(z.object({
      requestId: z.string().min(1),
      responseType: z.enum(RESPONSE_TYPES),
      responseStatus: z.enum(RESPONSE_STATUSES),
      comments: z.string().optional(),
      attachedDocuments: z.array(z.string()).optional(),
      sign: z.enum(SIGNATURE_METHODS).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireRequest(input.requestId, orgId);
      const result = await respondRequest({
        id: input.requestId, organizationId: orgId, responder: ctx.user.id, responseType: input.responseType,
        responseStatus: input.responseStatus, comments: input.comments, attachedDocuments: input.attachedDocuments,
        sign: input.sign, correlationId: ctx.correlationId,
      });
      return result;
    }),

  returnRequest: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const req = await requireRequest(input.requestId, orgId);
      if (req.status === "RETURNED") {
        return { success: true, requestId: req.id, status: "RETURNED" as const };
      }
      const returned = transition(req, "RETURNED");
      await updateRequestStatus(req.id, orgId, "RETURNED", req.assignedTo, returned.updatedAt);
      return { success: true, requestId: req.id, status: "RETURNED" as const };
    }),

  archive: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireRequest(input.requestId, orgId);
      const request = await archiveRequest(input.requestId, orgId, ctx.user.id);
      return { success: true, requestId: request.id, status: "ARCHIVED" as const };
    }),

  getTimeline: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const [timeline, documents, response] = await Promise.all([
        listRequestTimeline(input.requestId, orgId),
        listDocumentReferences(input.requestId, orgId),
        getResponseForRequest(input.requestId, orgId),
      ]);
      return { timeline, documents, response };
    }),
});
