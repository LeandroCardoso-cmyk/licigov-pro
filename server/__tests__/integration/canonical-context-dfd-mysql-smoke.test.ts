/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Contexto Canônico da Contratação × DFD — fluxo INTEGRADO contra MySQL REAL (CI, modo estrito), pelo
 * ROUTER real (tenantProcedure/orgRoleProcedure, membership do banco) e pelo AIExecutionEngine real:
 *
 *   Criar Processo (unidade requisitante) → contexto inicializado → 3 itens da Pesquisa (quantidade da
 *   cotação = 1) + quantidade PREVISTA informada → DFD abre PRÉ-PREENCHIDO → editar → salvar (fatos dfd no
 *   ledger, mesma transação) → recarregar (estado estável) → contexto muda → DESATUALIZADO → reconciliar
 *   (ação explícita) → rascunho de IA da justificativa (proveniência vinculada; retry = replay sem nova
 *   chamada) → DFD aprovado intocável; isolamento multi-tenant; RBAC; migration 0305 replay-safe.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "../../bootstrap";
import { governedResearchId, GOVERNED_RESEARCH_TABLES, forgetGovernedResearch } from "../helpers/governedPriceResearch";
import { recordContextAssertions, resolveProcurementContext } from "../../services/canonicalContextService";
import { appendContextFacts } from "../../db/procurementContext";
import { itemPath } from "../../domain/canonicalProcurementContext";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991305;
const ORG_B = 991306;

let conn: mysql.Connection;
let owner = 0;
let viewer = 0;
let ownerB = 0;
let processId = "";

