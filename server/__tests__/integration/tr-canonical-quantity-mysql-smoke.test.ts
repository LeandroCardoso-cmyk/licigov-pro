/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0.1 — TR × Itens da contratação contra MySQL REAL (CI, modo estrito):
 *
 *   Processo → Pesquisa de Preços (quantidade da FONTE = 1) → Itens Canônicos (router real) → TR sem
 *   quantidade prevista ⇒ PLANNED_QUANTITY_REQUIRED (nenhuma reserva de idempotência) → Item Inteligente
 *   aprovado sem vínculo ⇒ PRICE_RESEARCH_ITEM_UNLINKED → prevista = 50 ⇒ TR com Qtd 50 e total 50 × preço
 *   → replay (mesma chave+quantidade) → prevista 60 ⇒ source_changed; mesma chave ⇒ CONFLICT; nova chave ⇒ 60
 *   → TR OFICIAL (SoD) ⇒ mudar quantidade exige alteração governada; oficial intacto → legado preservado →
 *   tenant.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode. Provider de IA = mock determinístico (nunca real).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { governedResearchId, GOVERNED_RESEARCH_TABLES, forgetGovernedResearch } from "../helpers/governedPriceResearch";
import { generateDocument, getAuthoringSourceState } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { draftContentHash } from "../../domain/generatedDocument";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991309;
const ORG_B = 991310;

let conn: mysql.Connection;
let owner = 0, emitter = 0, ownerB = 0;
let pid = "";
let legacyPid = "";

