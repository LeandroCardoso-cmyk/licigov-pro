/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 EDITAL — Geração contextual do Edital contra MySQL REAL (CI, modo ESTRITO).
 *
 * Prova, contra o writer real sob STRICT_TRANS_TABLES, o P0 do Edital no caminho vivo:
 *   1) GERAÇÃO: com DFD/ETP/TR presentes, o Edital nasce como MINUTA estruturada (não placeholder) e
 *      persiste em generated_documents (kind=edital) + documento oficial correspondente;
 *   2) LINEAGE: as `sources` do rascunho registram fundamentação (grounding:…) + digest de fontes
 *      (srcdigest:…) + versão do TR reaproveitado (base:tr@<hash≠none>);
 *   3) IDEMPOTÊNCIA: retry com a MESMA chave+fontes → replay (uma única linha, sem duplicar);
 *   4) SOURCE_CHANGED: `getEditalSourceState` = current logo após gerar;
 *   5) ISOLAMENTO: tenant A não enxerga o Edital do tenant B.
 *
 * Só roda com DATABASE_URL. Cognição via seam determinístico (sem provider). NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDFDDraft, generateDocument, generateNotice, getEditalSourceState } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { getGeneratedDocumentByKind } from "../../db/procurement";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991071;
const ORG2 = 991072;
const AUTHOR = 5;

let conn: mysql.Connection;

async function seedUpstream(org: number, pid: string, object: string) {
  await generateDFDDraft({ organizationId: org, processId: pid, object, correlationId: "p0-seed", idempotencyKey: `dfd-${org}-${pid}`, actorUserId: AUTHOR });
  await generateDocument({ organizationId: org, processId: pid, kind: "etp", object, correlationId: "p0-seed", idempotencyKey: `etp-${org}-${pid}`, actorUserId: AUTHOR, invoke: async () => buildMockProviderAuthoring("etp") });
  await generateDocument({ organizationId: org, processId: pid, kind: "tr", object, correlationId: "p0-seed", idempotencyKey: `tr-${org}-${pid}`, actorUserId: AUTHOR, invoke: async () => buildMockProviderAuthoring("tr") });
}

async function genEdital(org: number, pid: string, object: string, key: string) {
  return generateNotice({
    organizationId: org, processId: pid, object, modality: "pregao", form: "eletronico", platform: "compras_gov",
    correlationId: "p0-edital", idempotencyKey: key, actorUserId: AUTHOR, invoke: async () => buildMockProviderAuthoring("edital"),
  });
}

async function countEdital(org: number, pid: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [org, pid],
  );
  return Number((rows[0] as any).n);
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    await conn.execute("DELETE FROM official_document_promotions WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("P0 — geração contextual do Edital (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const [id, slug] of [[ORG, "p0-org"], [ORG2, "p0-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `P0 Org ${id}`, slug]).catch(() => {});
    }
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1/2) gera MINUTA estruturada com lineage (grounding + srcdigest + base:tr) e cria documento oficial", async () => {
    const pid = "p0-ed-gen";
    await seedUpstream(ORG, pid, "Aquisição de material de expediente");
    const res = await genEdital(ORG, pid, "Aquisição de material de expediente", `ed-${ORG}-${pid}`);
    expect(res.validation.valid).toBe(true);
    expect(res.replayed).toBe(false);

    const read = await getGeneratedDocumentByKind(pid, ORG, "edital");
    expect(read).not.toBeNull();
    expect(read!.content).toContain("Edital de Licitação");           // minuta estruturada (não o stub de 1 linha)
    expect(read!.content).not.toContain("Templates, cláusulas e cronograma aplicados conforme a modalidade"); // stub antigo eliminado
    // Lineage nas sources.
    expect(read!.sources.some((s) => s.startsWith("grounding:"))).toBe(true);
    expect(read!.sources.some((s) => s.startsWith("srcdigest:"))).toBe(true);
    const baseTr = read!.sources.find((s) => s.startsWith("base:tr@"));
    expect(baseTr).toBeDefined();
    expect(baseTr).not.toBe("base:tr@none");                          // o TR foi realmente reaproveitado

    // Documento OFICIAL correspondente criado (pipeline único).
    const [off] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'edital'", [ORG, pid],
    );
    expect(Number((off[0] as any).n)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("3) idempotência: retry com a MESMA chave+fontes → replay, sem duplicar (1 linha)", async () => {
    const pid = "p0-ed-idem";
    await seedUpstream(ORG, pid, "Serviço de limpeza");
    const key = `ed-idem-${ORG}-${pid}`;
    const first = await genEdital(ORG, pid, "Serviço de limpeza", key);
    const second = await genEdital(ORG, pid, "Serviço de limpeza", key);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(await countEdital(ORG, pid)).toBe(1);
  }, 120_000);

  it("4) getEditalSourceState = current logo após gerar", async () => {
    const pid = "p0-ed-state";
    await seedUpstream(ORG, pid, "Obra de reforma");
    await genEdital(ORG, pid, "Obra de reforma", `ed-state-${ORG}-${pid}`);
    const st = await getEditalSourceState({ organizationId: ORG, processId: pid, object: "Obra de reforma", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(st.state).toBe("current");
  }, 120_000);

  it("5) isolamento cross-tenant: tenant A não enxerga o Edital do tenant B", async () => {
    const pid = "p0-ed-x";
    await seedUpstream(ORG2, pid, "Material tenantB");
    await genEdital(ORG2, pid, "Material tenantB", `ed-x-${ORG2}-${pid}`);
    expect(await getGeneratedDocumentByKind(pid, ORG, "edital")).toBeNull();          // tenant A não vê
    expect((await getGeneratedDocumentByKind(pid, ORG2, "edital"))!.content.trim().length).toBeGreaterThan(0); // dono vê
  }, 120_000);
});
