/**
 * CATMAT/CATSER — integração com o catálogo OFICIAL (Compras.gov.br), sem rede e sem banco.
 *
 * Fixtures CONTRATUAIS montadas com os campos REAIS observados na API oficial (Console do Railway staging, 16/10/2026):
 * envelope `resultado`/`totalRegistros`; CATSER `codigoServico`/`nomeServico`/`statusServico`; `tamanhoPagina` ≥ 10;
 * CATMAT `descricaoItem=notebook` ⇒ `resultado: []` (vazio legítimo); CATSER ignora filtro textual e devolve serviços
 * sem relação (ex.: endoscopia para "limpeza"). Valores sintéticos; o CI não chama a API. Smoke real: `catalog:smoke`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseOfficialCatalogPayload, catalogEvidenceChecksum, verifySuggestionAgainstEvidence, officialSourceLabel,
  type CatalogEvidence,
} from "../../domain/officialCatalog";
import { resolveCatalogConfig, CATALOG_CONFIG } from "../../config/catalog";
import {
  searchOfficialCatalog, lookupOfficialCode, listOfficialCatalogPage, buildCatalogParams, OFFICIAL_CATALOG_CONTRACTS,
  __setOfficialCatalogFetchForTests, __clearOfficialCatalogCacheForTests,
} from "../../services/officialCatalogService";
import { rankRelevant, syncCatalogIndex, type CatalogIndexSyncResult } from "../../services/itemCatalogClassificationService";
import { syncExitCode, SYNC_EXIT } from "../../../scripts/catalog-official-sync";
import { rankCATMAT } from "../../domain/catmatMatching";

export const CATMAT_NOTEBOOK = {
  resultado: [
    { codigoGrupo: 70, nomeGrupo: "EQUIPAMENTOS DE TIC", codigoItem: 451868, descricaoItem: "COMPUTADOR PORTÁTIL (NOTEBOOK), MEMÓRIA RAM 8 GB, SSD 256 GB", statusItem: true },
    { codigoGrupo: 70, nomeGrupo: "EQUIPAMENTOS DE TIC", codigoItem: 451869, descricaoItem: "COMPUTADOR PORTÁTIL (NOTEBOOK), MEMÓRIA RAM 16 GB", statusItem: true },
    { codigoGrupo: 70, nomeGrupo: "EQUIPAMENTOS DE TIC", codigoItem: 300100, descricaoItem: "NOTEBOOK ANTIGO DESCONTINUADO", statusItem: false },
    { codigoGrupo: 75, nomeGrupo: "MATERIAL DE EXPEDIENTE", codigoItem: 222333, descricaoItem: "CANETA ESFEROGRÁFICA AZUL", statusItem: true },
  ],
  totalRegistros: 4, totalPaginas: 1, paginasRestantes: 0,
};

export const CATSER_LIMPEZA = {
  resultado: [
    { codigoServico: 24961, nomeServico: "Limpeza e conservação predial", statusServico: true },
    { codigoServico: 24962, nomeServico: "Limpeza de vidros em altura", statusServico: true },
  ],
  totalRegistros: 2,
};

/** Como a API REAL respondeu a `descricaoItem=limpeza` no CATSER: filtro ignorado, serviços sem relação. */
export const CATSER_IGNORED_FILTER = {
  resultado: [
    { codigoServico: 13056, nomeServico: "ENDOSCOPIA DIGESTIVA ALTA", statusServico: true },
    { codigoServico: 13057, nomeServico: "COLONOSCOPIA", statusServico: true },
    { codigoServico: 13090, nomeServico: "EXAME DE ULTRASSONOGRAFIA HOSPITALAR", statusServico: true },
  ],
  totalRegistros: 3,
};
/** Como a API REAL respondeu a `descricaoItem=notebook` no CATMAT. */
export const CATMAT_EMPTY = { resultado: [], totalRegistros: 0, totalPaginas: 0, paginasRestantes: 0 };

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> };
const okJson = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body });

