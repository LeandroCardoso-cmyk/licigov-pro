/**
 * PR A.1 — Convites institucionais. `create/list/resend/cancel` exigem papel `admin` na
 * organização (orgRoleProcedure). `validateToken`/`accept` são públicos (é assim que alguém sem
 * conta entra no sistema); `acceptExisting` exige sessão (usuário que já tem conta noutra
 * organização, ou re-clicou o link estando logado).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { router, publicProcedure, protectedProcedure, orgRoleProcedure } from "../_core/trpc";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { SESSION_TTL_MS } from "../config/auth";
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  cancelInvitation,
  validateInvitationToken,
  acceptInvitation,
  acceptExistingInvitation,
} from "../services/invitationService";

const ORG_ROLE_ENUM = z.enum(["owner", "admin", "manager", "operator", "viewer"]);

export const invitationsRouter = router({
  create: orgRoleProcedure("admin")
    .input(
      z.object({
        email: z.string().email("E-mail inválido").max(254),
        role: ORG_ROLE_ENUM.exclude(["owner"]), // owner só via onboarding de tenant
        invitedName: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const invitation = await createInvitation({
        organizationId: ctx.organizationId!,
        email: input.email,
        role: input.role,
        invitedName: input.invitedName,
        createdByUserId: ctx.user!.id,
        correlationId: ctx.correlationId,
      });
      return { id: invitation.id, status: invitation.status, expiresAt: invitation.expiresAt };
    }),

  list: orgRoleProcedure("admin").query(async ({ ctx }) => {
    return await listInvitations(ctx.organizationId!);
  }),

  resend: orgRoleProcedure("admin")
    .use(rateLimitMiddleware("invitationManage"))
    .input(z.object({ invitationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await resendInvitation({
        invitationId: input.invitationId,
        organizationId: ctx.organizationId!,
        actorUserId: ctx.user!.id,
        correlationId: ctx.correlationId,
      });
      return { id: invitation.id, status: invitation.status, expiresAt: invitation.expiresAt };
    }),

  cancel: orgRoleProcedure("admin")
    .use(rateLimitMiddleware("invitationManage"))
    .input(z.object({ invitationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await cancelInvitation({
        invitationId: input.invitationId,
        organizationId: ctx.organizationId!,
        actorUserId: ctx.user!.id,
        correlationId: ctx.correlationId,
      });
      return { success: true } as const;
    }),

  validateToken: publicProcedure
    .use(rateLimitMiddleware("invitationAccept"))
    .input(z.object({ token: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      return await validateInvitationToken(input.token);
    }),

  /** Cria conta NOVA + sessão + membership. Mesmo padrão de authRouter.register. */
  accept: publicProcedure
    .use(rateLimitMiddleware("invitationAccept"))
    .input(
      z.object({
        token: z.string().min(1).max(200),
        name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
        password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await acceptInvitation({
        token: input.token,
        name: input.name,
        password: input.password,
        correlationId: ctx.correlationId,
      });

      const sessionToken = await sdk.signSession({
        openId: result.openId,
        appId: "licigov-pro",
        name: result.name,
        tv: 0,
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: SESSION_TTL_MS });

      return { success: true, organizationId: result.organizationId } as const;
    }),

  /** Usuário JÁ autenticado aceita um convite (outra organização, ou reabriu o link logado). */
  acceptExisting: protectedProcedure
    .use(rateLimitMiddleware("invitationAccept"))
    .input(z.object({ token: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sua conta não tem e-mail cadastrado." });
      }
      const result = await acceptExistingInvitation({
        token: input.token,
        userId: ctx.user.id,
        userEmail: ctx.user.email,
        correlationId: ctx.correlationId,
      });
      return { success: true, organizationId: result.organizationId } as const;
    }),
});
