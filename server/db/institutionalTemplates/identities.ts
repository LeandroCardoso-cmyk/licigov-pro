/**
 * Institutional Templates — repositório de IDENTIDADES (imutáveis após criadas). Tenant-scoped em toda operação.
 */
import { and, eq } from "drizzle-orm";
import { institutionalTemplateIdentitiesTable, type InstitutionalTemplateIdentityRow } from "../../../drizzle/schema";
import { validateTemplateIdentity, type TemplateIdentity, type TemplateDocumentKind } from "../../domain/institutionalTemplates";
import { TemplatePersistenceError } from "./errors";
import { duplicateKeyName, isDuplicateKey, requireReader, type TemplatesContext, type TemplatesReader, type TemplatesTx } from "./executor";

export function rowToIdentity(r: InstitutionalTemplateIdentityRow): TemplateIdentity {
  return {
    id: r.id, organizationId: r.organizationId, documentKind: r.documentKind as TemplateDocumentKind,
    slug: r.slug, createdAt: r.createdAtIso, createdByUserId: r.createdByUserId,
  };
}

export async function getIdentity(organizationId: number, id: string, executor?: TemplatesReader): Promise<TemplateIdentity | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateIdentitiesTable)
    .where(and(eq(institutionalTemplateIdentitiesTable.organizationId, organizationId), eq(institutionalTemplateIdentitiesTable.id, id))).limit(1);
  return rows.length === 1 && rows[0].id === id ? rowToIdentity(rows[0]) : null;
}

export async function findIdentityBySlug(
  organizationId: number, documentKind: TemplateDocumentKind, slug: string, executor?: TemplatesReader,
): Promise<TemplateIdentity | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateIdentitiesTable).where(and(
    eq(institutionalTemplateIdentitiesTable.organizationId, organizationId),
    eq(institutionalTemplateIdentitiesTable.documentKind, documentKind),
    eq(institutionalTemplateIdentitiesTable.slug, slug))).limit(1);
  return rows.length === 1 && rows[0].slug === slug ? rowToIdentity(rows[0]) : null;
}

async function lockIdentity(tx: TemplatesTx, organizationId: number, id: string): Promise<TemplateIdentity | null> {
  const rows = await tx.select().from(institutionalTemplateIdentitiesTable)
    .where(and(eq(institutionalTemplateIdentitiesTable.organizationId, organizationId), eq(institutionalTemplateIdentitiesTable.id, id)))
    .limit(1).for("share");
  return rows.length === 1 && rows[0].id === id ? rowToIdentity(rows[0]) : null;
}

/** Identidade do modelo (usada, com lock compartilhado, pelas escritas que dependem dela). */
export async function requireIdentity(tx: TemplatesTx, organizationId: number, id: string): Promise<TemplateIdentity> {
  const identity = await lockIdentity(tx, organizationId, id);
  if (!identity) throw new TemplatePersistenceError("NOT_FOUND", "identidade de modelo inexistente neste tenant");
  return identity;
}

export interface PersistedIdentity { readonly identity: TemplateIdentity; readonly created: boolean }

/**
 * Insere a identidade. Mesmo id + mesmo (tipo, slug) ⇒ replay converge (`created: false`); mesmo id com outro conteúdo, ou
 * mesmo (tipo, slug) sob outro id ⇒ CONFLICT. Nunca atualiza.
 */
export async function insertIdentity(tx: TemplatesTx, ctx: TemplatesContext, identity: TemplateIdentity): Promise<PersistedIdentity> {
  if (identity.organizationId !== ctx.organizationId) {
    throw new TemplatePersistenceError("CROSS_TENANT_REFERENCE", "a identidade pertence a outra organização que o contexto autoritativo");
  }
  const checked = validateTemplateIdentity(identity);
  if (!checked.ok) throw new TemplatePersistenceError("INVALID_INPUT", "identidade de modelo inválida", checked.issues);
  try {
    await tx.insert(institutionalTemplateIdentitiesTable).values({
      id: identity.id, organizationId: identity.organizationId, documentKind: identity.documentKind, slug: identity.slug,
      createdAtIso: identity.createdAt, createdByUserId: identity.createdByUserId,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existing = await lockIdentity(tx, ctx.organizationId, identity.id);
    if (existing && existing.documentKind === identity.documentKind && existing.slug === identity.slug) return { identity: existing, created: false };
    const key = duplicateKeyName(err);
    throw new TemplatePersistenceError("CONFLICT", key === "uq_iti_org_kind_slug"
      ? "já existe uma identidade com este tipo e slug nesta organização"
      : "o id já existe com outro conteúdo");
  }
  return { identity, created: true };
}
