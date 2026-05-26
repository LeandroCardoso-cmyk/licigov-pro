import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { OrgRole } from "../../drizzle/schema";
import { resolveTenantForUser } from "../services/tenantService";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

// ─── requireUser ────────────────────────────────────────────────────────────

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(requireUser);

// ─── adminProcedure ──────────────────────────────────────────────────────────

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);

// ─── tenantProcedure ────────────────────────────────────────────────────────
// Resolve o organizationId + papel do usuário na organização.
// Admins de plataforma passam via header X-Organization-Id (qualquer org).
// Usuários normais: resolvido pelo tenantService (único membership ou header).

const resolveTenant = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // Admins de plataforma têm acesso irrestrito
  if (ctx.user.role === 'admin') {
    const orgIdHeader = ctx.req.headers['x-organization-id'];
    const organizationId = orgIdHeader ? parseInt(orgIdHeader as string, 10) : 1;

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        organizationId,
        orgMembership: {
          id: 0,
          organizationId,
          userId: ctx.user.id,
          role: 'owner' as OrgRole,
          invitedBy: null,
          ativo: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });
  }

  // Usuários normais: resolver via tenantService
  const { organizationId, membership } = await resolveTenantForUser(
    ctx.user.id,
    ctx.req,
  );

  if (!membership || !membership.ativo) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Você não tem acesso a esta organização.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      organizationId,
      orgMembership: membership,
    },
  });
});

export const tenantProcedure = t.procedure.use(requireUser).use(resolveTenant);

// ─── orgRoleProcedure ───────────────────────────────────────────────────────
// Exige que o usuário tenha um dos papéis especificados na organização.

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  viewer:   1,
  operator: 2,
  manager:  3,
  admin:    4,
  owner:    5,
};

export function orgRoleProcedure(minRole: OrgRole) {
  return tenantProcedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      const userRole = ctx.orgMembership!.role;
      if (ORG_ROLE_RANK[userRole] < ORG_ROLE_RANK[minRole]) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Esta ação requer papel mínimo '${minRole}' na organização.`,
        });
      }

      return next({ ctx });
    }),
  );
}
