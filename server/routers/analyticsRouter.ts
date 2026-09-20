import { tenantProcedure, router } from "../_core/trpc";
import * as db from "../db";

/**
 * Overview institucional — TENANT-SCOPED (correção de vazamento cross-tenant).
 *
 * Antes: `protectedProcedure` + agregações GLOBAIS (getAllUsers/getProcessCountByStatus/…),
 * expondo processos, documentos, usuários e membros mais ativos de TODAS as organizações a
 * qualquer usuário autenticado. Agora deriva `organizationId` do contexto do servidor
 * (`tenantProcedure`) e filtra toda agregação por organização — nenhum tenant enxerga dados de
 * outro (invariante multi-tenant do PRODUCT_NORTH_STAR). Contrato de saída inalterado; o cliente
 * segue chamando sem argumentos.
 */
export const analyticsRouter = router({
  getOverview: tenantProcedure
    .query(async ({ ctx }) => {
      const organizationId = ctx.organizationId;
      const [processesByStatus, documentsByMonth, mostActiveMembers, members] = await Promise.all([
        db.getProcessCountByStatusForOrg(organizationId),
        db.getDocumentCountByMonthForOrg(organizationId, 6),
        db.getMostActiveMembersForOrg(organizationId, 10),
        db.getMembersOfOrg(organizationId),
      ]);
      const totalProcesses = processesByStatus.reduce((sum, item) => sum + item.count, 0);
      return {
        totalUsers: members.length, // membros ATIVOS da organização (não a lista global de usuários)
        totalProcesses,
        processesByStatus,
        documentsByMonth,
        mostActiveMembers,
      };
    }),
});
