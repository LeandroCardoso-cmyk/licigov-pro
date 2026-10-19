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
 *      Termo com o mesmo radical na descrição (plural/singular) vale inteiro; casado só por aproximação vale parcial
 *      e NUNCA conta como "consta da descrição";
 *   4. ATIVIDADE PRINCIPAL (só CATSER — serviços): o núcleo da consulta (termo principal + termos COORDENADOS a ele,
 *      "tradução e interpretação") precisa estar no núcleo da descrição oficial — "LOCACAO EQUIPAMENTO - TRADUCAO" é
 *      locação, não tradução. Havendo candidatos da mesma atividade, os que só MENCIONAM o objeto saem; não havendo,
 *      ficam SINALIZADOS (`activityMatch: false`) só os que mencionam o núcleo. No CATMAT (material), a consulta costuma
 *      abrir pela categoria ("Material de limpeza - detergente") ⇒ não avaliada (`activityMatch: null`);
 *   5. termos do objeto que a descrição oficial NÃO contém (`missingTokens`, ex.: "juramentada") são devolvidos para a
 *      tela dizer que não estão comprovados — candidato relacionado nunca é apresentado como equivalência.
 * O score continua sendo SIMILARIDADE TEXTUAL (nunca adequação técnica/jurídica); a decisão é sempre humana.
 */
import type { OfficialCatalogEntry } from "../domain/officialCatalog";
import { tokenize, stemPt, levenshtein } from "../domain/semanticIndex";
import { normalizeCatalogEntry, type CatalogEntry } from "./catalogIntegrationService";
import {
  searchExact, searchAlias, searchNormalized, searchToken, searchSemantic, searchFuzzy, rankResults, type MatchSource,
} from "./catalogSearchEngine";

export interface RelevanceExplanation {
  /** Termos do OBJETO pesquisado presentes (mesmo radical) na descrição oficial — justificativa do candidato. */
  readonly matchedTokens: string[];
  /** Termos do objeto pesquisado que a descrição oficial NÃO contém (características não comprovadas). */
  readonly missingTokens: string[];
  /** Atividade principal da descrição = a do objeto? false ⇒ só menciona o objeto; null ⇒ não avaliada (CATMAT). */
  readonly activityMatch: boolean | null;
}

export interface RelevantEntry extends RelevanceExplanation {
  readonly entry: OfficialCatalogEntry;
  /** Similaridade textual 0–1 (cobertura dos termos do objeto combinada com o score do motor). */
  readonly score: number;
  readonly matchSource: MatchSource;
}

/** Enquadramento da contratação: nunca identifica o objeto (comparação já normalizada, sem acento). */
export const PROCUREMENT_FRAMING_TERMS: ReadonlySet<string> = new Set([
  "prestacao", "prestacoes", "servico", "servicos", "serv", "contratacao", "contratacoes",
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
const APPROXIMATE_FACTOR = 0.4;  // termo casado só por aproximação (sem radical igual) vale 40% da cobertura: tolera erro
                                 // de digitação, mas nunca conta como termo que consta da descrição
const TYPO_MIN_LENGTH = 6;       // alinhamento de atividade tolera 1 letra de diferença só em termos longos

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Termos do objeto, na ordem em que aparecem (mesma normalização/stopwords do motor), sem o enquadramento. */
export function objectTerms(term: string): string[] {
  const words = fold(term).replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const ordered = [...new Set(words.flatMap((w) => tokenize(w)))].filter((t) => !PROCUREMENT_FRAMING_TERMS.has(t));
  return ordered.length > 1 && LEADING_FRAMING_TERMS.has(ordered[0]) ? ordered.slice(1) : ordered;
}

/**
 * NÚCLEO da atividade: o termo principal e os termos COORDENADOS a ele ("e", "ou", ",", "/"). Preposição ("de", "para",
 * "em"), travessão (" - ") ou termo adjacente não coordenado (modificador) encerram o núcleo. Mesma regra para a consulta
 * e para a descrição oficial: "LOCACAO EQUIPAMENTO - TRADUCAO" ⇒ [locacao]; "TRADUCAO / INTERPRETACAO SIMULTANEA" ⇒
 * [traducao, interpretacao]; "Serviços de tradução de documentos" ⇒ [traducao].
 */
const SEGMENT_DASH = /\s+-+\s*|\s*-+\s+/;

export function coreTerms(text: string): string[] {
  const tokens = fold(text)
    .replace(new RegExp(SEGMENT_DASH.source, "g"), " | ")
    .replace(/[/,;+]/g, " , ")
    .replace(/[^a-z0-9,|\s]/g, " ")
    .split(/\s+/).filter(Boolean);
  const core: string[] = [];
  let coordinated = false;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw === "," || raw === "e" || raw === "ou") { coordinated = core.length > 0; continue; }
    if (raw === "|") { if (core.length > 0) break; continue; }
    const t = tokenize(raw)[0];
    const skippable = !t || PROCUREMENT_FRAMING_TERMS.has(t) || /^\d+$/.test(t);
    if (core.length === 0) {
      if (skippable) continue;
      const more = tokens.slice(i + 1).some((x) => { const n = tokenize(x)[0]; return !!n && !PROCUREMENT_FRAMING_TERMS.has(n); });
      if (LEADING_FRAMING_TERMS.has(t) && more) continue;
      core.push(t);
      continue;
    }
    if (skippable || !coordinated) break;
    core.push(t);
    coordinated = false;
  }
  return [...new Set(core)];
}

