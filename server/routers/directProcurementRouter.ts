/**
 * FASE 5 — Direct Procurement Router (Contratação Direta, operacional).
 *
 * Conduz o servidor por Dispensa/Inexigibilidade num Workspace próprio. Reutiliza
 * Price Research, Institutional Request Engine (→ Parecer Jurídico), Timeline e
 * Document Engine. Multi-tenant. Adaptive Process Engine controla
 * as etapas condicionais (DFD, pesquisa, propostas, parecer).
 *
 * NEW-005 — RBAC institucional (matriz congelada em ./directProcurementRbacMatrix.ts):
 *   READ (loadProcess, listProcesses, getLegalOpinion)                      → tenantProcedure
 *   DRAFT_WRITE / EVIDENCE_WRITE (createProcess, importDFD, selectLegalBasis,
 *     characterizeNeed, importPriceResearch, configureProcedure, registerProposal,
 *     generateJustification, generatePriceJustification, validateDocuments,
 *     requestLegalOpinion)                                                  → orgRoleProcedure("operator")
 *   WORKFLOW_CONFIGURATION (configureFlags)                                 → orgRoleProcedure("manager")
 *   INSTITUTIONAL_DECISION (ratify)                                         → orgRoleProcedure("manager")
 *   PUBLICATION (publish)                                                   → orgRoleProcedure("manager")
 *   LEGACY_TO_DISABLE (updateStage, LEG-011)                                → desligado por PR-02
 * `manager` é só o PISO técnico de RBAC — não é a afirmação de autoridade legalmente competente.
 * Autoridade competente, decidedBy × recordedBy e SoD pertencem ao PR-07.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { router, tenantProcedure, orgRoleProcedure } from "../_core/trpc";
import {
  createDirectProcurementWorkspace, setDirectStage, markDirectPublished, deriveDirectProcurementStatus, describeFlagChange,
  setProcedureType, setLegalBasis,
  type DirectStartOption, type DirectProcurementType, type DirectProcurementWorkspace, type DirectProcurementStatus, type DirectProcurementStage,
} from "../domain/directProcurementWorkspace";
import {
  createDirectProcurementProcedure, createProposalCollection, createProposalDocument,
  suggestLegalBasis,
  type ProcedureMode, type ElectronicPlatform, type PresentialReceiptMethod, type ProposalDocumentKind,
} from "../domain/directProcurementProcedure";
import {
  PROCESS_ALREADY_EXISTS, ProcessAlreadyExistsError, DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE, directProcurementCreateMismatches,
} from "../domain/processCreateContract";
import { serviceLogger } from "../services/observabilityService";
import { recordDirectProcurementRatification } from "../services/institutionalDecisionService";
import { listDecisions } from "../db/institutionalDecisions";
import {
  createDirectProcurementWorkspaceWithInitialEvent,
  insertDirectProcurementWorkspace, getDirectProcurementWorkspace, listDirectProcurementWorkspaces,
  updateDirectProcurementStage, insertDirectProcedure, getDirectProcedure,
  insertProposalCollection, listProposalCollections, insertProposalDocument,
  getRatification, getContractJustification, getPriceJustification, listRequiredDocuments, listGeneratedPublications,
  getRecordedActsForWorkspaces, updateDirectWorkspaceFlagsWithEvent, listLinkedContractsForDirect,
} from "../db/directProcurement";
import { timelineActor } from "../domain/timelineActor";
import { PRICE_REFERENCE_METHODS } from "../domain/directPriceReference";
import { recordProcessEvent, listProcessTimeline } from "../db/procurement";
import {
  importDirectPriceResearch, generateContractJustification, generatePriceJustification, acceptContractJustification, listPriceResearchesForJustification,
  seedRequiredDocuments, requestLegalOpinion, getLegalOpinionResult, generatePublications,
  setRequiredDocumentStatus, attachRequiredDocument,
} from "../services/directProcurementService";
import { MAX_TASK_ATTACHMENT_BASE64_CHARS } from "../domain/taskAttachmentPolicy";

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

const log = serviceLogger("directProcurementRouter");

type StatusBasis = Omit<ReturnType<typeof deriveDirectProcurementStatus>, "status"> & { storedStatus: DirectProcurementStatus };
type PublicationRow = { id: string; kind: string; title: string; createdAt: string; unbacked: boolean };

/** R9 / SEM-042 — tokens estáveis da recusa "sem registro persistido" (nunca um sucesso falso). */
export const DIRECT_NEED_NOT_PERSISTED = "DIRECT_NEED_NOT_PERSISTED";
export const DIRECT_DFD_IMPORT_NOT_PERSISTED = "DIRECT_DFD_IMPORT_NOT_PERSISTED";

