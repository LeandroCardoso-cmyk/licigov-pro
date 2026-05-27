/**
 * Sprint 1.8 — Base Repository Multi-Tenant oficial do LiciGov Pro.
 *
 * Todo repository que acessa dados de uma organização DEVE estender esta classe.
 * Garante: tenant isolation, ownership enforcement, paginação padronizada.
 *
 * Padrão obrigatório:
 *   findById(id, organizationId)   ✅
 *   findById(id)                   ❌
 */
import { TRPCError } from "@trpc/server";
import type { PaginatedResult } from "./queryStrategy";

export abstract class BaseTenantRepository<TSelect> {
  /**
   * Nome legível da entidade — usado em mensagens de erro e logs.
   */
  protected abstract readonly entityName: string;

  /**
   * Valida que organizationId é um número positivo finito.
   * Lança BAD_REQUEST caso contrário.
   */
  protected requireOrganizationId(
    organizationId: unknown,
  ): asserts organizationId is number {
    if (
      typeof organizationId !== "number" ||
      !Number.isFinite(organizationId) ||
      organizationId <= 0
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `organizationId é obrigatório para operações em ${this.entityName}`,
      });
    }
  }

  /**
   * Verifica se entityOrgId pertence ao ctxOrgId.
   * Entidades legadas (null/undefined) são acessíveis apenas pela org=1.
   * Lança FORBIDDEN em caso de mismatch.
   */
  protected assertOwnership(
    entityOrgId: number | null | undefined,
    ctxOrgId: number,
  ): void {
    if (entityOrgId === null || entityOrgId === undefined) {
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
   * Busca por ID com verificação de ownership obrigatória.
   * Retorna null se não encontrado; lança FORBIDDEN se a entidade pertencer a outro tenant.
   */
  abstract safeFindById(id: number, organizationId: number): Promise<TSelect | null>;

  /**
   * Lista todas as entidades do tenant — query DEVE ser scoped por organizationId.
   */
  abstract safeFindMany(organizationId: number): Promise<TSelect[]>;

  /**
   * Lista paginada das entidades do tenant.
   * Usa buildPaginatedResult de queryStrategy para consistência.
   */
  abstract safePaginate(
    organizationId: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<TSelect>>;
}
