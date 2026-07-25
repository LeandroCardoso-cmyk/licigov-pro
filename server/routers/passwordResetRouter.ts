/**
 * PR A.1 — Recuperação de senha: 3 procedures públicas (sem autenticação — é exatamente para
 * quem perdeu acesso à conta). Toda a lógica de negócio vive em services/passwordResetService.ts;
 * este router só valida input, aplica rate limit e traduz para a resposta HTTP/tRPC.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";
import {
  requestPasswordReset,
  validatePasswordResetToken,
  completePasswordReset,
} from "../services/passwordResetService";

export const passwordResetRouter = router({
  /**
   * Anti-enumeração: SEMPRE retorna {success:true}, independentemente do e-mail existir, estar
   * rate-limitado, ou o envio falhar — a decisão real acontece dentro de requestPasswordReset,
   * que nunca lança.
   */
  request: publicProcedure
    .use(rateLimitMiddleware("passwordReset"))
    .input(z.object({ email: z.string().email("E-mail inválido").max(254) }))
    .mutation(async ({ ctx, input }) => {
      await requestPasswordReset({
        email: input.email,
        ipAddress: typeof ctx.req.ip === "string" ? ctx.req.ip : undefined,
        correlationId: ctx.correlationId,
      });
      return { success: true } as const;
    }),

  validateToken: publicProcedure
    .use(rateLimitMiddleware("passwordReset"))
    .input(z.object({ token: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      return await validatePasswordResetToken(input.token);
    }),

  complete: publicProcedure
    .use(rateLimitMiddleware("passwordReset"))
    .input(
      z.object({
        token: z.string().min(1).max(200),
        newPassword: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await completePasswordReset({
        token: input.token,
        newPassword: input.newPassword,
        ipAddress: typeof ctx.req.ip === "string" ? ctx.req.ip : undefined,
        correlationId: ctx.correlationId,
      });
      return { success: true } as const;
    }),
});
