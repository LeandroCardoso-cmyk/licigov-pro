/**
 * C.3A-OPS — Router institucional de controle de feature flags tenant-aware.
 *
 * Superfície MÍNIMA (apenas consulta + alteração), restrita a `adminProcedure` (admin de PLATAFORMA) —
 * não a operator/manager/owner de organização. NÃO contém regra de negócio: delega tudo ao
 * `featureFlagAdminService` (guarda de ambiente, allowlist, idempotência, transação atômica flag+auditoria,
 * invalidação de cache). Sem rollout %, sem ativar nenhuma flag por default.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { resolveTenantFlag, setTenantFlag } from "../services/featureFlagAdminService";

export const featureFlagAdminRouter = router({
  /** CONSULTA: estado tenant-aware de uma flag (override/enabled/percentage/expiresAt/effectiveValue/origin). */
  getTenantFlag: adminProcedure
    .input(
      z.object({
        organizationId: z.number().int().positive(),
        flagName: z.string().min(1).max(100),
      }),
    )
    .query(async ({ input }) => {
      return resolveTenantFlag(input.flagName, input.organizationId);
    }),

  /** ALTERA: UPSERT auditável e idempotente do override do tenant (bloqueado em produção). */
  setTenantFlag: adminProcedure
    .input(
      z.object({
        organizationId: z.number().int().positive(),
        flagName: z.string().min(1).max(100),
        enabled: z.boolean(),
        expiresAt: z.coerce.date().nullish(),
        reason: z.string().trim().min(1, "Justificativa obrigatória."),
        idempotencyKey: z.string().trim().min(1, "idempotencyKey obrigatória."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return setTenantFlag({
        organizationId: input.organizationId,
        flagName: input.flagName,
        enabled: input.enabled,
        expiresAt: input.expiresAt ?? null,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorUserId: ctx.user.id,
        actorName: ctx.user.name ?? null,
        actorEmail: ctx.user.email ?? null,
        actorRole: ctx.user.role ?? null,
        correlationId: ctx.correlationId,
        requestId: ctx.requestId,
      });
    }),
});
