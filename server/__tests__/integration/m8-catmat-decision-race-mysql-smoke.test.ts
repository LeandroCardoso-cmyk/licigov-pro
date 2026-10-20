/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M8 hardening (emenda PR #311) — CONCORRÊNCIA entre "Buscar classificação" (rebaixa sugestões a histórico) e a
 * confirmação governada no ledger, com interleavings DETERMINÍSTICOS (barreiras no serviço, nunca Promise.all às cegas).
 * MySQL real isolado; organizações sintéticas (nunca a organização 1).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { M8_PRICE_RESEARCH_TEXT } from "../../../scripts/homologation-e2e";
import { setCatmatThresholdConfig } from "../../db/catmatGovernance";
import { __setOfficialCatalogFetchForTests, __clearOfficialCatalogCacheForTests } from "../../services/officialCatalogService";
import { __setCatmatDecisionHookForTests, type CatmatDecisionHookPhase } from "../../services/catmatGovernanceService";
import { resetRateLimit } from "../../services/rateLimiter";

const DB = process.env.DATABASE_URL;
const ORG = 996611;
const ORG_B = 996612;
const RUN = Date.now().toString(36);
const U = { operator: 0, operatorB: 0 };
let conn: mysql.Connection;
let seq = 0;

const DESKTOP = "COMPUTADOR DESKTOP COMPLETO, PROCESSADOR 6 NÚCLEOS, MEMÓRIA 16 GB, SSD 512 GB";
const BOTH = { resultado: [
  { codigoItem: 482201, descricaoItem: DESKTOP, statusItem: true },
  { codigoItem: 482202, descricaoItem: "COMPUTADOR DESKTOP COMPLETO, MEMÓRIA 8 GB", statusItem: true },
], totalRegistros: 2 };
const ONLY_201 = { resultado: [BOTH.resultado[0]], totalRegistros: 1 };
/** Mesmo CÓDIGO nos dois catálogos, itens oficiais DIFERENTES (colisão possível: códigos CATMAT e CATSER se sobrepõem). */
const SHARED = "27502";
const CATSER_27502 = { codigoServico: 27502, nomeServico: "Manutenção de computadores desktop", statusServico: true };
const CATMAT_27502 = { codigoItem: 27502, descricaoItem: "COMPUTADOR DESKTOP COMPLETO, PROCESSADOR 4 NÚCLEOS", statusItem: true };

function serve(catmat: unknown) {
  __clearOfficialCatalogCacheForTests();
  __setOfficialCatalogFetchForTests(async (url) => {
    const q = new URL(url).searchParams;
    let body: any = catmat;
    if (url.includes("modulo-servico")) body = q.get("codigoServico") === SHARED ? { resultado: [CATSER_27502], totalRegistros: 1 } : { resultado: [], totalRegistros: 0 };
    else if (q.get("codigoItem")) body = { resultado: [...BOTH.resultado, CATMAT_27502].filter((r) => String(r.codigoItem) === q.get("codigoItem")), totalRegistros: 1 };
    return { ok: true, status: 200, json: async () => body };
  });
}
async function caller(userId: number, org = ORG) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `race-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
    correlationId: `corr-race-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string; message: string }> {
  try { return { ok: true, value: await p }; } catch (e: any) { return { ok: false, code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pausa a PRIMEIRA decisão na fase indicada até `release()`; as demais passam direto. */
function pauseAt(phase: CatmatDecisionHookPhase) {
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const reached = new Promise<void>((r) => { entered = r; });
  let used = false;
  __setCatmatDecisionHookForTests(async (p) => { if (p !== phase || used) return; used = true; entered(); await gate; });
  return { release, reached };
}

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["catmat_decisions", "organizationId"], ["catmat_threshold_config", "organizationId"], ["idempotency_keys", "organizationId"],
      ["catalog_entries", "organization_id"], ["catalog_snapshots", "organization_id"], ["item_catmat_matches", "organization_id"],
      ["item_recommendations", "organization_id"], ["item_risks", "organization_id"], ["intelligent_item_identity_aliases", "organization_id"],
      ["intelligent_items", "organization_id"], ["price_research_items", "organization_id"], ["price_research", "organization_id"],
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"], ["organization_members", "organizationId"],
    ] as const) await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
  }
}

