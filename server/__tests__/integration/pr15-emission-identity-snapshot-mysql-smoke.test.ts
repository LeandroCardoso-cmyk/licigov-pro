/**
 * R7 / PR-15 (SEM-013) — a versão EMITIDA congela a identidade institucional e a referência do processo da época.
 * R7.5 — guarda de imutabilidade: alterar o cadastro do órgão ou o rascunho NÃO altera a versão emitida.
 *
 * MySQL 8 real, dados sintéticos (órgão 960841). Antes do PR-15 a emissão governada (`promoteOfficialDocument`)
 * criava a versão `emitido` sem `institutionalIdentitySnapshot` e a reexportação usava a identidade VIGENTE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, canonicalDocumentIdentity, saveReviewableDraft } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { promoteOfficialDocument, draftContentHash } from "../../services/documentPromotionService";
import { institutionalIdentityFromMetadataOrLive } from "../../services/institutionalIdentityService";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { insertProcess } from "../../db/procurement";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 960841;
const AUTHOR = 41;
const EMITTER = 42;
const EDITOR = 43;

let conn: mysql.Connection;

async function draftHash(processId: string): Promise<string> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp' LIMIT 1", [ORG, processId]);
  return draftContentHash(rows.length ? String((rows[0] as { c: string }).c) : "");
}

async function emitted(processId: string) {
  const { lineageId } = canonicalDocumentIdentity({ organizationId: ORG, processId, kind: "etp" });
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT id, version, CAST(content AS CHAR) AS c, CAST(metadata AS CHAR) AS m, content_hash FROM official_documents WHERE tenant_id = ? AND lineage_id = ? AND status = 'emitido' ORDER BY version",
    [ORG, lineageId]);
  return (rows as Array<{ id: string; version: number; c: string; m: string; content_hash: string | null }>).map((r) => ({ ...r, meta: JSON.parse(r.m) as Record<string, unknown> }));
}

async function cleanup() {
  for (const [t, col] of [
    ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
    ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"], ["process_timeline", "organization_id"],
    ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"],
  ] as const) {
    await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [ORG]).catch(() => {});
  }
}

describe.skipIf(!DB)("PR-15 / R7.5 — snapshot institucional na emissão (MySQL 8)", () => {
  let pid = "";

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo, cnpj) VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome), cnpj = VALUES(cnpj)",
      [ORG, "Prefeitura Sintética Alfa", "pr15-alfa", "11.111.111/0001-11"]);
    await cleanup();
    const p = createProcurementWorkspace({
      organizationId: ORG, processNumber: `SINT-PR15/${Date.now()}`, object: "Material sintético PR-15", startOption: "iniciar_pesquisa",
      responsibleUser: AUTHOR, correlationId: "pr15",
    });
    await insertProcess(p);
    pid = p.id;
    await generateDocument({
      organizationId: ORG, processId: pid, kind: "etp", object: "Material sintético PR-15", correlationId: "pr15",
      idempotencyKey: `pr15-gen-${pid}`, actorUserId: AUTHOR, invoke: async () => buildMockProviderAuthoring("etp"),
    });
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("E1) a emissão grava snapshot da identidade + nº do processo + objeto no metadata da versão", async () => {
    const res = await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "etp", actorUserId: EMITTER, actorRole: "manager",
      idempotencyKey: `pr15-emit-1-${pid}`, correlationId: "pr15", expectedContentHash: await draftHash(pid),
    });
    expect(res.promoted).toBe(true);
    const [v1] = await emitted(pid);
    expect(v1.meta.institutionalIdentitySnapshot).toMatchObject({ organizationName: "Prefeitura Sintética Alfa", cnpj: "11.111.111/0001-11" });
    expect(typeof v1.meta.institutionalIdentityFingerprint).toBe("string");
    expect(v1.meta.processNumber).toMatch(/^SINT-PR15\//);
    expect(v1.meta.object).toBe("Material sintético PR-15");
  }, 120_000);

  it("E2) mudar o cadastro do órgão NÃO muda a identidade reexportada da versão emitida", async () => {
    await conn.execute("UPDATE organizations SET nome = ?, cnpj = ? WHERE id = ?", ["Prefeitura Sintética Beta", "22.222.222/0001-22", ORG]);
    const [v1] = await emitted(pid);
    const identity = await institutionalIdentityFromMetadataOrLive(v1.meta, ORG);
    expect(identity.organizationName).toBe("Prefeitura Sintética Alfa");
    expect(identity.cnpj).toBe("11.111.111/0001-11");
    // Controle: sem snapshot (versão legada) cairia para a identidade vigente.
    expect((await institutionalIdentityFromMetadataOrLive({}, ORG)).organizationName).toBe("Prefeitura Sintética Beta");
  }, 60_000);

  it("E3 / R7.5) editar o rascunho e emitir de novo cria v2 com a identidade NOVA; v1 permanece byte-idêntica", async () => {
    const [before] = await emitted(pid);
    const current = await draftHash(pid);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    await saveReviewableDraft({
      organizationId: ORG, processId: pid, kind: "etp", content: `${String((rows[0] as { c: string }).c)}\n\nAjuste humano PR-15.`, actorUserId: EDITOR,
      expectedContentHash: current, idempotencyKey: `pr15-edit-${pid}`, correlationId: "pr15",
    });
    await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "etp", actorUserId: EMITTER, actorRole: "manager",
      idempotencyKey: `pr15-emit-2-${pid}`, correlationId: "pr15", expectedContentHash: await draftHash(pid),
    });
    const [v1, v2] = await emitted(pid);
    expect(v1.id).toBe(before.id);
    expect(v1.c).toBe(before.c);
    expect(v1.m).toBe(before.m);
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.meta.institutionalIdentitySnapshot).toMatchObject({ organizationName: "Prefeitura Sintética Beta" });
    expect(v2.c).toContain("Ajuste humano PR-15.");
  }, 120_000);
});