describe("domínio — parser tolerante e fail-closed do payload oficial", () => {
  it("CATMAT: lê código, descrição oficial, situação e grupo do envelope `resultado`", () => {
    const p = parseOfficialCatalogPayload(CATMAT_NOTEBOOK, "catmat");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.entries).toHaveLength(4);
    expect(p.entries[0]).toEqual({ catalogType: "catmat", code: "451868", description: "COMPUTADOR PORTÁTIL (NOTEBOOK), MEMÓRIA RAM 8 GB, SSD 256 GB", active: true, group: "EQUIPAMENTOS DE TIC" });
    expect(p.entries[2].active).toBe(false);
    expect(p.total).toBe(4);
  });

  it("CATSER: lê os campos de serviço (codigoServico/nomeServico/statusServico)", () => {
    const p = parseOfficialCatalogPayload(CATSER_LIMPEZA, "catser");
    expect(p.ok && p.entries.map((e) => [e.catalogType, e.code, e.active])).toEqual([["catser", "24961", true], ["catser", "24962", true]]);
  });

  it("resposta malformada (sem lista, ou só linhas inválidas) ⇒ malformed; linha sem código/descrição é descartada", () => {
    expect(parseOfficialCatalogPayload({ mensagem: "erro" }, "catmat")).toEqual({ ok: false, reason: "malformed" });
    expect(parseOfficialCatalogPayload("<html>", "catmat")).toEqual({ ok: false, reason: "malformed" });
    expect(parseOfficialCatalogPayload({ resultado: [{ foo: 1 }, { codigoItem: "abc", descricaoItem: "x" }] }, "catmat")).toEqual({ ok: false, reason: "malformed" });
    const mixed = parseOfficialCatalogPayload({ resultado: [{ codigoItem: 1, descricaoItem: "A", statusItem: true }, { descricaoItem: "sem código" }] }, "catmat");
    expect(mixed.ok && mixed.discardedRows).toBe(1);
    // Lista vazia é resposta válida (nenhuma correspondência), não erro.
    expect(parseOfficialCatalogPayload({ resultado: [] }, "catmat")).toMatchObject({ ok: true, entries: [] });
  });

  it("situação não informada pela fonte ⇒ active null (não confirmável)", () => {
    const p = parseOfficialCatalogPayload({ data: [{ codigoItem: 9, descricaoItem: "X" }] }, "catmat");
    expect(p.ok && p.entries[0].active).toBeNull();
  });

  it("checksum da evidência é determinístico (independe da ordem das linhas)", () => {
    const p = parseOfficialCatalogPayload(CATMAT_NOTEBOOK, "catmat");
    if (!p.ok) throw new Error("fixture");
    const q = { term: "notebook", page: 1, pageSize: 10 };
    expect(catalogEvidenceChecksum({ catalogType: "catmat", query: q, entries: p.entries }))
      .toBe(catalogEvidenceChecksum({ catalogType: "catmat", query: q, entries: [...p.entries].reverse() }));
    expect(catalogEvidenceChecksum({ catalogType: "catmat", query: q, entries: p.entries }))
      .not.toBe(catalogEvidenceChecksum({ catalogType: "catser", query: q, entries: p.entries }));
  });
});