/** Mesmo termo para fins de ATIVIDADE: mesmo radical, ou 1 letra de diferença em termo longo (erro de digitação). */
const sameTerm = (a: string, b: string) =>
  stemPt(a) === stemPt(b) || (Math.min(a.length, b.length) >= TYPO_MIN_LENGTH && levenshtein(a, b) <= 1);

const stemsOf = (description: string) => new Set(tokenize(description).map(stemPt));
const usesActivity = (entries: readonly OfficialCatalogEntry[]) => entries.length > 0 && entries.every((e) => e.catalogType === "catser");

/**
 * Mesma atividade? Direto: núcleo da consulta × núcleo da descrição. Forma "OBJETO - ATIVIDADE" ("DOCUMENTO - GUARDA /
 * TRANSPORTE", "ELEVADOR - MANUTENCAO"): a cabeça da descrição é um termo do OBJETO pesquisado e o núcleo da consulta está
 * no primeiro segmento após o " - ". "LOCACAO EQUIPAMENTO - TRADUCAO" segue fora de "tradução": locação não é o objeto.
 */
function sameActivity(terms: string[], queryCore: string[], description: string): boolean {
  const entryCore = coreTerms(description);
  if (queryCore.some((q) => entryCore.some((c) => sameTerm(q, c)))) return true;
  const next = description.split(SEGMENT_DASH)[1];
  return !!next && entryCore.some((c) => terms.some((t) => sameTerm(t, c)))
    && coreTerms(next).some((c) => queryCore.some((q) => sameTerm(q, c)));
}

function explainWith(terms: string[], queryCore: string[], entry: OfficialCatalogEntry, stems: Set<string>, activity: boolean): RelevanceExplanation {
  const matchedTokens = terms.filter((t) => stems.has(stemPt(t)));
  const missingTokens = terms.filter((t) => !stems.has(stemPt(t)));
  if (!activity || queryCore.length === 0) return { matchedTokens, missingTokens, activityMatch: null };
  return { matchedTokens, missingTokens, activityMatch: sameActivity(terms, queryCore, entry.description) };
}

/**
 * Explica, SEM filtrar, a relação entre o objeto pesquisado e UMA descrição oficial (ex.: "Verificar código", em que o
 * código veio do servidor): termos que constam, termos não comprovados e atividade principal (só CATSER).
 */
export function explainRelevance(term: string, entry: OfficialCatalogEntry): RelevanceExplanation {
  return explainWith(objectTerms(term), coreTerms(term), entry, stemsOf(entry.description), usesActivity([entry]));
}

export function rankRelevant(term: string, entries: readonly OfficialCatalogEntry[], topK: number): RelevantEntry[] {
  const terms = objectTerms(term);
  if (terms.length === 0 || entries.length === 0) return [];
  const activity = usesActivity(entries);
  const queryCore = coreTerms(term);
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
      const engineMatched = terms.filter((t) => matchedByCode.get(r.entry.code)!.has(t));
      const stems = stemsByCode.get(r.entry.code)!;
      const coverage = engineMatched.reduce((s, t) => s + weight.get(t)! * (stems.has(stemPt(t)) ? 1 : APPROXIMATE_FACTOR), 0) / totalWeight;
      const score = Math.round((COVERAGE_SHARE * coverage + (1 - COVERAGE_SHARE) * r.score) * 1e4) / 1e4;
      const entry = byCode.get(r.entry.code)!;
      return { entry, score, coverage, matchSource: r.matchSource, engineMatched, ...explainWith(terms, queryCore, entry, stems, activity) };
    })
    .filter((r) => r.engineMatched.length > 0 && r.coverage >= MIN_COVERAGE);
  // Atividade principal: com candidatos da MESMA atividade, os que apenas mencionam o objeto não são alternativas.
  // Sem nenhum, ficam só os que mencionam o NÚCLEO do objeto (complemento sozinho não basta), sinalizados.
  const pool = !activity || queryCore.length === 0 ? scored
    : scored.some((r) => r.activityMatch) ? scored.filter((r) => r.activityMatch)
      : scored.filter((r) => r.engineMatched.some((t) => queryCore.includes(t)));
  const best = Math.max(0, ...pool.map((r) => r.coverage));

  return pool
    .filter((r) => r.coverage >= best * RELATIVE_TO_BEST)
    .sort((a, b) => b.score - a.score || (a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0))
    .slice(0, topK)
    .map(({ entry, score, matchSource, matchedTokens, missingTokens, activityMatch }) => ({ entry, score, matchSource, matchedTokens, missingTokens, activityMatch }));
}
