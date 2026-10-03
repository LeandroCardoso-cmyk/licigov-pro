/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R9 / SEM-049, SEM-055, SEM-067, SEM-068, SEM-069 — Itens da contratação contra MySQL 8 REAL, pelo ROUTER real
 * (órgãos sintéticos 960490/960491):
 *
 *   S1 (SEM-068) DFD com duas linhas IDÊNTICAS ⇒ dois candidatos, confirmar cria DOIS itens (sem DUPLICATE_DECISION);
 *      chaves persistidas com ordinal; nada é reproposto depois.
 *   S2 (SEM-049) quantidade do Item Inteligente muda depois do vínculo ⇒ workspace mostra vínculo × atual; "Usar N" sem
 *      confirmar o valor atual ⇒ CONFLICT SOURCE_QUANTITY_CHANGED (nada adotado); confirmando o atual ⇒ adota o ATUAL.
 *      (No DFD, a quantidade da linha já alimenta o contexto canônico diretamente; o vínculo × atual é exibido igual.)
 *   S3 (SEM-055) "Usar N" sobre prevista já definida ⇒ REPLACE_CONFIRMATION_REQUIRED; com confirmReplace ⇒ substitui.
 *   S4 (SEM-069) item retirado volta como candidato SINALIZADO; confirmar ⇒ PRECONDITION_FAILED ITEM_PREVIOUSLY_WITHDRAWN
 *      (antes: no-op reportado como sucesso); o item segue retirado, nada é criado.
 *   S5 (SEM-067) arquivar libera o código (code_key renomeado na mesma transação); recriar "01" funciona; arquivado
 *      LEGADO (código ainda reservado) é liberado na criação; lote da fonte com código de arquivado ⇒ lote NOVO, item
 *      nunca aponta para o arquivado.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { governedResearchId, GOVERNED_RESEARCH_TABLES, forgetGovernedResearch } from "../helpers/governedPriceResearch";

const DB = process.env.DATABASE_URL;
const ORG = 960490;
const ORG_B = 960491;

let conn: mysql.Connection;
let owner = 0;
let pid = "";
let pidQ = "";
const iiId = `r9-ii-${ORG}`;

