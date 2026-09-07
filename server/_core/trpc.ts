import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { OrgRole } from "../../drizzle/schema";
import { resolveTenantForUser } from "../services/tenantService";
import * as db from "../db";

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
// Admins de plataforma passam via header X-Organization-Id (qualquer org existente,
// mas SEMPRE explícita e validada — nunca um default silencioso, ver PR 0).
// Usuários normais: resolvido pelo tenantService (único membership ou header).

/**
 * PR 0 (Security Emergency Closure) — parser estrito do X-Organization-Id para o
 * contexto de admin de plataforma. Antes: `orgIdHeader ? parseInt(...) : 1` — sem
 * o header, o admin caía silenciosamente na organização 1; com um header inválido
 * (ex.: "abc"), `parseInt` produzia `NaN` e seguia adiante mesmo assim. Nenhum dos
 * dois casos é aceitável para um acesso cross-tenant institucional: a organização
 * precisa ser SEMPRE informada e válida. Aceita apenas uma sequência de dígitos
 * representando um inteiro positivo — rejeita ausência, "abc", "0", negativo,
 * ponto flutuante e notação científica.
 */
function parsePlatformAdminOrganizationId(headerValue: unknown): number | null {
  if (typeof headerValue !== "string") return null;
  const trimmed = headerValue.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

const resolveTenant = t.middleware(async opts => {
  const { ctx, next, path } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // Admins de plataforma têm acesso cross-tenant — mas o tenant precisa ser
  // DELIBERADO: informado explicitamente e validado contra organizações reais.
  if (ctx.user.role === 'admin') {
    const organizationId = parsePlatformAdminOrganizationId(ctx.req.headers['x-organization-id']);

    if (organizationId === null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cabeçalho X-Organization-Id obrigatório e deve ser um inteiro positivo para acesso de administrador de plataforma.",
      });
    }

    const organization = await db.getOrganizationById(organizationId);
    if (!organization) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organização informada não existe." });
    }

    // Auditoria obrigatória do acesso cross-tenant do admin de plataforma — FAIL-CLOSED:
    // se a auditoria não puder ser persistida, o acesso cross-tenant NÃO prossegue
    // (nunca "loga um aviso e segue"). O erro propaga e `next()` nunca é chamado.
    try {
      await db.createAuditLog({
        adminId: ctx.user.id,
        targetUserId: null,
        action: "other",
        details: JSON.stringify({
          event: "platform_admin_tenant_access",
          organizationId,
          operation: path,
          correlationId: ctx.correlationId,
        }),
        ipAddress: typeof ctx.req.ip === "string" ? ctx.req.ip : undefined,
      });
    } catch (auditError) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Falha ao registrar auditoria de acesso administrativo — acesso bloqueado (fail-closed).",
        cause: auditError instanceof Error ? auditError : undefined,
      });
    }

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
