/**
 * RC-3.5.2 — Classificação: **LEGACY** (compatibilidade apenas).
 *
 * Router legado que chama o DocumentConverter e o caminho Gemini diretamente, fora
 * do pipeline oficial (Document Engine / OfficialDocumentLifecycleService / AIExecution
 * Engine). Registrado na allowlist central (`DOCUMENT_CONVERTER_ALLOWLIST` /
 * `LEGACY_EXPORTERS`). Não remover, não reescrever, não migrar. Novos fluxos DEVEM usar
 * as portas oficiais do Kernel.
 *
 * @deprecated LEGACY_ACTIVE_MAINTENANCE_ONLY (RC-C0.1A) — é o caminho ATIVO em produção
 * hoje (não órfão): não adicione novos tipos documentais, novos consumidores ou novas
 * rotas aqui. Hotfix crítico e correção de segurança são permitidos. Destino canônico:
 * `procurementProcessRouter` + `documentEngineService` (ainda órfão do frontend — ver
 * `server/kernel/architecture/legacyBoundaries.ts` → `CANONICAL_NOT_YET_WIRED`).
 * Referência: `docs/architecture/LEGACY_INVENTORY.md`, seção "Licitação / Processo
 * Licitatório / Geração Documental". Migração prevista para sprint dedicada futura (C1+).
 */
import { tenantProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";
import { z } from "zod";
import * as db from "../db";

/**
 * R2 / LEG-009 (inventário R2.1 `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md`, decisão humana de
 * 27/09/2026 = DISABLE) — desligamento GOVERNADO das 13 procedures de leitura/gravação/geração/upload/
 * download/versionamento deste router (listByProcess, list, save, getByType, generateNext, updateDocument,
 * generateDocument, uploadDocument, getDownloadUrl, getVersionHistory, restoreVersion, downloadDocx,
 * downloadPdf). Os únicos chamadores de cliente estão na subárvore NÃO roteada de `pages/ProcessDetails.tsx`
 * (a rota `/processo/:id` redireciona para `/processos`).
 *
 * Cada procedure continua REGISTRADA e com o MESMO schema de input (contrato de API e congelamento
 * RC-C0.1A), mas recusa TODA chamada (FORBIDDEN + `LEGACY_ENDPOINT_DISABLED`) como PRIMEIRA instrução —
 * antes de qualquer leitura/gravação em banco, IA (gemini), S3, conversão DOCX/PDF ou activity log. Nenhum
 * dado histórico (linhas `documents`, objetos S3) é apagado ou alterado. Caminho canônico: Processo
 * Licitatório (`procurementProcess.*`) + Document Engine (`documentEngine.*`); revisão/aprovação oficial em
 * `documentReview.*` — nenhum deles é alterado por este corte.
 */

/** R2 / LEG-009 — caminho canônico sugerido na recusa governada. */
const LEG009_ALTERNATIVE =
  "o Processo Licitatório canônico (procurementProcess.*) e o Document Engine (documentEngine.*)";

/**
 * Tipos de SAÍDA do contrato legado, preservados só no nível de tipo: a procedure nunca mais os devolve (recusa
 * governada), mas o contrato da API não "some" silenciosamente e os chamadores legados (não roteados) seguem
 * compilando sem alteração.
 */
type LegacyDocType = "dfd" | "etp" | "tr" | "edital" | "contrato" | "ata" | "parecer";
type LegacyDocumentList = Awaited<ReturnType<typeof db.getDocumentsByProcessForOrganization>>;
type LegacyDocumentByType = Awaited<ReturnType<typeof db.getDocumentByProcessAndTypeForOrganization>>;
type LegacyDocumentVersions = Awaited<ReturnType<typeof db.getDocumentVersionsForOrganization>>;
type LegacySaveResult = { success: boolean; version: number };
type LegacyGenerateNextResult = { success: boolean; documentType: LegacyDocType | null; status: string };
type LegacyGenerateResult = { success: boolean; docType: LegacyDocType; version: number };
type LegacyDownloadUrlResult = { url: string; expiresIn: number };
type LegacyFileResult = { success: boolean; filename: string; data: string };

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
] as const;

