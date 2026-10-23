/**
 * Cliente ÚNICO do catálogo oficial CATMAT/CATSER (Compras.gov.br — Dados Abertos).
 *
 * Usado pela busca pública (`catmatRouter`) e pelo fluxo dos Itens Inteligentes. CONTRATOS HTTP SEPARADOS por catálogo
 * (validados contra a API real no Console do Railway staging, 16/10/2026):
 *   - CATMAT `4_consultarItemMaterial`: `codigoItem`, `statusItem`, `descricaoItem` (filtro textual documentado — seu
 *     comportamento real é medido pelo `catalog:smoke`; o resultado sempre passa pelo filtro de relevância local).
 *   - CATSER `6_consultarItemServico`: `codigoServico`, `statusServico`; payload `codigoServico`/`nomeServico`/
 *     `statusServico`. NÃO há filtro textual documentado: nenhum parâmetro textual é enviado (a busca por descrição
 *     de serviços usa o índice sincronizado — ver `itemCatalogClassificationService`).
 *   - Paginação: `pagina` + `tamanhoPagina` SEMPRE enviados; `tamanhoPagina` mínimo 10 (exigência da API).
 * Garantias: timeout (AbortController) e erro classificado (`disabled` | `timeout` | `http_error` | `network` |
 * `malformed`); indisponível NUNCA produz candidato; cache em memória só de respostas válidas (dados públicos);
 * `fetch` injetável nos testes (o CI não depende da API externa).
 */
import { CATALOG_CONFIG } from "../config/catalog";
import {
  parseOfficialCatalogPayload, catalogEvidenceChecksum,
  type OfficialCatalogEntry, type OfficialCatalogType,
} from "../domain/officialCatalog";

export interface CatalogHttpContract {
  readonly endpoint: string;
  readonly codeParam: string;
  readonly statusParam: string;
  /** Filtro textual DOCUMENTADO do endpoint; `null` = não existe (nunca enviar parâmetro que a fonte ignora). */
  readonly textParam: string | null;
}

export const OFFICIAL_CATALOG_CONTRACTS: Record<OfficialCatalogType, CatalogHttpContract> = {
  catmat: { endpoint: "/modulo-material/4_consultarItemMaterial", codeParam: "codigoItem", statusParam: "statusItem", textParam: "descricaoItem" },
  catser: { endpoint: "/modulo-servico/6_consultarItemServico", codeParam: "codigoServico", statusParam: "statusServico", textParam: null },
};

/** Compatibilidade: endpoint por catálogo. */
export const OFFICIAL_CATALOG_ENDPOINTS: Record<OfficialCatalogType, string> = {
  catmat: OFFICIAL_CATALOG_CONTRACTS.catmat.endpoint,
  catser: OFFICIAL_CATALOG_CONTRACTS.catser.endpoint,
};

/** Exigência da API: `tamanhoPagina` mínimo 10. */
export const MIN_PAGE_SIZE = 10;
const clampPageSize = (n: number | undefined) => Math.max(MIN_PAGE_SIZE, Math.floor(n ?? MIN_PAGE_SIZE));

export type CatalogUnavailableReason = "disabled" | "timeout" | "http_error" | "network" | "malformed";

export type OfficialCatalogQuery = { term?: string; code?: string; page: number; pageSize: number };

export type OfficialCatalogOk = {
  readonly status: "ok"; readonly catalogType: OfficialCatalogType; readonly entries: OfficialCatalogEntry[];
  readonly total: number | null; readonly remainingPages: number | null; readonly discardedRows: number;
  readonly retrievedAt: string; readonly sourceUrl: string; readonly checksum: string; readonly query: OfficialCatalogQuery;
  readonly cached: boolean;
};

export type OfficialCatalogUnavailable = {
  readonly status: "unavailable"; readonly catalogType: OfficialCatalogType; readonly reason: CatalogUnavailableReason; readonly detail: string;
};

export type OfficialCatalogQueryResult = OfficialCatalogOk | OfficialCatalogUnavailable;

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let injectedFetch: FetchLike | null = null;
/** Testes: injeta o transporte (respostas contratuais) — `null` restaura o padrão. */
export function __setOfficialCatalogFetchForTests(f: FetchLike | null): void { injectedFetch = f; }

const cache = new Map<string, { at: number; value: OfficialCatalogOk }>();
export function __clearOfficialCatalogCacheForTests(): void { cache.clear(); }

export const UNAVAILABLE_MESSAGES: Record<CatalogUnavailableReason, string> = {
  disabled: "A consulta ao catálogo oficial está desligada neste ambiente.",
  timeout: "O catálogo oficial não respondeu a tempo.",
  http_error: "O catálogo oficial recusou ou não conseguiu atender a consulta.",
  network: "Não foi possível conectar ao catálogo oficial.",
  malformed: "O catálogo oficial devolveu uma resposta em formato não reconhecido.",
};