async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {}, correlationId: `r9-items-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params as any[]);
  return Number((rows[0] as any).n);
}

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    forgetGovernedResearch(org);
    for (const [t, col] of [
      ...GOVERNED_RESEARCH_TABLES,
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"],
      ["generated_documents", "organization_id"], ["process_timeline", "organization_id"], ["intelligent_items", "organization_id"],
      ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

const TABLE = (rows: string[], withLot = false) => [
  withLot ? "| Lote | Item | Descrição | Unidade | Quantidade prevista |" : "| Item | Descrição | Unidade | Quantidade prevista |",
  withLot ? "|---|---|---|---|---|" : "|---|---|---|---|",
  ...rows,
];

/** Gera o DFD do processo e troca a seção 4 pela tabela informada (via router: loadDFD → saveDFD). */
async function setDFDTable(processId: string, rows: string[], withLot = false, key = `t-${Math.random()}`) {
  const c = await caller(owner);
  let cur = (await c.procurementProcess.loadDFD({ processId })).document;
  if (!cur) {
    await c.procurementProcess.generateDFD({ processId, idempotencyKey: `gen-${processId}` });
    cur = (await c.procurementProcess.loadDFD({ processId })).document!;
  }
  const lines = cur.content.split("\n");
  const start = lines.findIndex((l) => /^## 4\./.test(l));
  const end = lines.findIndex((l, i) => i > start && /^Memória de cálculo/.test(l));
  const content = [...lines.slice(0, start + 1), ...TABLE(rows, withLot), ...lines.slice(end)].join("\n");
  await c.procurementProcess.saveDFD({ processId, content, expectedContentHash: cur.contentHash, idempotencyKey: key });
}

const ws = async (processId = pid) => (await caller(owner)).procurementItems.workspace({ processId });

describe.skipIf(!DB)("R9 / SEM-049, 055, 067, 068, 069 — Itens da contratação (MySQL 8)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "Prefeitura R9 Itens", `r9-items-${ORG}`]);
    const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
      [`r9-items-owner-${Date.now()}`, "Servidora R9", `r9-items-owner-${Date.now()}@teste.local`]);
    owner = r.insertId;
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG, owner]);
    const { process } = await (await caller(owner)).procurementProcess.createProcess({ processNumber: `R9I-${Date.now()}`, object: "Material de limpeza", startOption: "criar_dfd" });
    pid = process.id;
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM users WHERE id = ?", [owner]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("S1) SEM-068: duas linhas IDÊNTICAS do DFD ⇒ dois candidatos e dois itens; nada reproposto depois", async () => {
    await setDFDTable(pid, ["| 1 | Detergente neutro | UN | 10 |", "| 2 | Detergente neutro | UN | 10 |", "| 3 | Sabão em pó | Kg | 40 |"], false, `s1-${pid}`);
    const c = await caller(owner);
    const p = await c.procurementItems.candidates({ processId: pid, source: "dfd" });
    expect(p.candidates.map((x: any) => x.description)).toEqual(["Detergente neutro", "Detergente neutro", "Sabão em pó"]);
    expect(new Set(p.candidates.map((x: any) => x.candidateKey)).size).toBe(3);
    const r = await c.procurementItems.confirmCandidates({
      processId: pid, source: "dfd", expectedSourceDigest: p.sourceDigest, idempotencyKey: `s1c-${pid}`,
      decisions: p.candidates.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const })),
    });
    expect(r.created).toHaveLength(3);
    expect(r.alreadyPresent).toEqual([]);
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ? AND description = 'Detergente neutro'", [ORG, pid])).toBe(2);
    const [keys] = await conn.execute<mysql.RowDataPacket[]>("SELECT source_item_key k FROM procurement_item_source_links WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, pid]);
    expect((keys as any[]).map((k) => String(k.k))).toEqual([expect.stringMatching(/#r1:$/), expect.stringMatching(/#r2:$/), expect.stringMatching(/#r3:$/)]);
    expect((await c.procurementItems.candidates({ processId: pid, source: "dfd" })).candidates).toHaveLength(0);
    expect((await ws()).sources.dfdRows).toBe(0);
  }, 120_000);

  it("S2) SEM-049: quantidade do Item Inteligente mudou após o vínculo ⇒ vínculo × atual; sem confirmar o atual ⇒ SOURCE_QUANTITY_CHANGED; confirmando ⇒ adota o ATUAL", async () => {
    const c = await caller(owner);
    const { process: p3 } = await c.procurementProcess.createProcess({ processNumber: `R9Q-${Date.now()}`, object: "Detergente automotivo", startOption: "iniciar_pesquisa" });
    pidQ = p3.id;
    const rid = await governedResearchId(conn, ORG, pidQ, owner);
    await conn.execute(
      `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
         suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
       VALUES (?, ?, ?, ?, 'Detergente automotivo', 20, 'Galão', '80.00', ?, NULL, '[]', '[]', '[]', '[]', 'aprovado', ?, 'done', 'r9-items')`,
      [iiId, ORG, pidQ, rid, JSON.stringify([{ name: "Fornecedor 1", value: 80, quoteId: "q1", researchId: rid }]), owner],
    );
    const cand = await c.procurementItems.candidates({ processId: pidQ, source: "price_research" });
    expect(cand.candidates).toHaveLength(1);
    await c.procurementItems.confirmCandidates({
      processId: pidQ, source: "price_research", expectedSourceDigest: cand.sourceDigest, idempotencyKey: `s2conf-${pidQ}`,
      decisions: [{ candidateKey: cand.candidates[0].candidateKey, action: "create" as const }],
    });
    // a fonte muda DEPOIS do vínculo (vínculo congelado em 20)
    await conn.execute("UPDATE intelligent_items SET quantity = 25 WHERE id = ? AND organization_id = ?", [iiId, ORG]);
    let w = await ws(pidQ);
    const det = w.items[0];
    expect(det.sources[0]).toMatchObject({ sourceType: "price_research", sourceQuantity: 20, currentQuantity: 25, sourceFound: true });
    const base = { itemId: det.id, expectedRevision: det.revision, mode: "adopt_source" as const, sourceType: "price_research" as const, sourceId: iiId };
    await expect(c.procurementItems.setQuantities({ processId: pidQ, idempotencyKey: `s2a-${pidQ}`, changes: [base] }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/SOURCE_QUANTITY_CHANGED.*vínculo: 20; atual: 25/) });
    await expect(c.procurementItems.setQuantities({ processId: pidQ, idempotencyKey: `s2b-${pidQ}`, changes: [{ ...base, expectedSourceQuantity: 20 }] }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("SOURCE_QUANTITY_CHANGED") });
    w = await ws(pidQ);
    expect(w.items[0].plannedQuantity.value).toBeNull(); // nada adotado em silêncio (antes: adotava 20, valor velho)
    await c.procurementItems.setQuantities({ processId: pidQ, idempotencyKey: `s2c-${pidQ}`, changes: [{ ...base, expectedSourceQuantity: 25 }] });
    w = await ws(pidQ);
    expect(w.items[0].plannedQuantity).toMatchObject({ value: 25, mode: "adopted_source" });
    const [ev] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT details_json d FROM procurement_item_events WHERE organization_id = ? AND item_id = ? AND event_type = 'procurement_source_quantity_adopted'", [ORG, det.id]);
    expect(JSON.parse(String((ev as any[])[0].d))).toMatchObject({ linked: 20, observed: 25, adopted: 25, replaced: false });
  }, 120_000);

  it("S3) SEM-055: 'Usar N' sobre prevista já definida exige confirmação explícita da substituição", async () => {
    await conn.execute("UPDATE intelligent_items SET quantity = 30 WHERE id = ? AND organization_id = ?", [iiId, ORG]);
    const det = (await ws(pidQ)).items[0];
    expect(det.plannedQuantity.value).toBe(25);
    const c = await caller(owner);
    const base = { itemId: det.id, expectedRevision: det.revision, mode: "adopt_source" as const, sourceType: "price_research" as const, sourceId: iiId, expectedSourceQuantity: 30 };
    await expect(c.procurementItems.setQuantities({ processId: pidQ, idempotencyKey: `s3a-${pidQ}`, changes: [base] }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("REPLACE_CONFIRMATION_REQUIRED") });
    expect((await ws(pidQ)).items[0].plannedQuantity.value).toBe(25);
    await c.procurementItems.setQuantities({ processId: pidQ, idempotencyKey: `s3b-${pidQ}`, changes: [{ ...base, confirmReplace: true }] });
    expect((await ws(pidQ)).items[0].plannedQuantity.value).toBe(30);
  }, 120_000);

  it("S4) SEM-069: reincluir item retirado ⇒ candidato sinalizado e recusa explícita (nunca no-op 'sucesso')", async () => {
    const c = await caller(owner);
    const twins = (await ws()).items.filter((i: any) => i.description === "Detergente neutro");
    expect(twins).toHaveLength(2);
    await c.procurementItems.withdrawItem({ processId: pid, itemId: twins[1].id, expectedRevision: twins[1].revision, reason: "Duplicado por engano", idempotencyKey: `s4w-${pid}` });
    const p = await c.procurementItems.candidates({ processId: pid, source: "dfd" });
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]).toMatchObject({ description: "Detergente neutro", withdrawnItemId: twins[1].id });
    const itemsBefore = await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ?", [ORG, pid]);
    await expect(c.procurementItems.confirmCandidates({
      processId: pid, source: "dfd", expectedSourceDigest: p.sourceDigest, idempotencyKey: `s4c-${pid}`,
      decisions: [{ candidateKey: p.candidates[0].candidateKey, action: "create" as const }],
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("ITEM_PREVIOUSLY_WITHDRAWN") });
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(itemsBefore);
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE id = ? AND status = 'withdrawn'", [twins[1].id])).toBe(1);
    // a recusa não deixou a chave de idempotência "concluída": um retry recebe a MESMA recusa, não um replay de sucesso
    await expect(c.procurementItems.confirmCandidates({
      processId: pid, source: "dfd", expectedSourceDigest: p.sourceDigest, idempotencyKey: `s4c-${pid}`,
      decisions: [{ candidateKey: p.candidates[0].candidateKey, action: "create" as const }],
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, 120_000);

  it("S5) SEM-067: arquivar libera o código; arquivado legado é liberado; lote da fonte nunca vira pertencimento a arquivado", async () => {
    const c = await caller(owner);
    // (a) arquivar ⇒ code_key renomeado na mesma transação; recriar "01" funciona com id NOVO
    const l1 = await c.procurementItems.createLot({ processId: pid, code: "01", name: "Limpeza", idempotencyKey: `s5l1-${pid}` });
    await c.procurementItems.archiveLot({ processId: pid, lotId: l1.lotId, expectedRevision: 1, reason: "Reestruturação", idempotencyKey: `s5a1-${pid}` });
    const [arch] = await conn.execute<mysql.RowDataPacket[]>("SELECT code, code_key k, status FROM procurement_lots WHERE id = ?", [l1.lotId]);
    expect((arch as any[])[0]).toMatchObject({ code: "01", k: `1~${l1.lotId}`, status: "archived" });
    const l1b = await c.procurementItems.createLot({ processId: pid, code: "Lote 1", name: "Limpeza (novo)", idempotencyKey: `s5l1b-${pid}` });
    expect(l1b.lotId).not.toBe(l1.lotId);
    expect((await ws()).lots.map((l: any) => [l.id, l.code])).toEqual([[l1b.lotId, "Lote 1"]]);
    // (b) arquivado LEGADO (anterior à correção, ainda com code_key "7") é liberado ao criar "07"
    const legacyId = "7".repeat(24);
    await conn.execute(
      "INSERT INTO procurement_lots (id, organization_id, process_id, code, code_key, name, ordinal, status, revision, created_by, updated_by) VALUES (?, ?, ?, '07', '7', 'Legado', 99, 'archived', 1, ?, ?)",
      [legacyId, ORG, pid, owner, owner]);
    const l7 = await c.procurementItems.createLot({ processId: pid, code: "07", name: "Sete", idempotencyKey: `s5l7-${pid}` });
    expect(l7.lotId).not.toBe(legacyId);
    expect(await count("SELECT COUNT(*) n FROM procurement_lots WHERE id = ? AND code_key = ?", [legacyId, `7~${legacyId}`])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM procurement_item_events WHERE organization_id = ? AND lot_id = ? AND event_type = 'procurement_lot_code_released'", [ORG, legacyId])).toBe(1);

    // (c) candidatos com lote da fonte: lote "05" criado pela fonte, esvaziado e arquivado; nova linha "05" ⇒ lote NOVO
    const { process: p2 } = await c.procurementProcess.createProcess({ processNumber: `R9L-${Date.now()}`, object: "Químicos", startOption: "criar_dfd" });
    await setDFDTable(p2.id, ["| 05 | 1 | Cloro | L | 3 |"], true, `s5d1-${p2.id}`);
    let cand = await c.procurementItems.candidates({ processId: p2.id, source: "dfd" });
    const r1 = await c.procurementItems.confirmCandidates({
      processId: p2.id, source: "dfd", expectedSourceDigest: cand.sourceDigest, idempotencyKey: `s5c1-${p2.id}`,
      decisions: cand.candidates.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const, lot: { kind: "source" as const } })),
    });
    const srcLot = r1.lotsCreated[0];
    let w2 = await ws(p2.id);
    const cloro = w2.items[0];
    await c.procurementItems.assignLot({ processId: p2.id, itemId: cloro.id, expectedRevision: cloro.revision, lotId: null, idempotencyKey: `s5u-${p2.id}` });
    await c.procurementItems.archiveLot({ processId: p2.id, lotId: srcLot, expectedRevision: (await ws(p2.id)).lots[0].revision, reason: "Sem itens", idempotencyKey: `s5a5-${p2.id}` });
    await setDFDTable(p2.id, ["| — | 1 | Cloro | L | 3 |", "| 05 | 2 | Rodo | UN | 1 |"], true, `s5d2-${p2.id}`);
    cand = await c.procurementItems.candidates({ processId: p2.id, source: "dfd" });
    const rodoCand = cand.candidates.find((x: any) => x.description === "Rodo")!;
    expect(rodoCand.sourceLotId).toBeNull(); // arquivado nunca é o "lote da fonte"
    const r2 = await c.procurementItems.confirmCandidates({
      processId: p2.id, source: "dfd", expectedSourceDigest: cand.sourceDigest, idempotencyKey: `s5c2-${p2.id}`,
      decisions: cand.candidates.map((x: any) => x.description === "Rodo"
        ? { candidateKey: x.candidateKey, action: "create" as const, lot: { kind: "source" as const } }
        : { candidateKey: x.candidateKey, action: "skip" as const }),
    });
    expect(r2.created).toHaveLength(1);
    expect(r2.lotsCreated).toHaveLength(1);
    expect(r2.lotsCreated[0]).not.toBe(srcLot);
    w2 = await ws(p2.id);
    expect(w2.lots.map((l: any) => [l.id, l.code, l.itemCount])).toEqual([[r2.lotsCreated[0], "05", 1]]);
    expect(await count("SELECT COUNT(*) n FROM procurement_items WHERE organization_id = ? AND process_id = ? AND lot_id = ?", [ORG, p2.id, srcLot])).toBe(0);
  }, 180_000);
});
