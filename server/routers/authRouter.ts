import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { hashPassword, verifyPassword } from "../services/passwordSecurity";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { rateLimitMiddleware } from "../services/rateLimiter";
import { SESSION_TTL_MS, ALLOW_PUBLIC_REGISTRATION } from "../config/auth";
import { sanitizeUser } from "../services/userProjection";

export const authRouter = router({
  // PR A.1 — nunca mais a linha completa de `users` (passwordHash/signaturePassword) ao cliente.
  me: publicProcedure.query(opts => (opts.ctx.user ? sanitizeUser(opts.ctx.user) : null)),

  register: publicProcedure
    .use(rateLimitMiddleware("login"))
    .input(
      z.object({
        name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
        email: z.string().email("E-mail inválido").max(254),
        password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // RC-SEC-PR-A (SEC-017): registro público fail-closed. Desabilitado por
      // padrão; só permitido com ALLOW_PUBLIC_REGISTRATION=true. Mesmo permitido,
      // o novo usuário NÃO recebe membership automático em organização alguma
      // (o fallback org=1 foi removido do tenantService) — precisa de convite/
      // vinculação administrativa para acessar recursos institucionais.
      if (!ALLOW_PUBLIC_REGISTRATION) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Cadastro público desabilitado. O acesso depende de convite ou vinculação administrativa.",
        });
      }

      const existing = await db.getUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "E-mail já cadastrado",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const openId = nanoid();

      const user = await db.createUser({
        openId,
        email: input.email,
        name: input.name,
        passwordHash,
      });

      const token = await sdk.signSession({
        openId: user.openId,
        appId: "licigov-pro",
        name: user.name ?? "",
        tv: user.tokenVersion,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });

      return { success: true, user: { id: user.id, name: user.name, email: user.email } };
    }),

  login: publicProcedure
    .use(rateLimitMiddleware("login"))
    .input(
      z.object({
        email: z.string().email("E-mail inválido").max(254),
        password: z.string().min(1, "Informe a senha").max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserByEmail(input.email);

      if (!user || !user.passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E-mail ou senha incorretos",
        });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E-mail ou senha incorretos",
        });
      }

      const token = await sdk.signSession({
        openId: user.openId,
        appId: "licigov-pro",
        name: user.name ?? "",
        tv: user.tokenVersion,
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });

      // PR A.1 — "último acesso" na tela de gestão de membros. touchLastSignedIn nunca lança
      // (best-effort internamente) — seguro dar `await` sem risco de derrubar um login válido.
      await db.touchLastSignedIn(user.id);

      return { success: true, user: { id: user.id, name: user.name, email: user.email } };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),

  updateTheme: protectedProcedure
    .input(z.object({ theme: z.enum(["light", "dark", "system"]) }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUserTheme(ctx.user.id, input.theme);
      return { success: true };
    }),
});