/** Transporte bruto (também usado pelo retorno histórico do `catmatRouter`). */
export async function fetchOfficialCatalogRaw(
  catalogType: OfficialCatalogType, params: Record<string, string>,
): Promise<{ ok: true; json: unknown; url: string } | { ok: false; reason: Exclude<CatalogUnavailableReason, "malformed">; detail: string; url: string }> {
  const url = new URL(`${CATALOG_CONFIG.baseUrl}${OFFICIAL_CATALOG_CONTRACTS[catalogType].endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const href = url.toString();
  const transport: FetchLike | null = injectedFetch ?? (CATALOG_CONFIG.enabled ? (globalThis.fetch as unknown as FetchLike) : null);
  if (!transport) return { ok: false, reason: "disabled", detail: "CATALOG_OFFICIAL_ENABLED=false", url: href };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CATALOG_CONFIG.timeoutMs);
  try {
    const res = await transport(href, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: "http_error", detail: `HTTP ${res.status}`, url: href };
    return { ok: true, json: await res.json(), url: href };
  } catch (err) {
    const aborted = ctrl.signal.aborted || (err as { name?: string })?.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network", detail: aborted ? `>${CATALOG_CONFIG.timeoutMs}ms` : String((err as Error)?.message ?? err), url: href };
  } finally {
    clearTimeout(timer);
  }
}

/** Parâmetros de uma consulta, SEMPRE com paginação válida e só com parâmetros documentados do catálogo. */
export function buildCatalogParams(catalogType: OfficialCatalogType, q: {
  page?: number; pageSize?: number; code?: string; term?: string; activeOnly?: boolean;
}): Record<string, string> {
  const c = OFFICIAL_CATALOG_CONTRACTS[catalogType];
  const params: Record<string, string> = { pagina: String(Math.max(1, Math.floor(q.page ?? 1))), tamanhoPagina: String(clampPageSize(q.pageSize)) };
  if (q.code) params[c.codeParam] = q.code;
  if (q.term) {
    if (!c.textParam) throw new Error(`O catálogo ${catalogType.toUpperCase()} não tem filtro textual documentado.`);
    params[c.textParam] = q.term;
  }
  if (q.activeOnly) params[c.statusParam] = "true";
  return params;
}

function readRemainingPages(json: unknown): number | null {
  const v = json && typeof json === "object" ? (json as Record<string, unknown>).paginasRestantes : undefined;
  return typeof v === "number" ? v : null;
}

async function query(catalogType: OfficialCatalogType, q: OfficialCatalogQuery, params: Record<string, string>, useCache = true): Promise<OfficialCatalogQueryResult> {
  const key = `${catalogType}|${JSON.stringify(params)}`;
  const hit = useCache ? cache.get(key) : undefined;
  if (hit && CATALOG_CONFIG.cacheTtlMs > 0 && Date.now() - hit.at < CATALOG_CONFIG.cacheTtlMs) return { ...hit.value, cached: true };
  const raw = await fetchOfficialCatalogRaw(catalogType, params);
  if (!raw.ok) {
    console.warn(`[CATALOGO-OFICIAL] ${catalogType} indisponível (${raw.reason}): ${raw.detail}`);
    return { status: "unavailable", catalogType, reason: raw.reason, detail: raw.detail };
  }
  const parsed = parseOfficialCatalogPayload(raw.json, catalogType);
  if (!parsed.ok) {
    console.warn(`[CATALOGO-OFICIAL] ${catalogType} resposta malformada.`);
    return { status: "unavailable", catalogType, reason: "malformed", detail: "payload sem lista reconhecível" };
  }
  const value: OfficialCatalogOk = {
    status: "ok", catalogType, entries: parsed.entries, total: parsed.total, remainingPages: readRemainingPages(raw.json),
    discardedRows: parsed.discardedRows, retrievedAt: new Date().toISOString(), sourceUrl: raw.url, query: q,
    checksum: catalogEvidenceChecksum({ catalogType, query: q, entries: parsed.entries }), cached: false,
  };
  if (useCache && CATALOG_CONFIG.cacheTtlMs > 0) cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Busca TEXTUAL — só CATMAT (único com filtro textual documentado). Resposta vazia é legítima ("nenhuma
 * correspondência"); o chamador SEMPRE aplica o filtro de relevância local (a fonte pode ignorar ou interpretar o filtro).
 */
export function searchOfficialCatalog(p: { catalogType: "catmat"; term: string; page?: number; pageSize?: number }): Promise<OfficialCatalogQueryResult> {
  const term = p.term.replace(/\s+/g, " ").trim();
  const page = p.page ?? 1;
  const pageSize = clampPageSize(p.pageSize);
  return query(p.catalogType, { term, page, pageSize }, buildCatalogParams(p.catalogType, { term, page, pageSize, activeOnly: true }));
}

/** Uma página do catálogo (sincronização do índice). Sem cache: cada página é lida uma vez por sincronização. */
export function listOfficialCatalogPage(p: { catalogType: OfficialCatalogType; page: number; pageSize: number; activeOnly?: boolean }): Promise<OfficialCatalogQueryResult> {
  const pageSize = clampPageSize(p.pageSize);
  return query(p.catalogType, { page: p.page, pageSize }, buildCatalogParams(p.catalogType, { page: p.page, pageSize, activeOnly: p.activeOnly ?? true }), false);
}

/** Consulta de um código específico (existência, descrição oficial e situação) — parâmetro de código DO catálogo. */
export async function lookupOfficialCode(p: { catalogType: OfficialCatalogType; code: string }): Promise<
  | { status: "found"; entry: OfficialCatalogEntry; result: OfficialCatalogOk }
  | { status: "not_found"; result: OfficialCatalogOk }
  | OfficialCatalogUnavailable
> {
  const code = p.code.trim();
  if (!/^\d{1,9}$/.test(code)) {
    return { status: "not_found", result: { status: "ok", catalogType: p.catalogType, entries: [], total: 0, remainingPages: 0, discardedRows: 0, retrievedAt: new Date().toISOString(), sourceUrl: "", checksum: "", query: { code, page: 1, pageSize: MIN_PAGE_SIZE }, cached: false } };
  }
  const res = await query(p.catalogType, { code, page: 1, pageSize: MIN_PAGE_SIZE }, buildCatalogParams(p.catalogType, { code }));
  if (res.status === "unavailable") return res;
  // A fonte pode ignorar o filtro: só vale a linha com o MESMO código (nunca "o primeiro da lista").
  const entry = res.entries.find((e) => e.code === code);
  return entry ? { status: "found", entry, result: res } : { status: "not_found", result: res };
}