/**
 * R3 / PR-05 (SEM-003) — a criação colidiu com a chave natural (org + número). NADA foi escrito. Relê o
 * existente NO ÓRGÃO do contexto e decide SEM ESCREVER (contrato: server/domain/processCreateContract.ts):
 * retry idempotente da MESMA criação (mesmo ator + payload normalizado idêntico) ⇒ devolve o workspace
 * PERSISTIDO com `created: false`; qualquer outro caso ⇒ CONFLICT `PROCESS_ALREADY_EXISTS`.
 */
async function resolveExistingDirectCreate(p: {
  organizationId: number; workspaceId: string; actorUserId: number; correlationId: string; startedAt: number;
  request: { object: string; procurementType: string; startOption: string; legalBasis?: string };
}): Promise<{ workspace: DirectProcurementWorkspace; created: false }> {
  const existing = await getDirectProcurementWorkspace(p.workspaceId, p.organizationId);
  const mismatches = existing
    ? directProcurementCreateMismatches(existing, { actorUserId: p.actorUserId, ...p.request })
    : ["missing"];
  if (existing && mismatches.length === 0) {
    log.info("create_process_replayed", {
      organizationId: p.organizationId, workspaceId: existing.id, actorUserId: p.actorUserId, correlationId: p.correlationId,
      outcome: "IDEMPOTENT_CONVERGENCE", durationMs: Date.now() - p.startedAt,
    });
    return { workspace: existing, created: false };
  }
  // Só NOMES de campo divergentes (sem valores/PII); o workspace existente não é tocado.
  log.warn("create_process_conflict", {
    organizationId: p.organizationId, workspaceId: p.workspaceId, actorUserId: p.actorUserId, correlationId: p.correlationId,
    outcome: "CONFLICT", reason: PROCESS_ALREADY_EXISTS, mismatches, durationMs: Date.now() - p.startedAt,
  });
  throw new TRPCError({ code: "CONFLICT", message: DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE });
}

