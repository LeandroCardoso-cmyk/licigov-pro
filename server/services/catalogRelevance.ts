/**
 * Relevância local do termo sobre entradas OFICIAIS do catálogo — PURO (sem banco nem rede), determinístico.
 *
 * Reutiliza o motor existente (`catalogSearchEngine`: exata/alias/normalizada/token/semântica/aproximada) sobre as
 * entradas normalizadas por `normalizeCatalogEntry` (org 0 = global), com RELEVÂNCIA DISCRIMINATIVA por cima:
 *   1. enquadramento da contratação ("prestação de serviços", "contratação de empresa especializada"…) é retirado da
 *      consulta — descreve o ato, não o objeto; "aquisição/fornecimento/execução" só quando ABREM a descrição;
 *   2. os termos do OBJETO pesam pela posição: o núcleo vem primeiro ("limpeza e conservação"), complementos depois
 *      ("… de ambientes administrativos") — depende só da consulta, nunca do corpus;
 *   3. cobertura ponderada dos termos do objeto casados pelo motor, com corte absoluto e relativo ao melhor candidato:
 *      melhor menos candidatos do que candidatos incompatíveis. Sem termo do objeto casado ⇒ não é candidato.
 *      Termo com o mesmo radical na descrição (plural/singular) vale inteiro; casado só por aproximação vale parcial.
 * O score continua sendo SIMILARIDADE TEXTUAL (nunca adequação técnica/jurídica); a decisão é sempre humana.
 */
import type { OfficialCatalogEntry } from "../domain/officialCatalog";
import { tokenize, stemPt } from "../domain/semanticIndex";
import { normalizeCatalogEntry, type CatalogEntry } from "./catalogIntegrationService";
import {
  searchExact, searchAlias, searchNormalized, searchToken, searchSemantic, searchFuzzy, rankResults, type MatchSource,
} from "./catalogSearchEngine";

export interface RelevantEntry {
  readonly entry: OfficialCatalogEntry;
  /** Similaridade textual 0–1 (cobertura dos termos do objeto combinada com o score do motor). */
  readonly score: number;
  readonly matchSource: MatchSource;
  /** Termos do OBJETO pesquisado presentes na descrição oficial (justificativa do candidato). */
  readonly matchedTokens: string[];
}

/** Enquadramento da contratação: nunca identifica o objeto (comparação já normalizada, sem acento). */
export const PROCUREMENT_FRAMING_TERMS: ReadonlySet<string> = new Set([
  "prestacao", "prestacoes", "servico", "servicos", "contratacao", "contratacoes",
  "empresa", "empresas", "especializada", "especializadas", "especializado", "especializados",
]);
/** Enquadramento só quando ABRE a descrição e há objeto depois ("Fornecimento de refeições"); no meio, é objeto. */
export const LEADING_FRAMING_TERMS: ReadonlySet<string> = new Set([
  "aquisicao", "aquisicoes", "fornecimento", "fornecimentos", "execucao",
]);

const POSITION_DECAY = 0.5;      // peso do i-ésimo termo do objeto: 1 / (1 + 0,5·i)
const MIN_COVERAGE = 0.25;       // cobertura ponderada mínima para ser candidato
const RELATIVE_TO_BEST = 0.5;    // e ao menos metade da cobertura do melhor candidato
const COVERAGE_SHARE = 0.6;      // score = 0,6·cobertura + 0,4·score do motor
const APPROXIMATE_FACTOR = 0.4;  // termo casado só por aproximação (sem radical igual) vale 40% — tolera erro de digitação,
                                 // mas palavra diferente não sustenta candidato ("tradução" × "produção"/"tração")

/** Termos do objeto, na ordem em que aparecem (mesma normalização/stopwords do motor), sem o enquadramento. */
export function objectTerms(term: string): string[] {
  const words = term.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const ordered = [...new Set(words.flatMap((w) => tokenize(w)))].filter((t) => !PROCUREMENT_FRAMING_TERMS.has(t));
  return ordered.length > 1 && LEADING_FRAMING_TERMS.has(ordered[0]) ? ordered.slice(1) : ordered;
}

export function rankRelevant(term: string, entries: readonly OfficialCatalogEntry[], topK: number): RelevantEntry[] {
  const terms = objectTerms(term);
  if (terms.length === 0 || entries.length === 0) return [];
  const weight = new Map(terms.map((t, i) => [t, 1 / (1 + POSITION_DECAY * i)]));
  const totalWeight = [...weight.values()].reduce((a, b) => a + b, 0);
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const normalized: CatalogEntry[] = entries.map((e) => normalizeCatalogEntry({ code: e.code, catalogType: e.catalogType, description: e.description, active: e.active === true }, 0));

  // Mesmas estratégias de `searchAll`; os termos casados são a UNIÃO entre estratégias (a melhor dá score e origem).
  const query = terms.join(" ");
  const all = [searchExact, searchAlias, searchNormalized, searchToken, searchSemantic, searchFuzzy].flatMap((f) => f(query, normalized));
  const matchedByCode = new Map<string, Set<string>>();
  for (const r of all) {
    const set = matchedByCode.get(r.entry.code) ?? new Set<string>();
    for (const t of r.matchedTokens) set.add(t);
    matchedByCode.set(r.entry.code, set);
  }
  const stemsByCode = new Map(normalized.map((e) => [e.code, new Set(e.tokens.map(stemPt))]));
  const scored = rankResults(all)
    .filter((r) => byCode.has(r.entry.code))
    .map((r) => {
      const matched = terms.filter((t) => matchedByCode.get(r.entry.code)!.has(t));
      const stems = stemsByCode.get(r.entry.code)!;
      const coverage = matched.reduce((s, t) => s + weight.get(t)! * (stems.has(stemPt(t)) ? 1 : APPROXIMATE_FACTOR), 0) / totalWeight;
      const score = Math.round((COVERAGE_SHARE * coverage + (1 - COVERAGE_SHARE) * r.score) * 1e4) / 1e4;
      return { entry: byCode.get(r.entry.code)!, score, coverage, matchSource: r.matchSource, matchedTokens: matched };
    })
    .filter((r) => r.matchedTokens.length > 0 && r.coverage >= MIN_COVERAGE);
  const best = Math.max(0, ...scored.map((r) => r.coverage));

  return scored
    .filter((r) => r.coverage >= best * RELATIVE_TO_BEST)
    .sort((a, b) => b.score - a.score || (a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0))
    .slice(0, topK)
    .map(({ entry, score, matchSource, matchedTokens }) => ({ entry, score, matchSource, matchedTokens }));
}