async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `tr-qty-smoke-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

async function insertUser(tag: string, name: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`tr-qty-smoke-${tag}-${Date.now()}`, name, `tr-qty-smoke-${tag}-${Date.now()}@teste.local`]);
  return r.insertId;
}

async function seedItem(processId: string, id: string, description: string, unit: string, quantity: number, price: number, status = "aprovado") {
  const rid = await governedResearchId(conn, ORG, processId, owner);
  const suppliers = Array.from({ length: 3 }, (_, i) => ({ name: `Fornecedor ${i + 1}`, value: price, quoteId: `${id}-q${i}`, researchId: rid }));
  await conn.execute(
    `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
       suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', '[]', '[]', '[]', ?, NULL, 'done', 'tr-qty-smoke')`,
    [`${id}-${ORG}`, ORG, processId, rid, description, quantity, unit, price.toFixed(2), JSON.stringify(suppliers), status],
  );
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function trRow(processId: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c, CAST(sources AS CHAR) AS s, status FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'tr' LIMIT 1",
    [ORG, processId],
  );
  return rows.length ? { content: String((rows[0] as any).c), sources: String((rows[0] as any).s), status: String((rows[0] as any).status) } : null;
}

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    forgetGovernedResearch(org);
    for (const [t, col] of [
      ...GOVERNED_RESEARCH_TABLES,
      ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"],
      ["generated_documents", "organization_id"], ["process_timeline", "organization_id"], ["intelligent_items", "organization_id"],
      ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

const gen = (key: string, processId = pid, org = ORG, actor = owner) => generateDocument({
  organizationId: org, processId, kind: "tr", object: "Material de limpeza", correlationId: `trq-${key}`,
  idempotencyKey: key, actorUserId: actor, invoke: async () => buildMockProviderAuthoring("tr"),
});
const ws = async () => (await caller(owner)).procurementItems.workspace({ processId: pid });
const byDesc = (w: any, d: string) => w.items.find((i: any) => i.description === d);
async function setPlanned(desc: string, quantity: string, key: string) {
  const it = byDesc(await ws(), desc);
  return (await caller(owner)).procurementItems.setQuantities({ processId: pid, idempotencyKey: key, changes: [{ itemId: it.id, expectedRevision: it.revision, mode: "informed", quantity }] });
}

describe.skipIf(!DB)("P0.1 — TR usa a quantidade PREVISTA dos Itens da contratação (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura TR Qtd"], [ORG_B, "Prefeitura Outra TR Qtd"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `trq-${id}`]);
    }
    owner = await insertUser("owner", "Servidora Responsável");
    emitter = await insertUser("emitter", "Gestora Emissora");
    ownerB = await insertUser("ownerb", "Outro Tenant");
    for (const [org, u, role] of [[ORG, owner, "owner"], [ORG, emitter, "manager"], [ORG_B, ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM users WHERE id IN (?, ?, ?)", [owner, emitter, ownerB]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("1) Pesquisa (fonte = 1) → Itens Canônicos; TR sem prevista ⇒ PLANNED_QUANTITY_REQUIRED, sem reservar idempotência", async () => {
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `TRQ-${Date.now()}`, object: "Material de limpeza", startOption: "iniciar_pesquisa" });
    pid = process.id;
    await seedItem(pid, "trq-ii1", "Detergente neutro", "UN", 1, 100);
    await seedItem(pid, "trq-ii2", "Sabão em pó", "UN", 7, 20);
    const c = await caller(owner);
    const p = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    await c.procurementItems.confirmCandidates({
      processId: pid, source: "price_research", expectedSourceDigest: p.sourceDigest, idempotencyKey: `trq-confirm-${pid}`,
      decisions: p.candidates.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const })),
    });
    const w = await ws();
    expect(w.items.map((i: any) => [i.description, i.plannedQuantity.value, i.sources[0].sourceQuantity])).toEqual([
      ["Detergente neutro", null, 1], ["Sabão em pó", null, 7],
    ]);
    await expect(gen(`trq-missing-${pid}`)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista do item antes de gerar o Termo de Referência"),
    });
    expect(await count("SELECT COUNT(*) n FROM idempotency_keys WHERE organizationId = ? AND `key` = ?", [ORG, `trq-missing-${pid}`])).toBe(0);
    expect(await trRow(pid)).toBeNull();
  }, 120_000);

  it("2) Item Inteligente aprovado SEM vínculo ⇒ PRICE_RESEARCH_ITEM_UNLINKED (nunca presumido como necessidade, nenhum vínculo criado)", async () => {
    await setPlanned("Detergente neutro", "50", `trq-q50-${pid}`);
    await setPlanned("Sabão em pó", "5", `trq-q5-${pid}`);
    await seedItem(pid, "trq-ii3", "Desinfetante", "UN", 12, 50);
    const links = await count("SELECT COUNT(*) n FROM procurement_item_source_links WHERE organization_id = ? AND process_id = ?", [ORG, pid]);
    await expect(gen(`trq-unlinked-${pid}`)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PRICE_RESEARCH_ITEM_UNLINKED") });
    expect(await count("SELECT COUNT(*) n FROM procurement_item_source_links WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(links);
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(2);
    await conn.execute("UPDATE intelligent_items SET status = 'pendente' WHERE id = ?", [`trq-ii3-${ORG}`]);
  }, 120_000);

  it("3) prevista = 50 (fonte = 1) ⇒ TR com Qtd 50 × R$ 100 = R$ 5.000 por item; replay com a mesma chave+quantidade", async () => {
    const r1 = await gen(`trq-k1-${pid}`);
    expect(r1.replayed).toBe(false);
    const content = r1.document.content;
    expect(content).toMatch(/\| \d+ \| Detergente neutro \| 50 \| UN \| 100,00 \| 5\.000,00 \|/);
    expect(content).toMatch(/\| \d+ \| Sabão em pó \| 5 \| UN \| 20,00 \| 100,00 \|/);
    expect(content).toContain("**Valor estimado global:** R$ 5.100,00");
    expect(content).toContain("Qtd. prevista");
    expect(content).not.toMatch(/\| Detergente neutro \| 1 \| UN \|/);
    expect(content).not.toMatch(/\| Sabão em pó \| 7 \| UN \|/);
    expect((await trRow(pid))!.sources).toContain("qtd:prevista");
    const r2 = await gen(`trq-k1-${pid}`);
    expect(r2.replayed).toBe(true);
    expect(r2.document.content).toBe(content);
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Material de limpeza" })).state).toBe("current");
  }, 120_000);

  it("4) prevista 50 → 60 ⇒ source_changed; mesma chave ⇒ CONFLICT; nova chave ⇒ quadro com 60 (R$ 6.000)", async () => {
    await setPlanned("Detergente neutro", "60", `trq-q60-${pid}`);
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "tr", object: "Material de limpeza" })).state).toBe("source_changed");
    await expect(gen(`trq-k1-${pid}`)).rejects.toMatchObject({ code: "CONFLICT" });
    const r = await gen(`trq-k2-${pid}`);
    expect(r.document.content).toMatch(/\| \d+ \| Detergente neutro \| 60 \| UN \| 100,00 \| 6\.000,00 \|/);
    expect(r.document.content).toContain("**Valor estimado global:** R$ 6.100,00");
  }, 120_000);

  it("5) TR OFICIAL (SoD: terceiro manager) ⇒ mudar quantidade exige alteração governada; oficial e rascunho intactos", async () => {
    const before = (await trRow(pid))!;
    await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "tr", actorUserId: emitter, actorRole: "manager",
      idempotencyKey: `trq-emit-${pid}`, correlationId: "trq-emit", expectedContentHash: draftContentHash(before.content),
    });
    expect(await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ? AND process_id = ? AND document_kind = 'tr'", [ORG, pid])).toBe(1);
    await expect(setPlanned("Detergente neutro", "70", `trq-q70-${pid}`))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("GOVERNED_CHANGE_REQUIRED") });
    expect(byDesc(await ws(), "Detergente neutro").plannedQuantity.value).toBe(60);
    expect((await trRow(pid))!.content).toBe(before.content); // nenhuma mutação automática do TR
  }, 120_000);

  it("6) legado (processo SEM Itens da contratação) ⇒ gate determinístico mantém o TR histórico (quantidade da cotação)", async () => {
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `TRQL-${Date.now()}`, object: "Material de limpeza", startOption: "iniciar_pesquisa" });
    legacyPid = process.id;
    await seedItem(legacyPid, "trq-leg1", "Vassoura", "UN", 3, 25);
    const r = await gen(`trq-legacy-${legacyPid}`, legacyPid);
    expect(r.document.content).toMatch(/\| \d+ \| Vassoura \| 3 \| UN \| 25,00 \| 75,00 \|/);
    expect(r.document.content).not.toContain("Qtd. prevista");
    expect((await trRow(legacyPid))!.sources).not.toContain("qtd:prevista");
  }, 120_000);

  it("7) tenant: outro órgão não vê itens, quantidades nem o contexto canônico do processo", async () => {
    await expect((await caller(ownerB)).procurementItems.workspace({ processId: pid })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ctxB = await resolveDocumentAuthoringContext({ organizationId: ORG_B, processId: pid, kind: "tr", object: "Material de limpeza" });
    expect(ctxB.quantitySource).toBe("legacy");
    expect(ctxB.canonical).toBeNull();
    expect(ctxB.estimate.itemCount).toBe(0);
    expect(ctxB.promptContext).not.toContain("Detergente neutro");
  }, 120_000);
});
