/**
 * P0 PILOTO — Contrato de governança da identidade institucional documental (varredura de fonte).
 *
 * Trava os invariantes do fix (sem depender de DB): RBAC no backend, tenant-scope, auditoria,
 * ausência de fallback por userId, consumidores repontados para a fonte tenant e gating do frontend
 * (sem formulário institucional editável para não-admin nem quando a query falha).
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
  const end = rest.indexOf("export const documentSettings.$inferSelect");
  // Corta no próximo `export type` após a definição da tabela.
  const cut = rest.indexOf("export type DocumentSettings");
  return cut > 0 ? rest.slice(0, cut) : rest.slice(0, end > 0 ? end : 1200);
}

describe("documentSettings · governança institucional (contrato)", () => {
  it("modelo é TENANT-SCOPED: organizationId único, sem userId (chave per-user extinta)", () => {
    const block = documentSettingsBlock();
    expect(block).toMatch(/organizationId:\s*int\("organizationId"\)\.notNull\(\)/);
    expect(block).toContain('unique("documentSettings_org_unique").on(table.organizationId)');
    expect(block).not.toMatch(/userId:\s*int\("userId"\)/);
  });

  it("migration 0302 é determinística e segura (backfill → dedupe → órfãos → NOT NULL → UNIQUE → drop)", () => {
    expect(MIGRATION).toMatch(/ADD `organizationId` int NULL/);
    expect(MIGRATION).toContain("FROM `organization_members`");
    expect(MIGRATION).toMatch(/MODIFY `organizationId` int NOT NULL/);
    expect(MIGRATION).toContain("`documentSettings_org_unique` UNIQUE");
    expect(MIGRATION).toMatch(/DROP COLUMN `userId`/);
  });

  it("db layer é org-scoped (getDocumentSettingsByOrg) e não há mais leitura por usuário", () => {
    expect(COLLAB).toContain("export async function getDocumentSettingsByOrg");
    expect(COLLAB).toContain("eq(documentSettings.organizationId");
    expect(COLLAB).not.toContain("getDocumentSettingsByUser");
  });

  it("router: RBAC admin/owner no backend, tenant-scoped e auditado (enforcement final)", () => {
    expect(ROUTER).toMatch(/get:\s*orgRoleProcedure\("admin"\)/);
    expect(ROUTER).toMatch(/save:\s*orgRoleProcedure\("admin"\)/);
    expect(ROUTER).toContain("db.getDocumentSettingsByOrg(ctx.organizationId!)");
    expect(ROUTER).toContain("organizationId: ctx.organizationId!");
    expect(ROUTER).toContain("org.document_settings_updated");
    // Sem gravação/fallback por usuário.
    expect(ROUTER).not.toContain("ctx.user.id");
    expect(ROUTER).not.toContain("getDocumentSettingsByUser");
  });

  it("consumidores repontados para a fonte tenant (sem fallback por userId)", () => {
    for (const f of CONSUMERS) {
      const src = read(f);
      expect(src, `${f} deve usar getDocumentSettingsByOrg`).toContain("getDocumentSettingsByOrg");
      expect(src, `${f} não pode mais usar getDocumentSettingsByUser`).not.toContain(
        "getDocumentSettingsByUser",
      );
    }
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
      // Guarda de papel (defense-in-depth) + acesso direto por URL bloqueado.
      expect(src).toContain('useOrgRole');
      expect(src).toContain("canManageUsers");
      expect(src).toContain("Acesso não autorizado");
      // A query só dispara para quem pode gerenciar (não expõe FORBIDDEN silencioso).
      expect(src).toContain("enabled: canManageUsers");
      // Falha de query NÃO cai em formulário editável — ramo de erro dedicado com retry.
      expect(src).toMatch(/\)\s*:\s*error\s*\?\s*\(/);
      expect(src).toContain("Tentar novamente");
      // Copy enganosa antiga removida.
      expect(src).not.toContain("Você pode preencher os dados abaixo");
    });
  }
});
