/**
 * CATMAT/CATSER — integração com o catálogo OFICIAL (Compras.gov.br), sem rede e sem banco.
 *
 * Fixtures CONTRATUAIS (formato do envelope `resultado` da API de Dados Abertos e nomes de campo de material/serviço),
 * montadas à mão: NÃO são respostas capturadas em runtime (o egresso desta suíte é bloqueado e o CI não pode depender da
 * API externa). O smoke real é separado (`scripts/catalog-official-smoke.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseOfficialCatalogPayload, catalogEvidenceChecksum, verifySuggestionAgainstEvidence, officialSourceLabel,
  type CatalogEvidence,
} from "../../domain/officialCatalog";
import { resolveCatalogConfig, CATALOG_CONFIG } from "../../config/catalog";
import {
  searchOfficialCatalog, lookupOfficialCode, __setOfficialCatalogFetchForTests, __clearOfficialCatalogCacheForTests,
} from "../../services/officialCatalogService";
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

  it("busca CATSER usa o endpoint de serviço (cache separado por catálogo)", async () => {
    __setOfficialCatalogFetchForTests(async (url) => { calls.push(url); return okJson(CATSER_LIMPEZA); });
    const r = await searchOfficialCatalog({ catalogType: "catser", term: "notebook" });
    expect(r.status === "ok" && r.catalogType).toBe("catser");
    expect(calls[0]).toContain("/modulo-servico/6_consultarItemServico?");
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
    expect(await lookupOfficialCode({ catalogType: "catmat", code: "999999" })).toEqual({ status: "not_found" });
    __clearOfficialCatalogCacheForTests();
    __setOfficialCatalogFetchForTests(async () => okJson(CATMAT_NOTEBOOK)); // ignora o filtro e devolve a lista
    expect(await lookupOfficialCode({ catalogType: "catmat", code: "583920" })).toEqual({ status: "not_found" });
  });
});
