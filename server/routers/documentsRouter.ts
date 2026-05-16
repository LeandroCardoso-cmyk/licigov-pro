import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { generateETP, generateTR, generateDFD, generateEdital } from "../services/gemini";
import { convertToPDF, convertToDOCX } from "../services/documentConverter";
import { storagePut, storageGet } from "../storage";

export const documentsRouter = router({
  listByProcess: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getDocumentsByProcess(input.processId);
    }),

  list: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getDocumentsByProcess(input.processId);
    }),

  save: protectedProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital"]),
      content: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getDocumentByProcessAndType(input.processId, input.type);
      const version = existing ? existing.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: input.type,
        content: input.content,
        version,
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `${existing ? 'atualizou' : 'criou'} o documento ${input.type.toUpperCase()}`,
        details: JSON.stringify({ version }),
      });

      return { success: true, version };
    }),

  getByType: protectedProcedure
    .input(z.object({
      processId: z.number(),
      type: z.enum(["etp", "tr", "dfd", "edital"]),
    }))
    .query(async ({ input }) => {
      return await db.getDocumentByProcessAndType(input.processId, input.type);
    }),

  generateNext: protectedProcedure
    .input(z.object({
      processId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
      if (process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este processo" });

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);
      const docs = await db.getDocumentsByProcess(input.processId);
      const dfdDoc = docs.find(d => d.type === "dfd");
      const etpDoc = docs.find(d => d.type === "etp");
      const trDoc = docs.find(d => d.type === "tr");

      let nextDocType: "dfd" | "etp" | "tr" | "edital";
      let nextStatus: "em_dfd" | "em_etp" | "em_tr" | "em_edital" | "concluido";
      let generatedContent: string;

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
        const processItems = await db.getProcessItems(input.processId);
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
      } else if (process.status === "em_edital") {
        await db.updateProcessStatus(input.processId, "concluido");
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
      });

      await db.updateProcessStatus(input.processId, nextStatus);

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `gerou o ${nextDocType.toUpperCase()} automaticamente`,
        details: JSON.stringify({ generatedBy: "AI", status: nextStatus }),
      });

      return { success: true, documentType: nextDocType, status: nextStatus };
    }),

  updateDocument: protectedProcedure
    .input(z.object({ documentId: z.number(), content: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const document = await db.getDocumentById(input.documentId);
      if (!document) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento não encontrado' });
      }

      const process = await db.getProcessById(document.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Sem permissão para editar este documento' });
      }

      const newVersion = document.version + 1;
      await db.createDocument({
        processId: document.processId,
        type: document.type,
        content: input.content,
        version: newVersion,
      });

      await db.createActivityLog({
        processId: document.processId,
        userId: ctx.user.id,
        action: `Editou ${document.type.toUpperCase()} (versão ${newVersion})`,
      });

      return { success: true, version: newVersion };
    }),

  generateDocument: protectedProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
      if (process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este processo" });

      const settings = await db.getDocumentSettingsByUser(ctx.user.id);
      const docs = await db.getDocumentsByProcess(input.processId);
      const dfdDoc = docs.find(d => d.type === "dfd");
      const etpDoc = docs.find(d => d.type === "etp");
      const trDoc = docs.find(d => d.type === "tr");

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
        const processItems = await db.getProcessItems(input.processId);
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
      } else {
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
      }

      const existingDoc = docs.find(d => d.type === input.docType);
      const nextVersion = existingDoc ? existingDoc.version + 1 : 1;

      await db.createDocument({
        processId: input.processId,
        type: input.docType,
        content: generatedContent,
        version: nextVersion,
      });

      const statusMap: Record<string, string> = {
        dfd: "em_dfd",
        etp: "em_etp",
        tr: "em_tr",
        edital: "em_edital",
      };
      if (process.status === statusMap[input.docType]) {
        // status already matches — no change needed
      } else if (
        (input.docType === "dfd" && process.status !== "em_dfd") ||
        (input.docType === "etp" && process.status === "em_dfd") ||
        (input.docType === "tr" && process.status === "em_etp") ||
        (input.docType === "edital" && process.status === "em_tr")
      ) {
        await db.updateProcessStatus(input.processId, statusMap[input.docType] as any);
      }

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `gerou o ${input.docType.toUpperCase()} por IA`,
        details: JSON.stringify({ generatedBy: "AI", docType: input.docType }),
      });

      return { success: true, docType: input.docType, version: nextVersion };
    }),

  uploadDocument: protectedProcedure
    .input(z.object({
      processId: z.number(),
      docType: z.enum(["dfd", "etp", "tr", "edital"]),
      fileName: z.string(),
      fileBase64: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const process = await db.getProcessById(input.processId);
      if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado" });
      if (process.ownerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

      const buffer = Buffer.from(input.fileBase64, "base64");
      const s3Key = `processes/${input.processId}/${input.docType}/${Date.now()}_${input.fileName}`;
      const { key, url } = await storagePut(s3Key, buffer, input.mimeType);

      const docs = await db.getDocumentsByProcess(input.processId);
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
      });

      await db.createActivityLog({
        processId: input.processId,
        userId: ctx.user.id,
        action: `fez upload do ${input.docType.toUpperCase()}`,
        details: JSON.stringify({ fileName: input.fileName, s3Key: key }),
      });

      return { success: true, docType: input.docType, version: nextVersion };
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ ctx, input }) => {
      const document = await db.getDocumentById(input.documentId);
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });

      const process = await db.getProcessById(document.processId);
      if (!process || process.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      if (!document.s3Key) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este documento não possui arquivo S3 associado" });
      }

      const { url } = await storageGet(document.s3Key, 3600);
      return { url, expiresIn: 3600 };
    }),

  getVersionHistory: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .query(async ({ input }) => {
      const document = await db.getDocumentById(input.documentId);
      if (!document) {
        throw new Error("Documento não encontrado");
      }
      return await db.getDocumentVersions(document.processId, document.type);
    }),

  restoreVersion: protectedProcedure
    .input(z.object({
      documentId: z.number(),
      versionId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const currentDocument = await db.getDocumentById(input.documentId);
      if (!currentDocument) {
        throw new Error("Documento não encontrado");
      }

      const versionToRestore = await db.getDocumentById(input.versionId);
      if (!versionToRestore) {
        throw new Error("Versão não encontrada");
      }

      const process = await db.getProcessById(currentDocument.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      const newVersion = currentDocument.version + 1;
      await db.createDocument({
        processId: currentDocument.processId,
        type: currentDocument.type,
        content: versionToRestore.content,
        version: newVersion,
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

  downloadDocx: protectedProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentById(input.documentId);
      if (!document) {
        throw new Error("Documento não encontrado");
      }

      const process = await db.getProcessById(document.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      const documentLabels: Record<string, string> = {
        etp: "Estudo Técnico Preliminar (ETP)",
        tr: "Termo de Referência (TR)",
        dfd: "Documento Formalizador de Demanda (DFD)",
        edital: "Edital de Licitação",
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

  downloadPdf: protectedProcedure
    .input(z.object({
      documentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const document = await db.getDocumentById(input.documentId);
      if (!document) {
        throw new Error("Documento não encontrado");
      }

      const process = await db.getProcessById(document.processId);
      if (!process) {
        throw new Error("Processo não encontrado");
      }

      const documentLabels: Record<string, string> = {
        etp: "Estudo Técnico Preliminar (ETP)",
        tr: "Termo de Referência (TR)",
        dfd: "Documento Formalizador de Demanda (DFD)",
        edital: "Edital de Licitação",
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
});
