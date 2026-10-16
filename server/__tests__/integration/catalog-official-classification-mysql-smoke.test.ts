/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CATMAT/CATSER sobre o catálogo OFICIAL — fluxo único dos Itens Inteligentes contra MySQL REAL (appRouter, RBAC, tenant).
 *
 * Transporte do catálogo INJETADO com fixtures nos campos REAIS da API (o CI não depende dela; smoke real: `catalog:smoke`):
 * CATSER paginado (`codigoServico`/`nomeServico`/`statusServico`, sem filtro textual), CATMAT `codigoItem`/`descricaoItem`.
 * Cobre: importação M8 (1 item, 3 cotações, R$ 4.000,00) SEM candidato fabricado → "Buscar classificação" (CATMAT/CATSER)
 * → evidência (catalog_snapshots/catalog_entries) → confirmação governada (ledger) → replay; e os casos adversariais:
 * código gerado por hash/legado não confirmável mesmo com limiar configurado, indisponibilidade sem fabricação,
 * isolamento entre órgãos, fonte atualizada sem substituir a decisão humana.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { M8_PRICE_RESEARCH_TEXT } from "../../../scripts/homologation-e2e";
import { setCatmatThresholdConfig } from "../../db/catmatGovernance";
import { insertCatmatMatch } from "../../db/procurement";
import { __setOfficialCatalogFetchForTests, __clearOfficialCatalogCacheForTests } from "../../services/officialCatalogService";
import { syncCatalogIndex, searchCatalogIndex, __clearCatalogIndexCacheForTests } from "../../services/itemCatalogClassificationService";
import { __setCatalogIndexWriteFaultForTests, catalogIndexLockKey, getLatestCatalogIndex, recordCatalogIndexSnapshot } from "../../db/catalogEvidence";
import type { OfficialCatalogEntry } from "../../domain/officialCatalog";

const DB = process.env.DATABASE_URL;
const ORG = 996601;
const ORG_B = 996602;
const RUN = Date.now().toString(36);
const U = { operator: 0, ownerB: 0 };
let conn: mysql.Connection;
let seq = 0;

const DESKTOP = "COMPUTADOR DESKTOP COMPLETO, PROCESSADOR 6 NÚCLEOS, MEMÓRIA 16 GB, SSD 512 GB";
const CATMAT_FIXTURE = {
  resultado: [
    { codigoItem: 482201, descricaoItem: DESKTOP, statusItem: true, nomeGrupo: "EQUIPAMENTOS DE TIC" },
    { codigoItem: 482202, descricaoItem: "COMPUTADOR DESKTOP COMPLETO, MEMÓRIA 8 GB", statusItem: true },
    { codigoItem: 300777, descricaoItem: "COMPUTADOR DESKTOP DESCONTINUADO", statusItem: false },
    { codigoItem: 222333, descricaoItem: "CANETA ESFEROGRÁFICA AZUL", statusItem: true },
  ],
  totalRegistros: 4,
};
/** Catálogo de serviços (23 linhas ⇒ 3 páginas de 10), com serviços hospitalares como os que a API devolveu a "limpeza". */
const CATSER_ALL = [
  { codigoServico: 27502, nomeServico: "Manutenção de computadores desktop", statusServico: true },
  { codigoServico: 24961, nomeServico: "Limpeza e conservação predial", statusServico: true },
  { codigoServico: 13056, nomeServico: "ENDOSCOPIA DIGESTIVA ALTA", statusServico: true },
  { codigoServico: 13057, nomeServico: "COLONOSCOPIA", statusServico: true },
  ...Array.from({ length: 19 }, (_, i) => ({ codigoServico: 15000 + i, nomeServico: `EXAME HOSPITALAR DE ROTINA ${i + 1}`, statusServico: true })),
];
/** Conteúdo da LISTAGEM paginada (alterável para gerar uma nova versão do catálogo). */
let catserListing: typeof CATSER_ALL = CATSER_ALL;
/** Situação ATUAL na fonte por código (pode divergir do índice: defasagem). */
let catserByCode = new Map(CATSER_ALL.map((r) => [String(r.codigoServico), r]));

