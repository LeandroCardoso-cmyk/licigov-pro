/**
 * PR A.1 (refinamento de homologação) — Helper CENTRAL de permissões organizacionais no frontend.
 *
 * ESPELHA o RBAC do backend (`ORG_ROLE_RANK` em server/_core/trpc.ts) — é a fonte única para
 * decidir o que mostrar na UI (menu, rotas, ações). NÃO substitui a autorização do backend: toda
 * procedure de gestão continua protegida por `orgRoleProcedure("admin")` (fail-closed). O frontend
 * só decide EXPERIÊNCIA (ocultar/gatear), nunca segurança.
 *
 * Não duplicar estas regras em componentes — importar daqui.
 */

export type OrgRole = "owner" | "admin" | "manager" | "operator" | "viewer";

/** Idêntico ao ORG_ROLE_RANK do backend (server/_core/trpc.ts). */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  operator: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

/** true se `role` tem rank >= `minRole` (mesma comparação do backend). */
export function hasOrgRole(role: OrgRole | null | undefined, minRole: OrgRole): boolean {
  if (!role) return false;
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minRole];
}

/**
 * Gestão de usuários (convidar/listar/alterar papel/ativar/desativar/remover) exige papel mínimo
 * `admin` — igual ao backend (todas essas procedures usam `orgRoleProcedure("admin")`). Ou seja:
 * apenas `admin` e `owner`. `manager`, `operator` e `viewer` NÃO têm acesso administrativo.
 */
export function canManageOrgUsers(role: OrgRole | null | undefined): boolean {
  return hasOrgRole(role, "admin");
}
