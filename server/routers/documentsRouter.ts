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
import { z } from "zod";
import * as db from "../db";
import { generateETP, generateTR, generateDFD, generateEdital, generateContrato, generateAta, generateParecer } from "../services/gemini";
import { convertToPDF, convertToDOCX } from "../services/documentConverter";
import { storagePut, storageGet } from "../storage";
import { serviceLogger } from "../services/observabilityService";

const log = serviceLogger("documentsRouter");

/**
 * RC-SEC-PR-A — Negação de autorização multi-tenant. Cross-tenant e inexistente
 * produzem o MESMO erro NOT_FOUND. Log estruturado leve, sem conteúdo sensível.
 */
function denyNotFound(
  procedure: string,
  ctx: { organizationId: number; user: { id: number } },
  resourceId: number,
  reason: string,
  message = "Recurso não encontrado",
): never {
  log.warn("tenant_authorization_denied", {
    procedure,
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    resourceId,
    reason,
  });
  throw new TRPCError({ code: "NOT_FOUND", message });
}

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
] as const;

/**
 * Verifica se o processo pertence à organização (1ª camada, isolamento tenant),
 * e então se o usuário é dono do processo ou membro com acesso (2ª camada intra-org).
 * Cross-tenant e inexistente retornam o MESMO NOT_FOUND.
 */
async function assertProcessAccess(processId: number, organizationId: number, userId: number): Promise<void> {
  const process = await db.getProcessByIdForOrganization(processId, organizationId);
  if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
  if (process.ownerId === userId) return;
  const member = await db.getProcessMember(processId, userId);
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este processo" });
}

