/**
 * Relevância local do termo sobre entradas OFICIAIS do catálogo — PURO (sem banco nem rede).
 *
 * Reutiliza o motor existente (`catalogSearchEngine`: exata/alias/normalizada/token/semântica/aproximada) sobre as
 * entradas normalizadas por `normalizeCatalogEntry` (org 0 = global). Só conta o que casou ao menos um termo
 * significativo — candidatos sem relação (ex.: serviços hospitalares para "limpeza") nunca viram sugestão.
 */
import type { OfficialCatalogEntry } from "../domain/officialCatalog";
import { normalizeCatalogEntry, type CatalogEntry } from "./catalogIntegrationService";
import { searchAll, type MatchSource } from "./catalogSearchEngine";

export interface RelevantEntry {
  readonly entry: OfficialCatalogEntry;
  readonly score: number;
  readonly matchSource: MatchSource;
  readonly matchedTokens: string[];
}

export function rankRelevant(term: string, entries: readonly OfficialCatalogEntry[], topK: number): RelevantEntry[] {
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const normalized: CatalogEntry[] = entries.map((e) => normalizeCatalogEntry({ code: e.code, catalogType: e.catalogType, description: e.description, active: e.active === true }, 0));
  return searchAll(term, normalized, topK)
    .filter((r) => r.matchedTokens.length > 0 && byCode.has(r.entry.code))
    .map((r) => ({ entry: byCode.get(r.entry.code)!, score: r.score, matchSource: r.matchSource, matchedTokens: r.matchedTokens }));
}
