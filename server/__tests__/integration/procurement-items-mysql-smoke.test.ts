/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Itens da Contratação — fluxo INTEGRADO contra MySQL REAL (CI, modo estrito), pelo ROUTER real:
 *
 *   Processo iniciado na PESQUISA (sem DFD) → Pesquisa revisada (5 itens lógicos / 30 cotações) → preparar
 *   candidatos (determinístico) → confirmar (5 Itens Canônicos, sem quantidade automática) → replay /
 *   CONFLICT → item manual (6º; Pesquisa intacta) → quantidades (informar, "Usar N", concorrência) → lotes
 *   (criar, atribuir, mover mantendo o id, reordenar) → contexto canônico (preço POR item) → DFD pré-preenchido
 *   → quantidade muda ⇒ DFD desatualizado → reconciliar → DFD aprovado ⇒ GOVERNED_CHANGE_REQUIRED →
 *   tenant/RBAC → migration 0306 replay-safe.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMigrations } from "../../bootstrap";
import { resolveProcurementContext } from "../../services/canonicalContextService";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991307;
const ORG_B = 991308;

let conn: mysql.Connection;
let owner = 0, operator2 = 0, viewer = 0, ownerB = 0;
let pid = "";
let itemIds: string[] = [];
let manualId = "";

async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `items-smoke-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

async function insertUser(tag: string, name: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`items-smoke-${tag}-${Date.now()}`, name, `items-smoke-${tag}-${Date.now()}@teste.local`]);
  return r.insertId;
}

/** Fixture SANITIZADA: 5 itens lógicos, 6 cotações cada (30), materializados após revisão aprovada. */
const RESEARCH = [
  { id: "sm-ii1", d: "Concentrado ativado", u: "Tambor", q: 1, st: "aprovado", v: 450 },
  { id: "sm-ii2", d: "Detergente automotivo", u: "Galão", q: 20, st: "aprovado", v: 80 },
  { id: "sm-ii3", d: "Pano de microfibra", u: "UN", q: 0, st: "pendente", v: 12 },
  { id: "sm-ii4", d: "Cera líquida", u: "Litro", q: 35, st: "aprovado", v: 30 },
  { id: "sm-ii5", d: "Escova de cerdas", u: "UN", q: 1, st: "aprovado", v: 25 },
];

async function seedResearch(processId: string) {
  for (const r of RESEARCH) {
    const suppliers = Array.from({ length: 6 }, (_, i) => ({ name: `Fornecedor ${i + 1}`, value: r.v, quoteId: `${r.id}-q${i}`, researchId: "sm-r" }));
    await conn.execute(
      `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
         suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
       VALUES (?, ?, ?, 'sm-r', ?, ?, ?, ?, ?, NULL, '[]', '[]', '[]', '[]', ?, NULL, 'done', 'items-smoke')`,
      [`${r.id}-${ORG}`, ORG, processId, r.d, r.q, r.u, r.v.toFixed(2), JSON.stringify(suppliers), r.st],
    );
  }
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"],
      ["generated_documents", "organization_id"], ["process_timeline", "organization_id"], ["intelligent_items", "organization_id"],
      ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

const ws = async (u = owner) => (await caller(u)).procurementItems.workspace({ processId: pid });
const byDesc = (w: any, d: string) => w.items.find((i: any) => i.description === d);

describe.skipIf(!DB)("Itens da contratação — fluxo integrado (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura Itens"], [ORG_B, "Prefeitura Outra Itens"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `items-${id}`]);
    }
    owner = await insertUser("owner", "Servidora Responsável");
    operator2 = await insertUser("op2", "Outro Operador");
    viewer = await insertUser("viewer", "Leitor");
    ownerB = await insertUser("ownerb", "Outro Tenant");
    for (const [org, u, role] of [[ORG, owner, "owner"], [ORG, operator2, "operator"], [ORG, viewer, "viewer"], [ORG_B, ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM users WHERE id IN (?, ?, ?, ?)", [owner, operator2, viewer, ownerB]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("1) processo iniciado na PESQUISA: 5 itens lógicos (30 cotações) ⇒ 5 candidatos determinísticos", async () => {
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `IT-${Date.now()}`, object: "Material de limpeza", startOption: "iniciar_pesquisa" });
    pid = process.id;
    await seedResearch(pid);
    const c = await caller(owner);
    const a = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    const b = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    expect(a.candidates).toHaveLength(5);
    expect(a.sourceDigest).toBe(b.sourceDigest);
    expect(a.candidates.map((x: any) => [x.description, x.unit, x.sourceQuantity])).toEqual([
      ["Concentrado ativado", "Tambor", 1], ["Detergente automotivo", "Galão", 20], ["Pano de microfibra", "UN", null],
      ["Cera líquida", "Litro", 35], ["Escova de cerdas", "UN", 1],
    ].sort((x, y) => (a.candidates.findIndex((c2: any) => c2.description === x[0]) - a.candidates.findIndex((c2: any) => c2.description === y[0]))));
    expect(a.counts).toMatchObject({ sourceItemCount: 5, newCandidateCount: 5, matchedCount: 0 });
  }, 60_000);

  it("2) confirmar ⇒ 5 Itens Canônicos (não 30); descrição/unidade herdadas; quantidade NÃO preenchida sozinha; replay/CONFLICT", async () => {
    const c = await caller(owner);
    const p = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    const decisions = p.candidates.map((x: any) => (
      x.description === "Concentrado ativado" ? { candidateKey: x.candidateKey, action: "create" as const, plannedQuantity: "35" }
        : x.description === "Cera líquida" ? { candidateKey: x.candidateKey, action: "create" as const, adoptSourceQuantity: true }
          : { candidateKey: x.candidateKey, action: "create" as const }));
    const input = { processId: pid, source: "price_research" as const, expectedSourceDigest: p.sourceDigest, decisions, idempotencyKey: `confirm-${pid}` };
    const r1 = await c.procurementItems.confirmCandidates(input);
    const r2 = await c.procurementItems.confirmCandidates(input); // retry idêntico → replay
    expect(r1.created).toHaveLength(5);
    expect(r2).toEqual(r1);
    await expect(c.procurementItems.confirmCandidates({ ...input, decisions: decisions.slice(0, 1) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(c.procurementItems.confirmCandidates({ ...input, idempotencyKey: `confirm2-${pid}` })).rejects.toMatchObject({ code: "CONFLICT" }); // projeção mudou (tudo vinculado)
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(5);
    expect(await count("SELECT COUNT(*) n FROM procurement_item_source_links WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(5);
    const again = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    expect(again.candidates.every((x: any) => x.match.status === "linked")).toBe(true);

    const w = await ws();
    itemIds = w.items.map((i: any) => i.id);
    expect(w.items.map((i: any) => [i.description, i.plannedQuantity.value])).toEqual([
      ["Concentrado ativado", 35], ["Detergente automotivo", null], ["Pano de microfibra", null], ["Cera líquida", 35], ["Escova de cerdas", null],
    ]);
    expect(byDesc(w, "Concentrado ativado").sources[0].sourceQuantity).toBe(1); // fonte = 1, necessidade = 35
    expect(byDesc(w, "Cera líquida").plannedQuantity.mode).toMatch(/^adopted_source/);
    expect(await count("SELECT COUNT(*) n FROM procurement_item_events WHERE organization_id = ? AND process_id = ? AND event_type = 'procurement_source_quantity_adopted'", [ORG, pid])).toBe(1);
  }, 60_000);

  it("3) parser perdeu um item: '+ Adicionar item' ⇒ 6 itens; Pesquisa continua com 5 (nenhum staging/cotação falso)", async () => {
    const c = await caller(owner);
    const stagingBefore = await count("SELECT COUNT(*) n FROM import_staging_items WHERE organization_id = ?", [ORG]).catch(() => 0);
    const input = { processId: pid, description: "Rodo de alumínio 60 cm", unit: "UN", plannedQuantity: "12", reason: "Item não identificado automaticamente no documento.", idempotencyKey: `manual-${pid}` };
    const r = await c.procurementItems.createManual(input);
    expect((await c.procurementItems.createManual(input)).itemId).toBe(r.itemId); // replay
    manualId = r.itemId;
    const w = await ws();
    expect(w.stats.itemCount).toBe(6);
    expect(byDesc(w, "Rodo de alumínio 60 cm")).toMatchObject({ origin: "manual", plannedQuantity: { value: 12 } });
    expect(byDesc(w, "Rodo de alumínio 60 cm").provenance.manual.reason).toMatch(/não identificado/);
    expect(await count("SELECT COUNT(*) n FROM intelligent_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(5);
    expect(await count("SELECT COUNT(*) n FROM import_staging_items WHERE organization_id = ?", [ORG]).catch(() => 0)).toBe(stagingBefore);
  }, 60_000);

  it("4) quantidades: 'Usar 20' explícito, 1 ≠ 50 coexistem; concorrência ⇒ só uma vence (STALE_REVISION)", async () => {
    const c = await caller(owner);
    let w = await ws();
    const det = byDesc(w, "Detergente automotivo");
    await c.procurementItems.setQuantities({ processId: pid, idempotencyKey: `adopt-${pid}`, changes: [{ itemId: det.id, expectedRevision: det.revision, mode: "adopt_source", sourceType: "price_research", sourceId: det.sources[0].sourceId }] });
    const esc = byDesc(w, "Escova de cerdas");
    await c.procurementItems.setQuantities({ processId: pid, idempotencyKey: `inform-${pid}`, changes: [{ itemId: esc.id, expectedRevision: esc.revision, mode: "informed", quantity: "50" }] });
    w = await ws();
    expect(byDesc(w, "Detergente automotivo").plannedQuantity.value).toBe(20);
    expect(byDesc(w, "Escova de cerdas")).toMatchObject({ plannedQuantity: { value: 50 }, sources: [{ sourceQuantity: 1 }] });

    const d2 = byDesc(w, "Detergente automotivo");
    const race = await Promise.allSettled([
      (await caller(owner)).procurementItems.setQuantities({ processId: pid, idempotencyKey: `race-a-${pid}`, changes: [{ itemId: d2.id, expectedRevision: d2.revision, mode: "informed", quantity: "25" }] }),
      (await caller(operator2)).procurementItems.setQuantities({ processId: pid, idempotencyKey: `race-b-${pid}`, changes: [{ itemId: d2.id, expectedRevision: d2.revision, mode: "informed", quantity: "30" }] }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((race.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    expect([25, 30]).toContain(byDesc(await ws(), "Detergente automotivo").plannedQuantity.value);
  }, 60_000);

  it("5) lotes: criar 01/02, distribuir, mover 01→02 mantém o MESMO id; código duplicado recusado; reordenar", async () => {
    const c = await caller(owner);
    const l1 = await c.procurementItems.createLot({ processId: pid, code: "01", name: "Materiais de limpeza", idempotencyKey: `lot1-${pid}` });
    const l2 = await c.procurementItems.createLot({ processId: pid, code: "02", name: "Produtos químicos", idempotencyKey: `lot2-${pid}` });
    await expect(c.procurementItems.createLot({ processId: pid, code: "Lote 1", name: "Dup", idempotencyKey: `lot3-${pid}` })).rejects.toMatchObject({ code: "CONFLICT" });
    let w = await ws();
    for (const it of w.items) {
      const lotId = ["Cera líquida", "Detergente automotivo"].includes(it.description) ? l2.lotId : l1.lotId;
      await c.procurementItems.assignLot({ processId: pid, itemId: it.id, expectedRevision: it.revision, lotId, idempotencyKey: `assign-${it.id}` });
    }
    w = await ws();
    expect(w.hasLots).toBe(true);
    expect(w.lots.map((l: any) => [l.code, l.itemCount])).toEqual([["01", 4], ["02", 2]]);
    const rodo = byDesc(w, "Rodo de alumínio 60 cm");
    await c.procurementItems.assignLot({ processId: pid, itemId: rodo.id, expectedRevision: rodo.revision, lotId: l2.lotId, idempotencyKey: `move-${rodo.id}` });
    w = await ws();
    expect(byDesc(w, "Rodo de alumínio 60 cm")).toMatchObject({ id: manualId, lotId: l2.lotId });
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(6);
    expect(await count("SELECT COUNT(*) n FROM procurement_item_events WHERE organization_id = ? AND item_id = ? AND event_type = 'procurement_item_moved_between_lots'", [ORG, manualId])).toBe(1);
    const lot2 = w.lots.find((l: any) => l.id === l2.lotId);
    await c.procurementItems.moveLot({ processId: pid, lotId: l2.lotId, expectedRevision: lot2.revision, direction: "up", idempotencyKey: `mvlot-${pid}` });
    expect((await ws()).lots.map((l: any) => l.code)).toEqual(["02", "01"]);
  }, 60_000);

  it("6) contexto canônico: 6 itens, 2 lotes, preço POR item (nunca média entre itens); estimativa só com previsto", async () => {
    const ctx = await resolveProcurementContext({ organizationId: ORG, processId: pid });
    expect(ctx.items).toHaveLength(6);
    expect(ctx.lots).toHaveLength(2);
    const conc = ctx.items.find((i) => i.description.value === "Concentrado ativado")!;
    expect(conc.priceContext.unitReferencePriceCents).toBe(45_000);
    expect(conc.estimatedTotalCents).toBe(35 * 45_000);
    const cera = ctx.items.find((i) => i.description.value === "Cera líquida")!;
    expect(cera.priceContext.unitReferencePriceCents).toBe(3_000);
    const pano = ctx.items.find((i) => i.description.value === "Pano de microfibra")!;
    expect(pano.plannedQuantity.value).toBeNull();
    expect(pano.priceContext.unitReferencePriceCents).toBeNull(); // evidência pendente de aprovação
    expect(ctx.priceContext.complete).toBe(false);
  }, 60_000);

  it("7) DFD criado depois consome os itens (coluna Lote, [a definir]); quantidade muda ⇒ desatualizado ⇒ reconciliar", async () => {
    const c = await caller(owner);
    const { document } = await c.procurementProcess.generateDFD({ processId: pid, idempotencyKey: `dfd-${pid}` });
    expect(document.content).toContain("| Lote | Item | Descrição | Unidade | Quantidade prevista |");
    expect(document.content).toMatch(/\| 01 \| \d+ \| Concentrado ativado \| Tambor \| 35 \|/);
    expect(document.content).toMatch(/\| 01 \| \d+ \| Pano de microfibra \| UN \| \[a definir\] \|/);
    let w = await ws();
    const esc = byDesc(w, "Escova de cerdas");
    await c.procurementItems.setQuantities({ processId: pid, idempotencyKey: `esc2-${pid}`, changes: [{ itemId: esc.id, expectedRevision: esc.revision, mode: "informed", quantity: "60" }] });
    const st = await c.procurementProcess.dfdAssistState({ processId: pid });
    expect(st.fields.find((f: any) => f.key === `item:${esc.id}`)).toMatchObject({ state: "stale", documentValue: "50", contextValue: "60" });
    const cur = (await c.procurementProcess.loadDFD({ processId: pid })).document!;
    await c.procurementProcess.reconcileDFDField({ processId: pid, fieldKey: `item:${esc.id}`, expectedContentHash: cur.contentHash, idempotencyKey: `rec-${pid}` });
    expect((await c.procurementProcess.loadDFD({ processId: pid })).document!.content).toMatch(/Escova de cerdas \| UN \| 60 \|/);
    w = await ws();
    expect(w.contextVersion).toBeGreaterThan(0);
  }, 60_000);

  it("8) DFD APROVADO consumiu o item ⇒ alterar quantidade/descrição exige alteração governada; definir 'a definir' é permitido", async () => {
    await conn.execute("UPDATE generated_documents SET status = 'aprovado' WHERE organization_id = ? AND process_id = ? AND kind = 'dfd'", [ORG, pid]);
    const c = await caller(owner);
    const w = await ws();
    const conc = byDesc(w, "Concentrado ativado");
    await expect(c.procurementItems.setQuantities({ processId: pid, idempotencyKey: `gov1-${pid}`, changes: [{ itemId: conc.id, expectedRevision: conc.revision, mode: "informed", quantity: "40" }] }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("GOVERNED_CHANGE_REQUIRED") });
    await expect(c.procurementItems.updateItem({ processId: pid, itemId: conc.id, expectedRevision: conc.revision, description: "Outro", idempotencyKey: `gov2-${pid}` }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const pano = byDesc(w, "Pano de microfibra");
    await c.procurementItems.setQuantities({ processId: pid, idempotencyKey: `gov3-${pid}`, changes: [{ itemId: pano.id, expectedRevision: pano.revision, mode: "informed", quantity: "100" }] });
    expect(byDesc(await ws(), "Pano de microfibra").plannedQuantity.value).toBe(100);
    expect((await c.procurementProcess.loadDFD({ processId: pid })).document!.content).toMatch(/Pano de microfibra \| UN \| \[a definir\] \|/); // aprovado intacto
    await conn.execute("UPDATE generated_documents SET status = 'rascunho' WHERE organization_id = ? AND process_id = ? AND kind = 'dfd'", [ORG, pid]);
  }, 60_000);

  it("9) tenant e RBAC: outro tenant não vê/edita; viewer só lê", async () => {
    const b = await caller(ownerB);
    await expect(b.procurementItems.workspace({ processId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.procurementItems.candidates({ processId: pid, source: "price_research" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.procurementItems.createManual({ processId: pid, description: "X", unit: "UN", idempotencyKey: "b1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.procurementItems.createLot({ processId: pid, code: "09", name: "X", idempotencyKey: "b2" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const v = await caller(viewer);
    const w = await v.procurementItems.workspace({ processId: pid });
    expect(w.stats.itemCount).toBe(6);
    await expect(v.procurementItems.setQuantities({ processId: pid, idempotencyKey: "v1", changes: [{ itemId: w.items[0].id, expectedRevision: w.items[0].revision, mode: "informed", quantity: "1" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(v.procurementItems.assignLot({ processId: pid, itemId: w.items[0].id, expectedRevision: w.items[0].revision, lotId: null, idempotencyKey: "v2" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ?", [ORG_B])).toBe(0);
  }, 60_000);

  it("10) migration 0306 replay-safe (reaplicar não falha nem duplica índices)", async () => {
    const sql = readFileSync(resolve(__dirname, "../../../drizzle/0306_canonical_procurement_items_lots.sql"), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint").map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean)) {
      await conn.query(stmt);
    }
    const [idx] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME t, COUNT(DISTINCT INDEX_NAME) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('procurement_items','procurement_lots','procurement_item_source_links','procurement_item_events') GROUP BY TABLE_NAME",
    );
    expect((idx as any[]).map((r) => [String(r.t), Number(r.n)]).sort((a, b) => (a[0] < b[0] ? -1 : 1))).toEqual([
      ["procurement_item_events", 2], ["procurement_item_source_links", 3], ["procurement_items", 3], ["procurement_lots", 3],
    ]);
    expect(itemIds).toHaveLength(5);
  }, 60_000);
});
