import { eq, and } from "drizzle-orm";
import { getDb } from "./connection";
import { organizations, organizationMembers } from "../../drizzle/schema";
import type { InsertOrganization, InsertOrganizationMember } from "../../drizzle/schema";

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
