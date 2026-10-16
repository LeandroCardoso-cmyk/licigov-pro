/**
 * Cliente ÚNICO do catálogo oficial CATMAT/CATSER (Compras.gov.br — Dados Abertos).
 *
 * Extraído do `catmatRouter` (que passa a delegar aqui) para que a busca pública e o fluxo dos Itens Inteligentes
 * usem a MESMA integração. Contrato:
 *   - timeout por consulta (AbortController) e erro classificado: `disabled` | `timeout` | `http_error` | `network` |
 *     `malformed`. Indisponível NUNCA produz candidato substituto;
 *   - cache em memória SÓ de respostas válidas (dados públicos do catálogo, sem dado de órgão); falha nunca é cacheada;
 *   - `fetch` injetável nos testes (o CI não depende da API externa).
 */
import { CATALOG_CONFIG } from "../config/catalog";
import {
  parseOfficialCatalogPayload, catalogEvidenceChecksum,
  type OfficialCatalogEntry, type OfficialCatalogType,
} from "../domain/officialCatalog";

/** Endpoints e parâmetros — os mesmos usados historicamente pelo `catmatRouter`. */
export const OFFICIAL_CATALOG_ENDPOINTS: Record<OfficialCatalogType, string> = {
  catmat: "/modulo-material/4_consultarItemMaterial",
  catser: "/modulo-servico/6_consultarItemServico",
};

export type CatalogUnavailableReason = "disabled" | "timeout" | "http_error" | "network" | "malformed";

export type OfficialCatalogQueryResult =
  | {
      readonly status: "ok"; readonly catalogType: OfficialCatalogType; readonly entries: OfficialCatalogEntry[];
      readonly total: number | null; readonly discardedRows: number; readonly retrievedAt: string; readonly sourceUrl: string;
      readonly checksum: string; readonly query: { term?: string; code?: string; page: number; pageSize: number };
      readonly cached: boolean;
    }
  | { readonly status: "unavailable"; readonly catalogType: OfficialCatalogType; readonly reason: CatalogUnavailableReason; readonly detail: string };

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let injectedFetch: FetchLike | null = null;
/** Testes: injeta o transporte (respostas contratuais) — `null` restaura o padrão. */
export function __setOfficialCatalogFetchForTests(f: FetchLike | null): void { injectedFetch = f; }

const cache = new Map<string, { at: number; value: Extract<OfficialCatalogQueryResult, { status: "ok" }> }>();
export function __clearOfficialCatalogCacheForTests(): void { cache.clear(); }

export const UNAVAILABLE_MESSAGES: Record<CatalogUnavailableReason, string> = {
  disabled: "A consulta ao catálogo oficial está desligada neste ambiente.",
  timeout: "O catálogo oficial não respondeu a tempo.",
  http_error: "O catálogo oficial recusou ou não conseguiu atender a consulta.",
  network: "Não foi possível conectar ao catálogo oficial.",
  malformed: "O catálogo oficial devolveu uma resposta em formato não reconhecido.",
};

/** Transporte bruto (compatível com o retorno histórico do `catmatRouter`). */
export async function fetchOfficialCatalogRaw(
  catalogType: OfficialCatalogType, params: Record<string, string>,
): Promise<{ ok: true; json: unknown; url: string } | { ok: false; reason: Exclude<CatalogUnavailableReason, "malformed">; detail: string; url: string }> {
  const url = new URL(`${CATALOG_CONFIG.baseUrl}${OFFICIAL_CATALOG_ENDPOINTS[catalogType]}`);
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

async function query(
  catalogType: OfficialCatalogType, q: { term?: string; code?: string; page: number; pageSize: number }, params: Record<string, string>,
): Promise<OfficialCatalogQueryResult> {
  const key = `${catalogType}|${q.term ?? ""}|${q.code ?? ""}|${q.page}|${q.pageSize}`;
  const hit = cache.get(key);
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
  const value = {
    status: "ok" as const, catalogType, entries: parsed.entries, total: parsed.total, discardedRows: parsed.discardedRows,
    retrievedAt: new Date().toISOString(), sourceUrl: raw.url, query: q,
    checksum: catalogEvidenceChecksum({ catalogType, query: q, entries: parsed.entries }), cached: false,
  };
  if (CATALOG_CONFIG.cacheTtlMs > 0) cache.set(key, { at: Date.now(), value });
  return value;
}

/** Busca por descrição (apenas itens ativos, como o router histórico). */
export function searchOfficialCatalog(p: { catalogType: OfficialCatalogType; term: string; page?: number; pageSize?: number }): Promise<OfficialCatalogQueryResult> {
  const term = p.term.replace(/\s+/g, " ").trim();
  const page = p.page ?? 1;
  const pageSize = p.pageSize ?? 10;
  return query(p.catalogType, { term, page, pageSize }, {
    descricaoItem: term, pagina: String(page), tamanhoPagina: String(pageSize), statusItem: "true",
  });
}

/** Consulta de um código específico (existência, descrição oficial e situação). */
export async function lookupOfficialCode(p: { catalogType: OfficialCatalogType; code: string }): Promise<
  | { status: "found"; entry: OfficialCatalogEntry; result: Extract<OfficialCatalogQueryResult, { status: "ok" }> }
  | { status: "not_found" }
  | Extract<OfficialCatalogQueryResult, { status: "unavailable" }>
> {
  const code = p.code.trim();
  const res = await query(p.catalogType, { code, page: 1, pageSize: 10 }, { codigoItem: code });
  if (res.status === "unavailable") return res;
  // A fonte pode ignorar o filtro: só vale a linha com o MESMO código (nunca "o primeiro da lista").
  const entry = res.entries.find((e) => e.code === code);
  return entry ? { status: "found", entry, result: res } : { status: "not_found" };
}
