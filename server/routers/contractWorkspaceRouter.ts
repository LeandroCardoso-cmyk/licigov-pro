/**
 * FASE 5 — Contract Workspace Router (Contratos, operacional).
 *
 * Engenharia documental contratual num Workspace próprio: nascimento (3 fluxos),
 * minutas inteligentes, aditivos, apostilamentos, ocorrências e parecer jurídico
 * (via Institutional Request Engine). tenantProcedure, multi-tenant. Foco exclusivo
 * em documentação — nunca ERP/financeiro.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { updateContractFields, transitionContractStatus, type ContractStatus } from "../domain/contractWorkspace";
import {
  createFromProcurement, createFromDirectProcurement, importExternalContract,
  generateContractDocument, createAddendum, createApostille, registerOccurrence,
  requestContractLegalOpinion, getContractLegalOpinion,
} from "../services/contractService";
import {
  getContractWorkspace, insertContractWorkspace, listContractWorkspaces, listImportedContractWorkspaces,
  listContractWsDocuments, listContractAddenda, listContractApostilles, listContractOccurrences,
} from "../db/contractWorkspace";
import { listProcessTimeline } from "../db/procurement";

const DOC_KINDS = ["contrato", "aditivo", "apostilamento", "rescisao", "anexo"] as const;
const ADDENDUM_TYPES = ["prazo", "valor", "quantitativo", "qualitativo"] as const;
const APOSTILLE_KINDS = ["reajuste", "gestor", "fiscal", "legal"] as const;
const OPINION_TYPES = ["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL"] as const;
const CONTRACT_STATUSES = ["minuta", "vigente", "aditado", "apostilado", "encerrado", "rescindido", "arquivado"] as const;

async function requireContract(id: string, orgId: number) {
  const ws = await getContractWorkspace(id, orgId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado nesta organização." });
  return ws;
}

export const contractWorkspaceRouter = router({
  createFromProcurement: tenantProcedure
    .input(z.object({ processId: z.string().min(1), contractNumber: z.string().min(1), contractor: z.string().optional(), value: z.number().optional(), term: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await createFromProcurement({ organizationId: orgId, processId: input.processId, contractNumber: input.contractNumber, contractor: input.contractor, value: input.value, term: input.term, correlationId: ctx.correlationId });
      return { workspace };
    }),

  createFromDirectProcurement: tenantProcedure
    .input(z.object({ directWorkspaceId: z.string().min(1), contractNumber: z.string().min(1), contractor: z.string().optional(), value: z.number().optional(), term: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await createFromDirectProcurement({ organizationId: orgId, directWorkspaceId: input.directWorkspaceId, contractNumber: input.contractNumber, contractor: input.contractor, value: input.value, term: input.term, correlationId: ctx.correlationId });
      return { workspace };
    }),

  importExternalContract: tenantProcedure
    .input(z.object({ source: z.enum(["pdf", "docx"]), rawText: z.string().min(1), contractNumber: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const result = await importExternalContract({ organizationId: orgId, source: input.source, rawText: input.rawText, contractNumber: input.contractNumber, correlationId: ctx.correlationId });
      return result;
    }),

  loadContract: tenantProcedure
    .input(z.object({ contractId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await getContractWorkspace(input.contractId, orgId);
      if (!workspace) return { workspace: null, documents: [], addenda: [], apostilles: [], occurrences: [], timeline: [] };
      const [documents, addenda, apostilles, occurrences, timeline] = await Promise.all([
        listContractWsDocuments(input.contractId, orgId),
        listContractAddenda(input.contractId, orgId),
        listContractApostilles(input.contractId, orgId),
        listContractOccurrences(input.contractId, orgId),
        listProcessTimeline(input.contractId, orgId),
      ]);
      return { workspace, documents, addenda, apostilles, occurrences, timeline };
    }),

  listContracts: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const contracts = await listContractWorkspaces(orgId, input?.limit ?? 50);
      return { contracts, total: contracts.length };
    }),

  listImported: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const contracts = await listImportedContractWorkspaces(orgId, input?.limit ?? 50);
      return { contracts, total: contracts.length };
    }),

  updateContract: tenantProcedure
    .input(z.object({
      contractId: z.string().min(1),
      contractor: z.string().optional(), object: z.string().optional(), value: z.number().optional(),
      term: z.string().optional(), manager: z.string().optional(), inspector: z.string().optional(),
      contractNumber: z.string().optional(), status: z.enum(CONTRACT_STATUSES).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireContract(input.contractId, orgId);
      const { contractId, status, ...fields } = input;
      const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      let updated = updateContractFields(ws, patch);
      if (status && status !== ws.status) {
        try { updated = transitionContractStatus(updated, status as ContractStatus); }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Transição inválida." }); }
      }
      await insertContractWorkspace(updated);
      return { workspace: updated };
    }),

  generateDocuments: tenantProcedure
    .input(z.object({ contractId: z.string().min(1), kind: z.enum(DOC_KINDS) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireContract(input.contractId, orgId);
      return generateContractDocument({ organizationId: orgId, contractId: input.contractId, kind: input.kind, correlationId: ctx.correlationId });
    }),

  createAddendum: tenantProcedure
    .input(z.object({ contractId: z.string().min(1), addendumType: z.enum(ADDENDUM_TYPES), justification: z.string().min(1), newValue: z.number().optional(), newTerm: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireContract(input.contractId, orgId);
      return createAddendum({ organizationId: orgId, contractId: input.contractId, addendumType: input.addendumType, justification: input.justification, newValue: input.newValue, newTerm: input.newTerm, correlationId: ctx.correlationId });
    }),

  createApostille: tenantProcedure
    .input(z.object({ contractId: z.string().min(1), kind: z.enum(APOSTILLE_KINDS), description: z.string().optional(), newValue: z.number().optional(), newManager: z.string().optional(), newInspector: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireContract(input.contractId, orgId);
      const apostille = await createApostille({ organizationId: orgId, contractId: input.contractId, kind: input.kind, description: input.description, newValue: input.newValue, newManager: input.newManager, newInspector: input.newInspector, correlationId: ctx.correlationId });
      return { apostille };
    }),

  registerOccurrence: tenantProcedure
    .input(z.object({ contractId: z.string().min(1), description: z.string().min(1), occurredOn: z.string().optional(), attachments: z.array(z.string()).optional(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireContract(input.contractId, orgId);
      const occurrence = await registerOccurrence({ organizationId: orgId, contractId: input.contractId, description: input.description, occurredOn: input.occurredOn, attachments: input.attachments, notes: input.notes, correlationId: ctx.correlationId });
      return { occurrence };
    }),

  requestLegalOpinion: tenantProcedure
    .input(z.object({ contractId: z.string().min(1), requestType: z.enum(OPINION_TYPES).optional(), documents: z.array(z.object({ documentId: z.string(), title: z.string().optional(), version: z.number().optional() })).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireContract(input.contractId, orgId);
      const { requestId } = await requestContractLegalOpinion({ organizationId: orgId, contractId: input.contractId, requestType: input.requestType ?? "LEGAL_OPINION_INITIAL", requestedBy: ctx.user.id, documents: input.documents, correlationId: ctx.correlationId });
      return { requestId, status: "aguardando_parecer" as const };
    }),

  getLegalOpinion: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return getContractLegalOpinion(input.requestId, orgId);
    }),
});
