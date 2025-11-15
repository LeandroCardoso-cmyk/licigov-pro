import { z } from "zod";
import { protectedProcedure, router, adminProcedure } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";

export const companyDocumentsRouter = router({
  // Listar todos os documentos da empresa (admin)
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas administradores podem acessar",
      });
    }

    return await db.getAllCompanyDocuments();
  }),

  // Listar documentos mais recentes (última versão de cada tipo)
  listLatest: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas administradores podem acessar",
      });
    }

    return await db.getLatestCompanyDocuments();
  }),

  // Criar novo documento (admin)
  create: protectedProcedure
    .input(
      z.object({
        type: z.enum([
          "contrato_social",
          "cartao_cnpj",
          "certidao_federal",
          "certidao_estadual",
          "certidao_municipal",
          "certidao_fgts",
          "certidao_trabalhista",
          "alvara_funcionamento",
          "outros",
        ]),
        name: z.string(),
        description: z.string().optional(),
        fileUrl: z.string(),
        fileKey: z.string(),
        fileName: z.string(),
        fileSize: z.number(),
        mimeType: z.string(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem criar documentos",
        });
      }

      // Verificar se já existe documento do mesmo tipo
      const existingDocs = await db.getCompanyDocumentsByType(input.type);
      const latestVersion = existingDocs.length > 0 ? Math.max(...existingDocs.map(d => d.version)) : 0;

      // Calcular status baseado na validade
      let status: 'valid' | 'expiring_soon' | 'expired' = 'valid';
      if (input.expiresAt) {
        const now = new Date();
        const daysUntilExpiry = Math.floor((input.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysUntilExpiry < 0) {
          status = 'expired';
        } else if (daysUntilExpiry <= 30) {
          status = 'expiring_soon';
        }
      }

      const docId = await db.createCompanyDocument({
        ...input,
        version: latestVersion + 1,
        previousVersionId: existingDocs.length > 0 ? existingDocs[0].id : null,
        status,
        uploadedBy: ctx.user.id,
      });

      // Registrar log de auditoria
      await db.createAuditLog({
        adminId: ctx.user.id,
        action: "other",
        details: `Documento ${input.name} (${input.type}) versão ${latestVersion + 1} enviado`,
      });

      return { docId };
    }),

  // Atualizar status do documento (admin)
  updateStatus: protectedProcedure
    .input(
      z.object({
        docId: z.number(),
        status: z.enum(["valid", "expiring_soon", "expired"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem atualizar status",
        });
      }

      await db.updateCompanyDocumentStatus(input.docId, input.status);
      return { success: true };
    }),

  // Deletar documento (admin)
  delete: protectedProcedure
    .input(z.object({ docId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas administradores podem deletar documentos",
        });
      }

      await db.deleteCompanyDocument(input.docId);

      // Registrar log de auditoria
      await db.createAuditLog({
        adminId: ctx.user.id,
        action: "other",
        details: "Documento da empresa deletado",
      });

      return { success: true };
    }),

  // Verificar documentos vencidos ou próximos do vencimento
  checkExpiring: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas administradores podem acessar",
      });
    }

    const allDocs = await db.getLatestCompanyDocuments();
    const now = new Date();
    
    const expiring = allDocs.filter(doc => {
      if (!doc.expiresAt) return false;
      const daysUntilExpiry = Math.floor((doc.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
    });

    const expired = allDocs.filter(doc => {
      if (!doc.expiresAt) return false;
      return doc.expiresAt < now;
    });

    return {
      expiring,
      expired,
      hasIssues: expiring.length > 0 || expired.length > 0,
    };
  }),
});
