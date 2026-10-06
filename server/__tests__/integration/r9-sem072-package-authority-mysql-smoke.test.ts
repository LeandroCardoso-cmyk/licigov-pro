/**
 * R9 / SEM-072 — pacotes ZIP com o documento AUTORITATIVO por tipo, MySQL 8 real (órgãos sintéticos 960721/960722).
 *
 *   P1. pacote de publicação (legado `documents`): só a maior versão APROVADA de cada tipo, como PDF real, nomes
 *       únicos `NN_TIPO_vN.pdf`; rascunhos/versões substituídas fora (listados no LEIA-ME); documento de OUTRO órgão
 *       gravado no mesmo processId nunca entra (lookup escopado pela organização do processo);
 *   P2. pacote presencial (`direct_contract_documents`): `.md` (conteúdo Markdown), final vigente em `documentos/`,
 *       último rascunho de tipo sem final em `rascunhos_NAO_OFICIAIS/`, arquivado fora; nomes únicos.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generatePublicationZip } from "../../services/zipService";
import { generatePresentialPackage } from "../../services/directContractPackage";
import { isPdfBytes } from "../../services/packageAuthority";
import { readZipEntries } from "../helpers/zipEntries";

const DB = process.env.DATABASE_URL;
const ORG = 960721;
const ORG_OTHER = 960722;

describe.skipIf(!DB)("R9 / SEM-072 — pacotes só com o documento autoritativo (MySQL 8)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let owner = 0, processId = 0, contractId = 0;

  async function cleanup() {
    const [cs] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM direct_contracts WHERE organizationId IN (?, ?)", [ORG, ORG_OTHER]);
    for (const c of cs) await conn.query("DELETE FROM direct_contract_documents WHERE directContractId = ?", [c.id]).catch(() => {});
    for (const t of ["direct_contracts", "documents", "processes"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG, ORG_OTHER]).catch(() => {});
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    owner = (await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO users (openId, name, email) VALUES (?, 'Dono SEM-072', ?)", [`sem072-${stamp}`, `sem072-${stamp}@teste.local`],
    ))[0].insertId;

    processId = (await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo SEM072', 'Objeto', ?, 'em_edital')", [ORG, owner],
    ))[0].insertId;
    const doc = (org: number, type: string, version: number, status: string, content: string) => conn.execute(
      "INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [org, processId, type, content, version, owner, status],
    );
    await doc(ORG, "etp", 1, "approved", "# ETP v1 aprovado (substituído)");
    await doc(ORG, "etp", 2, "approved", "# ETP v2 aprovado (vigente)");
    await doc(ORG, "etp", 3, "draft", "# ETP v3 rascunho");
    await doc(ORG, "dfd", 1, "approved", "# DFD v1 aprovado");
    await doc(ORG, "tr", 1, "in_review", "# TR em revisão");
    await doc(ORG, "edital", 1, "archived", "# Edital arquivado");
    await doc(ORG_OTHER, "parecer", 9, "approved", "# Parecer de OUTRO órgão"); // mesmo processId, outro tenant

    contractId = (await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO direct_contracts (organizationId, number, year, type, object, justification, value, createdBy) VALUES (?, ?, 2026, 'dispensa', 'Objeto', 'Just.', 100000, ?)",
      [ORG, `S072-${stamp}`.slice(0, 50), owner],
    ))[0].insertId;
    const ddoc = (type: string, status: string, content: string) => conn.execute(
      "INSERT INTO direct_contract_documents (directContractId, type, title, content, version, status) VALUES (?, ?, ?, ?, 1, ?)",
      [contractId, type, type, content, status],
    );
    await ddoc("termo_dispensa", "draft", "# Termo rascunho antigo");
    await ddoc("termo_dispensa", "final", "# Termo FINAL");
    await ddoc("termo_dispensa", "draft", "# Termo rascunho posterior");
    await ddoc("minuta_contrato", "draft", "# Minuta r1");
    await ddoc("minuta_contrato", "draft", "# Minuta r2");
    await ddoc("mapa_comparativo", "archived", "# Mapa arquivado");
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup();
    await conn.query("DELETE FROM users WHERE id = ?", [owner]).catch(() => {});
    await conn.end();
  });

  it("P1) publicação: só aprovados vigentes, PDF real, nomes únicos, outro órgão nunca entra", async () => {
    const { buffer } = await generatePublicationZip(processId, null);
    const entries = readZipEntries(buffer);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["00_LEIA_ME.txt", "01_DOCUMENTO_FORMALIZACAO_DEMANDA_v1.pdf", "02_ESTUDO_TECNICO_PRELIMINAR_v2.pdf"]);
    for (const e of entries.filter((x) => x.name.endsWith(".pdf"))) expect(isPdfBytes(e.data)).toBe(true);
    const readme = entries.find((e) => e.name === "00_LEIA_ME.txt")?.data.toString("utf-8") ?? "";
    expect(readme).toContain("02_ESTUDO_TECNICO_PRELIMINAR_v2.pdf");
    expect(readme).toMatch(/Estudo Técnico Preliminar \(ETP\) v1 \(approved\) — versão substituída/);
    expect(readme).toMatch(/Estudo Técnico Preliminar \(ETP\) v3 \(draft\) — rascunho/);
    expect(readme).toMatch(/Termo de Referência \(TR\) v1 \(in_review\) — rascunho/);
    expect(readme).toMatch(/Edital de Licitação v1 \(archived\) — status excluído/);
    expect(readme).not.toContain("Parecer"); // documento de outro órgão: nem no ZIP, nem no manifesto
  }, 60_000);

  it("P2) presencial: .md, final vigente em documentos/, último rascunho separado, arquivado fora", async () => {
    const zip = await generatePresentialPackage({ contractId });
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "LEIA-ME.txt", "documentos/01_TERMO_DISPENSA_v1.md", "rascunhos_NAO_OFICIAIS/05_MINUTA_CONTRATO_v1_RASCUNHO.md",
    ]);
    expect(entries.find((e) => e.name === "documentos/01_TERMO_DISPENSA_v1.md")?.data.toString("utf-8")).toBe("# Termo FINAL");
    expect(entries.find((e) => e.name.startsWith("rascunhos_NAO_OFICIAIS/"))?.data.toString("utf-8")).toBe("# Minuta r2");
    expect(entries.some((e) => e.name.endsWith(".pdf"))).toBe(false);
    const readme = entries.find((e) => e.name === "LEIA-ME.txt")?.data.toString("utf-8") ?? "";
    expect(readme).toMatch(/Mapa Comparativo de Preços v1 \(archived\) — status excluído/);
    expect(readme).toContain("NÃO OFICIAL");
  }, 60_000);
});
