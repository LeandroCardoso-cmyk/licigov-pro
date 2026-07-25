import { eq, and, or, desc } from "drizzle-orm";
import { getDb } from "./connection";
import { organizations, organizationMembers, users } from "../../drizzle/schema";
import type { InsertOrganization, InsertOrganizationMember, OrgRole } from "../../drizzle/schema";

export async function getOrganizationById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Perfil institucional (esfera/UF/município) para resolução do corpus — SELECT ESTREITO (apenas as
 * colunas necessárias, evitando timestamps/colunas que possam divergir em bancos legados) e TOLERANTE
 * A FALHAS: retorna null se a organização não puder ser carregada, para que o chamador degrade em vez
 * de quebrar. Nunca lança.
 */
export async function getOrganizationInstitutionalProfile(
  id: number,
): Promise<{ esfera: string | null; uf: string | null; municipio: string | null } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ esfera: organizations.esfera, uf: organizations.uf, municipio: organizations.municipio })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return rows[0] ?? null;
  } catch (e) {
    console.warn("[organizations] getOrganizationInstitutionalProfile falhou (schema legado?):", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function getOrganizationBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

/** PR A.1 — todas as organizações (admin de plataforma — tela /admin/organizacoes). */
export async function getAllOrganizations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(organizations).orderBy(desc(organizations.createdAt));
}

export async function createOrganization(data: InsertOrganization) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  const result = await db.insert(organizations).values(data);
  return result;
}

export async function updateOrganization(
  id: number,
  data: Partial<Pick<InsertOrganization, "nome" | "cnpj" | "esfera" | "uf" | "municipio" | "ativo">>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  await db.update(organizations).set(data).where(eq(organizations.id, id));
}

export async function getMembersOfOrg(organizationId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.ativo, true),
    ));
}

export async function addMemberToOrg(data: InsertOrganizationMember) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  await db.insert(organizationMembers).values(data);
}

export async function updateMemberRole(
  organizationId: number,
  userId: number,
  role: InsertOrganizationMember["role"],
) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  await db
    .update(organizationMembers)
    .set({ role })
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
    ));
}

export async function removeMemberFromOrg(organizationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  await db
    .update(organizationMembers)
    .set({ ativo: false })
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
    ));
}

/**
 * PR A.1 — TODOS os membros (ativos e inativos), para a tela de gestão de usuários (C10) poder
 * mostrar/reativar quem foi desativado. `getMembersOfOrg` continua retornando só ativos — não
 * alterado, mantém o comportamento de todos os consumers existentes.
 */
export async function getAllMembersOfOrg(organizationId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId));
}

/**
 * PR A.1 — membros (ativos e inativos) COM dados do usuário (nome/e-mail/último acesso), para a
 * tela de gestão de usuários. `getAllMembersOfOrg` continua enxuto (só a linha de membership) —
 * usado pelas checagens internas do router, que não precisam de nome/e-mail.
 */
export async function getMembersWithUserInfo(organizationId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({ member: organizationMembers, user: users })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, organizationId));
}

/** PR A.1 — conta membros ATIVOS com papel admin OU owner — base da proteção "último admin". */
export async function countActiveAdmins(organizationId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const rows = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.ativo, true),
        or(eq(organizationMembers.role, "admin"), eq(organizationMembers.role, "owner"))
      )
    );
  return rows.length;
}

/**
 * PR A.1 — liga/desliga o membership (usado por activateMember/deactivateMember). Também é o
 * caminho de reativação de um convite aceito para um e-mail que já foi membro e foi desativado
 * (ver invitationService — `.onDuplicateKeyUpdate` reaplica o papel do convite E reativa).
 */
export async function setMemberAtivo(organizationId: number, userId: number, ativo: boolean, role?: OrgRole): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  await db
    .update(organizationMembers)
    .set(role ? { ativo, role } : { ativo })
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
}

export async function getUserOrganizations(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({ org: organizations, membership: organizationMembers })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.ativo, true),
      eq(organizations.ativo, true),
    ));
}
