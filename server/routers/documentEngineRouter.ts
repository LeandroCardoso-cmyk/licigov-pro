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
import { exportOfficialDocument } from "../services/officialDocumentExportAdapter";

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

  /** Exporta o documento em DOCX ou PDF (base64 do binário real). Caminho legado. */
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

  /**
   * PR B.1 — Exportação INSTITUCIONAL (DOCX/PDF) de um documento oficial: cabeçalho
   * institucional, status/versão fiéis, sem artefatos Markdown, nome de download
   * legível/determinístico. Reutiliza o núcleo comum da PR B (renderInstitucional +
   * S3 + URL assinada). Ação de LEITURA — não gera, não versiona, não altera status.
   * Serve Contratos/Aditivos, Contratação Direta e Parecer (todos em official_documents).
   */
  exportInstitutional: tenantProcedure
    .input(z.object({
      documentId: z.string().min(1),
      format: z.enum(FORMATS),
      /** true → URL inline (visualizar/imprimir); default false (baixar). */
      inline: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // C.4B.1 — a policy de status oficial é DERIVADA NO SERVIDOR pelo businessDomain do documento
      // (ver exportOfficialDocument): o cliente NÃO controla o gate. processo_licitatorio só exporta
      // 'emitido'; demais domínios inalterados.
      return exportOfficialDocument({
        organizationId: ctx.organizationId!, userId: ctx.user.id,
        documentId: input.documentId, format: input.format,
        disposition: input.inline ? "inline" : "attachment",
        correlationId: ctx.correlationId,
      });
    }),
});