describe("domínio — verificação de sugestão contra a evidência oficial (adversarial)", () => {
  const ev: CatalogEvidence[] = [
    { catalogType: "catmat", code: "451868", description: "COMPUTADOR PORTÁTIL (NOTEBOOK), MEMÓRIA RAM 8 GB, SSD 256 GB", active: true, snapshotId: "s1", checksum: "c1", retrievedAt: "2026-10-16T12:00:00.000Z" },
    { catalogType: "catmat", code: "300100", description: "NOTEBOOK ANTIGO DESCONTINUADO", active: false, snapshotId: "s1", checksum: "c1", retrievedAt: "2026-10-16T12:00:00.000Z" },
  ];

  it("código gerado por hash (sem consulta oficial) ⇒ NÃO verificado", () => {
    const v = verifySuggestionAgainstEvidence({ catmatCode: "583920", catmatDescription: "Notebook i5 — especificação padrão" }, ev);
    expect(v).toMatchObject({ verified: false, source: "sem-proveniencia", evidence: null });
  });

  it("código real mas com descrição divergente (ex.: sugestão legada que colidiu com um código existente) ⇒ NÃO verificado", () => {
    expect(verifySuggestionAgainstEvidence({ catmatCode: "451868", catmatDescription: "Notebook — especificação padrão" }, ev).verified).toBe(false);
  });

  it("código inativo ⇒ NÃO verificado (com motivo); ativo + mesma descrição ⇒ verificado com fonte e evidência", () => {
    const inactive = verifySuggestionAgainstEvidence({ catmatCode: "300100", catmatDescription: "NOTEBOOK ANTIGO DESCONTINUADO" }, ev);
    expect(inactive).toMatchObject({ verified: false, reason: "Código inativo no catálogo oficial." });
    const ok = verifySuggestionAgainstEvidence({ catmatCode: "451868", catmatDescription: "computador portátil (notebook), memória ram 8 gb, ssd 256 gb" }, ev);
    expect(ok).toMatchObject({ verified: true, source: officialSourceLabel("catmat"), catalogType: "catmat" });
    expect(ok.evidence?.snapshotId).toBe("s1");
  });

  it("ranking textual só reordena códigos oficiais e é determinístico (empate ⇒ ordem por código)", () => {
    const p = parseOfficialCatalogPayload(CATMAT_NOTEBOOK, "catmat");
    if (!p.ok) throw new Error("fixture");
    const cands = p.entries.filter((e) => e.active).map((e) => ({ code: e.code, description: e.description, source: officialSourceLabel("catmat") }));
    const a = rankCATMAT({ itemId: "i", organizationId: 1, description: "notebook memória", candidates: cands, correlationId: "c", createdAt: "x" });
    const b = rankCATMAT({ itemId: "i", organizationId: 1, description: "notebook memória", candidates: [...cands].reverse(), correlationId: "c", createdAt: "x" });
    expect(a.map((m) => m.catmatCode)).toEqual(b.map((m) => m.catmatCode));
    expect(new Set(a.map((m) => m.catmatCode))).toEqual(new Set(cands.map((c) => c.code)));
    expect(a.every((m) => m.source === "api-comprasgov:catmat")).toBe(true);
    expect(a.find((m) => m.catmatCode === "222333")!.score).toBe(0); // sem correspondência textual
  });
});

describe("relevância local (catalogSearchEngine) — candidatos sem relação nunca viram sugestão", () => {
  it("ADVERSARIAL (comportamento real): 'limpeza' contra serviços hospitalares ⇒ nenhuma relevante", () => {
    const p = parseOfficialCatalogPayload(CATSER_IGNORED_FILTER, "catser");
    if (!p.ok) throw new Error("fixture");
    expect(rankRelevant("limpeza", p.entries, 10)).toEqual([]);
    expect(rankRelevant("serviço de limpeza predial", p.entries, 10)).toEqual([]);
  });

  it("correspondência real é encontrada e explicada (tipo de correspondência + termos casados)", () => {
    const p = parseOfficialCatalogPayload(CATSER_LIMPEZA, "catser");
    const m = parseOfficialCatalogPayload(CATMAT_NOTEBOOK, "catmat");
    if (!p.ok || !m.ok) throw new Error("fixture");
    const [r] = rankRelevant("limpeza", p.entries, 5);
    expect(r).toMatchObject({ entry: { code: "24961" }, matchedTokens: ["limpeza"] });
    expect(["exact", "alias", "normalized", "token", "semantic", "fuzzy"]).toContain(r.matchSource);
    // "notebook" casa a descrição oficial "COMPUTADOR PORTÁTIL (NOTEBOOK)…"; a caneta não aparece.
    const codes = rankRelevant("notebook", m.entries.filter((e) => e.active), 10).map((x) => x.entry.code);
    expect(codes).toEqual(expect.arrayContaining(["451868", "451869"]));
    expect(codes).not.toContain("222333");
  });
});

describe("config — catálogo oficial", () => {
  it("desligado por padrão na suíte de testes; ligado fora dela; endereço-base sem barra final", () => {
    expect(resolveCatalogConfig({}, { isTest: true }).enabled).toBe(false);
    expect(resolveCatalogConfig({}, { isTest: false })).toMatchObject({ enabled: true, baseUrl: "https://dadosabertos.compras.gov.br", timeoutMs: 8000 });
    expect(resolveCatalogConfig({ CATALOG_OFFICIAL_ENABLED: "false" }, { isTest: false }).enabled).toBe(false);
    expect(resolveCatalogConfig({ CATALOG_OFFICIAL_BASE_URL: "https://x.test/", CATALOG_OFFICIAL_TIMEOUT_MS: "1" }, { isTest: false })).toMatchObject({ baseUrl: "https://x.test", timeoutMs: 1000 });
  });
});