/** Verifica organização (1ª camada) e propriedade do processo (2ª camada, operações destrutivas). */
async function assertProcessOwner(processId: number, organizationId: number, userId: number): Promise<void> {
  const process = await db.getProcessByIdForOrganization(processId, organizationId);
  if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
  if (process.ownerId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Apenas o responsável pode executar esta ação" });
}

export const documentsRouter = router({
  listByProcess: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProcessAccess(input.processId, ctx.organizationId, ctx.user.id);
      return await db.getDocumentsByProcessForOrganization(input.processId, ctx.organizationId);
    }),

  list: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertProcessAccess(input.processId, ctx.organizationId, ctx.user.id);
      return await db.getDocumentsByProcessForOrganization(input.processId, ctx.organizationId);
    }),

  save: tenantProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer"]),
      content: z.string().max(500_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProcessAccess(input.processId, ctx.organizationId, ctx.user.id);
      const existing = await db.getDocumentByProcessAndTypeForOrganization(input.processId, input.type, ctx.organizationId);
      const version = existing ? existing.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: input.type,
        content: input.content,
        version,
        createdBy: ctx.user.id,
        organizationId: ctx.organizationId,
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `${existing ? 'atualizou' : 'criou'} o documento ${input.type.toUpperCase()}`,
        details: JSON.stringify({ version }),
      });

      return { success: true, version };
    }),

  getByType: tenantProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer"]),
    }))
    .query(async ({ ctx, input }) => {
      await assertProcessAccess(input.processId, ctx.organizationId, ctx.user.id);
      return await db.getDocumentByProcessAndTypeForOrganization(input.processId, input.type, ctx.organizationId);
    }),

  generateNext: tenantProcedure
    .input(z.object({
      processId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessByIdForOrganization(input.processId, ctx.organizationId);
      if (!process) {
        denyNotFound("generateNext", ctx, input.processId, "process_cross_tenant_or_missing", "Processo não encontrado");
      }
      if (process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este processo" });

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);
      const docs = await db.getDocumentsByProcessForOrganization(input.processId, ctx.organizationId);
      const dfdDoc = docs.find(d => d.type === "dfd");
      const etpDoc = docs.find(d => d.type === "etp");
      const trDoc = docs.find(d => d.type === "tr");

      let nextDocType: "dfd" | "etp" | "tr" | "edital" | "contrato" | "ata" | "parecer";
      let nextStatus: "em_dfd" | "em_etp" | "em_tr" | "em_edital" | "em_contrato" | "em_ata" | "em_parecer" | "concluido";
      let generatedContent: string;

      const editalDoc = docs.find(d => d.type === "edital");
      const contratoDoc = docs.find(d => d.type === "contrato");
      const ataDoc = docs.find(d => d.type === "ata");

      const commonOrgParams = {
        organizationName: settings?.organizationName || undefined,
        address: settings?.address || undefined,
        cnpj: settings?.cnpj || undefined,
        phone: settings?.phone || undefined,
        email: settings?.email || undefined,
        website: settings?.website || undefined,
      };

      if (process.status === "em_dfd" && dfdDoc) {
        nextDocType = "etp";
        nextStatus = "em_etp";
        generatedContent = await generateETP({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          dfdContent: dfdDoc.content || "",
          ...commonOrgParams,
        });
      } else if (process.status === "em_etp" && etpDoc && dfdDoc) {
        nextDocType = "tr";
        nextStatus = "em_tr";
        const processItems = await db.getProcessItemsForOrganization(input.processId, ctx.organizationId);
        const catmatItems = processItems.map(item => ({
          itemType: item.itemType,
          catmatCode: item.catmatCode ? String(item.catmatCode) : undefined,
          catserCode: item.catserCode ? String(item.catserCode) : undefined,
          description: item.description,
          unit: item.unit,
          groupCode: item.groupCode ? String(item.groupCode) : undefined,
          classCode: item.classCode ? String(item.classCode) : undefined,
        }));
        generatedContent = await generateTR({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          etpContent: etpDoc.content || "",
          catmatItems: catmatItems.length > 0 ? catmatItems : undefined,
          ...commonOrgParams,
        });
      } else if (process.status === "em_tr" && trDoc && etpDoc && dfdDoc) {
        nextDocType = "edital";
        nextStatus = "em_edital";
        generatedContent = await generateEdital({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          dfdContent: dfdDoc.content || "",
          etpContent: etpDoc.content || "",
          trContent: trDoc.content || "",
          ...commonOrgParams,
        });
      } else if (process.status === "em_edital" && editalDoc && trDoc) {
        nextDocType = "contrato";
        nextStatus = "em_contrato";
        generatedContent = await generateContrato({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          editalContent: editalDoc.content || "",
          trContent: trDoc.content || "",
          ...commonOrgParams,
        });
      } else if (process.status === "em_contrato" && contratoDoc && editalDoc) {
        nextDocType = "ata";
        nextStatus = "em_ata";
        generatedContent = await generateAta({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          editalContent: editalDoc.content || "",
          contratoContent: contratoDoc.content || "",
          ...commonOrgParams,
        });
      } else if (process.status === "em_ata" && ataDoc && editalDoc && trDoc && etpDoc && dfdDoc) {
        nextDocType = "parecer";
        nextStatus = "em_parecer";
        generatedContent = await generateParecer({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          dfdContent: dfdDoc.content || "",
          etpContent: etpDoc.content || "",
          trContent: trDoc.content || "",
          editalContent: editalDoc.content || "",
          ...commonOrgParams,
        });
      } else if (process.status === "em_parecer") {
        await db.updateProcessStatusForOrganization(input.processId, ctx.organizationId, "concluido");
        await db.createActivityLog({
          processId: input.processId,
          userId: ctx.user.id,
          action: "concluiu o processo",
          details: JSON.stringify({ status: "concluido" }),
        });
        return { success: true, documentType: null, status: "concluido" };
      } else {
        throw new Error("Não é possível gerar o próximo documento. Verifique o status do processo.");
      }

      const existingDoc = docs.find(d => d.type === nextDocType);
      const nextVersion = existingDoc ? existingDoc.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: nextDocType,
        content: generatedContent,
        version: nextVersion,
        createdBy: ctx.user.id,
        organizationId: ctx.organizationId,
      });

      await db.updateProcessStatusForOrganization(input.processId, ctx.organizationId, nextStatus);

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `gerou o ${nextDocType.toUpperCase()} automaticamente`,
        details: JSON.stringify({ generatedBy: "AI", status: nextStatus }),
      });

      return { success: true, documentType: nextDocType, status: nextStatus };
    }),

  updateDocument: tenantProcedure
    .input(z.object({ documentId: z.number(), content: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) {
        denyNotFound("updateDocument", ctx, input.documentId, "document_cross_tenant_or_missing", "Documento não encontrado");
      }

      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process) {
        denyNotFound("updateDocument", ctx, document.processId, "process_cross_tenant_or_missing", "Documento não encontrado");
      }
      if (process.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão para editar este documento' });
      }

      const newVersion = document.version + 1;
      await db.createDocument({
        processId: document.processId,
        type: document.type,
        content: input.content,
        version: newVersion,
        createdBy: ctx.user.id,
        organizationId: ctx.organizationId,
      });

      await db.createActivityLog({
        processId: document.processId,
        userId: ctx.user.id,
        action: `Editou ${document.type.toUpperCase()} (versão ${newVersion})`,
      });

      return { success: true, version: newVersion };
    }),

  generateDocument: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessByIdForOrganization(input.processId, ctx.organizationId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
      if (process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este processo" });

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);
      const docs = await db.getDocumentsByProcessForOrganization(input.processId, ctx.organizationId);
      const dfdDoc = docs.find(d => d.type === "dfd");
      const etpDoc = docs.find(d => d.type === "etp");
      const trDoc = docs.find(d => d.type === "tr");
      const editalDoc = docs.find(d => d.type === "edital");
      const contratoDoc = docs.find(d => d.type === "contrato");

      const commonOrgParams = {
        organizationName: settings?.organizationName || undefined,
        address: settings?.address || undefined,
        cnpj: settings?.cnpj || undefined,
        phone: settings?.phone || undefined,
        email: settings?.email || undefined,
        website: settings?.website || undefined,
      };

      let generatedContent: string;

      if (input.docType === "dfd") {
        generatedContent = await generateDFD({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          ...commonOrgParams,
        });
      } else if (input.docType === "etp") {
        generatedContent = await generateETP({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          dfdContent: dfdDoc?.content || undefined,
          ...commonOrgParams,
        });
      } else if (input.docType === "tr") {
        if (!etpDoc) throw new TRPCError({ code: "BAD_REQUEST", message: "ETP é necessário para gerar o TR" });
        const processItems = await db.getProcessItemsForOrganization(input.processId, ctx.organizationId);
        const catmatItems = processItems.map(item => ({
          itemType: item.itemType,
          catmatCode: item.catmatCode ? String(item.catmatCode) : undefined,
          catserCode: item.catserCode ? String(item.catserCode) : undefined,
          description: item.description,
          unit: item.unit,
          groupCode: item.groupCode ? String(item.groupCode) : undefined,
          classCode: item.classCode ? String(item.classCode) : undefined,
        }));
        generatedContent = await generateTR({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          etpContent: etpDoc.content || "",
          catmatItems: catmatItems.length > 0 ? catmatItems : undefined,
          ...commonOrgParams,
        });
      } else if (input.docType === "edital") {
        if (!etpDoc || !trDoc) throw new TRPCError({ code: "BAD_REQUEST", message: "ETP e TR são necessários para gerar o Edital" });
        generatedContent = await generateEdital({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          dfdContent: dfdDoc?.content || "",
          etpContent: etpDoc.content || "",
          trContent: trDoc.content || "",
          ...commonOrgParams,
        });
      } else if (input.docType === "contrato") {
        if (!editalDoc || !trDoc) throw new TRPCError({ code: "BAD_REQUEST", message: "Edital e TR são necessários para gerar a Minuta de Contrato" });
        generatedContent = await generateContrato({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          platformId: process.platformId,
          editalContent: editalDoc.content || "",
          trContent: trDoc.content || "",
          ...commonOrgParams,
        });
      } else if (input.docType === "ata") {
        if (!editalDoc || !contratoDoc) throw new TRPCError({ code: "BAD_REQUEST", message: "Edital e Minuta de Contrato são necessários para gerar a Ata" });
        generatedContent = await generateAta({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          editalContent: editalDoc.content || "",
          contratoContent: contratoDoc.content || "",
          ...commonOrgParams,
        });
      } else {
        // parecer
        if (!dfdDoc || !etpDoc || !trDoc || !editalDoc) throw new TRPCError({ code: "BAD_REQUEST", message: "DFD, ETP, TR e Edital são necessários para gerar o Parecer" });
        generatedContent = await generateParecer({
          processName: process.name,
          object: process.object || "",
          estimatedValue: process.estimatedValue || 0,
          modality: process.modality || "",
          category: process.category || "",
          dfdContent: dfdDoc.content || "",
          etpContent: etpDoc.content || "",
          trContent: trDoc.content || "",
          editalContent: editalDoc.content || "",
          ...commonOrgParams,
        });
      }

      const existingDoc = docs.find(d => d.type === input.docType);
      const nextVersion = existingDoc ? existingDoc.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: input.docType,
        content: generatedContent,
        version: nextVersion,
        createdBy: ctx.user.id,
      });

      const statusMap: Record<string, string> = {
        dfd: "em_dfd",
        etp: "em_etp",
        tr: "em_tr",
        edital: "em_edital",
        contrato: "em_contrato",
        ata: "em_ata",
        parecer: "em_parecer",
      };
      const statusOrder = ["em_dfd", "em_etp", "em_tr", "em_edital", "em_contrato", "em_ata", "em_parecer", "concluido"];
      const currentIdx = statusOrder.indexOf(process.status);
      const targetIdx = statusOrder.indexOf(statusMap[input.docType]);
      if (targetIdx > currentIdx) {
        await db.updateProcessStatusForOrganization(input.processId, ctx.organizationId, statusMap[input.docType] as any);
      }

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `gerou o ${input.docType.toUpperCase()} por IA`,
        details: JSON.stringify({ generatedBy: "AI", docType: input.docType }),
      });

      return { success: true, docType: input.docType, version: nextVersion };
    }),

  uploadDocument: tenantProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]),
      fileName: z.string().max(255).regex(/^[\w\-. ]+$/, "Nome de arquivo inválido"),
      fileBase64: z.string().max(15_000_000), // ~10 MB em base64
      mimeType: z.enum(ALLOWED_MIME_TYPES),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertProcessOwner(input.processId, ctx.organizationId, ctx.user.id);

      const buffer = Buffer.from(input.fileBase64, "base64");
      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9_\-. ]/g, "_");
      const s3Key = `processes/${input.processId}/${input.docType}/${Date.now()}_${safeFileName}`;
      const { key, url } = await storagePut(s3Key, buffer, input.mimeType);

      const docs = await db.getDocumentsByProcessForOrganization(input.processId, ctx.organizationId);
      const existingDoc = docs.find(d => d.type === input.docType);
      const nextVersion = existingDoc ? existingDoc.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: input.docType,
        content: null,
        sourceType: "upload",
        s3Key: key,
        fileUrl: url,
        version: nextVersion,
        createdBy: ctx.user.id,
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `fez upload do ${input.docType.toUpperCase()}`,
        details: JSON.stringify({ fileName: input.fileName, s3Key: key }),
      });

      return { success: true, docType: input.docType, version: nextVersion };
    }),

  getDownloadUrl: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });

      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      if (!document.s3Key) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este documento não possui arquivo S3 associado" });
      }

      const { url } = await storageGet(document.s3Key, 3600);
      return { url, expiresIn: 3600 };
    }),

  getVersionHistory: tenantProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      await assertProcessAccess(document.processId, ctx.organizationId, ctx.user.id);
      return await db.getDocumentVersionsForOrganization(document.processId, document.type, ctx.organizationId);
    }),

  restoreVersion: tenantProcedure
    .input(z.object({
      documentId: z.number(),
      versionId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const currentDocument = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!currentDocument) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });

      const versionToRestore = await db.getDocumentByIdForOrganization(input.versionId, ctx.organizationId);
      if (!versionToRestore) throw new TRPCError({ code: "NOT_FOUND", message: "Versão não encontrada" });

      await assertProcessOwner(currentDocument.processId, ctx.organizationId, ctx.user.id);

      const newVersion = currentDocument.version + 1;
      await db.createDocument({
        processId: currentDocument.processId,
        type: currentDocument.type,
        content: versionToRestore.content,
        version: newVersion,
        createdBy: ctx.user.id,
      });

      await db.createActivityLog({
        processId: currentDocument.processId,
        userId: ctx.user.id,
        action: `restaurou ${currentDocument.type.toUpperCase()} para versão ${versionToRestore.version}`,
        details: JSON.stringify({
          restoredFrom: versionToRestore.version,
          newVersion,
        }),
      });

      return { success: true, version: newVersion };
    }),

  downloadDocx: tenantProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      await assertProcessAccess(document.processId, ctx.organizationId, ctx.user.id);

      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });

      const documentLabels: Record<string, string> = {
        dfd: "Documento Formalizador de Demanda (DFD)",
        etp: "Estudo Técnico Preliminar (ETP)",
        tr: "Termo de Referência (TR)",
        edital: "Edital de Licitação",
        contrato: "Minuta de Contrato",
        ata: "Ata de Resultado de Julgamento",
        parecer: "Parecer Jurídico",
      };

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);

      const buffer = await convertToDOCX(
        document.content || "",
        `${documentLabels[document.type]} - ${process.name}`,
        settings?.organizationName || undefined,
        settings?.address || undefined,
        settings?.cnpj || undefined,
        settings?.phone || undefined,
        settings?.email || undefined,
        settings?.website || undefined
      );

      return {
        success: true,
        filename: `${document.type}_${process.name.replace(/\s+/g, "_")}.docx`,
        data: buffer.toString("base64"),
      };
    }),

  downloadPdf: tenantProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentByIdForOrganization(input.documentId, ctx.organizationId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      await assertProcessAccess(document.processId, ctx.organizationId, ctx.user.id);

      const process = await db.getProcessByIdForOrganization(document.processId, ctx.organizationId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });

      const documentLabels: Record<string, string> = {
        dfd: "Documento Formalizador de Demanda (DFD)",
        etp: "Estudo Técnico Preliminar (ETP)",
        tr: "Termo de Referência (TR)",
        edital: "Edital de Licitação",
        contrato: "Minuta de Contrato",
        ata: "Ata de Resultado de Julgamento",
        parecer: "Parecer Jurídico",
      };

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);

      const buffer = await convertToPDF(
        document.content || "",
        `${documentLabels[document.type]} - ${process.name}`,
        settings?.organizationName || undefined,
        settings?.address || undefined,
        settings?.cnpj || undefined,
        settings?.phone || undefined,
        settings?.email || undefined,
        settings?.website || undefined
      );

      return {
        success: true,
        filename: `${document.type}_${process.name.replace(/\s+/g, "_")}.pdf`,
        data: buffer.toString("base64"),
      };
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
