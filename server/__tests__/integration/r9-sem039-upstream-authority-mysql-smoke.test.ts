/**
 * R9 / SEM-039 — fonte AUTORITATIVA a montante, MySQL 8 real (órgãos sintéticos 960391/960392).
 *
 *   U1. TR com versão `emitido` v1 e rascunho editado DEPOIS ⇒ o Edital consome a v1 emitida (não o rascunho);
 *   U2. sem emissão ⇒ vale o rascunho, rotulado `rascunho`/`aprovado`;
 *   U3. emissão de OUTRO órgão para o mesmo processId nunca é consumida (tenant-scoped).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { createGeneratedDocument } from "../../domain/generatedDocument";
import { insertGeneratedDocument } from "../../db/procurement";
import { resolveAuthoritativeUpstream } from "../../services/authoring/upstreamAuthority";

const DB = process.env.DATABASE_URL;
const ORG = 960391;
const ORG_B = 960392;

describe.skipIf(!DB)("R9 / SEM-039 — upstream autoritativo (MySQL 8)", () => {
  let conn: mysql.Connection;
  const pid = `s039-${Date.now()}`.slice(0, 20);
  async function cleanup() {
    await conn.query("DELETE FROM generated_documents WHERE organization_id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM official_documents WHERE tenant_id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
  }
  async function emit(tenant: number, kind: string, version: number, content: string) {
    await conn.execute(
      "INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id) VALUES (?, ?, 'processo_licitatorio', ?, ?, ?, ?, 'emitido', ?, ?)",
      [`od-${tenant}-${kind}-${version}`.slice(0, 20), tenant, kind, pid, `${kind} v${version}`, version, content, `lin-${tenant}-${kind}`.slice(0, 20)],
    );
  }
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
  }, 300_000);
  afterAll(async () => { if (!conn) return; await cleanup(); await conn.end(); });

  it("U2) sem emissão ⇒ rascunho rotulado", async () => {
    await insertGeneratedDocument(createGeneratedDocument({ processId: pid, organizationId: ORG, kind: "tr", title: "TR", content: "TR rascunho A", correlationId: "s039" }));
    expect(await resolveAuthoritativeUpstream(ORG, pid, "tr")).toMatchObject({ authority: "rascunho", version: null, content: "TR rascunho A" });
  });

  it("U1) versão emitida vence o rascunho editado depois; a mais recente emitida é a usada", async () => {
    await emit(ORG, "tr", 1, "TR emitido v1");
    expect(await resolveAuthoritativeUpstream(ORG, pid, "tr")).toMatchObject({ authority: "emitido", version: 1, content: "TR emitido v1" });
    await conn.execute("UPDATE generated_documents SET content = 'TR rascunho EDITADO depois' WHERE organization_id = ? AND process_id = ? AND kind = 'tr'", [ORG, pid]);
    expect((await resolveAuthoritativeUpstream(ORG, pid, "tr"))?.content).toBe("TR emitido v1");
    await emit(ORG, "tr", 2, "TR emitido v2");
    expect(await resolveAuthoritativeUpstream(ORG, pid, "tr")).toMatchObject({ version: 2, content: "TR emitido v2" });
  });

  it("U3) emissão de outro órgão não é consumida", async () => {
    await emit(ORG_B, "etp", 1, "ETP de OUTRO órgão");
    expect(await resolveAuthoritativeUpstream(ORG, pid, "etp")).toBeNull();
  });
});