let lastUrls: string[] = [];
function serveFixtures(catmat: unknown = CATMAT_FIXTURE) {
  __clearOfficialCatalogCacheForTests();
  __setOfficialCatalogFetchForTests(async (url) => {
    lastUrls.push(url);
    const q = new URL(url).searchParams;
    let body: unknown = catmat;
    if (url.includes("modulo-servico")) {
      const code = q.get("codigoServico");
      if (code) body = { resultado: catserByCode.has(code) ? [catserByCode.get(code)] : [], totalRegistros: catserByCode.has(code) ? 1 : 0 };
      else {
        const page = Number(q.get("pagina")); const size = Number(q.get("tamanhoPagina"));
        const rowsP = catserListing.slice((page - 1) * size, page * size);
        body = { resultado: rowsP, totalRegistros: catserListing.length, paginasRestantes: Math.max(0, Math.ceil(catserListing.length / size) - page) };
      }
    } else if (q.get("codigoItem")) {
      const all = (CATMAT_FIXTURE.resultado as Array<{ codigoItem: number }>);
      body = { resultado: all.filter((r) => String(r.codigoItem) === q.get("codigoItem")), totalRegistros: 1 };
    }
    return { ok: true, status: 200, json: async () => body };
  });
}

async function caller(userId: number, org = ORG) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `cat-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
    correlationId: `corr-cat-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
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
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
  // Índice de pesquisa (org GLOBAL 0): só as linhas deste smoke.
  await conn.query("DELETE FROM catalog_entries WHERE organization_id = 0 AND catalog_type = 'catser' AND code IN (?)", [[...CATSER_ALL.map((r) => String(r.codigoServico)), "29999"]]).catch(() => {});
  await conn.query("DELETE FROM catalog_snapshots WHERE organization_id = 0 AND correlation_id LIKE 'cat-smoke-%'").catch(() => {});
  await conn.query("DELETE FROM catalog_entries WHERE organization_id = 0 AND catalog_type = 'catmat' AND code LIKE '88%'").catch(() => {});
  __clearCatalogIndexCacheForTests();
}

async function newProcessWithItem(tag: string): Promise<{ pid: string; itemId: string }> {
  const api = await caller(U.operator);
  const { process } = await api.procurementProcess.createProcess({ processNumber: `CAT-${tag}-${RUN}`, object: "Aquisição de 10 computadores desktop completos", startOption: "iniciar_pesquisa" });
  await api.procurementProcess.importPriceResearch({ processId: process.id, source: "colar", text: M8_PRICE_RESEARCH_TEXT });
  const [it] = await rows<{ id: string }>("SELECT id FROM intelligent_items WHERE organization_id = ? AND process_id = ?", [ORG, process.id]);
  return { pid: process.id, itemId: it.id };
}

