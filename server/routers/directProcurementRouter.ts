/**
 * FASE 5 — Direct Procurement Router (Contratação Direta, operacional).
 *
 * Conduz o servidor por Dispensa/Inexigibilidade num Workspace próprio. Reutiliza
 * Price Research, Institutional Request Engine (→ Parecer Jurídico), Timeline e
 * Document Engine. tenantProcedure, multi-tenant. Adaptive Process Engine controla
 * as etapas condicionais (DFD, pesquisa, propostas, parecer).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  createDirectProcurementWorkspace, advanceDirectStage, setDirectStage,
  setProcedureType, setLegalBasis, configureFlags,
  type DirectStartOption, type DirectProcurementStage, type DirectProcurementType,
} from "../domain/directProcurementWorkspace";
import { createDFDState, importDFD as importDFDDomain, type DFDSource } from "../domain/dfdState";
import {
  createDirectProcurementProcedure, createProposalCollection, createProposalDocument,
  createNeedCharacterization, suggestLegalBasis,
  type ProcedureMode, type ElectronicPlatform, type PresentialReceiptMethod, type ProposalDocumentKind,
} from "../domain/directProcurementProcedure";
import { createRatification } from "../domain/directProcurementJustifications";
import {
  insertDirectProcurementWorkspace, getDirectProcurementWorkspace, listDirectProcurementWorkspaces,
  updateDirectProcurementStage, insertDirectProcedure, getDirectProcedure,
  insertProposalCollection, listProposalCollections, insertProposalDocument,
  insertRatification, listRequiredDocuments, updateRequiredDocumentStatus, listGeneratedPublications,
} from "../db/directProcurement";
import { recordProcessEvent, listProcessTimeline } from "../db/procurement";
import {
  importDirectPriceResearch, generateContractJustification, generatePriceJustification,
  seedRequiredDocuments, requestLegalOpinion, getLegalOpinionResult, generatePublications,
} from "../services/directProcurementService";

const START_OPTIONS = ["criar_dfd", "importar_dfd", "importar_pdf", "importar_memorando", "importar_oficio", "sem_dfd"] as const;
const PROCUREMENT_TYPES = ["dispensa", "inexigibilidade"] as const;
const STAGES = ["NEW", "DFD", "LEGAL_BASIS", "NEED_CHARACTERIZATION", "PRICE_RESEARCH", "PROCEDURE", "PROPOSAL_COLLECTION", "CONTRACT_JUSTIFICATION", "PRICE_JUSTIFICATION", "REQUIRED_DOCUMENTS", "LEGAL_OPINION", "RATIFICATION", "PUBLICATION", "CONTRACT", "ARCHIVED"] as const;
const PROCEDURE_MODES = ["eletronico", "presencial"] as const;
const PLATFORMS = ["compras_gov", "bll", "licitanet", "portal_proprio", "outra"] as const;
const RECEIPT_METHODS = ["email", "protocolo", "entrega_presencial", "outro"] as const;
const PRICE_SOURCES = ["pdf", "docx", "xlsx", "csv", "colar", "manual"] as const;
const DOC_STATUSES = ["pendente", "anexado", "validado"] as const;
const PROPOSAL_DOC_KINDS = ["proposta_pdf", "email", "protocolo", "outro"] as const;

async function requireWs(id: string, orgId: number) {
  const ws = await getDirectProcurementWorkspace(id, orgId);
  if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
  return ws;
}

export const directProcurementRouter = router({
  createProcess: tenantProcedure
    .input(z.object({
      processNumber: z.string().min(1),
      object: z.string().min(1),
      procurementType: z.enum(PROCUREMENT_TYPES),
      startOption: z.enum(START_OPTIONS),
      legalBasis: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = createDirectProcurementWorkspace({
        organizationId: orgId, processNumber: input.processNumber, object: input.object,
        procurementType: input.procurementType as DirectProcurementType, startOption: input.startOption as DirectStartOption,
        legalBasis: input.legalBasis, responsibleUser: ctx.user.id, correlationId: ctx.correlationId,
      });
      await insertDirectProcurementWorkspace(ws);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "workspace_created", actor: String(ctx.user.id), summary: `Contratação direta ${ws.processNumber} (${ws.procurementType}) criada.`, refId: ws.id, correlationId: ctx.correlationId });
      return { workspace: ws };
    }),

  loadProcess: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await getDirectProcurementWorkspace(input.workspaceId, orgId);
      if (!workspace) return { workspace: null, procedure: null, proposals: [], requiredDocuments: [], publications: [], timeline: [] };
      const [procedure, proposals, requiredDocuments, publications, timeline] = await Promise.all([
        getDirectProcedure(input.workspaceId, orgId),
        listProposalCollections(input.workspaceId, orgId),
        listRequiredDocuments(input.workspaceId, orgId),
        listGeneratedPublications(input.workspaceId, orgId),
        listProcessTimeline(input.workspaceId, orgId),
      ]);
      return { workspace, procedure, proposals, requiredDocuments, publications, timeline };
    }),

  listProcesses: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspaces = await listDirectProcurementWorkspaces(orgId, input?.limit ?? 50);
      return { workspaces, total: workspaces.length };
    }),

  updateStage: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), stage: z.enum(STAGES).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const updated = input.stage ? setDirectStage(ws, input.stage as DirectProcurementStage) : advanceDirectStage(ws);
      await updateDirectProcurementStage(ws.id, orgId, updated.currentStage, updated.status, updated.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "change", actor: String(ctx.user.id), summary: `Etapa: ${updated.currentStage}.`, refId: ws.id, correlationId: ctx.correlationId });
      return { workspace: updated };
    }),

  importDFD: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), source: z.enum(["pdf", "docx", "oficio", "memorando"]), fields: z.record(z.string(), z.string()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const dfd = importDFDDomain(createDFDState({ processId: ws.id, organizationId: orgId, correlationId: ctx.correlationId }), input.source as DFDSource, input.fields ?? {});
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "change", actor: String(ctx.user.id), summary: `DFD importado (${input.source}).`, refId: dfd.id, correlationId: ctx.correlationId });
      return { dfd };
    }),

  selectLegalBasis: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), legalBasis: z.string().min(1), justification: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const updated = setLegalBasis(ws, input.legalBasis);
      await insertDirectProcurementWorkspace(updated);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "decision", actor: String(ctx.user.id), summary: `Fundamento legal: ${input.legalBasis}.${input.justification ? " " + input.justification : ""}`, refId: ws.id, correlationId: ctx.correlationId });
      return { workspace: updated, suggestions: suggestLegalBasis(ws.procurementType) };
    }),

  characterizeNeed: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), description: z.string().optional(), justification: z.string().optional(), estimatedValue: z.number().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const need = createNeedCharacterization({ workspaceId: ws.id, organizationId: orgId, description: input.description, justification: input.justification, estimatedValue: input.estimatedValue, correlationId: ctx.correlationId });
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "change", actor: String(ctx.user.id), summary: "Necessidade caracterizada.", refId: ws.id, correlationId: ctx.correlationId });
      return { need };
    }),

  importPriceResearch: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), source: z.enum(PRICE_SOURCES), text: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const result = await importDirectPriceResearch({ workspaceId: input.workspaceId, organizationId: orgId, source: input.source, text: input.text, correlationId: ctx.correlationId });
      return result;
    }),

  configureProcedure: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      procedureType: z.enum(PROCEDURE_MODES),
      platform: z.enum(PLATFORMS).optional(),
      receiptMethod: z.enum(RECEIPT_METHODS).optional(),
      instructions: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const procedure = createDirectProcurementProcedure({
        organizationId: orgId, workspaceId: ws.id, procedureType: input.procedureType as ProcedureMode,
        platform: input.platform as ElectronicPlatform | undefined, receiptMethod: input.receiptMethod as PresentialReceiptMethod | undefined,
        instructions: input.instructions, correlationId: ctx.correlationId,
      });
      await insertDirectProcedure(procedure);
      const updatedWs = setProcedureType(ws, input.procedureType);
      await insertDirectProcurementWorkspace(updatedWs);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "decision", actor: String(ctx.user.id), summary: `Procedimento: ${input.procedureType}${input.platform ? " / " + input.platform : ""}${input.receiptMethod ? " / " + input.receiptMethod : ""}.`, refId: procedure.id, correlationId: ctx.correlationId });
      return { procedure };
    }),

  registerProposal: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      supplierName: z.string().min(1),
      supplierDocument: z.string().optional(),
      proposalValue: z.number().optional(),
      protocol: z.string().optional(),
      index: z.number().optional(),
      documents: z.array(z.object({ kind: z.enum(PROPOSAL_DOC_KINDS), title: z.string(), documentReference: z.string() })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const proposal = createProposalCollection({
        organizationId: orgId, workspaceId: ws.id, supplierName: input.supplierName, supplierDocument: input.supplierDocument,
        proposalValue: input.proposalValue, protocol: input.protocol, index: input.index, correlationId: ctx.correlationId,
      });
      await insertProposalCollection(proposal);
      for (const d of input.documents ?? []) {
        const doc = createProposalDocument({ organizationId: orgId, proposalId: proposal.id, workspaceId: ws.id, kind: d.kind as ProposalDocumentKind, title: d.title, documentReference: d.documentReference, correlationId: ctx.correlationId });
        await insertProposalDocument(doc);
      }
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "change", actor: String(ctx.user.id), summary: `Proposta registrada: ${input.supplierName}.`, refId: proposal.id, correlationId: ctx.correlationId });
      return { proposal };
    }),

  generateJustification: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      return generateContractJustification({ workspaceId: input.workspaceId, organizationId: orgId, correlationId: ctx.correlationId });
    }),

  generatePriceJustification: tenantProcedure
    .input(z.object({
      workspaceId: z.string().min(1),
      source: z.enum(["pesquisa", "manual", "documento"]),
      justification: z.string().optional(),
      referenceValue: z.number().optional(),
      researchId: z.string().optional(),
      documentReferences: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      return generatePriceJustification({ workspaceId: input.workspaceId, organizationId: orgId, source: input.source, justification: input.justification, referenceValue: input.referenceValue, researchId: input.researchId, documentReferences: input.documentReferences, correlationId: ctx.correlationId });
    }),

  validateDocuments: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), documentId: z.string().optional(), status: z.enum(DOC_STATUSES).optional(), documentReference: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      if (input.documentId && input.status) {
        await updateRequiredDocumentStatus(input.documentId, orgId, input.status, input.documentReference ?? "");
      } else {
        await seedRequiredDocuments({ workspaceId: input.workspaceId, organizationId: orgId, correlationId: ctx.correlationId });
      }
      const documents = await listRequiredDocuments(input.workspaceId, orgId);
      return { documents, pending: documents.filter(d => d.required && d.status === "pendente").length };
    }),

  requestLegalOpinion: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), documents: z.array(z.object({ documentId: z.string(), title: z.string().optional(), version: z.number().optional() })).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const { requestId } = await requestLegalOpinion({ workspaceId: ws.id, organizationId: orgId, requestedBy: ctx.user.id, documents: input.documents, correlationId: ctx.correlationId });
      const moved = setDirectStage(ws, "LEGAL_OPINION");
      await updateDirectProcurementStage(ws.id, orgId, moved.currentStage, moved.status, moved.updatedAt);
      return { requestId, status: "aguardando_parecer" as const };
    }),

  getLegalOpinion: tenantProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return getLegalOpinionResult(input.requestId, orgId);
    }),

  ratify: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), decision: z.enum(["ratificado", "nao_ratificado"]).optional(), justification: z.string().optional(), evidence: z.array(z.string()).optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const ratification = createRatification({ organizationId: orgId, workspaceId: ws.id, responsible: ctx.user.id, decision: input.decision, justification: input.justification, evidence: input.evidence, correlationId: ctx.correlationId });
      await insertRatification(ratification);
      const moved = setDirectStage(ws, "RATIFICATION");
      await updateDirectProcurementStage(ws.id, orgId, moved.currentStage, moved.status, moved.updatedAt);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "approval", actor: String(ctx.user.id), summary: `Ratificação: ${ratification.decision}.`, refId: ratification.id, correlationId: ctx.correlationId });
      return { ratification };
    }),

  publish: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const publications = await generatePublications({ workspaceId: ws.id, organizationId: orgId, correlationId: ctx.correlationId });
      const moved = setDirectStage(ws, "PUBLICATION");
      await updateDirectProcurementStage(ws.id, orgId, moved.currentStage, moved.status, moved.updatedAt);
      return { publications };
    }),

  configureFlags: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), usesDFD: z.boolean().optional(), requiresPriceResearch: z.boolean().optional(), requiresProposalCollection: z.boolean().optional(), requiresLegalOpinion: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const { workspaceId, ...flags } = input;
      const updated = configureFlags(ws, flags);
      await insertDirectProcurementWorkspace(updated);
      return { workspace: updated };
    }),
});
