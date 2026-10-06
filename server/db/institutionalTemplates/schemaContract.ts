/**
 * Institutional Templates — CONTRATO ESTRUTURAL do banco (HD-26, Option A): as tabelas do bounded context e as FKs
 * CRÍTICAS que o gate de schema exige. É a ÚNICA declaração dessas FKs para o tooling; um teste unitário a compara com o
 * `drizzle/schema.ts` e com o SQL da 0316, então ela não pode divergir em silêncio.
 *
 * Regras que o gate faz valer:
 *  - toda FK é COMPOSTA e carrega `organization_id` na PRIMEIRA posição, dos dois lados (cross-tenant impossível);
 *  - o pai expõe uma chave ÚNICA com EXATAMENTE as colunas referenciadas (`UNIQUE (organization_id, id)` ou a variante com
 *    a identidade) e o filho tem índice à esquerda com as colunas da FK;
 *  - `ON DELETE`/`ON UPDATE` somente RESTRICT/NO ACTION (nunca CASCADE/SET NULL/SET DEFAULT);
 *  - nenhuma FK para fora do bounded context (as tabelas produtivas existentes NÃO ganham FK nem DDL — validação na tx).
 */
import type { ForeignKeyContract } from "../schemaForeignKeyGuard";

export const INSTITUTIONAL_TEMPLATES_TABLES = [
  "institutional_template_identities",
  "institutional_template_revisions",
  "institutional_template_bindings",
  "institutional_template_events",
  "document_composition_manifests",
  "document_composition_references",
] as const;

const fk = (name: string, table: string, columns: string[], refTable: string, refColumns: string[]) =>
  ({ name, table, columns, refTable, refColumns, onDelete: "RESTRICT", onUpdate: "RESTRICT" }) as const;

export const INSTITUTIONAL_TEMPLATES_FK_CONTRACT: ForeignKeyContract = {
  name: "institutional-templates",
  tenantColumn: "organization_id",
  tables: INSTITUTIONAL_TEMPLATES_TABLES,
  foreignKeys: [
    fk("fk_itr_identity", "institutional_template_revisions", ["organization_id", "identity_id"], "institutional_template_identities", ["organization_id", "id"]),
    fk("fk_itb_identity", "institutional_template_bindings", ["organization_id", "identity_id"], "institutional_template_identities", ["organization_id", "id"]),
    fk("fk_itb_revision", "institutional_template_bindings", ["organization_id", "identity_id", "pinned_revision_id"], "institutional_template_revisions", ["organization_id", "identity_id", "id"]),
    fk("fk_ite_identity", "institutional_template_events", ["organization_id", "identity_id"], "institutional_template_identities", ["organization_id", "id"]),
    fk("fk_ite_revision", "institutional_template_events", ["organization_id", "revision_id"], "institutional_template_revisions", ["organization_id", "id"]),
    fk("fk_ite_binding", "institutional_template_events", ["organization_id", "binding_id"], "institutional_template_bindings", ["organization_id", "id"]),
    fk("fk_dcm_revision", "document_composition_manifests", ["organization_id", "template_identity_id", "template_revision_id"], "institutional_template_revisions", ["organization_id", "identity_id", "id"]),
    fk("fk_dcm_derived", "document_composition_manifests", ["organization_id", "derived_from_manifest_id"], "document_composition_manifests", ["organization_id", "id"]),
    fk("fk_dcr_manifest", "document_composition_references", ["organization_id", "manifest_id"], "document_composition_manifests", ["organization_id", "id"]),
  ],
};
