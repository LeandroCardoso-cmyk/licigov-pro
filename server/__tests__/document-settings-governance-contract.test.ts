/**
 * P0 PILOTO (HARDENING) — Contrato de governança da identidade institucional (varredura de fonte).
 *
 * Trava os invariantes do fix endurecido (sem depender de DB):
 *  H1) migration 0302 FAIL-CLOSED: guards ANTES de mutar; aborta em ambiguidade; sem discard silencioso;
 *  H2) SEM duplicidade: nome/CNPJ só em `organizations`; `documentSettings` é extensão; composição via
 *      `InstitutionalIdentityService`; router grava por dono de campo;
 *  H3) REPLAY-SAFE: snapshot de identidade congelado no `metadata` do artefato e preferido na exportação;
 *  + RBAC no backend, tenant-scope, auditoria, e gating do frontend (sem formulário enganoso).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ROUTER = read("server/routers/documentSettingsRouter.ts");
const COLLAB = read("server/db/collaboration.ts");
const SCHEMA = read("drizzle/schema.ts");
const MIGRATION = read("drizzle/0302_document_settings_org_scoped.sql");
const SERVICE = read("server/services/institutionalIdentityService.ts");
const DOCS_ROUTER = read("server/routers/documentsRouter.ts");
const ENGINE = read("server/services/documentEngineService.ts");
const EXPORT_ADAPTER = read("server/services/officialDocumentExportAdapter.ts");

const CONSUMERS = [
  "server/routers/documentsRouter.ts",
  "server/routers/legalOpinionsRouter.ts",
  "server/services/directContractDocuments.ts",
  "server/routers/platformsRouter.ts",
  "server/services/platformTemplates.ts",
];

/** Bloco da tabela documentSettings dentro do schema.ts. */
function documentSettingsBlock(): string {
  const start = SCHEMA.indexOf("export const documentSettings = mysqlTable(");
  const rest = SCHEMA.slice(start);
  const cut = rest.indexOf("export type DocumentSettings");
  return cut > 0 ? rest.slice(0, cut) : rest.slice(0, 1200);
}

