/**
 * R7 / PR-17 (SEM-024) — Termo Aditivo e Apostilamento refletem os dados do PRÓPRIO instrumento registrado.
 * MySQL 8, dados sintéticos (órgãos 960861/960862). IA (copilotos) = provider mock; aparece só como sugestão rotulada.
 *
 *   T1. aditivo de valor: o termo traz justificativa, novo valor (R$) e prazo do registro; sugestões rotuladas como
 *       NÃO incorporadas; autor = ator humano (nunca `multi_copilot`); metadata aponta o instrumento;
 *   T2. apostilamento de gestor: o termo traz descrição e o novo gestor do registro;
 *   T3. gerar "aditivo" sem referência ⇒ PRECONDITION_FAILED INSTRUMENT_REFERENCE_REQUIRED, nenhum documento;
 *   T4. referência de outro contrato/órgão ⇒ NOT_FOUND INSTRUMENT_NOT_FOUND, nenhum documento.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { createManualContract, createAddendum, createApostille, generateContractDocument } from "../../services/contractService";
import { listContractAddenda, listContractApostilles } from "../../db/contractWorkspace";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 960861;
const ORG_B = 960862;
const ACTOR = 61;
const CORR = "pr17-smoke";
const RUN = Date.now().toString(36);

let conn: mysql.Connection;

async function officialDocs(origin: string, documentType: string) {
  const [rows] = await conn.query("SELECT CAST(content AS CHAR) AS c, author, CAST(metadata AS CHAR) AS m FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = ? ORDER BY version", [ORG, origin, documentType]);
  return (rows as Array<{ c: string; author: string; m: string }>).map((r) => ({ content: r.c, author: r.author, meta: JSON.parse(r.m) as Record<string, unknown> }));
}
async function errOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await fn(); } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava erro");
}
async function vigente(org: number, n: string) {
  const c = await createManualContract({
    organizationId: org, contractNumber: `CT-PR17/${RUN}/${n}`, contractor: "Fornecedor Sintético", object: "Objeto sintético PR-17",
    value: 50000, term: "12 meses", correlationId: CORR, createdBy: ACTOR,
  });
  // Mesmo fixture do V1/D2: a ativação minuta → vigente ainda não é uma transição implementada.
  await conn.execute("UPDATE contract_workspaces SET status = 'vigente' WHERE id = ? AND organization_id = ?", [c.id, org]);
  return c;
}

const TABLES: Array<[string, string]> = [
  ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"], ["process_timeline", "organization_id"],
  ["contract_ws_documents", "organization_id"], ["contract_addenda", "organization_id"], ["contract_ws_apostilles", "organization_id"],
  ["contract_workspaces", "organization_id"],
];

describe.skipIf(!DB)("PR-17 — termos a partir do instrumento (MySQL 8)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const id of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `PR17 ${id}`, `pr17-${id}`]);
    }
    for (const [t, col] of TABLES) await conn.execute(`DELETE FROM ${t} WHERE ${col} IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    for (const [t, col] of TABLES) await conn.execute(`DELETE FROM ${t} WHERE ${col} IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("T1) aditivo de valor ⇒ termo com justificativa, novo valor e prazo do registro; IA só como sugestão; autor humano", async () => {
    const c = await vigente(ORG, "T1");
    await createAddendum({
      organizationId: ORG, contractId: c.id, addendumType: "valor", justification: "Acréscimo de 10% por aumento de demanda comprovado.",
      newValue: 1234.56, newTerm: "18 meses", actorUserId: ACTOR, correlationId: CORR,
    });
    const [addendum] = await listContractAddenda(c.id, ORG);
    const [doc] = await officialDocs(c.id, "aditivo");
    expect(doc.content).toContain("# Termo Aditivo nº 1");
    expect(doc.content).toContain("Acréscimo de 10% por aumento de demanda comprovado.");
    expect(doc.content).toContain("- Valor: R$ 1.234,56");
    expect(doc.content).toContain("- Prazo/vigência: 18 meses");
    expect(doc.content).toContain("aguardando parecer jurídico");
    expect(doc.content).toContain("Sugestões dos copilotos (NÃO incorporadas ao termo — revisar)");
    expect(doc.content).not.toMatch(/^CLÁUSULA \d+\./m);
    expect(doc.author).toBe(String(ACTOR));
    expect(doc.meta).toMatchObject({ instrumentId: addendum.id, instrumentKind: "aditivo" });
  }, 120_000);

  it("T2) apostilamento de gestor ⇒ termo com descrição e novo gestor do registro", async () => {
    const c = await vigente(ORG, "T2");
    await createApostille({
      organizationId: ORG, contractId: c.id, kind: "gestor", description: "Substituição do gestor por remoção do titular.",
      newManager: "Servidora Sintética Gestora", actorUserId: ACTOR, correlationId: CORR,
    });
    const [ap] = await listContractApostilles(c.id, ORG);
    const [doc] = await officialDocs(c.id, "apostilamento");
    expect(doc.content).toContain("# Apostilamento nº 1");
    expect(doc.content).toContain("Substituição do gestor por remoção do titular.");
    expect(doc.content).toContain("- Gestor do contrato: Servidora Sintética Gestora");
    expect(doc.content).toContain("- Fiscal do contrato: sem alteração");
    expect(doc.author).toBe(String(ACTOR));
    expect(doc.meta).toMatchObject({ instrumentId: ap.id, instrumentKind: "apostilamento" });
  }, 120_000);

  it("T3) gerar aditivo sem referência ⇒ INSTRUMENT_REFERENCE_REQUIRED, nenhum documento", async () => {
    const c = await vigente(ORG, "T3");
    const e = await errOf(() => generateContractDocument({ organizationId: ORG, contractId: c.id, kind: "aditivo", actorUserId: ACTOR, correlationId: CORR }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("INSTRUMENT_REFERENCE_REQUIRED");
    expect(await officialDocs(c.id, "aditivo")).toEqual([]);
  }, 60_000);

  it("T4) referência de outro contrato ⇒ INSTRUMENT_NOT_FOUND, nenhum documento", async () => {
    const a = await vigente(ORG, "T4a");
    const b = await vigente(ORG, "T4b");
    await createAddendum({ organizationId: ORG, contractId: a.id, addendumType: "prazo", justification: "Prorrogação sintética.", newTerm: "24 meses", actorUserId: ACTOR, correlationId: CORR });
    const [foreign] = await listContractAddenda(a.id, ORG);
    const e = await errOf(() => generateContractDocument({ organizationId: ORG, contractId: b.id, kind: "aditivo", refId: foreign.id, actorUserId: ACTOR, correlationId: CORR }));
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toContain("INSTRUMENT_NOT_FOUND");
    expect(await officialDocs(b.id, "aditivo")).toEqual([]);
  }, 120_000);
});
