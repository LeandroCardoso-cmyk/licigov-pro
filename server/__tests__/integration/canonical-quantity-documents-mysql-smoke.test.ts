/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0.3 — quantidade da contratação com UMA fonte semântica, contra MySQL REAL (CI, modo estrito):
 *
 *   Processo → Pesquisa (quantidade da FONTE = 1 e 35) → Itens Canônicos (router real) → prevista ausente ⇒
 *   ETP gera com "[a definir]" (nunca 35) e Edital bloqueia (PLANNED_QUANTITY_REQUIRED) → prevista = 50/5 ⇒
 *   DFD, ETP, TR e Edital expressam 50; a Pesquisa continua com 1 → replay do Edital; 50 → 60 ⇒
 *   source_changed/CONFLICT e nova chave usa 60 → ETP APROVADO e Edital OFICIAL intactos; mudança exige
 *   alteração governada → processo legado preservado → tenant.
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode. Provider de IA = mock determinístico (nunca real).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument, generateNotice, getEditalSourceState, getAuthoringSourceState } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { resolveEditalSources } from "../../services/authoring/editalContext";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { draftContentHash } from "../../domain/generatedDocument";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991311;
const ORG_B = 991312;
const OBJ = "Material de limpeza";

let conn: mysql.Connection;
let owner = 0, emitter = 0, ownerB = 0;
let pid = "";