describe.skipIf(!DB)("CATMAT/CATSER oficial — fluxo único dos Itens Inteligentes (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const org of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Prefeitura Sintética Catálogo ${org}`, `cat-sintetica-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`cat-${k}-${RUN}`, `Sintético ${k}`, `cat-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, U.operator]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_B, U.ownerB]);
    // Limiar institucional CONFIGURADO nos dois órgãos: prova que ele não torna código fictício confirmável.
    for (const org of [ORG, ORG_B]) await setCatmatThresholdConfig({ organizationId: org, minScore: 0.1, reason: "smoke sintético", actorUserId: 1, correlationId: `cat-thr-${org}` });
  }, 300_000);

  afterEach(() => { __setOfficialCatalogFetchForTests(null); __setCatalogIndexWriteFaultForTests(null); catserListing = CATSER_ALL; lastUrls = []; catserByCode = new Map(CATSER_ALL.map((r) => [String(r.codigoServico), r])); });

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`cat-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("importação M8 preservada (1 item, 3 cotações, R$ 4.000,00) e SEM candidato CATMAT fabricado; item aprovável com classificação pendente", async () => {
    const { pid, itemId } = await newProcessWithItem("imp");
    const [it] = await rows<{ p: string; s: string | null; a: string | null }>("SELECT average_price p, suggested_catmat s, alternative_catmat a FROM intelligent_items WHERE id = ?", [itemId]);
    expect(Number(it.p)).toBe(4000);
    expect(await n("SELECT COUNT(*) n FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG, pid])).toBe(3);
    expect(it.s).toBeNull();
    expect(JSON.parse(it.a ?? "[]")).toEqual([]);
    expect(await n("SELECT COUNT(*) n FROM item_catmat_matches WHERE organization_id = ? AND item_id = ?", [ORG, itemId])).toBe(0);
    const api = await caller(U.operator);
    expect((await api.itemIntelligence.getCATMATSuggestions({ itemId })).suggestions).toEqual([]);
    // A aprovação do item não depende da classificação.
    await api.procurementProcess.approveItem({ itemId });
    expect((await rows<{ s: string }>("SELECT status s FROM intelligent_items WHERE id = ?", [itemId]))[0].s).toBe("aprovado");
  }, 120_000);

  it("ADVERSARIAL: sugestão legada gerada por hash não é confirmável mesmo com limiar configurado; ledger e item intactos", async () => {
    const { itemId } = await newProcessWithItem("hash");
    // Linha como o gerador antigo gravava (código de formato CATMAT sem existência comprovada).
    await insertCatmatMatch({ id: `lg${RUN}`.slice(0, 20), itemId, organizationId: ORG, catmatCode: "583920", catmatDescription: "Computador desktop completo — especificação padrão", score: 0.8, rank: 0, decision: "sugerido", correlationId: "legacy", createdAt: new Date().toISOString() });
    const api = await caller(U.operator);
    const [sug] = (await api.itemIntelligence.getCATMATSuggestions({ itemId })).suggestions;
    expect(sug).toMatchObject({ catmatCode: "583920", verified: false, source: "sem-proveniencia" });
    const e = await err(api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: sug.id, idempotencyKey: `hash-${RUN}` }));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(e?.message).toMatch(/CATMAT_SUGGESTION_UNVERIFIED/);
    expect((await err(api.itemIntelligence.acceptCATMAT({ itemId, matchId: sug.id, catmatCode: "583920" })))?.message).toMatch(/CATMAT_SUGGESTION_UNVERIFIED/);
    expect(await n("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [ORG, itemId])).toBe(0);
    expect((await rows<{ s: string | null }>("SELECT suggested_catmat s FROM intelligent_items WHERE id = ?", [itemId]))[0].s).toBeNull();
    // O histórico legado permanece (não é apagado nem reescrito).
    expect(await n("SELECT COUNT(*) n FROM item_catmat_matches WHERE id = ?", [`lg${RUN}`.slice(0, 20)])).toBe(1);
  }, 120_000);

  it("Buscar classificação (CATMAT): alternativas OFICIAIS verificadas + evidência; confirmação governada com fonte oficial; replay idempotente", async () => {
    const { pid, itemId } = await newProcessWithItem("ok");
    serveFixtures();
    const api = await caller(U.operator);
    const res = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(lastUrls[0]).toContain("/modulo-material/4_consultarItemMaterial?");
    // Inativo e sem correspondência textual ficam fora; os demais são códigos da fonte, verificados.
    expect(res.candidates.map((c) => c.catmatCode).sort()).toEqual(["482201", "482202"]);
    expect(res.candidates.every((c) => c.verified && c.source === "api-comprasgov:catmat" && c.catalogType === "catmat")).toBe(true);
    expect(res.discarded).toMatchObject({ inactive: 1, irrelevant: 1 });
    expect(res.filterIgnoredSuspected).toBe(false);
    // Evidência persistida por órgão: snapshot com fonte/checksum + entradas com a descrição oficial.
    const [snap] = await rows<{ id: string; checksum: string; integrity_metadata: any }>("SELECT id, checksum, integrity_metadata FROM catalog_snapshots WHERE organization_id = ?", [ORG]);
    const meta = typeof snap.integrity_metadata === "string" ? JSON.parse(snap.integrity_metadata) : snap.integrity_metadata;
    expect(meta).toMatchObject({ source: "api-comprasgov", isValid: true });
    expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(res.snapshotId).toBe(snap.id);
    expect((await rows<{ d: string }>("SELECT description d FROM catalog_entries WHERE organization_id = ? AND code = '482201'", [ORG]))[0].d).toBe(DESKTOP);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND event_type = 'catalog_lookup'", [ORG, pid])).toBe(1);
    // Nada foi decidido nem aplicado ao item pela consulta.
    expect(await n("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [ORG, itemId])).toBe(0);

    const best = res.candidates.find((c) => c.catmatCode === "482201")!;
    const key = `ok-${RUN}`;
    const out = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: best.id, idempotencyKey: key });
    expect(out.replayed).toBe(false);
    expect(out.decision).toMatchObject({ decision: "confirmado", catmatCode: "482201", catmatDescription: DESKTOP, source: "api-comprasgov:catmat", actorUserId: U.operator });
    expect((await rows<{ s: string }>("SELECT suggested_catmat s FROM intelligent_items WHERE id = ?", [itemId]))[0].s).toBe("482201");
    const again = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: best.id, idempotencyKey: key });
    expect(again.replayed).toBe(true);
    expect(await n("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [ORG, itemId])).toBe(1);

    // Fonte ATUALIZADA (descrição oficial mudou): nova consulta não substitui a decisão humana; replay segue devolvendo o registro.
    serveFixtures({ resultado: [{ codigoItem: 482201, descricaoItem: `${DESKTOP}, NOVA REDAÇÃO`, statusItem: true }] });
    await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    const cur = await api.itemIntelligence.getCATMATDecisions({ itemId });
    expect(cur.current).toMatchObject({ decision: "confirmado", catmatCode: "482201", catmatDescription: DESKTOP });
    expect(await n("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [ORG, itemId])).toBe(1);
    const replay = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: best.id, idempotencyKey: key });
    expect(replay.replayed).toBe(true);
    expect(replay.decision.catmatDescription).toBe(DESKTOP);
    // Dois snapshots imutáveis (evidências distintas), nenhum apagado.
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = ?", [ORG])).toBe(2);
  }, 120_000);

  it("CATSER sem índice sincronizado ⇒ index_unavailable, nenhum parâmetro textual enviado, nada gravado", async () => {
    const { itemId } = await newProcessWithItem("noidx");
    serveFixtures();
    const res = await (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catser", term: "limpeza" });
    expect(res.status).toBe("index_unavailable");
    expect(res.status === "index_unavailable" && res.message).toMatch(/não oferece busca por descrição/);
    expect(lastUrls).toEqual([]); // nenhuma chamada com filtro ignorado
    expect(await n("SELECT COUNT(*) n FROM item_catmat_matches WHERE organization_id = ? AND item_id = ?", [ORG, itemId])).toBe(0);
  }, 120_000);

  it("CATSER — sincronização LIMITADA do índice: paginação com tamanhoPagina ≥ 10, snapshot versionado, sem parâmetro textual", async () => {
    serveFixtures();
    const partial = await syncCatalogIndex({ catalogType: "catser", pageSize: 5, maxPages: 2, correlationId: `cat-smoke-p-${RUN}` });
    expect(partial).toMatchObject({ status: "synced", pages: 2, entries: 20, complete: false, replayed: false }); // limite de páginas ⇒ parcial (sem índice completo ainda)
    lastUrls = [];
    const full = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-${RUN}` });
    expect(full).toMatchObject({ status: "synced", pages: 3, entries: 23, total: 23, complete: true });
    expect(lastUrls).toHaveLength(3);
    expect(lastUrls.every((u) => u.includes("/modulo-servico/") && /tamanhoPagina=10/.test(u) && !u.includes("descricaoItem") && u.includes("statusServico=true"))).toBe(true);
    const [snap] = await rows<{ integrity_metadata: any }>("SELECT integrity_metadata FROM catalog_snapshots WHERE id = ?", [full.snapshotId]);
    const meta = typeof snap.integrity_metadata === "string" ? JSON.parse(snap.integrity_metadata) : snap.integrity_metadata;
    expect(meta).toMatchObject({ kind: "indice", source: "api-comprasgov", complete: true, entries: 23 });
    // Falha no meio ⇒ nada gravado; índice anterior preservado.
    __setOfficialCatalogFetchForTests(async () => { throw new Error("ECONNRESET"); });
    expect(await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 5, correlationId: `cat-smoke-f-${RUN}` })).toMatchObject({ status: "failed" });
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND correlation_id = ?", [`cat-smoke-f-${RUN}`])).toBe(0);
    // Parcial NUNCA substitui o completo publicado.
    serveFixtures();
    const regress = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 1, correlationId: `cat-smoke-r-${RUN}` });
    expect(regress).toMatchObject({ status: "failed", reason: expect.stringContaining("índice completo anterior preservado") });
    expect((await getLatestCatalogIndex("catser"))?.snapshotId).toBe(full.snapshotId);
  }, 120_000);

  it("ATOMICIDADE do índice: falha NO MEIO da persistência ⇒ rollback (nenhum snapshot novo visível, índice anterior intacto); replay idempotente; publicação concorrente recusada", async () => {
    serveFixtures();
    const before = await getLatestCatalogIndex("catser");
    expect(before?.complete).toBe(true);
    const snapsBefore = await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND catalog_type = 'catser'");
    const entriesBefore = await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND catalog_type = 'catser'");

    // Nova versão do catálogo (um serviço a mais) + falha injetada DEPOIS de gravar o 1º lote de entradas.
    catserListing = [...CATSER_ALL, { codigoServico: 29999, nomeServico: "Limpeza de caixas d'água", statusServico: true }];
    serveFixtures();
    __setCatalogIndexWriteFaultForTests((written) => { if (written > 0) throw new Error("falha simulada no meio da persistência"); });
    const failed = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-x-${RUN}` });
    expect(failed).toMatchObject({ status: "failed", reason: expect.stringContaining("falha simulada") });
    __setCatalogIndexWriteFaultForTests(null);
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND catalog_type = 'catser'")).toBe(snapsBefore);
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND catalog_type = 'catser'")).toBe(entriesBefore);
    expect((await getLatestCatalogIndex("catser"))?.snapshotId).toBe(before!.snapshotId);
    __clearCatalogIndexCacheForTests();
    const stillOld = await searchCatalogIndex("catser", "caixas d'água");
    expect(stillOld.status === "ok" && stillOld.results.map((r) => r.entry.code)).not.toContain("29999");

    // Publicação concorrente (lock do catálogo ocupado) ⇒ recusada, nada gravado.
    await conn.query("SELECT GET_LOCK(?, 0)", [catalogIndexLockKey("catser")]);
    try {
      const busy = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-c-${RUN}`, lockWaitSeconds: 1 });
      expect(busy).toMatchObject({ status: "failed", reason: expect.stringContaining("CATALOG_INDEX_SYNC_IN_PROGRESS") });
      expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND catalog_type = 'catser'")).toBe(snapsBefore);
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [catalogIndexLockKey("catser")]);
    }

    // Retentativa sem falha ⇒ publica a nova versão por inteiro; o snapshot anterior e suas entradas permanecem.
    const ok = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-y-${RUN}` });
    expect(ok).toMatchObject({ status: "synced", entries: 24, complete: true, replayed: false });
    expect((await getLatestCatalogIndex("catser"))?.snapshotId).toBe(ok.snapshotId);
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND snapshot_id = ?", [ok.snapshotId])).toBe(24);
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND snapshot_id = ?", [before!.snapshotId])).toBe(23);
    // Replay: mesmo conteúdo ⇒ nenhuma escrita.
    const again = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-z-${RUN}` });
    expect(again).toMatchObject({ status: "synced", snapshotId: ok.snapshotId, replayed: true });
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND catalog_type = 'catser' AND id = ?", [ok.snapshotId])).toBe(1);
    // Volta ao catálogo-base para os próximos cenários.
    catserListing = CATSER_ALL;
    serveFixtures();
    expect((await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-b-${RUN}` })).status).toBe("synced");
  }, 120_000);

  it("INTEGRIDADE fail-closed sobre índice vigente: descarte, duplicidade, total divergente/ausente/alterado ⇒ nada gravado, snapshot anterior vigente; replay sem escrita", async () => {
    serveFixtures();
    const base = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-i0-${RUN}` });
    expect(base).toMatchObject({ status: "synced", complete: true, entries: 23, total: 23 });
    const vigente = (await getLatestCatalogIndex("catser"))!;
    expect(vigente.snapshotId).toBe(base.snapshotId);
    const snaps = () => n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = 0 AND catalog_type = 'catser'");
    const ents = () => n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND catalog_type = 'catser'");
    const [snapsBefore, entsBefore] = [await snaps(), await ents()];

    /** Listagem paginada com uma adulteração por cenário (sobre o catálogo-base de 23 serviços). */
    const serveListing = (mutate: (body: Record<string, unknown>, page: number) => Record<string, unknown>) => {
      __clearOfficialCatalogCacheForTests();
      __setOfficialCatalogFetchForTests(async (url) => {
        const q = new URL(url).searchParams;
        const page = Number(q.get("pagina")); const size = Number(q.get("tamanhoPagina"));
        const body = { resultado: CATSER_ALL.slice((page - 1) * size, page * size) as unknown[], totalRegistros: CATSER_ALL.length, paginasRestantes: Math.max(0, Math.ceil(CATSER_ALL.length / size) - page) };
        return { ok: true, status: 200, json: async () => mutate(body, page) };
      });
    };
    const scenarios: Array<[string, (b: Record<string, unknown>, page: number) => Record<string, unknown>, RegExp]> = [
      ["descarte", (b, page) => (page === 1 ? { ...b, resultado: [...(b.resultado as unknown[]).slice(0, 9), { codigoServico: "X1", nomeServico: "INVÁLIDO", statusServico: true }] } : b), /descartado/],
      ["duplicidade", (b, page) => (page === 2 ? { ...b, resultado: [CATSER_ALL[0], ...(b.resultado as unknown[]).slice(1)] } : b), /repetido/],
      ["total-divergente", (b) => ({ ...b, totalRegistros: 40, paginasRestantes: undefined }), /totalRegistros oficial 40/],
      ["total-ausente", (b) => ({ resultado: b.resultado }), /não informou totalRegistros/],
      ["total-alterado", (b, page) => (page === 3 ? { ...b, totalRegistros: 24 } : b), /totalRegistros mudou/],
    ];
    for (const [tag, mutate, reason] of scenarios) {
      serveListing(mutate);
      const r = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-i-${tag}-${RUN}` });
      expect(r, tag).toMatchObject({ status: "failed", snapshotId: null, complete: false });
      expect(r.reason, tag).toMatch(reason);
      expect(await snaps(), tag).toBe(snapsBefore);
      expect(await ents(), tag).toBe(entsBefore);
      expect((await getLatestCatalogIndex("catser"))?.snapshotId, tag).toBe(vigente.snapshotId);
    }
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE correlation_id LIKE ?", [`cat-smoke-i-%-${RUN}`])).toBe(0);
    // O snapshot vigente continua íntegro e servindo a busca.
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND snapshot_id = ?", [vigente.snapshotId])).toBe(23);
    __clearCatalogIndexCacheForTests();
    const found = await searchCatalogIndex("catser", "limpeza");
    expect(found.status === "ok" && found.results.map((x) => x.entry.code)).toContain("24961");
    // Fonte normalizada ⇒ mesmo conteúdo ⇒ replay sem nenhuma escrita.
    serveFixtures();
    const again = await syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages: 50, correlationId: `cat-smoke-i9-${RUN}` });
    expect(again).toMatchObject({ status: "synced", complete: true, replayed: true, publication: "replayed", snapshotId: vigente.snapshotId });
    expect([await snaps(), await ents()]).toEqual([snapsBefore, entsBefore]);
  }, 120_000);

  it("CONCORRÊNCIA REAL: lock retido até o COMMIT; parcial × completo revalidado na serialização; vigente segue a política após commits concorrentes", async () => {
    // Namespace isolado do teste: índice CATMAT da org global (o app não usa índice CATMAT).
    const entries = (n: number, tag: string): OfficialCatalogEntry[] =>
      Array.from({ length: n }, (_, i) => ({ catalogType: "catmat", code: `88${tag}${String(i).padStart(3, "0")}`, description: `ITEM SINTÉTICO ${tag} ${i}`, active: true, group: null }));
    const publish = (tag: string, n: number, complete: boolean) => recordCatalogIndexSnapshot({
      catalogType: "catmat", entries: entries(n, tag), checksum: `ck-${tag}-${RUN}`, retrievedAt: new Date().toISOString(),
      sourceUrl: "https://dadosabertos.compras.gov.br/teste", pages: 1, total: n, complete, pageSize: 10, correlationId: `cat-smoke-cc-${tag}-${RUN}`,
    });
    const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** Pausa a 1ª publicação DENTRO da transação (lock retido, nada commitado) até `release()`. */
    function pauseFirst() {
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const reached = new Promise<void>((r) => { entered = r; });
      let used = false;
      __setCatalogIndexWriteFaultForTests(async () => { if (used) return; used = true; entered(); await gate; });
      return { release, reached };
    }
    const lockHolder = async () => {
      const [r] = await conn.query<mysql.RowDataPacket[]>("SELECT IS_USED_LOCK(?) AS h", [catalogIndexLockKey("catmat")]);
      return r[0].h as number | null;
    };

    // Ordem 1 — PARCIAL inicia primeiro (sem índice vigente) e é pausada; COMPLETO concorre.
    expect(await getLatestCatalogIndex("catmat")).toBeNull();
    let g = pauseFirst();
    const pPartial = publish("01", 5, false);
    await g.reached;
    let completeDone = false;
    const pComplete = publish("02", 7, true).then((r) => { completeDone = true; return r; });
    await tick(600);
    expect(completeDone).toBe(false);                               // bloqueado: exclusividade até o commit
    expect(await lockHolder()).not.toBeNull();                       // lock retido pela 1ª conexão
    expect(await getLatestCatalogIndex("catmat")).toBeNull();        // nada commitado ainda ⇒ nada vigente
    g.release();
    const [r1, r2] = await Promise.all([pPartial, pComplete]);
    __setCatalogIndexWriteFaultForTests(null);
    expect(r1).toMatchObject({ status: "published" });
    expect(r2).toMatchObject({ status: "published" });               // completo depois de parcial ⇒ publica
    const v1 = await getLatestCatalogIndex("catmat");
    expect(v1).toMatchObject({ snapshotId: r2!.snapshotId, complete: true, entries: 7 });
    expect(await lockHolder()).toBeNull();                           // liberado após o commit

    // Ordem 2 — COMPLETO (novo conteúdo) pausado; PARCIAL concorre ⇒ revalidado DENTRO da serialização ⇒ recusado.
    g = pauseFirst();
    const pComplete2 = publish("03", 8, true);
    await g.reached;
    let partialDone = false;
    const pPartial2 = publish("04", 3, false).then((r) => { partialDone = true; return r; });
    await tick(600);
    expect(partialDone).toBe(false);
    expect((await getLatestCatalogIndex("catmat"))?.snapshotId).toBe(r2!.snapshotId); // vigente anterior intacto
    g.release();
    const [r3, r4] = await Promise.all([pComplete2, pPartial2]);
    __setCatalogIndexWriteFaultForTests(null);
    expect(r3).toMatchObject({ status: "published" });
    expect(r4).toMatchObject({ status: "refused_partial", currentSnapshotId: r3!.snapshotId });
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE id = ?", [r4!.snapshotId])).toBe(0); // nada gravado
    expect((await getLatestCatalogIndex("catmat"))).toMatchObject({ snapshotId: r3!.snapshotId, complete: true, entries: 8 });

    // Replay e recondução: mesmo conteúdo do vigente ⇒ sem escrita; conteúdo anterior ⇒ volta a vigente (entradas intactas).
    expect(await publish("03", 8, true)).toMatchObject({ status: "replayed", snapshotId: r3!.snapshotId });
    expect(await publish("02", 7, true)).toMatchObject({ status: "republished", snapshotId: r2!.snapshotId });
    expect((await getLatestCatalogIndex("catmat"))?.snapshotId).toBe(r2!.snapshotId);
    for (const [id, nEnt] of [[r1!.snapshotId, 5], [r2!.snapshotId, 7], [r3!.snapshotId, 8]] as const) {
      expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = 0 AND snapshot_id = ?", [id])).toBe(nEnt); // imutáveis
    }
    // O índice CATSER do app não foi tocado pela concorrência no CATMAT (lock e snapshots por catálogo).
    expect((await getLatestCatalogIndex("catser"))?.complete).toBe(true);
  }, 120_000);

  it("CATSER — busca no índice + verificação POR CÓDIGO (codigoServico) na fonte; confirma com fonte oficial; isolado do órgão", async () => {
    const { itemId } = await newProcessWithItem("ser");
    serveFixtures();
    const api = await caller(U.operator);
    const res = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catser", term: "manutenção de computadores desktop" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.method).toBe("indice-sincronizado");
    expect(res.candidates.map((c) => [c.catmatCode, c.catalogType, c.source, c.verified])).toEqual([["27502", "catser", "api-comprasgov:catser", true]]);
    // Só consultas por código ao CATSER (≤ VERIFY_TOP_K), nunca filtro textual.
    expect(lastUrls.length).toBeGreaterThan(0);
    expect(lastUrls.length).toBeLessThanOrEqual(5);
    expect(lastUrls.every((u) => u.includes("/modulo-servico/") && u.includes("codigoServico=") && !u.includes("descricaoItem"))).toBe(true);
    const out = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: res.candidates[0].id, idempotencyKey: `ser-${RUN}` });
    expect(out.decision).toMatchObject({ catmatCode: "27502", source: "api-comprasgov:catser" });
    // Evidência por código registrada no ÓRGÃO (não na org global do índice).
    expect(await n("SELECT COUNT(*) n FROM catalog_entries WHERE organization_id = ? AND code = '27502'", [ORG])).toBe(1);
  }, 120_000);

  it("ADVERSARIAL CATSER: termo sem correspondência ('limpeza hospitalar de jardins') ou índice defasado (inativo na fonte) ⇒ nada sugerido", async () => {
    const { itemId } = await newProcessWithItem("seradv");
    serveFixtures();
    const api = await caller(U.operator);
    const none = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catser", term: "jardinagem paisagismo" });
    expect(none.status === "ok" && none.candidates).toEqual([]);
    // Serviços hospitalares (o que a API devolveu a "limpeza") nunca viram sugestão de limpeza.
    const limpeza = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catser", term: "limpeza" });
    expect(limpeza.status === "ok" && limpeza.candidates.map((c) => c.catmatCode)).toEqual(["24961"]);
    // Defasagem: o código saiu da fonte (inativo) depois da sincronização ⇒ não verificado, não sugerido.
    catserByCode.set("27502", { codigoServico: 27502, nomeServico: "Manutenção de computadores desktop", statusServico: false });
    serveFixtures();
    const { itemId: it2 } = await newProcessWithItem("serstale");
    const stale = await api.itemIntelligence.buscarClassificacaoOficial({ itemId: it2, catalogType: "catser", term: "manutenção de computadores desktop" });
    expect(stale.status === "ok" && [stale.candidates.length, stale.discarded.unverified]).toEqual([0, 1]);
  }, 120_000);

  it("CATMAT: vazio é legítimo; linhas sem relação com o termo ⇒ filtro possivelmente ignorado, nada sugerido", async () => {
    const { itemId } = await newProcessWithItem("matadv");
    const api = await caller(U.operator);
    serveFixtures({ resultado: [], totalRegistros: 0 });
    const empty = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat", term: "notebook" });
    expect(empty).toMatchObject({ status: "ok", returned: 0, filterIgnoredSuspected: false, candidates: [] });
    serveFixtures({ resultado: [{ codigoItem: 222333, descricaoItem: "CANETA ESFEROGRÁFICA AZUL", statusItem: true }], totalRegistros: 1 });
    const ignored = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat", term: "computador desktop" });
    expect(ignored).toMatchObject({ status: "ok", returned: 1, filterIgnoredSuspected: true, candidates: [] });
    expect(await n("SELECT COUNT(*) n FROM item_catmat_matches WHERE organization_id = ? AND item_id = ?", [ORG, itemId])).toBe(0);
  }, 120_000);

  it("Verificar código: CATMAT (codigoItem) encontrado ⇒ alternativa verificada e confirmável; inexistente/inativo ⇒ nada sugerido; CATSER por codigoServico", async () => {
    const { itemId } = await newProcessWithItem("code");
    serveFixtures();
    const api = await caller(U.operator);
    const ok = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: "482201" });
    expect(ok.status).toBe("verified");
    if (ok.status !== "verified") return;
    expect(ok.candidate).toMatchObject({ catmatCode: "482201", catmatDescription: DESKTOP, verified: true, source: "api-comprasgov:catmat", matchSource: "codigo" });
    expect(lastUrls.at(-1)).toMatch(/codigoItem=482201/);
    const missing = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: "999999" });
    expect(missing.status).toBe("not_found");
    const inactive = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: "300777" });
    expect(inactive.status).toBe("inactive");
    expect((await api.itemIntelligence.getCATMATSuggestions({ itemId })).suggestions.map((x) => x.catmatCode)).toEqual(["482201"]);
    const svc = await api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catser", code: "24961" });
    expect(svc.status === "verified" && svc.candidate.source).toBe("api-comprasgov:catser");
    expect(lastUrls.at(-1)).toMatch(/modulo-servico\/6_consultarItemServico\?pagina=1&tamanhoPagina=10&codigoServico=24961$/);
    const out = await api.itemIntelligence.decidirCATMAT({ itemId, decision: "confirmado", suggestionId: ok.candidate.id, idempotencyKey: `code-${RUN}` });
    expect(out.decision).toMatchObject({ catmatCode: "482201", source: "api-comprasgov:catmat" });
    expect((await err(api.itemIntelligence.verificarCodigoOficial({ itemId, catalogType: "catmat", code: "48A201" })))?.code).toBe("BAD_REQUEST");
  }, 120_000);

  it("catálogo INDISPONÍVEL: nenhuma sugestão/evidência criada, classificação pendente, falha registrada na linha do tempo; retentativa funciona", async () => {
    const { pid, itemId } = await newProcessWithItem("down");
    __clearOfficialCatalogCacheForTests();
    __setOfficialCatalogFetchForTests(async () => { throw new Error("ECONNRESET"); });
    const snapsBefore = await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = ?", [ORG]);
    const api = await caller(U.operator);
    const res = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(res).toMatchObject({ status: "unavailable", reason: "network" });
    expect(res.status === "unavailable" && res.message).toMatch(/Nenhum código foi sugerido nem alterado/);
    expect(await n("SELECT COUNT(*) n FROM item_catmat_matches WHERE organization_id = ? AND item_id = ?", [ORG, itemId])).toBe(0);
    expect(await n("SELECT COUNT(*) n FROM catalog_snapshots WHERE organization_id = ?", [ORG])).toBe(snapsBefore);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND event_type = 'catalog_lookup' AND summary LIKE ?", [ORG, pid, "%indisponível%"])).toBe(1);
    serveFixtures();
    const retry = await api.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    expect(retry.status === "ok" && retry.candidates.length).toBe(2);
  }, 120_000);

  it("ISOLAMENTO: outro órgão não busca/lê o item; evidência de um órgão não verifica sugestão de outro", async () => {
    const { itemId } = await newProcessWithItem("iso");
    serveFixtures();
    await (await caller(U.operator)).itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" });
    const apiB = await caller(U.ownerB, ORG_B);
    expect((await err(apiB.itemIntelligence.buscarClassificacaoOficial({ itemId, catalogType: "catmat" })))?.code).toBe("NOT_FOUND");
    expect((await apiB.itemIntelligence.getCATMATSuggestions({ itemId })).suggestions).toEqual([]);
    expect((await apiB.itemIntelligence.getCATMATDecisions({ itemId })).history).toEqual([]);
    // Mesmo código/descrição numa sugestão do órgão B, sem consulta do órgão B ⇒ não verificada.
    await insertCatmatMatch({ id: `iso${RUN}`.slice(0, 20), itemId: `ib${RUN}`.slice(0, 20), organizationId: ORG_B, catmatCode: "482201", catmatDescription: DESKTOP, score: 1, rank: 0, decision: "sugerido", correlationId: "iso", createdAt: new Date().toISOString() });
    const { listVerifiedSuggestions } = await import("../../services/itemCatalogClassificationService");
    expect((await listVerifiedSuggestions(`ib${RUN}`.slice(0, 20), ORG_B))[0]).toMatchObject({ verified: false });
  }, 120_000);
});
