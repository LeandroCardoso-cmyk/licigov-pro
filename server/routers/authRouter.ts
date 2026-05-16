import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { hashPassword, verifyPassword } from "../services/passwordSecurity";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";

export const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),

  register: publicProcedure
    .input(
      z.object({
        name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
        email: z.string().email("E-mail inválido"),
        password: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
      })
    )
    .mutation(async ({ ctx, input }) => {
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
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return { success: true, user: { id: user.id, name: user.name, email: user.email } };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email("E-mail inválido"),
        password: z.string().min(1, "Informe a senha"),
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
      });

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

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