async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `cqd-smoke-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
async function insertUser(tag: string, name: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`cqd-smoke-${tag}-${Date.now()}`, name, `cqd-smoke-${tag}-${Date.now()}@teste.local`]);
  return r.insertId;
}
async function seedItem(processId: string, id: string, description: string, quantity: number, price: number) {
  const suppliers = Array.from({ length: 3 }, (_, i) => ({ name: `Fornecedor ${i + 1}`, value: price, quoteId: `${id}-q${i}`, researchId: "cqd-r" }));
  await conn.execute(
    `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
       suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
     VALUES (?, ?, ?, 'cqd-r', ?, ?, 'UN', ?, ?, NULL, '[]', '[]', '[]', '[]', 'aprovado', NULL, 'done', 'cqd-smoke')`,
    [`${id}-${ORG}`, ORG, processId, description, quantity, price.toFixed(2), JSON.stringify(suppliers)],
  );
}
async function row(processId: string, kind: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c, CAST(sources AS CHAR) AS s, status FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ? LIMIT 1",
    [ORG, processId, kind],
  );
  return rows.length ? { content: String((rows[0] as any).c), sources: String((rows[0] as any).s), status: String((rows[0] as any).status) } : null;
}
async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
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

const genDoc = (kind: "etp" | "tr", key: string, processId = pid) => generateDocument({
  organizationId: ORG, processId, kind, object: OBJ, correlationId: `cqd-${key}`, idempotencyKey: key, actorUserId: owner,
  invoke: async () => buildMockProviderAuthoring(kind),
});
const genEdital = (key: string, processId = pid) => generateNotice({
  organizationId: ORG, processId, object: OBJ, modality: "pregao", form: "eletronico", platform: "compras_gov",
  correlationId: `cqd-${key}`, idempotencyKey: key, actorUserId: owner, invoke: async () => buildMockProviderAuthoring("edital"),
});
const editalState = () => getEditalSourceState({ organizationId: ORG, processId: pid, object: OBJ, modality: "pregao", form: "eletronico", platform: "compras_gov" });
const ws = async () => (await caller(owner)).procurementItems.workspace({ processId: pid });
async function setPlanned(desc: string, quantity: string, key: string) {
  const it = (await ws()).items.find((i: any) => i.description === desc);
  return (await caller(owner)).procurementItems.setQuantities({ processId: pid, idempotencyKey: key, changes: [{ itemId: it.id, expectedRevision: it.revision, mode: "informed", quantity }] });
}

describe.skipIf(!DB)("P0.3 — quantidade PREVISTA como fonte única em DFD/ETP/TR/Edital (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura Qtd Docs"], [ORG_B, "Prefeitura Outra Qtd Docs"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `cqd-${id}`]);
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

  it("1) Pesquisa (fonte 1 e 35) → Itens Canônicos; sem prevista: ETP gera com [a definir] (nunca 35) e Edital bloqueia", async () => {
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `CQD-${Date.now()}`, object: OBJ, startOption: "iniciar_pesquisa" });
    pid = process.id;
    await seedItem(pid, "cqd-ii1", "Detergente neutro", 1, 100);
    await seedItem(pid, "cqd-ii2", "Sabão em pó", 35, 20);
    const c = await caller(owner);
    const p = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    await c.procurementItems.confirmCandidates({
      processId: pid, source: "price_research", expectedSourceDigest: p.sourceDigest, idempotencyKey: `cqd-confirm-${pid}`,
      decisions: p.candidates.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const })),
    });
    const etpCtx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: pid, kind: "etp", object: OBJ });
    expect(etpCtx.quantitySource).toBe("canonical_planned");
    expect(etpCtx.promptContext).toMatch(/Sabão em pó — quantidade prevista: \[a definir\]/);
    expect(etpCtx.promptContext).not.toMatch(/Sabão em pó — 35 UN/);
    await expect(genEdital(`cqd-ed-missing-${pid}`)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED", message: expect.stringContaining("PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista dos itens antes de gerar o Edital."),
    });
    const [k] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM idempotency_keys WHERE organizationId = ? AND `key` = ?", [ORG, `cqd-ed-missing-${pid}`]);
    expect(Number((k[0] as any).n)).toBe(0);
    expect(await row(pid, "edital")).toBeNull();
  }, 120_000);

  it("2) prevista 50/5 (fonte 1/35) ⇒ DFD, ETP, TR e Edital expressam 50; a Pesquisa continua com 1", async () => {
    await setPlanned("Detergente neutro", "50", `cqd-q50-${pid}`);
    await setPlanned("Sabão em pó", "5", `cqd-q5-${pid}`);
    const c = await caller(owner);
    const { document: dfd } = await c.procurementProcess.generateDFD({ processId: pid, idempotencyKey: `cqd-dfd-${pid}` });
    expect(dfd.content).toMatch(/\| \d+ \| Detergente neutro \| UN \| 50 \|/);
    await genDoc("etp", `cqd-etp1-${pid}`);
    expect((await row(pid, "etp"))!.sources).toContain("qtd:prevista");
    const etpCtx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: pid, kind: "etp", object: OBJ });
    expect(etpCtx.promptContext).toContain("Detergente neutro — 50 UN (quantidade prevista)");
    const tr = await genDoc("tr", `cqd-tr1-${pid}`);
    expect(tr.document.content).toMatch(/\| \d+ \| Detergente neutro \| 50 \| UN \| 100,00 \| 5\.000,00 \|/);
    const ed = await genEdital(`cqd-ed1-${pid}`);
    expect(ed.document.content).toMatch(/\| \d+ \| Detergente neutro \| 50 \| UN \| 100,00 \| 5\.000,00 \|/);
    expect(ed.document.content).toMatch(/\| \d+ \| Sabão em pó \| 5 \| UN \| 20,00 \| 100,00 \|/);
    expect(ed.document.content).toContain("**Valor estimado global:** R$ 5.100,00");
    for (const content of [dfd.content, tr.document.content, ed.document.content]) {
      expect(content).not.toMatch(/Detergente neutro \| 1 \|/);
      expect(content).not.toMatch(/Sabão em pó \| 35 \|/);
    }
    const [ii] = await conn.execute<mysql.RowDataPacket[]>("SELECT quantity q FROM intelligent_items WHERE id = ?", [`cqd-ii1-${ORG}`]);
    expect(Number((ii[0] as any).q)).toBe(1); // evidência da Pesquisa intacta
  }, 180_000);

  it("3) Edital: replay (mesma chave+contexto); 50 → 60 ⇒ source_changed, mesma chave ⇒ CONFLICT, nova chave ⇒ 60", async () => {
    const again = await genEdital(`cqd-ed1-${pid}`);
    expect(again.replayed).toBe(true);
    expect((await editalState()).state).toBe("current");
    await setPlanned("Detergente neutro", "60", `cqd-q60-${pid}`);
    expect((await editalState()).state).toBe("source_changed");
    expect((await getAuthoringSourceState({ organizationId: ORG, processId: pid, kind: "etp", object: OBJ })).state).toBe("source_changed");
    await expect(genEdital(`cqd-ed1-${pid}`)).rejects.toMatchObject({ code: "CONFLICT" });
    const r = await genEdital(`cqd-ed2-${pid}`);
    expect(r.document.content).toMatch(/\| \d+ \| Detergente neutro \| 60 \| UN \| 100,00 \| 6\.000,00 \|/);
  }, 180_000);

  it("4) ETP APROVADO e Edital OFICIAL não mudam; mudar a quantidade já consumida exige alteração governada", async () => {
    await genDoc("etp", `cqd-etp2-${pid}`); // novo draft do ETP com 60
    await conn.execute("UPDATE generated_documents SET status = 'aprovado' WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    const etpBefore = (await row(pid, "etp"))!;
    await expect(setPlanned("Detergente neutro", "70", `cqd-q70-${pid}`))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("GOVERNED_CHANGE_REQUIRED") });
    const edBefore = (await row(pid, "edital"))!;
    await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "edital", actorUserId: emitter, actorRole: "manager",
      idempotencyKey: `cqd-emit-${pid}`, correlationId: "cqd-emit", expectedContentHash: draftContentHash(edBefore.content),
    });
    await expect(setPlanned("Sabão em pó", "8", `cqd-q8-${pid}`))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("GOVERNED_CHANGE_REQUIRED") });
    expect((await row(pid, "etp"))!.content).toBe(etpBefore.content);
    expect((await row(pid, "edital"))!.content).toBe(edBefore.content);
    expect((await ws()).items.find((i: any) => i.description === "Detergente neutro").plannedQuantity.value).toBe(60);
  }, 180_000);

  it("5) legado (sem Itens da contratação): ETP e Edital seguem com o comportamento anterior", async () => {
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `CQDL-${Date.now()}`, object: OBJ, startOption: "iniciar_pesquisa" });
    await seedItem(process.id, "cqd-leg1", "Vassoura", 3, 25);
    const etpCtx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: process.id, kind: "etp", object: OBJ });
    expect(etpCtx.quantitySource).toBe("legacy");
    expect(etpCtx.promptContext).toContain("Vassoura — 3 UN");
    const ed = await genEdital(`cqd-ed-legacy-${process.id}`, process.id);
    expect(ed.document.content).toMatch(/\| \d+ \| Vassoura \| 3 \| UN \| 25,00 \| 75,00 \|/);
    expect((await row(process.id, "edital"))!.sources).not.toContain("qtd:prevista");
  }, 180_000);

  it("6) tenant: outro órgão não usa Itens da contratação nem quantidades do processo no ETP/Edital", async () => {
    const etpB = await resolveDocumentAuthoringContext({ organizationId: ORG_B, processId: pid, kind: "etp", object: OBJ });
    const edB = await resolveEditalSources({ organizationId: ORG_B, processId: pid, object: OBJ, modality: "pregao", form: "eletronico", platform: "compras_gov" });
    for (const ctx of [etpB, edB]) {
      expect(ctx.quantitySource).toBe("legacy");
      expect(ctx.canonical).toBeNull();
      expect(ctx.promptContext).not.toContain("Detergente neutro");
    }
  }, 120_000);
});
