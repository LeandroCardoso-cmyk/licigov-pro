/**
 * SECURITY-02 — Invariante de AUTORIDADE INSTITUCIONAL (puro, sem I/O).
 *
 * Acesso técnico da plataforma ≠ autoridade do órgão. O `resolveTenant` projeta para o admin de plataforma
 * (`users.role = 'admin'` + `X-Organization-Id`) uma membership SINTÉTICA `owner` (id 0) — escopo técnico de
 * suporte, NUNCA prova de vínculo municipal. Atos institucionais (emitir, aprovar, ratificar, publicar,
 * formalizar, registrar decisão governada, conceder privilégio no órgão) exigem membership REAL: persistida
 * em `organization_members`, ativa, do MESMO órgão e com papel efetivo ≥ piso do ato. É a mesma regra que o
 * NEW-007 já aplica ao Parecer Jurídico (`legalOpinionAuthorityService`), agora como contrato central.
 */
import type { OrgRole } from "../../drizzle/schema";

/** Código estável (não traduzir; usado por cliente/testes) — recusa por falta de autoridade institucional real. */
export const INSTITUTIONAL_AUTHORITY_REQUIRED = "INSTITUTIONAL_AUTHORITY_REQUIRED";
/** Código estável — ninguém concede vínculo/papel no órgão a si mesmo (convite, inclusão, alteração ou reativação). */
export const SELF_GRANT_FORBIDDEN = "SELF_GRANT_FORBIDDEN";
export const SELF_GRANT_MESSAGE = `Ninguém pode conceder vínculo ou papel no órgão a si mesmo (${SELF_GRANT_FORBIDDEN}).`;

/** Espelha `ORG_ROLE_RANK` de `server/_core/trpc.ts` (o domínio não importa o _core; um teste garante a paridade). */
const ROLE_RANK: Readonly<Record<OrgRole, number>> = Object.freeze({ viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 });

export type InstitutionalAuthorityDenial =
  | "membership_required" // nenhuma membership ativa persistida (inclui o admin de plataforma sem vínculo)
  | "membership_inactive"
  | "organization_mismatch"
  | "membership_invalid" // registro sem id persistido (ex.: a projeção sintética id 0) ou papel desconhecido
  | "role_insufficient"
  | "authority_lookup_failed"; // falha ao consultar a fonte autoritativa ⇒ fail-closed

/** Membership como lida da fonte autoritativa (`organization_members`). */
export interface PersistedMembership {
  id: number;
  organizationId: number;
  userId: number;
  role: OrgRole;
  ativo: boolean;
}

/** Autoridade institucional comprovada: o papel aqui é o PERSISTIDO, nunca o do contexto da requisição. */
export interface InstitutionalAuthority {
  readonly userId: number;
  readonly organizationId: number;
  readonly role: OrgRole;
  readonly membershipId: number;
}

export function roleRankAtLeast(role: OrgRole, minRole: OrgRole): boolean {
  const have = ROLE_RANK[role];
  return have !== undefined && have >= ROLE_RANK[minRole];
}

/**
 * Decide, de forma pura, se a membership lida da fonte autoritativa comprova autoridade para o ato.
 * Retorna o motivo da recusa (ou null quando autorizada). Nunca aceita o registro sintético (id ≤ 0).
 */
export function evaluateInstitutionalAuthority(
  membership: PersistedMembership | null | undefined,
  expected: { userId: number; organizationId: number; minRole: OrgRole },
): InstitutionalAuthorityDenial | null {
  if (!membership) return "membership_required";
  if (!Number.isSafeInteger(membership.id) || membership.id <= 0) return "membership_invalid";
  if (membership.userId !== expected.userId) return "membership_invalid";
  if (membership.organizationId !== expected.organizationId) return "organization_mismatch";
  if (membership.ativo !== true) return "membership_inactive";
  if (!(membership.role in ROLE_RANK)) return "membership_invalid";
  if (!roleRankAtLeast(membership.role, expected.minRole)) return "role_insufficient";
  return null;
}

export function institutionalAuthorityRequiredMessage(minRole: OrgRole): string {
  return `Este ato institucional exige vínculo ativo com o órgão, com papel mínimo '${minRole}'. Acesso técnico da plataforma não constitui autoridade do órgão (${INSTITUTIONAL_AUTHORITY_REQUIRED}).`;
}

/** Marca do evento de linha do tempo feito sob acesso TÉCNICO da plataforma (suporte) — nunca ato do órgão. */
export const PLATFORM_TECHNICAL_ACCESS_NOTE = "Acesso técnico da plataforma (suporte) — não é ato do órgão.";

/**
 * Pós-homologação (Frente C) — o ator do evento continua sendo o usuário autenticado (mesmo formato de `actor`); o resumo
 * passa a dizer que foi acesso técnico, ligado à auditoria `platform_admin_tenant_access` pelo MESMO correlationId.
 */
export function timelineSummaryForAccess(summary: string, platformAdminAccess: boolean | undefined): string {
  return platformAdminAccess ? `${summary} ${PLATFORM_TECHNICAL_ACCESS_NOTE}` : summary;
}
