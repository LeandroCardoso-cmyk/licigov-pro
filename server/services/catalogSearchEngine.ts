/**
 * Sprint 3.0 — Catalog Search Engine.
 *
 * Busca operacional sobre entradas de catálogo CATMAT/CATSER. Implementa
 * múltiplas estratégias (exata, alias, token, fuzzy, normalizada, semântica),
 * ranking determinístico e busca com fallback em cascata.
 *
 * PRINCÍPIOS:
 *   - Ordering determinístico: score DESC → matchSource priority → code ASC.
 *   - Ranking explicável: cada resultado carrega rankRationale legível.
 *   - Tolerância a typos via Levenshtein (reuso de semanticIndex).
 *   - Normalização PT-BR consistente com canonicalUnits/tokenize.
 *
 * Embasamento: transparência e rastreabilidade (Lei 14.133/2021, art. 5º).
 */

import { tokenize, levenshtein, isFuzzyMatch, scoreAgainstEntry, createSearchEntry } from "../domain/semanticIndex";
import type { CatalogEntry } from "./catalogIntegrationService";

// ─── Result types ─────────────────────────────────────────────────────────────

export type MatchSource =
  | "exact"
  | "alias"
  | "token"
  | "normalized"
  | "semantic"
  | "fuzzy";

export interface CatalogSearchResult {
  entry:         CatalogEntry;
  score:         number;        // 0–1
  matchSource:   MatchSource;
  matchedTokens: string[];
  rankRationale: string;        // explicabilidade
}

// ─── Match source priority (deterministic tiebreak) ───────────────────────────

const MATCH_SOURCE_PRIORITY: Record<MatchSource, number> = {
  exact:      0,
  alias:      1,
  normalized: 2,
  token:      3,
  semantic:   4,
  fuzzy:      5,
};

// ─── Normalization helper ─────────────────────────────────────────────────────

function normalizeQuery(query: string): string {
  return tokenize(query).join(" ");
}

// ─── searchExact ──────────────────────────────────────────────────────────────

/**
 * Correspondência exata sobre a descrição normalizada.
 */
export function searchExact(query: string, entries: CatalogEntry[]): CatalogSearchResult[] {
  const normQuery = normalizeQuery(query);
  if (!normQuery) return [];
  return entries
    .filter(e => e.active && e.normalizedDescription === normQuery)
    .map(e => ({
      entry:         e,
      score:         1.0,
      matchSource:   "exact" as MatchSource,
      matchedTokens: tokenize(query),
      rankRationale: `Correspondência exata na descrição normalizada ("${normQuery}").`,
    }));
}

// ─── searchAlias ──────────────────────────────────────────────────────────────

/**
 * Correspondência por alias registrado (descrição normalizada == alias normalizado).
 */
export function searchAlias(query: string, entries: CatalogEntry[]): CatalogSearchResult[] {
  const normQuery = normalizeQuery(query);
  if (!normQuery) return [];
  const out: CatalogSearchResult[] = [];
  for (const e of entries) {
    if (!e.active) continue;
    const matchedAlias = e.aliases.find(a => normalizeQuery(a) === normQuery);
    if (matchedAlias) {
      out.push({
        entry:         e,
        score:         0.95,
        matchSource:   "alias",
        matchedTokens: tokenize(query),
        rankRationale: `Correspondência via alias registrado "${matchedAlias}".`,
      });
    }
  }
  return out;
}

// ─── searchToken ──────────────────────────────────────────────────────────────

/**
 * Interseção de tokens (Jaccard sobre tokens da descrição + aliases).
 */
export function searchToken(
  query:    string,
  entries:  CatalogEntry[],
  minScore  = 0.35,
): CatalogSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const out: CatalogSearchResult[] = [];
  for (const e of entries) {
    if (!e.active) continue;
    const matched = queryTokens.filter(t => e.tokens.includes(t));
    if (matched.length === 0) continue;
    const union = new Set([...queryTokens, ...e.tokens]).size;
    const jaccard = matched.length / union;
    const score = Math.min(0.94, 0.50 + jaccard * 0.44);
    if (score < minScore) continue;
    out.push({
      entry:         e,
      score,
      matchSource:   "token",
      matchedTokens: matched,
      rankRationale: `Interseção de ${matched.length} token(s) [${matched.join(", ")}] (Jaccard ${jaccard.toFixed(2)}).`,
    });
  }
  return out;
}

// ─── searchNormalized ─────────────────────────────────────────────────────────

/**
 * Match por prefixo/normalização — todos os tokens da query presentes (subset).
 */
export function searchNormalized(query: string, entries: CatalogEntry[]): CatalogSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const out: CatalogSearchResult[] = [];
  for (const e of entries) {
    if (!e.active) continue;
    const allPresent = queryTokens.every(t => e.tokens.includes(t));
    if (!allPresent) continue;
    // Avoid double-counting exact matches.
    if (e.normalizedDescription === queryTokens.slice().sort().join(" ")) continue;
    out.push({
      entry:         e,
      score:         0.88,
      matchSource:   "normalized",
      matchedTokens: queryTokens,
      rankRationale: `Todos os tokens da consulta presentes na entrada normalizada.`,
    });
  }
  return out;
}

// ─── searchFuzzy ──────────────────────────────────────────────────────────────

/**
 * Tolerância a typos: tokens da query a Levenshtein ≤ maxDistance dos tokens da entrada.
 */