describe("serviço — consulta oficial com transporte injetado", () => {
  const calls: string[] = [];
  const originalTimeout = CATALOG_CONFIG.timeoutMs;
  beforeEach(() => { calls.length = 0; __clearOfficialCatalogCacheForTests(); });
  afterEach(() => { __setOfficialCatalogFetchForTests(null); (CATALOG_CONFIG as { timeoutMs: number }).timeoutMs = originalTimeout; });

  it("sem transporte injetado e desligado no ambiente de teste ⇒ indisponível (disabled), nada fabricado", async () => {
    const r = await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" });
    expect(r).toMatchObject({ status: "unavailable", reason: "disabled" });
  });

  it("busca CATMAT válida: endpoint de material, parâmetros históricos, evidência com checksum; 2ª chamada usa o cache", async () => {
    __setOfficialCatalogFetchForTests(async (url) => { calls.push(url); return okJson(CATMAT_NOTEBOOK); });
    const r = await searchOfficialCatalog({ catalogType: "catmat", term: "  notebook  " });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(calls[0]).toContain("/modulo-material/4_consultarItemMaterial?");
    expect(calls[0]).toContain("descricaoItem=notebook");
    expect(calls[0]).toContain("statusItem=true");
    expect(r.entries).toHaveLength(4);
    expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
    const again = await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" });
    expect(again.status === "ok" && again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("CONTRATOS SEPARADOS: CATSER nunca envia filtro textual; código por codigoServico; paginação sempre com tamanhoPagina ≥ 10", () => {
    expect(OFFICIAL_CATALOG_CONTRACTS.catser).toMatchObject({ codeParam: "codigoServico", statusParam: "statusServico", textParam: null });
    expect(OFFICIAL_CATALOG_CONTRACTS.catmat).toMatchObject({ codeParam: "codigoItem", statusParam: "statusItem", textParam: "descricaoItem" });
    expect(() => buildCatalogParams("catser", { term: "limpeza" })).toThrow(/não tem filtro textual/);
    expect(buildCatalogParams("catser", { code: "24961" })).toEqual({ pagina: "1", tamanhoPagina: "10", codigoServico: "24961" });
    expect(buildCatalogParams("catmat", { code: "451868" })).toEqual({ pagina: "1", tamanhoPagina: "10", codigoItem: "451868" });
    expect(buildCatalogParams("catser", { page: 3, pageSize: 5, activeOnly: true })).toEqual({ pagina: "3", tamanhoPagina: "10", statusServico: "true" });
    expect(buildCatalogParams("catmat", { term: "notebook", activeOnly: true })).toEqual({ pagina: "1", tamanhoPagina: "10", descricaoItem: "notebook", statusItem: "true" });
  });

  it("CATSER: consulta por código usa codigoServico (+ paginação) e lê nomeServico/statusServico", async () => {
    __setOfficialCatalogFetchForTests(async (url) => { calls.push(url); return okJson({ resultado: [CATSER_LIMPEZA.resultado[0]] }); });
    const r = await lookupOfficialCode({ catalogType: "catser", code: "24961" });
    expect(r.status === "found" && [r.entry.code, r.entry.description, r.entry.active]).toEqual(["24961", "Limpeza e conservação predial", true]);
    expect(calls[0]).toContain("/modulo-servico/6_consultarItemServico?");
    expect(calls[0]).toContain("codigoServico=24961");
    expect(calls[0]).toContain("tamanhoPagina=10");
    expect(calls[0]).not.toContain("codigoItem");
    expect(calls[0]).not.toContain("descricaoItem");
  });

  it("listagem paginada (sincronização do índice): sem cache, só parâmetros documentados", async () => {
    __setOfficialCatalogFetchForTests(async (url) => { calls.push(url); return okJson(CATSER_LIMPEZA); });
    await listOfficialCatalogPage({ catalogType: "catser", page: 2, pageSize: 100 });
    await listOfficialCatalogPage({ catalogType: "catser", page: 2, pageSize: 100 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/pagina=2&tamanhoPagina=100&statusServico=true$/);
  });

  it("CATMAT vazio é resposta LEGÍTIMA (nenhuma correspondência), não erro", async () => {
    __setOfficialCatalogFetchForTests(async () => okJson(CATMAT_EMPTY));
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "ok", entries: [], total: 0 });
  });

  it("API indisponível (HTTP 503 / erro de rede) ⇒ indisponível; falha NÃO é cacheada (retentativa consulta de novo)", async () => {
    __setOfficialCatalogFetchForTests(async (url) => { calls.push(url); return { ok: false, status: 503, json: async () => ({}) }; });
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "unavailable", reason: "http_error" });
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "unavailable" });
    expect(calls).toHaveLength(2);
    __setOfficialCatalogFetchForTests(async () => { throw new Error("ECONNREFUSED"); });
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "unavailable", reason: "network" });
  });

  it("timeout real (AbortController) ⇒ indisponível por timeout", async () => {
    (CATALOG_CONFIG as { timeoutMs: number }).timeoutMs = 30;
    __setOfficialCatalogFetchForTests((_url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "unavailable", reason: "timeout" });
  });

  it("resposta malformada ⇒ indisponível (malformed), nunca candidato", async () => {
    __setOfficialCatalogFetchForTests(async () => okJson({ erro: "formato inesperado" }));
    expect(await searchOfficialCatalog({ catalogType: "catmat", term: "notebook" })).toMatchObject({ status: "unavailable", reason: "malformed" });
  });

  it("consulta por código: encontrado (com situação), inexistente, e fonte que ignora o filtro não 'confirma' outro código", async () => {
    __setOfficialCatalogFetchForTests(async (url) => okJson(url.includes("codigoItem=451868") ? { resultado: [CATMAT_NOTEBOOK.resultado[0]] } : url.includes("codigoItem=300100") ? { resultado: [CATMAT_NOTEBOOK.resultado[2]] } : { resultado: [] }));
    const found = await lookupOfficialCode({ catalogType: "catmat", code: "451868" });
    expect(found.status === "found" && found.entry.active).toBe(true);
    const inactive = await lookupOfficialCode({ catalogType: "catmat", code: "300100" });
    expect(inactive.status === "found" && inactive.entry.active).toBe(false);
    expect(await lookupOfficialCode({ catalogType: "catmat", code: "999999" })).toMatchObject({ status: "not_found" });
    __clearOfficialCatalogCacheForTests();
    __setOfficialCatalogFetchForTests(async () => okJson(CATMAT_NOTEBOOK)); // ignora o filtro e devolve a lista
    expect(await lookupOfficialCode({ catalogType: "catmat", code: "583920" })).toMatchObject({ status: "not_found" });
  });
});

