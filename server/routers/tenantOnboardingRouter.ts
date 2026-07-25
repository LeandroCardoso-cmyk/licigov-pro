/**
 * PR A.1 — Onboarding de tenants: exclusivo do admin de plataforma (`users.role === 'admin'`,
 * não confundir com papel `admin` de organização). É como o Moreira Sales (ou qualquer novo
 * órgão) entra no sistema — via tela `/admin/organizacoes` (C10), sem hardcode.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { onboardTenant } from "../services/tenantOnboardingService";

export const tenantOnboardingRouter = router({
  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(3).max(255),
        slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Use apenas letras minúsculas, números e hífen."),
        cnpj: z.string().optional(),
        esfera: z.enum(["federal", "estadual", "municipal", "outro"]).default("municipal"),
        uf: z.string().length(2).optional(),
        municipio: z.string().max(100).optional(),
        firstAdminName: z.string().min(2).max(255),
        firstAdminEmail: z.string().email("E-mail inválido"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await onboardTenant({
        ...input,
        actorUserId: ctx.user.id,
        correlationId: ctx.correlationId,
      });
    }),
});
