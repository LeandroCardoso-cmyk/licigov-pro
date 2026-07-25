import { trpc } from "@/lib/trpc";
import { canManageOrgUsers, hasOrgRole, type OrgRole } from "@/utils/orgPermissions";

/**
 * PR A.1 (refinamento) — Papel do usuário na organização ATUAL + permissões derivadas. Fonte única
 * para o frontend gatear menu/rotas/ações. `organizations.getCurrent` é `tenantProcedure` e resolve
 * o papel real (admins de plataforma recebem `owner` sintético). Se o usuário não tiver membership
 * resolvível, a query falha (fail-closed no backend) e tratamos como "sem papel" (null) — nenhuma
 * permissão administrativa concedida.
 */
export function useOrgRole() {
  const query = trpc.organizations.getCurrent.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const role: OrgRole | null = (query.data?.role as OrgRole | undefined) ?? null;

  return {
    role,
    isLoading: query.isLoading,
    canManageUsers: canManageOrgUsers(role),
    hasRole: (min: OrgRole) => hasOrgRole(role, min),
  };
}
