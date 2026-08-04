/**
 * PR B.2.1 — Guarda estática da migration formal 0288 (campos canônicos de ingestão).
 * Valida forma: aditiva (só ADD), colunas NULLABLE (compatível com linhas históricas), índice
 * tenant-aware NÃO-único (sem unicidade global por checksum), presença no journal (1:1), e que
 * o ensureSchema NÃO cria mais essas colunas (apenas verifica). A aplicação real contra MySQL
 * (aplicação única, isolamento por tenant, banco novo/existente) é exercitada pelo
 * reconciliation-mysql-smoke, que roda a cadeia completa no CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION = read("drizzle/0288_import_session_canonical_fields.sql");
const JOURNAL = JSON.parse(read("drizzle/meta/_journal.json"));
const BOOTSTRAP = read("server/bootstrap.ts");

describe("migration 0288 — formal, aditiva, segura", () => {
  it("adiciona checksum, processId e importPurpose (ADD, aditivo)", () => {
    expect(MIGRATION).toMatch(/ADD `checksum` varchar\(64\)/);
    expect(MIGRATION).toMatch(/ADD `processId` int/);
    expect(MIGRATION).toMatch(/ADD `importPurpose` varchar\(50\)/);
  });

  it("é puramente aditiva (sem DROP, sem NOT NULL, sem UNIQUE)", () => {
    expect(MIGRATION).not.toMatch(/DROP\s/i);
    expect(MIGRATION).not.toMatch(/NOT NULL/i);   // colunas nullable p/ linhas históricas
    expect(MIGRATION).not.toMatch(/UNIQUE/i);     // nenhuma unicidade global por checksum
  });

  it("cria índice tenant-aware NÃO-único (organizationId, checksum)", () => {
    expect(MIGRATION).toMatch(/ADD INDEX `import_sessions_org_checksum_idx` \(`organizationId`,`checksum`\)/);
  });

  it("está registrada no journal (1:1)", () => {
    const tags = JOURNAL.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0288_import_session_canonical_fields");
    expect(JOURNAL.entries[JOURNAL.entries.length - 1].tag).toBe("0288_import_session_canonical_fields");
  });
});

describe("ensureSchema — não muta o schema dessas colunas (apenas verifica)", () => {
  it("não adiciona mais as colunas de ingestão; usa verificação acionável", () => {
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"checksum"/);
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"processId"/);
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"importPurpose"/);
    expect(BOOTSTRAP).toContain("assertColumnsPresent");
  });
});