async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `ctx-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

async function insertUser(tag: string, name: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`ctx-smoke-${tag}-${Date.now()}`, name, `ctx-smoke-${tag}-${Date.now()}@teste.local`],
  );
  return r.insertId;
}

async function insertItem(pid: string, id: string, description: string, value: number) {
  const rid = await governedResearchId(conn, ORG, pid, owner);
  await conn.execute(
    `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
       suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
     VALUES (?, ?, ?, ?, ?, 1, 'UN', ?, ?, NULL, '[]', '[]', '[]', '[]', 'aprovado', ?, 'done', 'ctx-smoke')`,
    [id, ORG, pid, rid, description, value.toFixed(2), JSON.stringify([{ name: "F1", value }, { name: "F2", value }, { name: "F3", value }]), owner],
  );
}

async function ledger(pid: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT operation AS op, actor_user_id AS actor FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'dfd' ORDER BY id", [ORG, pid],
  );
  return rows.map((r: any) => ({ op: String(r.op), actor: Number(r.actor) }));
}

async function facts(org: number, pid: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT path, CAST(value_json AS CHAR) AS v, source_type AS s, status AS st, actor_user_id AS a FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? ORDER BY id", [org, pid],
  );
  return rows.map((r: any) => ({ path: String(r.path), value: r.v == null ? null : JSON.parse(String(r.v)), source: String(r.s), status: String(r.st), actor: r.a == null ? null : Number(r.a) }));
}

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    forgetGovernedResearch(org);
    for (const [t, col] of [
      ...GOVERNED_RESEARCH_TABLES,
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"],
      ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"],
      ["process_timeline", "organization_id"], ["intelligent_items", "organization_id"], ["procurement_processes", "organization_id"],
      ["cognitive_provenance", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

/** Ids ESTÁVEIS dos Itens Canônicos (Armário, Cadeira, Mesa) — preenchidos no passo 2 pela Área de Itens. */
let K: string[] = [];

describe.skipIf(!DB)("Contexto Canônico × DFD — fluxo integrado (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura Contexto"], [ORG_B, "Prefeitura Outra"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `ctx-${id}`]);
    }
    owner = await insertUser("owner", "Servidora Responsável");
    viewer = await insertUser("viewer", "Leitor");
    ownerB = await insertUser("ownerb", "Outro Tenant");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG, owner]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'viewer', 1)", [ORG, viewer]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_B, ownerB]);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM users WHERE id IN (?, ?, ?)", [owner, viewer, ownerB]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("1) criar Processo com unidade requisitante → fato registrado na MESMA transação (fonte Processo)", async () => {
    const c = await caller(owner);
    const { process } = await c.procurementProcess.createProcess({
      processNumber: `CTX-${Date.now()}`, object: "Mobiliário escolar", startOption: "criar_dfd", requestingUnit: "Secretaria Municipal de Educação",
    });
    processId = process.id;
    expect(await facts(ORG, processId)).toEqual([
      { path: "demand.requestingUnit", value: "Secretaria Municipal de Educação", source: "process", status: "confirmed", actor: owner },
    ]);
  }, 60_000);

  it("2) Pesquisa (quantidade da cotação = 1) → Itens da contratação confirmados + quantidade PREVISTA → contexto resolvido", async () => {
    await insertItem(processId, `ctx-i1-${ORG}`, "Cadeira giratória", 450);
    await insertItem(processId, `ctx-i2-${ORG}`, "Mesa de escritório", 800);
    await insertItem(processId, `ctx-i3-${ORG}`, "Armário de aço", 1200);
    const c = await caller(owner);
    const cand = await c.procurementItems.candidates({ processId, source: "price_research" });
    const planned: Record<string, string> = { "Armário de aço": "5", "Cadeira giratória": "30", "Mesa de escritório": "10" };
    const ordered = [...cand.candidates].sort((a: any, b: any) => (a.description < b.description ? -1 : 1));
    await c.procurementItems.confirmCandidates({
      processId, source: "price_research", expectedSourceDigest: cand.sourceDigest, idempotencyKey: `conf-${processId}`,
      decisions: ordered.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const, plannedQuantity: planned[x.description] })),
    });
    const w = await c.procurementItems.workspace({ processId });
    K = ["Armário de aço", "Cadeira giratória", "Mesa de escritório"].map((d) => w.items.find((i: any) => i.description === d)!.id);
    // Pesquisa NUNCA é autoridade da quantidade prevista (recusado na escrita).
    await expect(recordContextAssertions({
      organizationId: ORG, processId, correlationId: "ctx", facts: [{ path: itemPath(K[1], "plannedQuantity"), value: 1, sourceType: "price_research", sourceId: "r", sourceVersion: "v", status: "confirmed", actorUserId: owner, basisValueHash: null }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { context } = await c.procurementProcess.canonicalContext({ processId });
    expect(context.demand.requestingUnit.value).toBe("Secretaria Municipal de Educação");
    expect(context.demand.responsibleParty.value).toBe("Servidora Responsável");
    expect(context.items.map((i: any) => [i.description.value, i.plannedQuantity.value, i.priceContext.sourceQuantities])).toEqual([
      ["Armário de aço", 5, [1]], ["Cadeira giratória", 30, [1]], ["Mesa de escritório", 10, [1]],
    ]);
    expect(context.priceContext).toMatchObject({ complete: true, estimatedTotalCents: 2_750_000 });
    expect(context.version).toBeGreaterThan(0);
  }, 60_000);

  it("3) DFD abre PRÉ-PREENCHIDO (mesmo template) e o reload é estável", async () => {
    const c = await caller(owner);
    const { document } = await c.procurementProcess.generateDFD({ processId, idempotencyKey: `gen-${processId}` });
    expect(document.content).toContain("Setor/unidade demandante: Secretaria Municipal de Educação");
    expect(document.content).toContain("Responsável pela demanda: Servidora Responsável");
    expect(document.content).toContain("| 2 | Cadeira giratória | UN | 30 |");
    expect(document.content).toContain("R$ 27.500,00");
    expect(document.status).toBe("rascunho");
    const loaded = (await c.procurementProcess.loadDFD({ processId })).document!;
    expect(loaded.content).toBe(document.content);
    expect(loaded.sources.some((s: string) => s.startsWith("ctxdigest:"))).toBe(true);
    const st = await c.procurementProcess.dfdAssistState({ processId });
    expect(st.available).toBe(true);
    expect(st.stale).toBe(false);
    expect(st.summary.prefilled).toBeGreaterThanOrEqual(8);
    expect(await ledger(processId)).toEqual([]); // criação não gera ledger (contrato C.4B.3A)
  }, 60_000);

  it("4) editar + salvar: conteúdo humano preservado, ledger dfd_manual_edit e fatos dfd no ledger do contexto", async () => {
    const c = await caller(owner);
    const cur = (await c.procurementProcess.loadDFD({ processId })).document!;
    const edited = cur.content
      .replace("| 2 | Cadeira giratória | UN | 30 |", "| 2 | Cadeira giratória | UN | 45 |")
      .replace("Prazo pretendido para a contratação: [preencher]", "Prazo pretendido para a contratação: até julho de 2026");
    await c.procurementProcess.saveDFD({ processId, content: edited, expectedContentHash: cur.contentHash, idempotencyKey: `save-${processId}` });
    // retry da MESMA tentativa → replay (sem novo ledger, sem fato duplicado)
    await c.procurementProcess.saveDFD({ processId, content: edited, expectedContentHash: cur.contentHash, idempotencyKey: `save-${processId}` });
    expect(await ledger(processId)).toEqual([{ op: "dfd_manual_edit", actor: owner }]);
    const dfdFacts = (await facts(ORG, processId)).filter((f) => f.source === "dfd");
    expect(dfdFacts.map((f) => [f.path, f.value, f.status, f.actor]).sort()).toEqual([
      [itemPath(K[1], "plannedQuantity"), 45, "confirmed", owner], ["planning.desiredDate", "até julho de 2026", "confirmed", owner],
    ].sort());

    const reloaded = (await c.procurementProcess.loadDFD({ processId })).document!;
    expect(reloaded.content).toBe(edited);
    const st = await c.procurementProcess.dfdAssistState({ processId });
    const byKey = Object.fromEntries(st.fields.map((f: any) => [f.key, f.state]));
    expect(byKey[`item:${K[1]}`]).toBe("user_modified");
    expect(byKey["prioridade.prazo"]).toBe("user_modified");
    expect(st.summary.conflict).toBe(0);
    const ctx = await resolveProcurementContext({ organizationId: ORG, processId });
    expect(ctx.items.find((i) => i.key === K[1])!.plannedQuantity.value).toBe(45); // DFD alimenta as próximas etapas
  }, 60_000);

  it("5) contexto muda → DESATUALIZADO → 'Atualizar no rascunho' só no campo (ledger dfd_context_reconcile)", async () => {
    // Quantidade alterada na Área de Itens (caminho operacional real) → nova versão do contexto.
    const w0 = await (await caller(owner)).procurementItems.workspace({ processId });
    const mesa = w0.items.find((i: any) => i.id === K[2])!;
    await (await caller(owner)).procurementItems.setQuantities({ processId, idempotencyKey: `mesa-${processId}`, changes: [{ itemId: mesa.id, expectedRevision: mesa.revision, mode: "informed", quantity: "12" }] });
    const c = await caller(owner);
    const st = await c.procurementProcess.dfdAssistState({ processId });
    expect(st.stale).toBe(true);
    expect(st.fields.find((f: any) => f.key === `item:${K[2]}`)).toMatchObject({ state: "stale", reconcilable: true, documentValue: "10", contextValue: "12" });
    const cur = (await c.procurementProcess.loadDFD({ processId })).document!;
    expect(cur.content).toContain("| 3 | Mesa de escritório | UN | 10 |"); // nada muda sozinho
    await c.procurementProcess.reconcileDFDField({ processId, fieldKey: `item:${K[2]}`, expectedContentHash: cur.contentHash, idempotencyKey: `rec-${processId}` });
    const after = (await c.procurementProcess.loadDFD({ processId })).document!;
    expect(after.content).toContain("| 3 | Mesa de escritório | UN | 12 |");
    expect(after.content).toContain("| 2 | Cadeira giratória | UN | 45 |"); // edição humana intacta
    expect((await ledger(processId)).map((l) => l.op)).toEqual(["dfd_manual_edit", "dfd_context_reconcile"]);
  }, 60_000);

  it("6) RBAC e tenant: viewer não reconcilia/gera IA; outro tenant não enxerga o contexto", async () => {
    const v = await caller(viewer);
    const cur = (await v.procurementProcess.loadDFD({ processId })).document!;
    await expect(v.procurementProcess.generateDFDJustification({ processId, expectedContentHash: cur.contentHash, idempotencyKey: "v-ai" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(v.procurementProcess.reconcileDFDField({ processId, fieldKey: "identificacao.unidade", expectedContentHash: cur.contentHash, idempotencyKey: "v-rec" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const b = await caller(ownerB);
    await expect(b.procurementProcess.canonicalContext({ processId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.procurementProcess.dfdAssistState({ processId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await facts(ORG_B, processId)).toEqual([]);
  }, 60_000);

  it("7) rascunho de IA da justificativa (AIExecutionEngine) marcado + proveniência; retry = replay sem nova execução", async () => {
    const c = await caller(owner);
    const cur = (await c.procurementProcess.loadDFD({ processId })).document!;
    const key = `ai-${processId}`;
    const r1 = await c.procurementProcess.generateDFDJustification({ processId, expectedContentHash: cur.contentHash, idempotencyKey: key });
    expect(r1.explanation.executionId).toBeTruthy();
    expect(r1.explanation.promptVersion).toBe("dfd-justificativa/1");
    const after = (await c.procurementProcess.loadDFD({ processId })).document!;
    expect(after.sources.some((s: string) => s.startsWith("ai:justificativa="))).toBe(true);
    expect(after.content).toContain("| 2 | Cadeira giratória | UN | 45 |"); // só a seção 2 mudou
    expect(after.status).toBe("rascunho");
    const [prov] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM cognitive_provenance WHERE organization_id = ? AND artifact_kind = 'dfd' AND artifact_id = ?", [ORG, after.id],
    );
    expect(Number((prov[0] as any).n)).toBeGreaterThan(0);
    const [p0] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM cognitive_provenance WHERE organization_id = ?", [ORG]);
    const r2 = await c.procurementProcess.generateDFDJustification({ processId, expectedContentHash: cur.contentHash, idempotencyKey: key });
    expect(r2.explanation.executionId).toBe(r1.explanation.executionId);
    const [p1] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM cognitive_provenance WHERE organization_id = ?", [ORG]);
    expect(Number((p1[0] as any).n)).toBe(Number((p0[0] as any).n)); // nenhuma nova execução cognitiva
    expect((await ledger(processId)).map((l) => l.op)).toEqual(["dfd_manual_edit", "dfd_context_reconcile", "dfd_ai_draft"]);
    const st = await c.procurementProcess.dfdAssistState({ processId });
    expect(st.fields.find((f: any) => f.key === "justificativa").state).toBe("ai_draft");
  }, 120_000);

  it("8) DFD APROVADO nunca é alterado silenciosamente (save/reconcile/IA/regeneração recusados)", async () => {
    await conn.execute("UPDATE generated_documents SET status = 'aprovado' WHERE organization_id = ? AND process_id = ? AND kind = 'dfd'", [ORG, processId]);
    const c = await caller(owner);
    const cur = (await c.procurementProcess.loadDFD({ processId })).document!;
    await expect(c.procurementProcess.saveDFD({ processId, content: `${cur.content}\nx`, expectedContentHash: cur.contentHash, idempotencyKey: "ap-1" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(c.procurementProcess.generateDFD({ processId, idempotencyKey: "ap-2" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(c.procurementProcess.generateDFDJustification({ processId, expectedContentHash: cur.contentHash, confirmReplace: true, idempotencyKey: "ap-3" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await c.procurementProcess.loadDFD({ processId })).document!.content).toBe(cur.content);
    expect((await ledger(processId)).length).toBe(3);
  }, 60_000);

  it("9) ledger idempotente (dedup por tenant) e migration 0305 replay-safe", async () => {
    const f = { path: "planning.priority" as const, value: "alta", sourceType: "user" as const, sourceId: "u", sourceVersion: "v", status: "confirmed" as const, actorUserId: owner, basisValueHash: null };
    expect(await appendContextFacts(ORG, processId, [f], "c")).toBe(1);
    expect(await appendContextFacts(ORG, processId, [f], "c")).toBe(0);
    expect(await appendContextFacts(ORG_B, processId, [f], "c")).toBe(1); // mesma chave lógica, outro tenant: isolado
    const sql = readFileSync(resolve(__dirname, "../../../drizzle/0305_canonical_procurement_context.sql"), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean)) {
      await conn.query(stmt); // reaplicar não falha nem duplica índice
    }
    const [idx] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_context_facts'",
    );
    expect(Number((idx[0] as any).n)).toBe(3); // PRIMARY + uq dedup + idx scope
  }, 60_000);
});