export const directProcurementRouter = router({
  createProcess: orgRoleProcedure("operator")
    .input(z.object({
      processNumber: z.string().min(1),
      object: z.string().min(1),
      procurementType: z.enum(PROCUREMENT_TYPES),
      startOption: z.enum(START_OPTIONS),
      legalBasis: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const startedAt = Date.now();
      const orgId = ctx.organizationId!;
      const ws = createDirectProcurementWorkspace({
        organizationId: orgId, processNumber: input.processNumber, object: input.object,
        procurementType: input.procurementType as DirectProcurementType, startOption: input.startOption as DirectStartOption,
        legalBasis: input.legalBasis, responsibleUser: ctx.user.id, correlationId: ctx.correlationId,
      });
      // R3 / PR-05 (SEM-003) — Create ≠ Reset: INSERT PURO + evento inicial na MESMA transação. Número já
      // existente no órgão ⇒ nada é escrito; converge (retry idempotente da mesma criação) ou CONFLICT.
      try {
        await createDirectProcurementWorkspaceWithInitialEvent(ws, {
          actor: String(ctx.user.id), summary: `Contratação direta ${ws.processNumber} (${ws.procurementType}) criada.`, correlationId: ctx.correlationId,
        });
      } catch (err) {
        if (err instanceof ProcessAlreadyExistsError) {
          return resolveExistingDirectCreate({
            organizationId: orgId, workspaceId: err.processId, actorUserId: ctx.user.id, correlationId: ctx.correlationId, startedAt,
            request: { object: input.object, procurementType: input.procurementType, startOption: input.startOption, legalBasis: input.legalBasis },
          });
        }
        throw err;
      }
      log.info("create_process_created", {
        organizationId: orgId, workspaceId: ws.id, actorUserId: ctx.user.id, correlationId: ctx.correlationId,
        outcome: "CREATED", durationMs: Date.now() - startedAt,
      });
      return { workspace: ws, created: true };
    }),

  loadProcess: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const workspace = await getDirectProcurementWorkspace(input.workspaceId, orgId);
      if (!workspace) return { workspace: null, statusBasis: null as StatusBasis | null, procedure: null, proposals: [], requiredDocuments: [], publications: [] as PublicationRow[], timeline: [] };
      const [procedure, proposals, requiredDocuments, publications, timeline, acts, linkedContracts] = await Promise.all([
        getDirectProcedure(input.workspaceId, orgId),
        listProposalCollections(input.workspaceId, orgId),
        listRequiredDocuments(input.workspaceId, orgId),
        listGeneratedPublications(input.workspaceId, orgId),
        listProcessTimeline(input.workspaceId, orgId),
        getRecordedActsForWorkspaces(orgId, [input.workspaceId]),
        listLinkedContractsForDirect(orgId, input.workspaceId),
      ]);
      // R9 / SEM-064 — o status exibido vem dos ATOS REGISTRADOS (ledger + publicações), não do ponteiro de etapa.
      const { status, ...basis } = deriveDirectProcurementStatus(workspace, acts.get(input.workspaceId) ?? { ratification: null, publicationCount: 0 });
      const hasContract = linkedContracts.some((c) => c.status !== "minuta" && c.contractNumber.trim() !== "");
      return {
        workspace: { ...workspace, status },
        statusBasis: { ...basis, storedStatus: workspace.status } as StatusBasis | null,
        procedure, proposals, requiredDocuments,
        // Extrato gerado antes da correção (texto genérico, sem contrato) fica visível MAS marcado como sem lastro.
        publications: publications.map((p): PublicationRow => ({ ...p, unbacked: p.kind === "extrato_contrato" && !hasContract })),
        timeline,
      };
    }),

  listProcesses: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const rows = await listDirectProcurementWorkspaces(orgId, input?.limit ?? 50);
      const acts = await getRecordedActsForWorkspaces(orgId, rows.map((r) => r.id));
      // R9 / SEM-064 — status derivado dos atos registrados (a coluna gravada segue em `storedStatus`, para auditoria).
      const workspaces = rows.map((r) => {
        const d = deriveDirectProcurementStatus(
          { status: r.status as DirectProcurementStatus, currentStage: r.currentStage as DirectProcurementStage },
          acts.get(r.id) ?? { ratification: null, publicationCount: 0 },
        );
        return { ...r, status: d.status as string, storedStatus: r.status, ratificationBasis: d.ratification, publicationBasis: d.publication };
      });
      return { workspaces, total: workspaces.length };
    }),

  updateStage: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1), stage: z.enum(STAGES).optional() }))
    .mutation(async ({ ctx }) => {
      // R2 / LEG-011 (FCC-02) — desligamento governado: salto genérico de etapa com tenantProcedure
      // simples, fora das transições canônicas. Recusa ANTES de qualquer efeito.
      throwLegacyEndpointDisabled("directProcurement.updateStage", "LEG-011", ctx, "as transições canônicas (ratify/publish)");
    }),

  /**
   * R9 / SEM-042 — SEM registro persistido: a Contratação Direta não tem repositório de DFD importado (nem tabela, nem
   * migration neste ciclo). Antes, a chamada montava um DFD EM MEMÓRIA, gravava só um evento "DFD importado" e devolvia
   * `{ dfd }` — sucesso falso (o conteúdo se perdia). Agora recusa de forma ESTÁVEL antes de qualquer escrita
   * (zero linhas, zero evento). O RBAC (operator+) e o tenant (workspace do órgão ou NOT_FOUND) continuam valendo. O DFD do
   * Processo Licitatório (`procurementProcess.importDFD`) é outro caminho, persistido, e não muda.
   */
  importDFD: orgRoleProcedure("operator")
    .input(z.object({ workspaceId: z.string().min(1), source: z.enum(["pdf", "docx", "oficio", "memorando"]), fields: z.record(z.string(), z.string()).optional() }))
    .mutation(async ({ input, ctx }): Promise<{ dfd: { id: string } }> => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      log.warn("direct_dfd_import_not_persisted", { organizationId: orgId, workspaceId: ws.id, actorUserId: ctx.user.id, correlationId: ctx.correlationId, outcome: "REFUSED_NOT_PERSISTED" });
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `A importação de DFD na contratação direta ainda não possui registro persistido; nada foi gravado (${DIRECT_DFD_IMPORT_NOT_PERSISTED}).` });
    }),

  selectLegalBasis: orgRoleProcedure("operator")
    .input(z.object({ workspaceId: z.string().min(1), legalBasis: z.string().min(1), justification: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const updated = setLegalBasis(ws, input.legalBasis);
      await insertDirectProcurementWorkspace(updated);
      await recordProcessEvent({ organizationId: orgId, processId: ws.id, eventType: "decision", actor: String(ctx.user.id), summary: `Fundamento legal: ${input.legalBasis}.${input.justification ? " " + input.justification : ""}`, refId: ws.id, correlationId: ctx.correlationId });
      return { workspace: updated, suggestions: suggestLegalBasis(ws.procurementType) };
    }),

  /**
   * R9 / SEM-042 — SEM registro persistido: não existe repositório da caracterização da necessidade (nem tabela, nem
   * migration neste ciclo). Antes, a chamada construía o objeto em memória, gravava só um evento "Necessidade
   * caracterizada." e a tela mostrava "Necessidade registrada." — sucesso falso (o texto e o valor estimado se perdiam).
   * Agora recusa de forma ESTÁVEL antes de qualquer escrita; a UI deixou de oferecer o formulário. A necessidade
   * institucional é registrada por `acceptJustification` (aceite humano, persistida).
   */
  characterizeNeed: orgRoleProcedure("operator")
    .input(z.object({ workspaceId: z.string().min(1), description: z.string().optional(), justification: z.string().optional(), estimatedValue: z.number().optional() }))
    .mutation(async ({ input, ctx }): Promise<{ need: { workspaceId: string } }> => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      log.warn("direct_need_characterization_not_persisted", { organizationId: orgId, workspaceId: ws.id, actorUserId: ctx.user.id, correlationId: ctx.correlationId, outcome: "REFUSED_NOT_PERSISTED" });
      throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `A caracterização da necessidade ainda não possui registro persistido; nada foi gravado (${DIRECT_NEED_NOT_PERSISTED}). Registre a necessidade na Justificativa da Contratação.` });
    }),

  // R2 / PR-04A — LEG-014 / FCC-01: importação GOVERNADA (identidade explícita por importação, idempotência,
  // contentHash + dedup, transação local, linhagem, evento persistido). Escrita ⇒ operator+ (viewer NÃO
  // escreve — mesmo RBAC de procurementProcess.importPriceResearch). Workspace por (id, org do contexto):
  // outro órgão ⇒ NOT_FOUND neutro, sem escrita.
  importPriceResearch: orgRoleProcedure("operator")
    .input(z.object({
      workspaceId: z.string().min(1),
      source: z.enum(PRICE_SOURCES),
      text: z.string().min(1),
      idempotencyKey: z.string().trim().min(8).max(128),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      try {
        return await importDirectPriceResearch({
          workspaceId: input.workspaceId, organizationId: orgId, source: input.source, text: input.text,
          idempotencyKey: input.idempotencyKey, actorUserId: ctx.user!.id, correlationId: ctx.correlationId,
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err; // NOT_FOUND / CONFLICT / BAD_REQUEST do contrato
        log.error("direct_price_import_persist_failed", {
          organizationId: orgId, userId: ctx.user!.id, workspaceId: input.workspaceId,
          source: input.source, correlationId: ctx.correlationId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível importar a pesquisa de preços. Tente novamente; se persistir, contate o suporte.",
        });
      }
    }),

  configureProcedure: orgRoleProcedure("operator")
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

  registerProposal: orgRoleProcedure("operator")
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

  generateJustification: orgRoleProcedure("operator")
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      return generateContractJustification({ workspaceId: input.workspaceId, organizationId: orgId, correlationId: ctx.correlationId, actorUserId: ctx.user!.id });
    }),

  generatePriceJustification: orgRoleProcedure("operator")
    .input(z.object({
      workspaceId: z.string().min(1),
      source: z.enum(["pesquisa", "manual", "documento"]),
      justification: z.string().max(20000).optional(),
      /** R9 / SEM-042 — "pesquisa": só uma PROPOSTA comparada com o valor do servidor; demais fontes: valor DECLARADO. */
      referenceValue: z.number().optional(),
      researchId: z.string().max(20).optional(),
      /** R9 / SEM-042 — método de cálculo escolhido pela pessoa (obrigatório com source "pesquisa"; sem padrão). */
      method: z.enum(PRICE_REFERENCE_METHODS).optional(),
      documentReferences: z.array(z.string()).optional(),
      /** R5 / PR-11 (SEM-022) — aceite humano explícito do registro oficial. */
      confirmOfficial: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      return generatePriceJustification({ workspaceId: input.workspaceId, organizationId: orgId, source: input.source, justification: input.justification, referenceValue: input.referenceValue, researchId: input.researchId, method: input.method, documentReferences: input.documentReferences, correlationId: ctx.correlationId, confirmOfficial: input.confirmOfficial, actorUserId: ctx.user.id });
    }),

  /**
   * R5 / PR-11 (SEM-021) — ACEITE HUMANO da justificativa da contratação (a partir da sugestão revisada ou de texto
   * próprio). Só aqui a justificativa é persistida e o documento oficial é gerado, com autor humano.
   */
  acceptJustification: orgRoleProcedure("operator")
    .input(z.object({
      workspaceId: z.string().min(1),
      need: z.string().max(20000), publicInterest: z.string().max(20000), motivation: z.string().max(20000),
      legalFoundation: z.string().max(20000), benefits: z.string().max(20000), alternatives: z.string().max(20000),
      basedOnSuggestion: z.boolean(),
      confirmAccept: z.literal(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const { workspaceId, basedOnSuggestion, confirmAccept: _confirm, ...fields } = input;
      return acceptContractJustification({ workspaceId, organizationId: orgId, actorUserId: ctx.user.id, fields, basedOnSuggestion, correlationId: ctx.correlationId });
    }),

  /** R5 / PR-11 — justificativas PERSISTIDAS (fonte da hidratação dos formulários; leitura tenant). */
  getJustifications: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const [contract, price, priceResearches] = await Promise.all([
        getContractJustification(input.workspaceId, orgId), getPriceJustification(input.workspaceId, orgId),
        // R9 / SEM-042 — pesquisas verificadas + valores CALCULADOS PELO SERVIDOR (o cliente só os exibe).
        listPriceResearchesForJustification(input.workspaceId, orgId),
      ]);
      return { contract, price, priceResearches };
    }),

  /**
   * R7 / PR-16 (SEM-020) — sem `documentId`: semeia o checklist. Com `documentId`+`status`: "pendente"/"validado"
   * (validar exige anexo REAL); "anexado" só via `attachRequiredDocument`. A referência do cliente é IGNORADA.
   */
  validateDocuments: orgRoleProcedure("operator")
    .input(z.object({ workspaceId: z.string().min(1), documentId: z.string().optional(), status: z.enum(DOC_STATUSES).optional(), documentReference: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const documents = input.documentId && input.status
        ? await setRequiredDocumentStatus({ workspaceId: input.workspaceId, organizationId: orgId, documentId: input.documentId, status: input.status, actorUserId: ctx.user.id, correlationId: ctx.correlationId })
        : await seedRequiredDocuments({ workspaceId: input.workspaceId, organizationId: orgId, correlationId: ctx.correlationId });
      return { documents, pending: documents.filter(d => d.required && d.status === "pendente").length };
    }),

  /** R7 / PR-16 (SEM-020) — anexar = upload REAL (base64 → S3 pelo servidor, SHA-256). Nunca URL/referência do cliente. */
  attachRequiredDocument: orgRoleProcedure("operator")
    .input(z.object({
      workspaceId: z.string().min(1), documentId: z.string().min(1),
      fileName: z.string().min(1).max(255).regex(/^[^\\/]+$/, "Nome de arquivo inválido"),
      fileBase64: z.string().min(1).max(MAX_TASK_ATTACHMENT_BASE64_CHARS),
      mimeType: z.string().min(1).max(120),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      return attachRequiredDocument({
        workspaceId: input.workspaceId, organizationId: orgId, documentId: input.documentId, fileName: input.fileName,
        mimeType: input.mimeType, content: Buffer.from(input.fileBase64, "base64"), actorUserId: ctx.user.id, correlationId: ctx.correlationId,
      });
    }),

  requestLegalOpinion: orgRoleProcedure("operator")
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

  // NEW-005 — INSTITUTIONAL_DECISION: piso técnico manager+. NÃO define autoridade competente; quem decide
  // (decidedBy) × quem registra (recordedBy) e a segregação de funções são do PR-07 (semântica inalterada aqui).
  /**
   * R4 / PR-07 (SEM-004) — registro GOVERNADO da decisão de ratificação no ledger append-only
   * (`institutional_decisions`, 0312). Sem resultado padrão; autoridade DECLARADA (nome, cargo, data e referência do
   * ato) separada de quem registra (usuário autenticado); revisão com CAS (`expectedRevision`); nova decisão supera a
   * anterior explicitamente (histórico preservado); idempotência por chave (INV-11). manager+ continua sendo só o
   * PISO TÉCNICO de quem registra (NEW-005) — a competência jurídica da autoridade NÃO é validada pelo sistema
   * (R4.2 pendente ⇒ `authorityValidation = NOT_VALIDATED_POLICY_PENDING`).
   */
  ratify: orgRoleProcedure("manager")
    .input(z.object({
      workspaceId: z.string().min(1),
      decision: z.enum(["ratificado", "nao_ratificado"]),
      decidedByName: z.string().max(255),
      decidedByRole: z.string().max(255),
      decidedAt: z.string().max(10),
      basisReference: z.string().max(500),
      justification: z.string().max(20000),
      evidence: z.array(z.string().max(2000)).max(50).optional(),
      expectedRevision: z.number().int().min(0),
      idempotencyKey: z.string().min(8).max(128),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await recordDirectProcurementRatification({
        organizationId: ctx.organizationId!, subjectType: "direct_procurement.ratification", subjectId: input.workspaceId,
        decisionType: "ratification", outcome: input.decision, decidedByName: input.decidedByName,
        decidedByRole: input.decidedByRole, decidedByUserId: null, decidedAt: input.decidedAt,
        basisReference: input.basisReference, reason: input.justification, evidence: input.evidence ?? [],
        recordedByUserId: ctx.user.id, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey,
        correlationId: ctx.correlationId,
      });
      return { decision: result.decision, replayed: result.replayed };
    }),

  /** R4 / PR-07 — decisão de ratificação corrente + histórico (revisões superadas) + legado pré-0312 (somente leitura). */
  getRatificationDecision: tenantProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const history = await listDecisions(orgId, "direct_procurement.ratification", input.workspaceId);
      const legacy = await getRatification(input.workspaceId, orgId);
      return {
        current: history.length ? history[history.length - 1] : null,
        history,
        legacyRatification: legacy ? { decision: legacy.decision, ratifiedAt: legacy.ratifiedAt, recordedBy: legacy.responsible } : null,
        currentRevision: history.length ? history[history.length - 1].revision : 0,
      };
    }),

  // NEW-005 — PUBLICATION: piso técnico manager+ (mesma ressalva do ratify: autoridade competente = PR-07).
  // SEM-060 — EFEITO REAL (rótulo da UI = efeito): gera as publicações E move o processo para a etapa PUBLICATION.
  publish: orgRoleProcedure("manager")
    .input(z.object({
      workspaceId: z.string().min(1),
      /** R9 / SEM-064 — opt-in: extrato do contrato REGISTRADO e vinculado (sem contrato ⇒ recusa estável, zero escritas). */
      includeContractExtract: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const ws = await requireWs(input.workspaceId, orgId);
      const { publications, contractExtract } = await generatePublications({
        workspaceId: ws.id, organizationId: orgId, correlationId: ctx.correlationId,
        includeContractExtract: input.includeContractExtract === true, actorUserId: ctx.user.id,
      });
      // As publicações JÁ estão gravadas (ato registrado): só agora o ponteiro/status passa a `publicado`.
      const moved = markDirectPublished(ws);
      await updateDirectProcurementStage(ws.id, orgId, moved.currentStage, moved.status, moved.updatedAt);
      // SEM-060 — a resposta declara a transição efetiva (a UI e os testes não presumem a etapa).
      return { publications, contractExtract, stage: moved.currentStage };
    }),

  // NEW-005 — WORKFLOW_CONFIGURATION: muda exigências do fluxo (ex.: requiresLegalOpinion) ⇒ piso manager+.
  configureFlags: orgRoleProcedure("manager")
    .input(z.object({ workspaceId: z.string().min(1), usesDFD: z.boolean().optional(), requiresPriceResearch: z.boolean().optional(), requiresProposalCollection: z.boolean().optional(), requiresLegalOpinion: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await requireWs(input.workspaceId, orgId);
      const { workspaceId: _workspaceId, ...flags } = input;
      // R9 / SEM-064 — a mudança de flags deixa EVENTO de timeline (antes → depois, ator humano, correlationId), na
      // mesma transação do UPDATE; desligar `requiresLegalOpinion` é destacado como decisão. Sem mudança ⇒ sem escrita.
      const result = await updateDirectWorkspaceFlagsWithEvent({
        workspaceId: input.workspaceId, organizationId: orgId, patch: flags,
        actor: timelineActor(ctx.user.id), correlationId: ctx.correlationId, describe: describeFlagChange,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
      if (result.changed) {
        log.info("direct_flags_configured", {
          organizationId: orgId, workspaceId: input.workspaceId, actorUserId: ctx.user.id, correlationId: ctx.correlationId,
          legalOpinionRequiredBefore: result.before.requiresLegalOpinion, legalOpinionRequiredAfter: result.after.requiresLegalOpinion,
        });
      }
      const workspace = await requireWs(input.workspaceId, orgId);
      return { workspace, changed: result.changed };
    }),
});