export const documentsRouter = router({
  // R2 / LEG-009 — as 13 procedures abaixo (até downloadPdf) estão DESLIGADAS de forma governada: schema de
  // input preservado (contrato de API e congelamento RC-C0.1A), recusa antes de qualquer efeito colateral.
  listByProcess: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyDocumentList> => {
      throwLegacyEndpointDisabled("documents.listByProcess", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  list: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyDocumentList> => {
      throwLegacyEndpointDisabled("documents.list", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  save: tenantProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer"]),
      content: z.string().max(500_000),
    }))
    .mutation(async ({ ctx }): Promise<LegacySaveResult> => {
      throwLegacyEndpointDisabled("documents.save", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  getByType: tenantProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer"]),
    }))
    .query(async ({ ctx }): Promise<LegacyDocumentByType> => {
      throwLegacyEndpointDisabled("documents.getByType", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  generateNext: tenantProcedure
    .input(z.object({
      processId: z.number(),
    }))
    .mutation(async ({ ctx }): Promise<LegacyGenerateNextResult> => {
      throwLegacyEndpointDisabled("documents.generateNext", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  updateDocument: tenantProcedure
    .input(z.object({ documentId: z.number(), content: z.string() }))
    .mutation(async ({ ctx }): Promise<LegacySaveResult> => {
      throwLegacyEndpointDisabled("documents.updateDocument", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  generateDocument: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
    }))
    .mutation(async ({ ctx }): Promise<LegacyGenerateResult> => {
      throwLegacyEndpointDisabled("documents.generateDocument", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  uploadDocument: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
      fileName: z.string().max(255).regex(/^[\w\-. ]+$/, "Nome de arquivo inválido"),
      fileBase64: z.string().max(15_000_000), // ~10 MB em base64
      mimeType: z.enum(ALLOWED_MIME_TYPES),
    }))
    .mutation(async ({ ctx }): Promise<LegacyGenerateResult> => {
      throwLegacyEndpointDisabled("documents.uploadDocument", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  getDownloadUrl: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyDownloadUrlResult> => {
      throwLegacyEndpointDisabled("documents.getDownloadUrl", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  getVersionHistory: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx }): Promise<LegacyDocumentVersions> => {
      throwLegacyEndpointDisabled("documents.getVersionHistory", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  restoreVersion: tenantProcedure
    .input(z.object({
      documentId: z.number(),
      versionId: z.number(),
    }))
    .mutation(async ({ ctx }): Promise<LegacySaveResult> => {
      throwLegacyEndpointDisabled("documents.restoreVersion", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  downloadDocx: tenantProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx }): Promise<LegacyFileResult> => {
      throwLegacyEndpointDisabled("documents.downloadDocx", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  downloadPdf: tenantProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx }): Promise<LegacyFileResult> => {
      throwLegacyEndpointDisabled("documents.downloadPdf", "LEG-009", ctx, LEG009_ALTERNATIVE);
    }),

  submitForReview: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process || process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await db.updateDocumentStatusForOrganization(input.documentId, ctx.organizationId, "in_review");
      await db.createActivityLog({
        processId: document.processId,
        userId: ctx.user.id,
        action: `enviou ${document.type.toUpperCase()} para revisão`,
        details: JSON.stringify({ documentId: input.documentId, version: document.version }),
      });
      return { success: true };
    }),

  approveDocument: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process || process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await db.updateDocumentStatusForOrganization(input.documentId, ctx.organizationId, "approved");
      await db.createActivityLog({
        processId: document.processId,
        userId: ctx.user.id,
        action: `aprovou o ${document.type.toUpperCase()} (v${document.version})`,
        details: JSON.stringify({ documentId: input.documentId, version: document.version }),
      });
      return { success: true };
    }),

  rejectDocument: tenantProcedure
    .input(z.object({ documentId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process || process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      await db.updateDocumentStatusForOrganization(input.documentId, ctx.organizationId, "rejected");
      await db.createActivityLog({
        processId: document.processId,
        userId: ctx.user.id,
        action: `rejeitou o ${document.type.toUpperCase()} (v${document.version})`,
        details: JSON.stringify({ documentId: input.documentId, version: document.version, reason: input.reason }),
      });
      return { success: true };
    }),
});
