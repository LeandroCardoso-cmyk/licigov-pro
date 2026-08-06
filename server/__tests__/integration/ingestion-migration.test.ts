/**
 * PR B.2.1 — Guarda estática da migration formal 0288 (campos canônicos de ingestão), agora
 * RECONCILIADORA. Valida forma: idempotente via INFORMATION_SCHEMA + SQL dinâmico (PREPARE/EXECUTE),
 * aditiva (só ADD de coluna/índice; sem DROP/UPDATE/DELETE/RENAME), colunas NULLABLE (sem NOT NULL),
 * índice tenant-aware NÃO exclusivo (sem unicidade global por checksum), compatibilidade EXPLÍCITA
 * (falha acionável por tabela-sentinela, nunca catch genérico de ER_DUP_FIELDNAME), presença no
 * journal (1:1), e que o ensureSchema NÃO cria mais essas colunas — apenas verifica presença E
 * tipo/nulabilidade. A aplicação real contra MySQL (banco novo/transitório/parcial, tipo incompatível,
 * índice ausente/presente, linhas históricas, journal único, isolamento por tenant) é exercitada pelo
 * ingestion-0288-reconciliation-mysql-smoke, que roda a reconciliação e a cadeia completa no CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION = read("drizzle/0288_import_session_canonical_fields.sql");
const JOURNAL = JSON.parse(read("drizzle/meta/_journal.json"));
const BOOTSTRAP = read("server/bootstrap.ts");

describe("migration 0288 — reconciliadora, aditiva, segura", () => {
  it("adiciona checksum, processId e importPurpose quando ausentes (ADD, aditivo)", () => {
    expect(MIGRATION).toMatch(/ADD `checksum` varchar\(64\)/);
    expect(MIGRATION).toMatch(/ADD `processId` int/);
    expect(MIGRATION).toMatch(/ADD `importPurpose` varchar\(50\)/);
  });

  it("é idempotente: consulta INFORMATION_SCHEMA e monta a DDL via SQL dinâmico", () => {
    expect(MIGRATION).toMatch(/INFORMATION_SCHEMA\.COLUMNS/);
    expect(MIGRATION).toMatch(/INFORMATION_SCHEMA\.STATISTICS/);
    expect(MIGRATION).toMatch(/PREPARE /);
    expect(MIGRATION).toMatch(/EXECUTE /);
    expect(MIGRATION).toMatch(/DEALLOCATE PREPARE /);
  });

  it("é puramente aditiva — sem DROP de tabela/coluna/índice, sem UPDATE/DELETE/TRUNCATE/RENAME", () => {
    expect(MIGRATION).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
    expect(MIGRATION).not.toMatch(/\b(TRUNCATE|DELETE|UPDATE|RENAME|MODIFY|CHANGE)\b/i);
  });

  it("mantém as colunas NULLABLE (sem NOT NULL) e valida a nulabilidade existente", () => {
    expect(MIGRATION).not.toMatch(/NOT NULL/i);   // nenhuma coluna forçada a NOT NULL
    expect(MIGRATION).toMatch(/IS_NULLABLE = 'YES'/); // valida que as existentes são nuláveis
  });

  it("cria índice tenant-aware NÃO exclusivo (organizationId, checksum), sem unicidade global", () => {
    expect(MIGRATION).toMatch(/ADD INDEX `import_sessions_org_checksum_idx` \(`organizationId`,`checksum`\)/);
    // Nenhuma criação de unicidade por checksum (o mesmo checksum reaparece em re-import legítimo):
    expect(MIGRATION).not.toMatch(/ADD\s+UNIQUE/i);
    expect(MIGRATION).not.toMatch(/CREATE\s+UNIQUE/i);
    expect(MIGRATION).not.toMatch(/UNIQUE\s*\(/i);
    expect(MIGRATION).not.toMatch(/ADD\s+CONSTRAINT/i);
    // Valida que um índice preexistente é não exclusivo (NON_UNIQUE = 1):
    expect(MIGRATION).toMatch(/NON_UNIQUE/);
  });

  it("compatibilidade EXPLÍCITA e limitada à 0288: aborta acionável se coluna/índice for incompatível", () => {
    // Falha por tabela-sentinela inexistente cujo nome descreve o ajuste esperado — nunca um
    // tratamento genérico que ignore ER_DUP_FIELDNAME.
    expect(MIGRATION).toMatch(/erro_0288_import_sessions_checksum_deve_ser_varchar_64_e_nulavel/);
    expect(MIGRATION).toMatch(/erro_0288_import_sessions_processId_deve_ser_int_e_nulavel/);
    expect(MIGRATION).toMatch(/erro_0288_import_sessions_importPurpose_deve_ser_varchar_50_e_nulavel/);
    expect(MIGRATION).toMatch(/erro_0288_indice_org_checksum_deve_ser_nao_exclusivo/);
  });

  it("está registrada no journal (1:1)", () => {
    const tags = JOURNAL.entries.map((e: { tag: string }) => e.tag);
    expect(tags).toContain("0288_import_session_canonical_fields");
    // A 0289 (vínculo canônico) passou a ser a última entrada; a 0288 permanece registrada 1:1.
    const idx288 = JOURNAL.entries.find((e: { idx: number }) => e.idx === 288);
    expect(idx288?.tag).toBe("0288_import_session_canonical_fields");
  });
});

describe("ensureSchema — não muta o schema dessas colunas (verifica presença + tipo/nulabilidade)", () => {
  it("não adiciona mais as colunas de ingestão; usa verificação acionável", () => {
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"checksum"/);
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"processId"/);
    expect(BOOTSTRAP).not.toMatch(/addColumnIfMissing\("import_sessions",\s*"importPurpose"/);
    expect(BOOTSTRAP).toContain("assertColumnsPresent");
  });

  it("assertColumnsPresent valida também tipo, tamanho e nulabilidade (defesa em profundidade)", () => {
    // A verificação lê a forma da coluna no INFORMATION_SCHEMA sem mutar o schema.
    expect(BOOTSTRAP).toMatch(/DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE/);
    // E o call-site declara a forma esperada dos 3 campos canônicos.
    expect(BOOTSTRAP).toMatch(/name:\s*"checksum",\s*dataType:\s*"varchar",\s*charLen:\s*64,\s*nullable:\s*true/);
    expect(BOOTSTRAP).toMatch(/name:\s*"processId",\s*dataType:\s*"int",\s*nullable:\s*true/);
    expect(BOOTSTRAP).toMatch(/name:\s*"importPurpose",\s*dataType:\s*"varchar",\s*charLen:\s*50,\s*nullable:\s*true/);
  });
});
