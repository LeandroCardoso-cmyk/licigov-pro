/**
 * R9 / SEM-041 — FIXAÇÃO REAL dos documentos analisados pelo parecer, MySQL 8 real (órgãos 960411/960412).
 *
 *   P1. referência informada ⇒ versão REAL do banco e snapshot = hash do CONTEÚDO (verifySnapshot confere; conteúdo
 *       alterado depois não confere);
 *   P2. documento de OUTRO órgão / inexistente ⇒ BAD_REQUEST, nenhuma solicitação gravada;
 *   P3. versão informada divergente ⇒ CONFLICT, nada gravado;
 *   P4. sem documentos ⇒ a solicitação de parecer fixa automaticamente a versão VIGENTE de cada linhagem da origem.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { requestInstitutionalReview } from "../../services/institutionalRequestService";
import { listDocumentReferences } from "../../db/institutionalRequests";
import { verifySnapshot } from "../../domain/documentReference";

const DB = process.env.DATABASE_URL;
const ORG = 960411;
const ORG_B = 960412;

describe.skipIf(!DB)("R9 / SEM-041 — parecer fixa versão e conteúdo dos documentos (MySQL 8)", () => {
  let conn: mysql.Connection;
  const origin = `s041-${Date.now()}`.slice(0, 20);
  const base = { sourceDomain: "contratacao_direta" as const, destinationDomain: "parecer_juridico" as const, requestType: "LEGAL_OPINION_INITIAL" as const, referenceProcessId: origin, title: "Parecer", requestedBy: 7, correlationId: "s041" };
  async function cleanup() {
    for (const t of ["institutional_requests", "document_references", "request_assignments", "request_timelines", "request_notifications"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    }
    await conn.query("DELETE FROM official_documents WHERE tenant_id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
  }
  async function official(id: string, tenant: number, type: string, version: number, content: string) {
    await conn.execute(
      "INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id) VALUES (?, ?, 'contratacao_direta', ?, ?, ?, ?, 'gerado', ?, ?)",
      [id, tenant, type, origin, `${type} v${version}`, version, content, `l${tenant}-${type === "justificativa" ? "j" : "p"}`],
    );
  }
  const requests = async (org: number) => Number(((await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM institutional_requests WHERE organization_id = ?", [org]))[0][0] as { n: number }).n);

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    await official("s041-just-v1", ORG, "justificativa", 1, "Justificativa v1");
    await official("s041-just-v2", ORG, "justificativa", 2, "Justificativa v2 vigente");
    await official("s041-preco-v1", ORG, "justificativa_preco", 1, "Preço v1");
    await official("s041-other", ORG_B, "justificativa", 1, "De outro órgão");
  }, 300_000);
  afterAll(async () => { if (!conn) return; await cleanup(); await conn.end(); });

  it("P1) referência informada: versão real e snapshot do CONTEÚDO", async () => {
    const r = await requestInstitutionalReview({ ...base, organizationId: ORG, documents: [{ documentId: "s041-just-v2" }] });
    const refs = await listDocumentReferences(r.request.id, ORG);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ documentId: "s041-just-v2", version: 2 });
    expect(verifySnapshot(refs[0], "Justificativa v2 vigente")).toBe(true);
    expect(verifySnapshot(refs[0], "conteúdo alterado")).toBe(false);
  });

  it("P2/P3) outro órgão ou versão divergente ⇒ recusa sem gravar", async () => {
    const before = await requests(ORG);
    await expect(requestInstitutionalReview({ ...base, organizationId: ORG, documents: [{ documentId: "s041-other" }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("DOCUMENT_REFERENCE_NOT_FOUND") });
    await expect(requestInstitutionalReview({ ...base, organizationId: ORG, documents: [{ documentId: "s041-just-v2", version: 1 }] }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await requests(ORG)).toBe(before);
  });

  it("P4) sem documentos: fixa a versão vigente de cada linhagem da origem", async () => {
    const r = await requestInstitutionalReview({ ...base, organizationId: ORG });
    const refs = await listDocumentReferences(r.request.id, ORG);
    expect(refs.map((x) => [x.documentId, x.version]).sort()).toEqual([["s041-just-v2", 2], ["s041-preco-v1", 1]]);
    expect(refs.every((x) => x.snapshot.length > 0)).toBe(true);
  });
});