export function searchFuzzy(
  query:       string,
  entries:     CatalogEntry[],
  maxDistance  = 2,
  minScore     = 0.35,
): CatalogSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const out: CatalogSearchResult[] = [];
  for (const e of entries) {
    if (!e.active) continue;
    const fuzzyMatched: string[] = [];
    let totalDistance = 0;
    for (const qt of queryTokens) {
      let best: { token: string; dist: number } | null = null;
      for (const et of e.tokens) {
        if (isFuzzyMatch(qt, et, maxDistance)) {
          const d = levenshtein(qt, et);
          if (!best || d < best.dist) best = { token: et, dist: d };
        }
      }
      if (best) {
        fuzzyMatched.push(qt);
        totalDistance += best.dist;
      }
    }
    if (fuzzyMatched.length < Math.ceil(queryTokens.length * 0.5)) continue;
    const coverage = fuzzyMatched.length / queryTokens.length;
    const avgDist = fuzzyMatched.length > 0 ? totalDistance / fuzzyMatched.length : maxDistance;
    const score = Math.max(0, Math.min(0.84, 0.40 + coverage * 0.30 - avgDist * 0.05));
    if (score < minScore) continue;
    out.push({
      entry:         e,
      score,
      matchSource:   "fuzzy",
      matchedTokens: fuzzyMatched,
      rankRationale: `Tolerância a typo: ${fuzzyMatched.length}/${queryTokens.length} token(s) com distância média ${avgDist.toFixed(1)}.`,
    });
  }
  return out;
}

// ─── searchSemantic ───────────────────────────────────────────────────────────

/**
 * Busca semântica via scoreAgainstEntry (reuso do semanticIndex).
 */
export function searchSemantic(
  query:    string,
  entries:  CatalogEntry[],
  minScore  = 0.35,
): CatalogSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const out: CatalogSearchResult[] = [];
  for (const e of entries) {
    if (!e.active) continue;
    const searchEntry = createSearchEntry(e.organizationId, e.description, {
      aliases:    e.aliases,
      source:     "catmat",
      catmatCode: e.code,
    });
    const result = scoreAgainstEntry(queryTokens, searchEntry);
    if (result.score < minScore) continue;
    out.push({
      entry:         e,
      score:         Math.min(0.90, result.score),
      matchSource:   "semantic",
      matchedTokens: result.matchedOn,
      rankRationale: `Score semântico ${result.score.toFixed(3)} via estratégia "${result.strategy}".`,
    });
  }
  return out;
}

// ─── rankResults ──────────────────────────────────────────────────────────────

/**
 * Ordena resultados de forma determinística: score DESC → matchSource priority
 * ASC → code ASC. Deduplica por code (mantém o de maior score).
 */
export function rankResults(results: CatalogSearchResult[]): CatalogSearchResult[] {
  // Dedup by code: keep best per code (deterministic).
  const byCode = new Map<string, CatalogSearchResult>();
  for (const r of results) {
    const existing = byCode.get(r.entry.code);
    if (!existing || compareResults(r, existing) < 0) {
      byCode.set(r.entry.code, r);
    }
  }
  return Array.from(byCode.values()).sort(compareResults);
}

function compareResults(a: CatalogSearchResult, b: CatalogSearchResult): number {
  if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
  const pa = MATCH_SOURCE_PRIORITY[a.matchSource];
  const pb = MATCH_SOURCE_PRIORITY[b.matchSource];
  if (pa !== pb) return pa - pb;
  return a.entry.code.localeCompare(b.entry.code);
}

// ─── searchWithFallback ───────────────────────────────────────────────────────

export interface FallbackSearchResult {
  results:    CatalogSearchResult[];
  usedSource: MatchSource | "none";
  cascade:    string[]; // estratégias tentadas, em ordem
}

/**
 * Busca em cascata: exact → alias → normalized → token → fuzzy.
 * Para na primeira estratégia que retorna resultados. Explicável.
 */
export function searchWithFallback(
  query:   string,
  entries: CatalogEntry[],
  topK     = 5,
): FallbackSearchResult {
  const cascade: string[] = [];

  const stages: Array<{ source: MatchSource; fn: () => CatalogSearchResult[] }> = [
    { source: "exact",      fn: () => searchExact(query, entries) },
    { source: "alias",      fn: () => searchAlias(query, entries) },
    { source: "normalized", fn: () => searchNormalized(query, entries) },
    { source: "token",      fn: () => searchToken(query, entries) },
    { source: "fuzzy",      fn: () => searchFuzzy(query, entries) },
  ];

  for (const stage of stages) {
    cascade.push(stage.source);
    const ranked = rankResults(stage.fn());
    if (ranked.length > 0) {
      return { results: ranked.slice(0, topK), usedSource: stage.source, cascade };
    }
  }

  return { results: [], usedSource: "none", cascade };
}

// ─── Combined search (all strategies, ranked) ─────────────────────────────────

/**
 * Executa todas as estratégias e retorna o ranking combinado determinístico.
 */
export function searchAll(
  query:   string,
  entries: CatalogEntry[],
  topK     = 5,
): CatalogSearchResult[] {
  const combined = [
    ...searchExact(query, entries),
    ...searchAlias(query, entries),
    ...searchNormalized(query, entries),
    ...searchToken(query, entries),
    ...searchSemantic(query, entries),
    ...searchFuzzy(query, entries),
  ];
  return rankResults(combined).slice(0, topK);
}