describe("sincronização do índice CATSER — integridade fail-closed (sem banco: nada pode ser publicado)", () => {
  const svc = (code: number | string, name = `SERVIÇO SINTÉTICO ${code}`) => ({ codigoServico: code, nomeServico: name, statusServico: true });
  const catalog = (n: number) => Array.from({ length: n }, (_, i) => svc(20000 + i));
  /** Página do envelope real; `total` e `paginasRestantes` coerentes com a listagem, salvo quando o cenário diz o contrário. */
  const pageOf = (rows: unknown[], page: number, size: number, total: number | null = rows.length) => ({
    resultado: rows.slice((page - 1) * size, page * size),
    ...(total === null ? {} : { totalRegistros: total, paginasRestantes: Math.max(0, Math.ceil(total / size) - page) }),
  });
  const urls: string[] = [];
  function servePages(build: (page: number, size: number) => unknown) {
    __clearOfficialCatalogCacheForTests();
    __setOfficialCatalogFetchForTests(async (url) => {
      urls.push(url);
      const q = new URL(url).searchParams;
      return okJson(build(Number(q.get("pagina")), Number(q.get("tamanhoPagina"))));
    });
  }
  const sync = (maxPages = 10) => syncCatalogIndex({ catalogType: "catser", pageSize: 10, maxPages, correlationId: "unit-sync" });
  const expectNothingPublished = (r: CatalogIndexSyncResult, reason: RegExp) => {
    expect(r).toMatchObject({ status: "failed", complete: false, snapshotId: null, replayed: false });
    expect(r.publication).toBeUndefined();
    expect(r.reason).toMatch(reason);
    expect(syncExitCode(r)).toBe(SYNC_EXIT.failed);
  };
  beforeEach(() => { urls.length = 0; });
  afterEach(() => { __setOfficialCatalogFetchForTests(null); __clearOfficialCatalogCacheForTests(); });

  it("página CHEIA com um registro descartado pelo leitor ⇒ falha na própria página (antes: encerraria a leitura e marcaria 'completo')", async () => {
    const rows: unknown[] = catalog(25);
    rows[3] = svc("SRV-INVALIDO"); // código não numérico ⇒ descartado ⇒ página 1 teria 9 entradas < 10
    servePages((page, size) => pageOf(rows, page, size));
    const r = await sync();
    expectNothingPublished(r, /1 registro\(s\) da página 1 descartado/);
    expect(urls).toHaveLength(1); // interrompe na página do problema
    // Descrição vazia também é descarte (não só código inválido).
    const rows2: unknown[] = catalog(25);
    rows2[14] = svc(20014, "   ");
    servePages((page, size) => pageOf(rows2, page, size));
    expectNothingPublished(await sync(), /página 2 descartado/);
  });

  it("DUPLICIDADE entre páginas (paginação instável) reduz os códigos únicos ⇒ falha, mesmo com total e contagem de linhas coerentes", async () => {
    const rows: unknown[] = catalog(25);
    rows[12] = svc(20001); // código da página 1 reaparece na página 2; o 20012 nunca é lido
    servePages((page, size) => pageOf(rows, page, size));
    const r = await sync();
    expectNothingPublished(r, /1 código\(s\) repetido\(s\) entre páginas \(25 linha\(s\), 24 código\(s\) único\(s\)\)/);
    expect(r).toMatchObject({ pages: 3, total: 25, entries: 24 });
  });

  it("DIVERGÊNCIA entre total declarado e coletado (fonte declara 30, entrega 25) ⇒ falha; nunca 'completo'", async () => {
    const rows = catalog(25);
    servePages((page, size) => ({ ...pageOf(rows, page, size, 30), paginasRestantes: page < 3 ? 1 : 0 }));
    const r = await sync();
    expectNothingPublished(r, /25 código\(s\) único\(s\) coletado\(s\) × totalRegistros oficial 30/);
  });

  it("totalRegistros AUSENTE ⇒ completude não comprovável ⇒ falha já na 1ª página", async () => {
    const rows = catalog(25);
    servePages((page, size) => pageOf(rows, page, size, null)); // sem totalRegistros nem paginasRestantes
    expectNothingPublished(await sync(), /não informou totalRegistros \(página 1\)/);
    expect(urls).toHaveLength(1);
  });

  it("totalRegistros ALTERADO durante a paginação (catálogo mudou na fonte) ⇒ falha", async () => {
    const rows = catalog(25);
    servePages((page, size) => pageOf(rows, page, size, page === 2 ? 26 : 25));
    expectNothingPublished(await sync(), /totalRegistros mudou durante a paginação \(25 → 26, página 2\)/);
  });

  it.skipIf(!!process.env.DATABASE_URL)("catálogo VÁLIDO e completo, mas banco INDISPONÍVEL ⇒ falha explícita, sem snapshotId nem sucesso operacional", async () => {
    const rows = catalog(25);
    servePages((page, size) => pageOf(rows, page, size));
    const r = await sync();
    expect(r).toMatchObject({ status: "failed", snapshotId: null, replayed: false, pages: 3, entries: 25, total: 25 });
    expect(r.reason).toMatch(/banco de dados indisponível — nenhum snapshot publicado/);
    expect(r.publication).toBeUndefined();
    expect(syncExitCode(r)).toBe(SYNC_EXIT.failed);
  });

  it("CLI: exit 0 SÓ para sincronização COMPLETA publicada; parcial ⇒ 2; falha ou sucesso sem snapshot ⇒ 1", () => {
    const base = { catalogType: "catser" as const, pages: 31, entries: 3022, total: 3022, replayed: false };
    expect(syncExitCode({ ...base, status: "synced", complete: true, snapshotId: "s1", publication: "published" })).toBe(0);
    expect(syncExitCode({ ...base, status: "synced", complete: true, snapshotId: "s1", replayed: true, publication: "replayed" })).toBe(0);
    expect(syncExitCode({ ...base, status: "synced", complete: false, snapshotId: "s2", publication: "published" })).toBe(2);
    expect(syncExitCode({ ...base, status: "synced", complete: true, snapshotId: null })).toBe(1);
    expect(syncExitCode({ ...base, status: "failed", complete: false, snapshotId: null, reason: "x" })).toBe(1);
  });
});
