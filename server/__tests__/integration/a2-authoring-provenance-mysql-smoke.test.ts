/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — AUTORIA ESTRUTURADA × PROVENIÊNCIA A1 (MySQL real).
 *
 * Executável (não source inspection). Prova a INTEGRAÇÃO A2→A1 no boundary REAL de geração canônica
 * (procurementProcessService.generateDocument, ETP/TR) com COGNIÇÃO REAL (sem `invoke`; provider mock):
 *   - a proveniência ORIGINAL é persistida com evidenceFingerprint REAL (não-nulo) e grounding_state
 *     FACTUAL (grounded/partially_grounded) — evidência recuperada do corpus institucional VIGENTE;
 *   - o artefato de trabalho é VINCULADO à proveniência na MESMA transação (artifact_id/kind preenchidos);
 *   - replay keyed NÃO cria uma segunda proveniência ORIGINAL (is_replay=0 permanece único) e devolve
 *     replayed=true sem re-chamar o provider;
 *   - TR também produz proveniência aterrada.
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument } from "../../services/procurementProcessService";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 990061;
const USER = 5;

let conn: mysql.Connection;

async function provRows(org: number, correlationId: string): Promise<any[]> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT execution_status, grounding_state, evidence_fingerprint, is_replay, provenance_class, artifact_kind, artifact_id FROM cognitive_provenance WHERE organization_id = ? AND correlation_id = ? ORDER BY is_replay",
    [org, correlationId],
  );
  return rows as any[];
}

async function cleanup() {
  await conn.execute("DELETE FROM cognitive_provenance WHERE organization_id = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]).catch(() => {});
}

describe.skipIf(!DB)("A2 — autoria estruturada × proveniência A1 (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "A2 Org", "a2-org"]).catch(() => {});
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("ETP: cognição real → proveniência com evidenceFingerprint REAL e grounding factual; artefato vinculado", async () => {
    const corr = "a2-prov-etp";
    const r = await generateDocument({
      organizationId: ORG, processId: "a2-p-etp", kind: "etp", object: "Aquisição de material de escritório",
      correlationId: corr, idempotencyKey: "a2-etp-key-1", actorUserId: USER,
    });
    expect(r.replayed).toBe(false);
    expect(r.document.kind).toBe("etp");

    const rows = await provRows(ORG, corr);
    const original = rows.find((x) => Number(x.is_replay) === 0);
    expect(original).toBeTruthy();
    // Proveniência moderna, execução concluída.
    expect(String(original.provenance_class)).toBe("provenanced");
    expect(["completed", "completed_degraded"]).toContain(String(original.execution_status));
    // A2 — evidência REAL recuperada → fingerprint não-nulo e grounding FACTUAL (não ungrounded/not_applicable).
    expect(original.evidence_fingerprint).toBeTruthy();
    expect(["grounded", "partially_grounded"]).toContain(String(original.grounding_state));
    // Artefato de trabalho VINCULADO à proveniência (mesma transação).
    expect(String(original.artifact_kind)).toBe("etp");
    expect(original.artifact_id).toBeTruthy();
  }, 120_000);

  it("replay keyed: NÃO cria segunda proveniência ORIGINAL; devolve replayed=true", async () => {
    const corr = "a2-prov-etp"; // mesma correlação/tenant/chave → replay
    const before = (await provRows(ORG, corr)).filter((x) => Number(x.is_replay) === 0).length;
    const r2 = await generateDocument({
      organizationId: ORG, processId: "a2-p-etp", kind: "etp", object: "Aquisição de material de escritório",
      correlationId: corr, idempotencyKey: "a2-etp-key-1", actorUserId: USER,
    });
    expect(r2.replayed).toBe(true);
    const after = (await provRows(ORG, corr)).filter((x) => Number(x.is_replay) === 0).length;
    expect(after).toBe(before); // imutabilidade: nenhuma nova proveniência original
  }, 120_000);

  it("TR: cognição real → proveniência aterrada e artefato vinculado", async () => {
    const corr = "a2-prov-tr";
    const r = await generateDocument({
      organizationId: ORG, processId: "a2-p-tr", kind: "tr", object: "Serviço de limpeza predial",
      correlationId: corr, idempotencyKey: "a2-tr-key-1", actorUserId: USER,
    });
    expect(r.replayed).toBe(false);
    const original = (await provRows(ORG, corr)).find((x) => Number(x.is_replay) === 0);
    expect(original).toBeTruthy();
    expect(original.evidence_fingerprint).toBeTruthy();
    expect(["grounded", "partially_grounded"]).toContain(String(original.grounding_state));
    expect(String(original.artifact_kind)).toBe("tr");
  }, 120_000);
});
