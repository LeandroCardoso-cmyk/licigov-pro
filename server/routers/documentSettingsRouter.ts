import { router, orgRoleProcedure } from "../_core/trpc";
import { z } from "zod";
import { logFromCtx, type TrpcAuditCtx } from "../services/activityLogService";
import {
  resolveInstitutionalIdentity,
  saveInstitutionalIdentity,
} from "../services/institutionalIdentityService";

/**
 * Identidade institucional dos documentos (cabeçalho/rodapé aplicados aos documentos gerados).
 *
 * GOVERNANÇA (P0 piloto):
 *  - FONTE ÚNICA, SEM DUPLICIDADE: `organizationName`/`cnpj` (+esfera/uf/municipio) são CANÔNICOS em
 *    `organizations`; logo/endereço/telefone/email/site/rodapé são EXTENSÃO documental em
 *    `documentSettings`. A composição/gravação passa pelo `InstitutionalIdentityService` — nunca há
 *    duas fontes independentes para o mesmo campo.
 *  - TENANT-SCOPED: lida/gravada por `ctx.organizationId` (uma linha por organização), nunca por
 *    usuário. Substitui o modelo per-user (`userId`) que permitia identidades divergentes.
 *  - RBAC no BACKEND é o enforcement final: leitura e escrita exigem papel organizacional
 *    `admin`/`owner` (`orgRoleProcedure("admin")`) — operator/manager/viewer NÃO acessam.
 *  - AUDITÁVEL: toda alteração registra `org.document_settings_updated` (activity log com
 *    organizationId, ator e correlationId).
 *
 * Determinismo/replay: como a identidade é função pura de `organizationId`, a geração/exportação de
 * documentos é determinística — todo servidor autorizado da mesma organização produz a mesma
 * identidade, independentemente de quem dispara a geração.
 */
export const documentSettingsRouter = router({
  get: orgRoleProcedure("admin").query(async ({ ctx }) => {
    // Identidade COMPOSTA (canônica + extensão). O frontend distingue o que é canônico do que é
    // extensão para renderização; a gravação é roteada por dono de campo em `save`.
    return await resolveInstitutionalIdentity(ctx.organizationId!);
  }),

  save: orgRoleProcedure("admin")
    .input(z.object({
      // Canônicos (organizations). Contrato de entrada PERMISSIVO (preserva a UX existente da tela de
      // Configurações); a persistência roteia nome/cnpj para `organizations` (fonte única). Vazio é
      // ignorado em `saveInstitutionalIdentity` (nunca apaga o canônico com formulário parcial).
      organizationName: z.string().optional(),
      cnpj: z.string().optional(),
      // Extensão documental (documentSettings).
      logoUrl: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await saveInstitutionalIdentity(ctx.organizationId!, input);

      await logFromCtx(ctx as TrpcAuditCtx, null, "org.document_settings_updated", {
        entityType: "Organization",
        entityId: ctx.organizationId!,
        details: input,
      });

      return { success: true };
    }),
});
