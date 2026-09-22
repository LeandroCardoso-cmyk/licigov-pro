import { router, orgRoleProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";
import { logFromCtx, type TrpcAuditCtx } from "../services/activityLogService";

/**
 * Identidade institucional documental (cabeçalho/rodapé aplicados aos documentos gerados).
 *
 * GOVERNANÇA (P0 piloto):
 *  - TENANT-SCOPED: lida/gravada por `ctx.organizationId` (uma linha por organização), nunca por
 *    usuário. Substitui o modelo per-user (`userId`) que permitia identidades divergentes entre
 *    servidores da mesma organização e viajava entre tenants.
 *  - RBAC no BACKEND é o enforcement final: leitura e escrita exigem papel organizacional
 *    `admin`/`owner` (`orgRoleProcedure("admin")`) — operator/manager/viewer NÃO acessam.
 *  - AUDITÁVEL: toda alteração registra `org.document_settings_updated` (activity log com
 *    organizationId, ator e correlationId).
 *
 * Determinismo/replay: como a identidade é função pura de `organizationId`, a geração/exportação de
 * documentos é determinística — todo servidor autorizado da mesma organização produz a mesma
 * identidade institucional, independentemente de quem dispara a geração.
 */
export const documentSettingsRouter = router({
  get: orgRoleProcedure("admin").query(async ({ ctx }) => {
    return await db.getDocumentSettingsByOrg(ctx.organizationId!);
  }),

  save: orgRoleProcedure("admin")
    .input(z.object({
      organizationName: z.string().optional(),
      logoUrl: z.string().optional(),
      address: z.string().optional(),
      cnpj: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertDocumentSettings({ organizationId: ctx.organizationId!, ...input });

      await logFromCtx(ctx as TrpcAuditCtx, null, "org.document_settings_updated", {
        entityType: "Organization",
        entityId: ctx.organizationId!,
        details: input,
      });

      return { success: true };
    }),
});