async function newItem(tag: string, user = U.operator, org = ORG): Promise<{ pid: string; itemId: string }> {
  const api = await caller(user, org);
  const { process } = await api.procurementProcess.createProcess({ processNumber: `RACE-${tag}-${RUN}`, object: "Aquisição de 10 computadores desktop completos", startOption: "iniciar_pesquisa" });
  await api.procurementProcess.importPriceResearch({ processId: process.id, source: "colar", text: M8_PRICE_RESEARCH_TEXT });
  const [it] = await rows<{ id: string }>("SELECT id FROM intelligent_items WHERE organization_id = ? AND process_id = ?", [org, process.id]);
  return { pid: process.id, itemId: it.id };
}
const decisions = (itemId: string, org = ORG) => n("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [org, itemId]);
const pinned = async (itemId: string) => (await rows<{ s: string | null }>("SELECT suggested_catmat s FROM intelligent_items WHERE id = ?", [itemId]))[0].s;
const stateOf = async (itemId: string, code: string, org = ORG) =>
  (await rows<{ d: string }>("SELECT decision d FROM item_catmat_matches WHERE organization_id = ? AND item_id = ? AND catmat_code = ?", [org, itemId, code]))[0]?.d;

describe.skipIf(!DB)("M8 — corrida busca × confirmação CATMAT/CATSER (MySQL real, interleavings determinísticos)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const org of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Prefeitura Sintética Corrida ${org}`, `race-sintetica-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`race-${k}-${RUN}`, `Sintético ${k}`, `race-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, U.operator]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG_B, U.operatorB]);
    for (const org of [ORG, ORG_B]) await setCatmatThresholdConfig({ organizationId: org, minScore: 0.1, reason: "smoke sintético", actorUserId: 1, correlationId: `race-thr-${org}` });
  }, 300_000);

  afterEach(() => {
    __setCatmatDecisionHookForTests(null); __setOfficialCatalogFetchForTests(null);
    resetRateLimit(`user:${U.operator}`, "catmat"); resetRateLimit(`user:${U.operatorB}`, "catmat");
  });

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`race-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("A) a NOVA BUSCA vence: a confirmação já em curso (estado lido antes) não registra a sugestão que virou histórica", async () => {
    const { itemId } = await newItem("A");
    const api = await caller(U.operator);
    serve(BOTH);
    const first = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    const s2 = first.status === "ok" ? first.candidates.find((c) => c.catmatCode === "482202")! : null;
    expect(s2?.state).toBe("busca_atual");
    // A: confirmação de 482202 — já leu as sugestões (estado busca_atual) e para ANTES da etapa decisiva.
    const g = pauseAt("before_lock");
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2!.id, idempotencyKey: `raceA-${RUN}` }));
    await g.reached;
    // B: nova busca conclui e rebaixa 482202 a histórico.
    serve(ONLY_201);
    await (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(await stateOf(itemId, "482202")).toBe("historico");
    g.release();
    const a = await pA;
    expect(a.ok).toBe(false);
    expect(!a.ok && a.message).toMatch(/CATMAT_SUGGESTION_NOT_CURRENT/);
    expect(await decisions(itemId)).toBe(0);
    expect(await pinned(itemId)).toBeNull();
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND event_type = 'decision'", [ORG, itemId])).toBe(0);
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = ? AND code = '482202'", [ORG])).toBe(1);
  }, 120_000);

  it("CATMAT × CATSER: mesmo código em catálogos diferentes nunca vira candidato/confirmação do OUTRO catálogo", async () => {
    const { itemId } = await newItem("X");
    const api = await caller(U.operator);
    serve({ resultado: [CATMAT_27502], totalRegistros: 1 });
    // 1) Servidor verifica o código no CATSER (serviço).
    const v = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catser", code: SHARED });
    expect(v.status === "verified" && [v.candidate.catalogType, v.candidate.catmatDescription]).toEqual(["catser", CATSER_27502.nomeServico]);
    // 2) Busca no CATMAT (material) devolve o MESMO código, outro item oficial.
    const s = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat", term: "computador desktop completo processador" });
    expect(s.status).toBe("ok");
    expect(s.status === "ok" && s.identityConflicts).toEqual([SHARED]);
    // Nenhum candidato do resultado CATMAT pode carregar a descrição/catálogo do CATSER (nem o inverso).
    const cands = s.status === "ok" ? s.candidates : [];
    expect(cands.every((c) => c.catalogType === "catmat")).toBe(true);
    // 3) "Verificar código" no CATMAT para o mesmo código: nunca devolve o item CATSER como se fosse CATMAT.
    const v2 = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: SHARED });
    if (v2.status === "verified") expect([v2.candidate.catalogType, v2.candidate.catmatDescription]).toEqual(["catmat", CATMAT_27502.descricaoItem]);
    else expect(v2.status).toBe("identity_conflict");
    // A sugestão persistida continua sendo do catálogo em que foi verificada (CATSER), com a descrição dele.
    const list = (await api.itemIntelligence.getCATMATSuggestions({ itemId })).suggestions.filter((x) => x.catmatCode === SHARED);
    expect(list.map((x) => [x.catalogType, x.catmatDescription, x.state])).toEqual([["catser", CATSER_27502.nomeServico, "codigo_verificado"]]);
    // Confirmar registra o que o servidor vê (CATSER), nunca o item CATMAT homônimo.
    const out = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: list[0].id, idempotencyKey: `X-${RUN}` });
    expect(out.decision).toMatchObject({ catmatCode: SHARED, catmatDescription: CATSER_27502.nomeServico, source: "api-comprasgov:catser" });
  }, 120_000);

  /** Busca inicial com 482201/482202 (busca_atual). */
  async function seeded(tag: string, user = U.operator, org = ORG) {
    const { itemId } = await newItem(tag, user, org);
    serve(BOTH);
    const res = await (await caller(user, org)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    const byCode = new Map((res.status === "ok" ? res.candidates : []).map((c) => [c.catmatCode, c.id]));
    return { itemId, s1: byCode.get("482201")!, s2: byCode.get("482202")! };
  }

  it("B) a CONFIRMAÇÃO vence: com o lock do item, a busca concorrente espera; decisão registrada e não alterada pela busca posterior; replay estável", async () => {
    const { itemId, s2 } = await seeded("B");
    const api = await caller(U.operator);
    const g = pauseAt("after_lock");
    const key = `raceB-${RUN}`;
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key }));
    await g.reached;
    serve(ONLY_201);
    let searchDone = false;
    const pB = (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" }).then((r) => { searchDone = true; return r; });
    await tick(800);
    expect(searchDone).toBe(false);                 // bloqueada no lock do item (decisão em curso)
    expect(await stateOf(itemId, "482202")).toBe("busca_atual");
    g.release();
    const a = await pA;
    await pB;
    expect(a.ok && a.value.decision).toMatchObject({ decision: "confirmado", catmatCode: "482202" });
    expect(await stateOf(itemId, "482202")).toBe("historico"); // a busca rebaixou DEPOIS — decisão intacta
    expect(await decisions(itemId)).toBe(1);
    expect(await pinned(itemId)).toBe("482202");
    const again = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key });
    expect(again).toMatchObject({ replayed: true, decision: { id: a.ok ? a.value.decision.id : -1, catmatCode: "482202" } });
    const other = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: `${key}-2` }));
    expect(!other.ok && other.message).toMatch(/CATMAT_SUGGESTION_NOT_CURRENT/);
    expect(await decisions(itemId)).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND event_type = 'decision'", [ORG, itemId])).toBe(1);
  }, 120_000);

  it("C) confirmações concorrentes: mesma chave/mesmo payload (em voo ⇒ CONFLICT, depois replay); mesma chave/payload diferente ⇒ CONFLICT; chaves distintas ⇒ serializadas, cada uma com o SEU registro", async () => {
    const { itemId, s1, s2 } = await seeded("C");
    const api = await caller(U.operator);
    const key = `raceC-${RUN}`;
    const g = pauseAt("after_lock");
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key }));
    await g.reached;
    const same = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key }));
    expect(!same.ok && same.code).toBe("CONFLICT");
    const diff = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s1, idempotencyKey: key }));
    expect(!diff.ok && diff.code).toBe("CONFLICT");
    // Chave distinta concorrente: espera o lock do item e é registrada depois, com o próprio registro.
    let otherDone = false;
    const pD = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s1, idempotencyKey: `${key}-other` })).then((r) => { otherDone = true; return r; });
    await tick(800);
    expect(otherDone).toBe(false);
    g.release();
    const [a, d] = await Promise.all([pA, pD]);
    expect(a.ok && a.value.decision.catmatCode).toBe("482202");
    expect(d.ok && d.value.decision.catmatCode).toBe("482201");   // nunca o registro de outra requisição
    expect(a.ok && d.ok && a.value.decision.id).not.toBe(d.ok ? d.value.decision.id : -1);
    expect(await decisions(itemId)).toBe(2);
    // Lineage atômica e ordenada: o código fixado é o da ÚLTIMA decisão do ledger.
    const [last] = await rows<{ c: string }>("SELECT catmatCode c FROM catmat_decisions WHERE organizationId = ? AND itemId = ? ORDER BY id DESC LIMIT 1", [ORG, itemId]);
    expect(await pinned(itemId)).toBe(last.c);
    // Depois de concluída: mesmo payload ⇒ replay do registro original; payload diferente ⇒ CONFLICT.
    const replay = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key });
    expect(replay).toMatchObject({ replayed: true, decision: { id: a.ok ? a.value.decision.id : -1 } });
    expect((await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s1, idempotencyKey: key }))).ok).toBe(false);
    expect(await decisions(itemId)).toBe(2);
  }, 120_000);

  it("D) código verificado manualmente (fora do ranking) + busca concorrente: não é rebaixado e a confirmação segue válida", async () => {
    const { itemId } = await seeded("D");
    const api = await caller(U.operator);
    serve(ONLY_201);
    await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(await stateOf(itemId, "482202")).toBe("historico");
    const v = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: "482202" });
    expect(v.status === "verified" && v.candidate.state).toBe("codigo_verificado");
    const g = pauseAt("before_lock");
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: v.status === "verified" ? v.candidate.id : "", idempotencyKey: `raceD-${RUN}` }));
    await g.reached;
    await (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" }); // não traz 482202
    expect(await stateOf(itemId, "482202")).toBe("codigo_verificado");
    g.release();
    const a = await pA;
    expect(a.ok && a.value.decision).toMatchObject({ catmatCode: "482202", source: "api-comprasgov:catmat" });
  }, 120_000);

  it("E) busca INDISPONÍVEL concorrente não inventa estado: a sugestão atual continua confirmável", async () => {
    const { itemId, s2 } = await seeded("E");
    const api = await caller(U.operator);
    const g = pauseAt("before_lock");
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: `raceE-${RUN}` }));
    await g.reached;
    __clearOfficialCatalogCacheForTests();
    __setOfficialCatalogFetchForTests(async () => { throw new Error("ECONNRESET"); });
    const down = await (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(down.status).toBe("unavailable");
    expect(await stateOf(itemId, "482202")).toBe("busca_atual");
    g.release();
    expect((await pA).ok).toBe(true);
  }, 120_000);

  it("F) isolamento: o lock de um órgão não bloqueia nem altera o outro; outro órgão não decide o item", async () => {
    const a = await seeded("Fa");
    const b = await seeded("Fb", U.operatorB, ORG_B);
    const apiA = await caller(U.operator);
    const apiB = await caller(U.operatorB, ORG_B);
    const g = pauseAt("after_lock");
    const pA = settle(apiA.itemIntelligence.decidirCATMAT({ itemId: a.itemId, decision: "confirmado", suggestionId: a.s2, idempotencyKey: `raceFa-${RUN}` }));
    await g.reached;                                  // órgão A segura o lock do SEU item
    serve(ONLY_201);
    const searchB = await apiB.itemIntelligence.buscarClassificacaoOficial({ itemId: b.itemId, catalogType: "catmat" });
    expect(searchB.status).toBe("ok");               // concluiu sem esperar o órgão A
    const decB = await apiB.itemIntelligence.decidirCATMAT({ itemId: b.itemId, decision: "confirmado", suggestionId: b.s1, idempotencyKey: `raceFb-${RUN}` });
    expect(decB.decision.catmatCode).toBe("482201");
    expect(await stateOf(a.itemId, "482202")).toBe("busca_atual"); // a busca do órgão B não tocou o item do órgão A
    expect((await settle(apiB.itemIntelligence.decidirCATMAT({ itemId: a.itemId, decision: "confirmado", suggestionId: a.s1, idempotencyKey: `raceFx-${RUN}` }))).ok).toBe(false);
    g.release();
    expect((await pA).ok).toBe(true);
    expect(await decisions(a.itemId)).toBe(1);
    expect(await decisions(b.itemId, ORG_B)).toBe(1);
  }, 120_000);

  it("G) falhas: deadlock/erro no meio ⇒ rollback integral (sem ledger, sem código, sem evento) e reenvio com a mesma chave funciona; falha DEPOIS do commit ⇒ reenvio devolve a decisão original mesmo com a sugestão já histórica", async () => {
    const { itemId, s2 } = await seeded("G");
    const api = await caller(U.operator);
    const key = `raceG-${RUN}`;
    // 1) Deadlock simulado ANTES do commit (depois do insert no ledger e da lineage).
    __setCatmatDecisionHookForTests((phase) => {
      if (phase === "before_commit") throw Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
    });
    const failed = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key }));
    expect(failed.ok).toBe(false);
    expect(await decisions(itemId)).toBe(0);
    expect(await pinned(itemId)).toBeNull();
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND event_type = 'decision'", [ORG, itemId])).toBe(0);
    expect((await rows<{ s: string }>("SELECT status s FROM idempotency_keys WHERE organizationId = ? AND `key` = ?", [ORG, key]))[0].s).toBe("failed");
    // 2) Reenvio com a MESMA chave: sem retry automático, o cliente reenvia ⇒ registrada uma única vez.
    __setCatmatDecisionHookForTests(null);
    const ok = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key });
    expect(ok).toMatchObject({ replayed: false, decision: { catmatCode: "482202" } });
    // 3) Falha DEPOIS do commit (resposta não salva na chave) + sugestão rebaixada em seguida ⇒ reenvio devolve o ORIGINAL.
    await conn.execute("UPDATE idempotency_keys SET status = 'failed', responsePayload = NULL WHERE organizationId = ? AND `key` = ?", [ORG, key]);
    serve(ONLY_201);
    await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(await stateOf(itemId, "482202")).toBe("historico");
    const recovered = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key });
    expect(recovered).toMatchObject({ replayed: true, decision: { id: ok.decision.id, catmatCode: "482202" } });
    // Chave vencida (TTL) idem; e a mesma chave para OUTRA decisão ⇒ CONFLICT sem gravação.
    await conn.execute("UPDATE idempotency_keys SET expiresAt = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE organizationId = ? AND `key` = ?", [ORG, key]);
    expect(await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: key })).toMatchObject({ replayed: true, decision: { id: ok.decision.id } });
    await conn.execute("UPDATE idempotency_keys SET expiresAt = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE organizationId = ? AND `key` = ?", [ORG, key]);
    const reused = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "rejeitado", suggestionId: s2, justification: "outra decisão", idempotencyKey: key }));
    expect(!reused.ok && reused.code).toBe("CONFLICT");
    expect(await decisions(itemId)).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND event_type = 'decision'", [ORG, itemId])).toBe(1);
  }, 120_000);

  it("H) achados da auditoria: mesma chave reaproveitada com OUTRO código após falha/TTL ⇒ CONFLICT; mesma chave por outro ator em outro item, em paralelo ⇒ CONFLICT (nunca 500); rejeição legada serializada pelo lock do item", async () => {
    const { itemId, s1, s2 } = await seeded("H");
    const api = await caller(U.operator);
    // (1) confirmar por CÓDIGO (sem suggestionId); falha depois do commit; reenvio com a mesma chave e OUTRO código ⇒ CONFLICT.
    const key = `raceH-${RUN}`;
    await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", catmatCode: "482201", idempotencyKey: key });
    await conn.execute("UPDATE idempotency_keys SET status = 'failed', responsePayload = NULL WHERE organizationId = ? AND `key` = ?", [ORG, key]);
    const other = await settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", catmatCode: "482202", idempotencyKey: key }));
    expect(!other.ok && other.code).toBe("CONFLICT");
    expect(await decisions(itemId)).toBe(1);
    // (2) mesma chave explícita, OUTRO ator e OUTRO item do mesmo órgão, concorrendo: o perdedor recebe CONFLICT, sem gravar.
    const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`race-op2-${RUN}`, "Sintético op2", `race-op2-${RUN}@teste.local`]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, r.insertId]);
    const other2 = await seeded("H2", r.insertId);
    const shared = `raceH-shared-${RUN}`;
    const g = pauseAt("before_commit");                // A grava a chave no ledger e para antes do commit
    const pA = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s1, idempotencyKey: shared }));
    await g.reached;
    const pB = settle((await caller(r.insertId)).itemIntelligence.decidirCATMAT({ itemId: other2.itemId, decision: "confirmado", suggestionId: other2.s1, idempotencyKey: shared }));
    await tick(500);
    g.release();
    const [a, b] = await Promise.all([pA, pB]);
    expect(a.ok).toBe(true);
    expect(!b.ok && b.code).toBe("CONFLICT");
    expect(await decisions(other2.itemId)).toBe(0);
    expect(await pinned(other2.itemId)).toBeNull();
    // (3) rejeição legada (rejectCATMAT) espera o lock do item quando uma decisão está em curso.
    const g2 = pauseAt("after_lock");
    const pC = settle(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: s2, idempotencyKey: `raceH-rej-${RUN}` }));
    await g2.reached;
    let rejected = false;
    const pR = api.itemIntelligence.rejectCATMAT({ matchId: s2 }).then(() => { rejected = true; });
    await tick(500);
    expect(rejected).toBe(false);
    g2.release();
    expect((await pC).ok).toBe(true);
    await pR;
    expect(await stateOf(itemId, "482202")).toBe("rejeitado");
    await conn.query("DELETE FROM users WHERE openId = ?", [`race-op2-${RUN}`]).catch(() => {});
  }, 120_000);
});