describe("documentSettings · governança institucional endurecida (contrato)", () => {
  it("H2 modelo: tenant-scoped, SEM duplicidade (sem organizationName/cnpj/userId; org é extensão)", () => {
    const block = documentSettingsBlock();
    expect(block).toMatch(/organizationId:\s*int\("organizationId"\)\.notNull\(\)/);
    expect(block).toContain('unique("documentSettings_org_unique").on(table.organizationId)');
    expect(block).not.toMatch(/userId:\s*int\("userId"\)/);
    // Duplicidade canônica eliminada: nome/CNPJ vivem só em organizations.
    expect(block).not.toContain('organizationName: text("organizationName")');
    expect(block).not.toContain('cnpj: varchar("cnpj"');
    // Extensão documental permanece.
    expect(block).toContain('logoUrl: text("logoUrl")');
    expect(block).toContain('address: text("address")');
  });

  it("H1 migration 0302 é FAIL-CLOSED: guards ANTES de mutar, aborta em ambiguidade, sem discard", () => {
    // Guard roda ANTES de qualquer DDL de mutação (ADD organizationId).
    const guardAt = MIGRATION.indexOf("CALL `_ds0302_guard`()");
    const addColAt = MIGRATION.indexOf("ADD `organizationId`");
    expect(guardAt).toBeGreaterThan(0);
    expect(addColAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(addColAt);
    // Fail-closed explícito (SIGNAL) para as 5 precondições.
    expect(MIGRATION).toContain("SIGNAL SQLSTATE '45000'");
    for (const g of ["FAIL-CLOSED (A)", "FAIL-CLOSED (B)", "FAIL-CLOSED (C)", "FAIL-CLOSED (D)", "FAIL-CLOSED (E)"]) {
      expect(MIGRATION, `guard ${g}`).toContain(g);
    }
    // Sem descarte silencioso de órfãos (o antigo DELETE de órfãos foi substituído por ABORT).
    expect(MIGRATION).not.toMatch(/DELETE FROM `documentSettings` WHERE `organizationId` IS NULL/);
    // Preservação (promove CNPJ ao canônico) e remoção das colunas duplicadas.
    expect(MIGRATION).toMatch(/UPDATE `organizations`[\s\S]*SET o\.`cnpj`/);
    expect(MIGRATION).toMatch(/DROP COLUMN `userId`/);
    expect(MIGRATION).toMatch(/DROP COLUMN `organizationName`/);
    expect(MIGRATION).toMatch(/DROP COLUMN `cnpj`/);
    expect(MIGRATION).toContain("`documentSettings_org_unique` UNIQUE");
  });

  it("H2 InstitutionalIdentityService COMPÕE fonte única (organizations canônica + documentSettings ext.)", () => {
    expect(SERVICE).toContain("export async function resolveInstitutionalIdentity");
    expect(SERVICE).toContain("export async function saveInstitutionalIdentity");
    expect(SERVICE).toContain("export function institutionalIdentityFingerprint");
    expect(SERVICE).toContain("export async function snapshotInstitutionalIdentity");
    // Canônica vem de organizations; extensão de documentSettings.
    expect(SERVICE).toContain("getOrganizationById");
    expect(SERVICE).toContain("updateOrganization");
    expect(SERVICE).toContain("getDocumentSettingsByOrg");
    expect(SERVICE).toContain("upsertDocumentSettings");
    // Nome/CNPJ mapeados da fonte canônica (organizations.nome/cnpj).
    expect(SERVICE).toContain("org?.nome");
    expect(SERVICE).toContain("org?.cnpj");
  });

  it("db layer: extensão org-scoped; upsert NÃO grava mais nome/cnpj; sem leitura por usuário", () => {
    expect(COLLAB).toContain("export async function getDocumentSettingsByOrg");
    expect(COLLAB).toContain("eq(documentSettings.organizationId");
    expect(COLLAB).not.toContain("getDocumentSettingsByUser");
    // upsert só persiste extensão (sem organizationName/cnpj no set-clause).
    const upsertStart = COLLAB.indexOf("export async function upsertDocumentSettings");
    const upsertBlock = COLLAB.slice(upsertStart, upsertStart + 500);
    expect(upsertBlock).not.toContain("organizationName");
    expect(upsertBlock).not.toContain("cnpj");
  });

  it("router: get compõe identidade; save grava por dono de campo; RBAC admin + auditoria; sem userId", () => {
    expect(ROUTER).toMatch(/get:\s*orgRoleProcedure\("admin"\)/);
    expect(ROUTER).toMatch(/save:\s*orgRoleProcedure\("admin"\)/);
    expect(ROUTER).toContain("resolveInstitutionalIdentity(ctx.organizationId!)");
    expect(ROUTER).toContain("saveInstitutionalIdentity(ctx.organizationId!");
    expect(ROUTER).toContain("org.document_settings_updated");
    expect(ROUTER).not.toContain("ctx.user.id");
    expect(ROUTER).not.toContain("getDocumentSettingsByUser");
  });

  it("H2 consumidores resolvem pela fonte única (InstitutionalIdentity), nunca por usuário", () => {
    for (const f of CONSUMERS) {
      const src = read(f);
      expect(src, `${f} deve resolver pela InstitutionalIdentity`).toMatch(/InstitutionalIdentity/);
      expect(src, `${f} não pode usar getDocumentSettingsByUser`).not.toContain("getDocumentSettingsByUser");
    }
  });

  it("H3 replay-safe: snapshot de identidade congelado na geração/emissão e preferido na exportação", () => {
    // Legacy documents: grava snapshot no metadata na geração e prefere-o na exportação.
    expect(DOCS_ROUTER).toContain("institutionalIdentitySnapshot");
    expect(DOCS_ROUTER).toContain("institutionalIdentityFromMetadataOrLive");
    expect(DOCS_ROUTER).toContain("metadata: identitySnapshotMetadata(identity)");
    // Document Engine oficial: injeta o snapshot no metadata de toda versão emitida.
    expect(ENGINE).toContain("snapshotInstitutionalIdentity");
    expect(ENGINE).toContain("institutionalIdentitySnapshot");
    // Exportador oficial: lê a identidade do snapshot (fallback vivo) e registra o fingerprint (lineage).
    expect(EXPORT_ADAPTER).toContain("institutionalIdentityFromMetadataOrLive");
    expect(EXPORT_ADAPTER).toContain("institutionalIdentityFingerprint");
  });

  it("frontend: Configurações restrita a admin/owner na sidebar", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toMatch(
      /label:\s*"Configurações",\s*path:\s*"\/configuracoes",\s*requiresOrgAdmin:\s*true/,
    );
  });

  for (const page of ["client/src/pages/Settings.tsx", "client/src/pages/DocumentSettings.tsx"]) {
    it(`frontend: ${page} gateia por papel, sem formulário enganoso e sem comportamento silencioso`, () => {
      const src = read(page);
      expect(src).toContain('useOrgRole');
      expect(src).toContain("canManageUsers");
      expect(src).toContain("Acesso não autorizado");
      expect(src).toContain("enabled: canManageUsers");
      expect(src).toMatch(/\)\s*:\s*error\s*\?\s*\(/);
      expect(src).toContain("Tentar novamente");
      expect(src).not.toContain("Você pode preencher os dados abaixo");
    });
  }
});
