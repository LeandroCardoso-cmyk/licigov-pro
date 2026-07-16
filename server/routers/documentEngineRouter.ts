/**
 * RC-3 — Document Engine Router (pipeline único de documentos oficiais).
 *
 * Endpoint compartilhado por TODOS os Business Domains para geração, versionamento,
 * timeline, prévia e exportação (DOCX/PDF) de documentos oficiais. tenantProcedure,
 * multi-tenant. O acesso ao Kernel ocorre nos serviços via kernelAccessService.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import {
  generateOfficialDocument, renderOfficialDocument, previewOfficialDocument,
  getOfficialDocument, listOfficialDocuments, listVersions, listDocumentTimeline, computeLineageId,
} from "../services/documentEngineService";

const DOMAINS = ["processo_licitatorio", "contratacao_direta", "parecer_juridico", "contratos"] as const;
const DOC_TYPES = ["dfd", "etp", "tr", "edital", "justificativa_contratacao", "justificativa_preco", "ratificacao", "aviso", "extrato_contrato", "parecer_inicial", "parecer_final", "despacho", "contrato", "aditivo", "apostilamento", "rescisao", "outro"] as const;
const FORMATS = ["docx", "pdf"] as const;

export const documentEngineRouter = router({
  /** Gera (ou versiona) um documento oficial pelo pipeline único. */
  generate: tenantProcedure
    .input(z.object({
      businessDomain: z.enum(DOMAINS),
      documentType: z.enum(DOC_TYPES),
      origin: z.string().min(1),
      title: z.string().min(1),
      content: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const document = await generateOfficialDocument({
        organizationId: orgId, businessDomain: input.businessDomain, documentType: input.documentType,
        origin: input.origin, title: input.title, content: input.content, metadata: input.metadata,
        author: String(ctx.user.id), correlationId: ctx.correlationId,
      });
      return { document };
    }),

  get: tenantProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const document = await getOfficialDocument(input.documentId, orgId);
      return { document };
    }),

  list: tenantProcedure
    .input(z.object({ businessDomain: z.enum(DOMAINS).optional(), origin: z.string().optional(), limit: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const documents = await listOfficialDocuments(orgId, { businessDomain: input?.businessDomain, origin: input?.origin, limit: input?.limit ?? 100 });
      return { documents, total: documents.length };
    }),

  /** Versões de uma linhagem (informe origin+domain+tipo OU o lineageId). */
  versions: tenantProcedure
    .input(z.object({ businessDomain: z.enum(DOMAINS), documentType: z.enum(DOC_TYPES), origin: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const lineageId = computeLineageId({ tenantId: orgId, businessDomain: input.businessDomain, documentType: input.documentType, origin: input.origin });
      const versions = await listVersions(lineageId, orgId);
      return { lineageId, versions, total: versions.length };
    }),

  /** Timeline documental (append-only) de uma linhagem. */
  timeline: tenantProcedure
    .input(z.object({ businessDomain: z.enum(DOMAINS), documentType: z.enum(DOC_TYPES), origin: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const lineageId = computeLineageId({ tenantId: orgId, businessDomain: input.businessDomain, documentType: input.documentType, origin: input.origin });
      const timeline = await listDocumentTimeline(lineageId, orgId);
      return { timeline };
    }),

  /** Prévia (conteúdo) do documento — sem gerar binário. */
  preview: tenantProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return previewOfficialDocument({ organizationId: orgId, documentId: input.documentId });
    }),

  /** Exporta o documento em DOCX ou PDF (base64 do binário real). */
  download: tenantProcedure
    .input(z.object({ documentId: z.string().min(1), format: z.enum(FORMATS) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      try {
        return await renderOfficialDocument({ organizationId: orgId, documentId: input.documentId, format: input.format });
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: e instanceof Error ? e.message : "Falha ao exportar." });
      }
    }),
});
