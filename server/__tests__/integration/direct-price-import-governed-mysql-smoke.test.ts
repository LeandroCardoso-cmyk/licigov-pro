/**
 * R2 / PR-04A — LEG-014 / FCC-01 (P0, classe SEM-005) — importação GOVERNADA da Pesquisa de Preços da
 * Contratação Direta contra MySQL REAL. Só roda com DATABASE_URL.
 *
 * Problema reproduzido na main pré-fix: `directProcurement.importPriceResearch` (tenantProcedure — viewer
 * escrevia) derivava o id da pesquisa de (org, workspace, fonte) e o da cotação de (org, pesquisa, índice,
 * descrição) e fazia UPSERT fora de transação ⇒ uma 2ª colagem SOBRESCREVIA as cotações da 1ª (o fornecedor
 * A sumia, a média era recalculada com 1 cotação).
 *
 * Matriz (via appRouter.createCaller + x-organization-id, membership real):
 *  T1  nova importação; T2 replay idêntico converge (sem duplicar pesquisa/cotações/eventos);
 *  T3  mesma chave + payload diferente ⇒ CONFLICT; T4 duas importações diferentes coexistem;
 *  T5  nenhuma sobrescreve a outra (fornecedores A e B presentes, cotações da 1ª intactas);
 *  DEDUP mesmo conteúdo sob NOVA chave ⇒ converge para a importação existente (sem escrita/evento);
 *  T6  workspace de outro órgão ⇒ NOT_FOUND neutro, zero escrita; T7 viewer negado, zero escrita;
 *  T8  operator permitido; T9 concorrência (mesma chave ⇒ exatamente 1 importação; chaves diferentes com o
 *      mesmo conteúdo ⇒ exatamente 1 importação); T10 rollback atômico em falha forçada (trigger TEMPORÁRIO
 *      do banco de teste, removido no teardown); T11 linhagem; T12 evento de auditoria persistido;
 *  T13 contentHash recomputável das cotações persistidas; T14 retry após falha local sucede exatamente 1 vez.
 * T15 (sem regressão do Processo Licitatório) = os smokes canônicos existentes seguem verdes (gate da suíte).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { planDirectPriceImport, computeDirectPriceImportContentHash } from "../../domain/directPriceImport";

const DB = process.env.DATABASE_URL;
const TRIGGER = "pr04a_fail_direct_price_import_event";

describe.skipIf(!DB)("PR-04A — importação governada da Pesquisa de Preços (Contratação Direta, MySQL real)", () => {
  const stamp = Date.now();
  const ORG_A = 960401;
  const ORG_B = 960402;
  let conn: mysql.Connection;
  let owner: number, operator: number, viewer: number, ownerB: number;
  let wsA = "";
  let wsB = "";

  async function caller(userId: number, org: number, correlationId = `pr04a-${userId}-${org}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const rows = async (sql: string, p: unknown[]) => (await conn.execute<mysql.RowDataPacket[]>(sql, p))[0];
  const n = async (sql: string, p: unknown[]) => Number((await rows(sql, p))[0].n);
  const state = async (ws: string, org: number) => ({
    research: await n(`SELECT COUNT(*) n FROM price_research WHERE process_id = ? AND organization_id = ?`, [ws, org]),
    quotes: await n(`SELECT COUNT(*) n FROM price_research_items WHERE process_id = ? AND organization_id = ?`, [ws, org]),
    events: await n(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Pesquisa de preços importada%'`, [ws, org]),
  });
  const keyRows = async (key: string) => rows(`SELECT userId, organizationId, status, operation FROM idempotency_keys WHERE \`key\` = ?`, [key]);
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };
  const K = (tag: string) => `pr04a-${tag}-${stamp}`;

  const TEXT_A = "Caneta azul;100;un;1,50;Fornecedor A\nLápis HB;50;un;0,90;Fornecedor A";
  const TEXT_B = "Caneta azul;100;un;1,80;Fornecedor B\nLápis HB;50;un;1,10;Fornecedor B";

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A PR04A ${stamp}`, `org-a-pr04a-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B PR04A ${stamp}`, `org-b-pr04a-${stamp}`]);
    const user = async (tag: string) => {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`pr04a-${tag}-${stamp}`, `PR04A ${tag}`, `pr04a-${tag}-${stamp}@teste.local`]);
      return r.insertId;
    };
    const member = (org: number, u: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, u, role]);
    owner = await user("owner"); operator = await user("operator"); viewer = await user("viewer"); ownerB = await user("owner-b");
    await member(ORG_A, owner, "owner"); await member(ORG_A, operator, "operator"); await member(ORG_A, viewer, "viewer");
    await member(ORG_B, ownerB, "owner");
    const create = async (u: number, org: number, num: string) =>
      (await (await caller(u, org)).directProcurement.createProcess({
        processNumber: num, object: "Aquisição de material de expediente (PR-04A)", procurementType: "dispensa", startOption: "sem_dfd",
      })).workspace.id;
    wsA = await create(owner, ORG_A, `DISPENSA-A-${stamp}`);
    wsB = await create(ownerB, ORG_B, `DISPENSA-B-${stamp}`);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    await conn.query(`DROP TRIGGER IF EXISTS ${TRIGGER}`).catch(() => {});
    for (const org of [ORG_A, ORG_B]) {
      await del(`DELETE FROM price_research_items WHERE organization_id = ?`, [org]);
      await del(`DELETE FROM price_research WHERE organization_id = ?`, [org]);
      await del(`DELETE FROM process_timeline WHERE organization_id = ?`, [org]);
      await del(`DELETE FROM idempotency_keys WHERE organizationId = ?`, [org]);
      await del(`DELETE FROM direct_procurement_workspaces WHERE organization_id = ?`, [org]);
      await del(`DELETE FROM activity_logs WHERE organizationId = ?`, [org]);
      await del(`DELETE FROM organization_members WHERE organizationId = ?`, [org]);
    }
    const users = [owner, operator, viewer, ownerB].filter(Boolean);
    if (users.length) await del(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(",")})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  let import1 = "";
  let snapshot1: mysql.RowDataPacket[] = [];

  it("T1/T8/T11/T12/T13 — operator importa: 1 pesquisa + cotações + 1 evento, com linhagem e contentHash verificável", async () => {
    const c = await caller(operator, ORG_A, `pr04a-corr-t1-${stamp}`);
    const out = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: TEXT_A, idempotencyKey: K("t1") });
    expect(out).toMatchObject({ itemCount: 2, source: "colar", deduplicated: false, replayed: false });
    expect(out.researchId).toBe(out.importId);
    expect(out.contentHash).toMatch(/^[0-9a-f]{64}$/);
    import1 = out.importId;
    expect(await state(wsA, ORG_A)).toEqual({ research: 1, quotes: 2, events: 1 });

    // T11 — linhagem: fonte, importId, correlationId, ator (evento) e chave de idempotência do usuário
    const [research] = await rows(`SELECT id, organization_id, process_id, source, item_count, correlation_id FROM price_research WHERE id = ?`, [import1]);
    expect(research).toMatchObject({ id: import1, organization_id: ORG_A, process_id: wsA, source: "colar", item_count: 2, correlation_id: `pr04a-corr-t1-${stamp}` });
    snapshot1 = await rows(`SELECT id, research_id, description, quantity, unit, supplier, value, source FROM price_research_items WHERE research_id = ? ORDER BY id`, [import1]);
    expect(snapshot1.every((r) => r.research_id === import1 && r.source === "colar" && r.supplier === "Fornecedor A")).toBe(true);
    // T12 — evento de auditoria persistido (process_timeline) com ator autenticado, refId e contentHash
    const [ev] = await rows(`SELECT actor, ref_id, correlation_id, summary, event_type FROM process_timeline WHERE process_id = ? AND ref_id = ?`, [wsA, import1]);
    expect(ev).toMatchObject({ actor: String(operator), ref_id: import1, correlation_id: `pr04a-corr-t1-${stamp}`, event_type: "change" });
    expect(String(ev.summary)).toContain(`importId=${import1}`);
    expect(String(ev.summary)).toContain(`contentHash=${out.contentHash}`);
    expect(await keyRows(K("t1"))).toEqual([expect.objectContaining({ userId: operator, organizationId: ORG_A, status: "completed", operation: "directProcurement.importPriceResearch" })]);
    // T13 — contentHash recomputado a partir das cotações PERSISTIDAS
    const persisted = await rows(`SELECT description, quantity, unit, value, supplier, brand, model, observations FROM price_research_items WHERE research_id = ?`, [import1]);
    expect(computeDirectPriceImportContentHash(persisted.map((r) => ({
      description: String(r.description), quantity: String(r.quantity), unit: String(r.unit), value: String(r.value),
      supplier: String(r.supplier), brand: String(r.brand), model: String(r.model), observations: String(r.observations ?? ""),
    })))).toBe(out.contentHash);
  }, 60_000);

  it("T2 — replay idêntico (mesma chave + mesmo payload) converge: mesmo resultado, nada duplicado", async () => {
    const c = await caller(operator, ORG_A);
    const first = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: TEXT_A, idempotencyKey: K("t1") });
    const again = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: TEXT_A, idempotencyKey: K("t1") });
    for (const r of [first, again]) expect(r).toMatchObject({ importId: import1, researchId: import1, itemCount: 2, deduplicated: false, replayed: true });
    expect(await state(wsA, ORG_A)).toEqual({ research: 1, quotes: 2, events: 1 });
  }, 60_000);

  it("T3 — mesma chave + payload diferente ⇒ CONFLICT, sem escrita", async () => {
    const c = await caller(operator, ORG_A);
    expect((await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: TEXT_B, idempotencyKey: K("t1") }))).code).toBe("CONFLICT");
    // fonte diferente com o mesmo texto também é outro payload sob a mesma chave
    expect((await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "csv", text: TEXT_A, idempotencyKey: K("t1") }))).code).toBe("CONFLICT");
    expect(await state(wsA, ORG_A)).toEqual({ research: 1, quotes: 2, events: 1 });
  }, 60_000);

  it("T4/T5 — segunda importação (conteúdo diferente) COEXISTE e NÃO sobrescreve a primeira", async () => {
    const c = await caller(operator, ORG_A);
    const out = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: TEXT_B, idempotencyKey: K("t4") });
    expect(out).toMatchObject({ itemCount: 2, deduplicated: false, replayed: false });
    expect(out.importId).not.toBe(import1);
    expect(await state(wsA, ORG_A)).toEqual({ research: 2, quotes: 4, events: 2 });
    // cotações da 1ª importação INTACTAS (nenhum campo alterado)
    expect(await rows(`SELECT id, research_id, description, quantity, unit, supplier, value, source FROM price_research_items WHERE research_id = ? ORDER BY id`, [import1])).toEqual(snapshot1);
    const suppliers = (await rows(`SELECT DISTINCT supplier FROM price_research_items WHERE process_id = ? ORDER BY supplier`, [wsA])).map((r) => r.supplier);
    expect(suppliers).toEqual(["Fornecedor A", "Fornecedor B"]);
    const canetas = (await rows(`SELECT value FROM price_research_items WHERE process_id = ? AND description = 'Caneta azul' ORDER BY value`, [wsA])).map((r) => String(r.value));
    expect(canetas).toEqual(["1.50", "1.80"]);
  }, 60_000);

  it("DEDUP governada — mesmo conteúdo (normalizado/reordenado) sob NOVA chave converge para a importação existente", async () => {
    const c = await caller(owner, ORG_A);
    const reordered = "  lápis hb ; 50 ; un ; 0,90 ; fornecedor a\n\nCANETA AZUL;100;un;R$ 1,50;Fornecedor A";
    const out = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: reordered, idempotencyKey: K("dedup") });
    expect(out).toMatchObject({ importId: import1, researchId: import1, itemCount: 2, deduplicated: true, replayed: false });
    expect(await state(wsA, ORG_A)).toEqual({ research: 2, quotes: 4, events: 2 });
    expect(await keyRows(K("dedup"))).toEqual([expect.objectContaining({ userId: owner, status: "completed" })]);
  }, 60_000);

  it("T6 — workspace de OUTRO órgão ⇒ NOT_FOUND neutro (idêntico ao inexistente) e zero escrita", async () => {
    const beforeB = await state(wsB, ORG_B);
    const beforeA = await state(wsA, ORG_A);
    const c = await caller(operator, ORG_A);
    const foreign = await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsB, source: "colar", text: TEXT_A, idempotencyKey: K("t6") }));
    const missing = await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: "ws-inexistente-0001", source: "colar", text: TEXT_A, idempotencyKey: K("t6b") }));
    expect(foreign.code).toBe("NOT_FOUND");
    expect(missing).toEqual(foreign);
    expect(await state(wsB, ORG_B)).toEqual(beforeB);
    expect(await state(wsA, ORG_A)).toEqual(beforeA);
    expect(await n(`SELECT COUNT(*) n FROM price_research WHERE process_id = ?`, [wsB])).toBe(0);
    expect(await keyRows(K("t6"))).toEqual([]);
  }, 60_000);

  it("T7 — viewer NÃO escreve: FORBIDDEN e zero escrita (nem chave de idempotência)", async () => {
    const before = await state(wsA, ORG_A);
    const c = await caller(viewer, ORG_A);
    expect((await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: "Grampeador;5;un;30,00;Fornecedor C", idempotencyKey: K("t7") }))).code).toBe("FORBIDDEN");
    expect(await state(wsA, ORG_A)).toEqual(before);
    expect(await keyRows(K("t7"))).toEqual([]);
    // leitura segue permitida ao viewer (tenantProcedure)
    await expect(c.directProcurement.loadProcess({ workspaceId: wsA })).resolves.toBeTruthy();
  }, 60_000);

  it("T9 — concorrência: mesma chave ⇒ exatamente 1 importação; chaves diferentes com o mesmo conteúdo ⇒ exatamente 1", async () => {
    const c = await caller(operator, ORG_A);
    const text = "Borracha;20;un;0,50;Fornecedor D";
    const before = await state(wsA, ORG_A);
    const settled = await Promise.allSettled([1, 2, 3, 4].map(() =>
      c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text, idempotencyKey: K("t9") })));
    const ok = settled.filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof c.directProcurement.importPriceResearch>>> => s.status === "fulfilled");
    expect(ok.filter((s) => !s.value.replayed).length).toBe(1);
    for (const s of settled) if (s.status === "rejected") expect((s.reason as { code?: string }).code).toBe("CONFLICT");
    expect(await state(wsA, ORG_A)).toEqual({ research: before.research + 1, quotes: before.quotes + 1, events: before.events + 1 });

    const text2 = "Régua 30cm;10;un;2,00;Fornecedor E";
    const outs = await Promise.all([1, 2, 3].map((i) =>
      c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: text2, idempotencyKey: K(`t9-${i}`) })));
    expect(new Set(outs.map((o) => o.importId)).size).toBe(1);
    expect(outs.filter((o) => !o.deduplicated).length).toBe(1);
    expect(await state(wsA, ORG_A)).toEqual({ research: before.research + 2, quotes: before.quotes + 2, events: before.events + 2 });
  }, 60_000);

  it("T10/T14 — falha local forçada (trigger temporário) ⇒ rollback total; retry com a MESMA chave sucede exatamente 1 vez", async () => {
    const text = "Pasta arquivo;30;un;4,20;Fornecedor F\nClipes;100;cx;3,10;Fornecedor F";
    const planned = planDirectPriceImport({ workspaceId: wsA, organizationId: ORG_A, source: "colar", text, correlationId: "x" });
    const before = await state(wsA, ORG_A);
    await conn.query(`CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON process_timeline FOR EACH ROW
      BEGIN IF NEW.process_id = '${wsA}' AND NEW.ref_id = '${planned.importId}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pr04a forced timeline failure'; END IF; END`);
    const c = await caller(operator, ORG_A);
    try {
      const err = await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text, idempotencyKey: K("t10") }));
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
      expect(err.message).not.toContain("pr04a forced"); // erro sanitizado
      expect(await state(wsA, ORG_A)).toEqual(before);   // pesquisa + cotações revertidas junto do evento
      expect(await n(`SELECT COUNT(*) n FROM price_research WHERE id = ?`, [planned.importId])).toBe(0);
      expect(await n(`SELECT COUNT(*) n FROM price_research_items WHERE research_id = ?`, [planned.importId])).toBe(0);
      expect(await keyRows(K("t10"))).toEqual([expect.objectContaining({ status: "failed" })]); // falha NÃO cacheada como sucesso
    } finally {
      await conn.query(`DROP TRIGGER IF EXISTS ${TRIGGER}`);
    }
    const retry = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text, idempotencyKey: K("t10") });
    expect(retry).toMatchObject({ importId: planned.importId, itemCount: 2, deduplicated: false, replayed: false });
    const again = await c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text, idempotencyKey: K("t10") });
    expect(again).toMatchObject({ importId: planned.importId, replayed: true });
    expect(await state(wsA, ORG_A)).toEqual({ research: before.research + 1, quotes: before.quotes + 2, events: before.events + 1 });
    expect(await keyRows(K("t10"))).toEqual([expect.objectContaining({ status: "completed" })]);
  }, 60_000);

  it("conteúdo sem cotação reconhecível ⇒ BAD_REQUEST antes de qualquer efeito (nem chave reservada)", async () => {
    const before = await state(wsA, ORG_A);
    const c = await caller(operator, ORG_A);
    expect((await errOf(() => c.directProcurement.importPriceResearch({ workspaceId: wsA, source: "colar", text: " \n \n", idempotencyKey: K("empty") }))).code).toBe("BAD_REQUEST");
    expect(await state(wsA, ORG_A)).toEqual(before);
    expect(await keyRows(K("empty"))).toEqual([]);
  }, 60_000);
});
