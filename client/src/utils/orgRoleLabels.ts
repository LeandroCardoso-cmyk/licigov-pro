/**
 * PR A.1 (refinamento de homologação) — Fonte única dos rótulos de papel de organização EXIBIDOS
 * na interface. Nomenclatura institucional (contexto de órgão público), não-comercial:
 * o papel interno `owner` NUNCA é apresentado como "Proprietário(a)" — vira "Administrador da
 * Organização".
 *
 * IMPORTANTE: isto é APENAS a camada de apresentação. As enumerações internas (`OrgRole` em
 * drizzle/schema.ts), o RBAC (ORG_ROLE_RANK em _core/trpc.ts) e as permissões permanecem
 * inalterados — `owner|admin|manager|operator|viewer` continuam sendo os valores reais.
 */

export type OrgRoleKey = "owner" | "admin" | "manager" | "operator" | "viewer";

export const ORG_ROLE_LABELS: Record<OrgRoleKey, string> = {
  owner: "Administrador da Organização",
  admin: "Administrador",
  manager: "Gestor",
  operator: "Operador",
  viewer: "Visualizador",
};

/** Rótulo seguro para qualquer string de papel (cai no próprio valor se desconhecido). */
export function orgRoleLabel(role: string): string {
  return ORG_ROLE_LABELS[role as OrgRoleKey] ?? role;
}
