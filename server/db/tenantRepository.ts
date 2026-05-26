import { TRPCError } from "@trpc/server";

/**
 * Verifica se um recurso pertence à organização do contexto.
 * Lança FORBIDDEN se o organizationId do recurso não corresponde.
 *
 * Uso obrigatório em qualquer query que busca por ID sem filtro de tenant:
 *   const entity = await db.findById(id);         // busca sem filtro
 *   assertTenantOwnership(entity.organizationId, ctx.organizationId); // verifica após
 */
export function assertTenantOwnership(
  entityOrgId: number | null | undefined,
  ctxOrgId: number,
): void {
  if (entityOrgId === null || entityOrgId === undefined) {
    // Legado sem organizationId: compatível apenas com org=1 (fase de backfill)
    if (ctxOrgId !== 1) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Acesso negado: recurso pertence a outra organização.",
      });
    }
    return;
  }
  if (entityOrgId !== ctxOrgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso negado: recurso pertence a outra organização.",
    });
  }
}

/**
 * Contrato obrigatório para repositories tenant-safe.
 *
 * ✅ findById(id, organizationId)
 * ❌ findById(id)
 *
 * Todo método que acessa um recurso por ID DEVE exigir organizationId
 * para garantir isolamento multi-tenant na camada de dados.
 */
export interface TenantScopedRepository<T> {
  findById(id: number, organizationId: number): Promise<T | null>;
  findAll(organizationId: number): Promise<T[]>;
}
