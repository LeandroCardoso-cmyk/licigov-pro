/**
 * RC-5.0 — Institutional Knowledge Integration Layer · KnowledgeRetrievalService (Componente 2).
 *
 * Recebe o contexto institucional e consulta EXCLUSIVAMENTE o Official Knowledge Corpus (RC-4.9)
 * para selecionar documentos relevantes e recuperar trechos pertinentes — por correspondência
 * lexical DETERMINÍSTICA (SEM IA, SEM sumarização, SEM interpretação). Preserva documentId,
 * authority, version, jurisdiction, bindingLevel, citation, lineage e explainability.
 *
 * RAG-QUALITY-001 — Motor de recuperação híbrido (ainda 100% lexical/determinístico):
 * (1) BM25-lite com normalização de comprimento de bloco (evita que artigos extensos/genéricos —
 *     ex.: Art. 6º, um glossário com dezenas de definições — dominem o ranking só por amplitude
 *     de vocabulário, sem relação temática real com a consulta);
 * (2) boost estrutural: título/capítulo/seção que contém o artigo (ex.: "Capítulo VIII — Da
 *     Contratação Direta") é indexado e pontuado — quando os termos da consulta casam com o RÓTULO
 *     do container estrutural, todos os artigos daquela seção recebem sinal de relevância, mesmo
 *     que o corpo do artigo isoladamente não repita a expressão da pergunta;
 * (3) vizinhança estrutural: artigos do MESMO container (seção/capítulo) de um artigo bem pontuado
 *     recebem um reforço proporcional — aproxima o comportamento de "recuperar o dispositivo E seus
 *     vizinhos normativos", como um profissional faria ao consultar a lei;
 * (4) segunda rodada de busca determinística (no máx. 2 rodadas) quando a cobertura de termos da
 *     consulta nas passagens retornadas é baixa — amplia minScore/maxPassagesPerDocument uma única
 *     vez, sem aleatoriedade.
 */

import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import type { IngestedDocument } from "../../domain/officialCorpus/officialCorpusIngestion";
import type { InstitutionalContext } from "../../domain/institutionalIntegration/institutionalContextResolver";
import type { RetrievedPassage, Citation, ContextExplainabilityEntry, ContextDocument } from "../../domain/institutionalIntegration/contextPackage";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";

export interface RetrievalResult {
  readonly documents: readonly ContextDocument[];
  readonly passages: readonly RetrievedPassage[];
  readonly citations: readonly Citation[];
  readonly explainability: readonly ContextExplainabilityEntry[];
  readonly documentsLoaded: readonly string[];
  readonly documentsIgnored: readonly string[];
  /** RAG-QUALITY-001 — quantas rodadas de busca foram executadas (1 ou 2; determinístico, sem IA). */
  readonly searchRounds: number;
  /** RAG-QUALITY-001 — fração dos termos "alcançáveis" da consulta cobertos pelas passagens retornadas (0..1). */
  readonly coverageRatio: number;
  /** RAG-QUALITY-001 — maior score entre as passagens retornadas (0 se nenhuma). */
  readonly maxPassageScore: number;
  /** RAG-QUALITY-002 — a passagem de MAIOR score veio de um container genérico (Disposições
   *  Gerais/Transitórias/Finais) enquanto um capítulo temático concorrente existia no mesmo
   *  documento. Sinal de "sustenta a frase, mas pode não responder à intenção jurídica" — usado
   *  para NÃO classificar a resposta como "Fundamentada" às cegas (ver `classifyEvidenceSufficiency`). */
  readonly topPassageGenericContainer: boolean;
}

const STOPWORDS = new Set([
  // ── artigos/preposições/conectivos (já existentes) ──
  "de", "da", "do", "das", "dos", "a", "o", "e", "as", "os", "para", "por", "com", "que", "em", "no", "na", "um", "uma", "ao", "à",
  // ── RAG-QUALITY-001 — pronomes interrogativos e verbos auxiliares de pergunta: carregam ZERO
  // conteúdo jurídico e, sem normalização de comprimento, tendiam a favorecer blocos grandes/genéricos
  // que os contêm incidentalmente. Generaliza para QUALQUER pergunta (não só o caso de teste). ──
  "qual", "quais", "quando", "onde", "quem", "fala", "diz", "diga", "existe", "posso", "pode", "podem",
  "devo", "deve", "devem", "preciso", "precisa", "gostaria", "queria", "seria", "seriam",
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/** Frequência de cada termo em um texto (para TF do BM25-lite). Determinístico. */
function tokenizeCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(s)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * Expansão de vocabulário de licitações: a busca é lexical (casamento de termos), mas as normas usam
 * a forma POR EXTENSO (ex.: "estudo técnico preliminar") enquanto o usuário pergunta pela sigla (ETP).
 * Expandir siglas/variantes na consulta faz os trechos oficiais casarem — sem embeddings/RAG semântico.
 */
export const TERM_EXPANSIONS: Record<string, readonly string[]> = {
  // ── Fluxo de planejamento / documentos ──
  dfd: ["documento", "formalizacao", "demanda"],
  etp: ["estudo", "tecnico", "preliminar"],
  tr: ["termo", "referencia"],
  pb: ["projeto", "basico"],
  mr: ["matriz", "riscos"],
  pca: ["plano", "contratacoes", "anual"],
  // ── Registro de preços ──
  srp: ["sistema", "registro", "precos"],
  arp: ["ata", "registro", "precos"],
  irp: ["intencao", "registro", "precos"],
  // ── Micro/pequena empresa (LC 123) — só siglas sem colisão com palavras comuns ──
  epp: ["empresa", "pequeno", "porte"],
  mei: ["microempreendedor", "individual"],
  // ── Órgãos / normas ──
  tcu: ["tribunal", "contas", "uniao"],
  tce: ["tribunal", "contas", "estado"],
  cgu: ["controladoria"],
  agu: ["advocacia"],
  pncp: ["portal", "nacional", "contratacoes"],
  seges: ["secretaria", "gestao"],
  in: ["instrucao", "normativa"],
  lc: ["lei", "complementar"],
  // ── Catálogos / cadastros ──
  catmat: ["catalogo", "materiais"],
  catser: ["catalogo", "servicos"],
  sicaf: ["cadastramento", "unificado", "fornecedores"],
  bdi: ["beneficios", "despesas", "indiretas"],
  // ── Variantes morfológicas úteis (palavras completas, sem ambiguidade) ──
  obrigatorio: ["obrigatoria", "obrigatoriedade", "obrigatorios"],
  dispensa: ["dispensavel"],
  inexigibilidade: ["inexigivel"],
  pregao: ["pregoeiro"],
  credenciamento: ["credenciar"],
  aditivo: ["aditamento", "aditar"],
  prorrogacao: ["prorrogar"],
  reequilibrio: ["reequilibrar", "equilibrio"],
  habilitacao: ["habilitar", "habilitado"],
  fiscalizacao: ["fiscal", "fiscalizar"],
};

/** Termos da consulta + expansões de siglas/variantes conhecidas (determinístico, aditivo). */
export function expandQueryTerms(query: string): string[] {
  const base = tokenize(query);
  const rawWords = new Set(
    query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean),
  );
  const out = new Set(base);
  for (const [key, exps] of Object.entries(TERM_EXPANSIONS)) {
    if (rawWords.has(key)) for (const e of exps) out.add(e);
  }
  return [...out];
}

export interface RetrieveParams {
  query: string;
  maxPassagesPerDocument?: number;
  minScore?: number;
  /** Limite de caracteres por trecho verbatim (evita despejar chunks inteiros). Sem limite se ausente. */
  maxPassageChars?: number;
}

/** Corta um trecho longo preservando o início (mais relevante), com marcador de continuação. */
function clipPassage(text: string, max?: number): string {
  if (!max || text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "").trimEnd() + " […]";
}

// ── RAG-QUALITY-001 — parâmetros do BM25-lite e dos boosts estruturais (constantes, determinísticos) ──
const BM25_K1 = 1.4;
const BM25_B = 0.75;
/** RAG-QUALITY-002 — normalização de comprimento relaxada quando o título/seção do PRÓPRIO artigo
 *  casa especificamente com a consulta (o comprimento é profundidade temática, não diluição). */
const BM25_B_THEMATIC = 0.25;
/** Peso do boost de título/seção quando os termos da consulta casam com o RÓTULO do container. */
const HEADING_BOOST_WEIGHT = 0.6;
/** Peso do reforço de vizinhança estrutural (artigos do mesmo container de um artigo bem pontuado). */
const NEIGHBOR_BOOST_WEIGHT = 0.15;
/** Abaixo desta cobertura de termos "alcançáveis", uma 2ª rodada (mais permissiva) é tentada. */
const ESCALATION_COVERAGE_THRESHOLD = 0.5;
/** Mesmo com cobertura baixa, não escala se já houver uma passagem MUITO forte (evita busca desnecessária). */
const ESCALATION_SKIP_IF_MAX_SCORE_ABOVE = 0.6;

interface Cand {
  readonly doc: InstitutionalContext["applicableDocuments"][number];
  readonly ingested: IngestedDocument;
  readonly b: ReturnType<typeof allBlocks>[number];
  readonly freq: Map<string, number>;
  readonly tokenSet: ReadonlySet<string>;
  readonly length: number;
  readonly headingTokens: ReadonlySet<string>;
  /** Chave do container estrutural mais profundo (para agrupar vizinhança) — ex.: "Título II>Capítulo VIII>Seção I". */
  readonly groupKey: string;
}

function headingTextOf(b: Cand["b"]): string {
  const heading = (b.metadata as { headingText?: unknown }).headingText;
  return Array.isArray(heading) ? heading.filter((h): h is string => typeof h === "string").join(" ") : "";
}

function pathOf(b: Cand["b"]): string {
  const path = (b.metadata as { path?: unknown }).path;
  return Array.isArray(path) ? path.filter((p): p is string => typeof p === "string").join(">") : "";
}

// RAG-QUALITY-002 — Títulos/capítulos BOILERPLATE, presentes em praticamente toda lei brasileira,
// não carregam matéria própria: "Disposições Gerais/Transitórias/Finais/Preliminares". Quando a
// consulta casa tematicamente com um capítulo ESPECÍFICO de outro trecho do mesmo documento (ex.:
// "Da Contratação Direta"), um artigo genérico que só mencione os mesmos termos incidentalmente
// (ex.: uma regra de transição que cita "contratação direta" de passagem) não deve superar o
// capítulo temático — generaliza para qualquer lei, não é específico da Lei 14.133.
const GENERIC_HEADING_PATTERN = /disposi[çc][õo]es?\s+(gerais|transit[óo]rias|finais|preliminares)/i;
function isGenericHeading(headingText: string): boolean {
  return GENERIC_HEADING_PATTERN.test(headingText);
}
/** Multiplicador aplicado ao score de CORPO de um artigo em container genérico, quando existe
 *  concorrente temático no mesmo documento (não penaliza quando é a ÚNICA base disponível). */
const GENERIC_CONTAINER_PENALTY = 0.4;

/** Uma rodada de recuperação (BM25-lite + boost de título + vizinhança). Determinística. */
function runRetrievalPass(corpus: OfficialCorpusBuildResult, context: InstitutionalContext, query: string, maxPer: number, minScore: number): {
  byDoc: Map<string, { doc: Cand["doc"]; ingested: IngestedDocument; scored: Array<{ b: Cand["b"]; score: number; isGenericPenalized: boolean }> }>;
  ignored: Set<string>;
  reachableTermsCount: number;
} {
  const queryTerms = expandQueryTerms(query);
  const ingestedByNorm = new Map<string, IngestedDocument>(corpus.ingested.map(d => [d.official.normId, d]));

  const cands: Cand[] = [];
  const ignored = new Set<string>();
  for (const doc of context.applicableDocuments) {
    const ingested = ingestedByNorm.get(doc.normId);
    if (!ingested) { ignored.add(doc.documentId); continue; }
    const blocks = allBlocks(ingested.knowledgeDocument).filter(b => b.kind === "OfficialText");
    if (blocks.length === 0) { ignored.add(doc.documentId); continue; }
    for (const b of blocks) {
      const bodyText = b.fragments.map(f => f.text).join(" ");
      const freq = tokenizeCounts(bodyText);
      const length = [...freq.values()].reduce((s, n) => s + n, 0);
      cands.push({
        doc, ingested, b, freq, tokenSet: new Set(freq.keys()), length,
        headingTokens: new Set(tokenize(headingTextOf(b))),
        groupKey: `${doc.documentId}::${pathOf(b)}`,
      });
    }
  }

  // IDF sobre os blocos candidatos: termos raros/específicos ("preliminar") pesam mais que genéricos
  // ("quando"). Isso ranqueia os trechos pertinentes acima do ruído — determinístico, sem embeddings.
  const N = Math.max(1, cands.length);
  const df = new Map<string, number>();
  for (const c of cands) for (const t of c.tokenSet) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) ?? 0))) + 1;

  // RAG-QUALITY-001 — termos que NUNCA ocorrem em nenhum bloco (ex.: número da norma citado na
  // pergunta, como "14133", que não aparece verbatim no corpo dos artigos) são descartados do
  // denominador: mantê-los só infla o IDF total sem jamais poder contribuir a um match, deflacionando
  // TODOS os scores de forma desigual (alguns blocos "perdem" mais desse termo morto que outros).
  const reachableTerms = queryTerms.filter(t => (df.get(t) ?? 0) > 0);
  const scoringTerms = reachableTerms.length > 0 ? reachableTerms : queryTerms;
  const denom = scoringTerms.reduce((s, t) => s + idf(t), 0) || 1;

  const avgLen = cands.length > 0 ? cands.reduce((s, c) => s + c.length, 0) / cands.length : 1;

  const headingScoreOf = (c: Cand): number => {
    let num = 0;
    for (const t of scoringTerms) if (c.headingTokens.has(t)) num += idf(t);
    return num / denom;
  };
  const hasSpecificHeadingMatch = (c: Cand): boolean => !isGenericHeading(headingTextOf(c.b)) && headingScoreOf(c) > 0;

  // RAG-QUALITY-002 — a normalização de comprimento do BM25 penaliza blocos grandes por padrão
  // (evita que um GLOSSÁRIO genérico, ex.: Art. 6º, vença por amplitude de vocabulário). Mas um
  // artigo extenso porque é o tratamento EXAUSTIVO do próprio tema perguntado (ex.: Art. 75 — dezenas
  // de hipóteses de dispensa, sob a seção "Da Dispensa de Licitação") não deve ser punido do mesmo
  // jeito: seu comprimento é PROFUNDIDADE temática, não diluição. Quando o próprio título/seção do
  // artigo casa especificamente com a consulta, relaxa a normalização de comprimento (b menor).
  const bodyScoreOf = (c: Cand): number => {
    const b = hasSpecificHeadingMatch(c) ? BM25_B_THEMATIC : BM25_B;
    let num = 0;
    for (const t of scoringTerms) {
      const tf = c.freq.get(t);
      if (!tf) continue;
      const denomBm25 = tf + BM25_K1 * (1 - b + b * (c.length / (avgLen || 1)));
      num += idf(t) * (tf * (BM25_K1 + 1)) / (denomBm25 || 1);
    }
    return num / denom;
  };

  // RAG-QUALITY-002 — existe capítulo temático específico concorrente (não genérico) no MESMO
  // documento cujo RÓTULO já casa com a consulta? Se sim, artigos em container genérico
  // (Disposições Gerais/Transitórias/Finais) são penalizados — evita que uma disposição de
  // transição que só cita os termos de passagem supere o capítulo que trata da matéria.
  const thematicMatchByDoc = new Map<string, boolean>();
  for (const c of cands) {
    if (hasSpecificHeadingMatch(c)) thematicMatchByDoc.set(c.doc.documentId, true);
  }

  // Passo 2 — pontua (corpo + boost de título, com penalidade de container genérico), agrupa por
  // container estrutural p/ vizinhança.
  const withBaseScore = cands.map(c => {
    const isGeneric = isGenericHeading(headingTextOf(c.b));
    const penalize = isGeneric && (thematicMatchByDoc.get(c.doc.documentId) ?? false);
    const body = bodyScoreOf(c) * (penalize ? GENERIC_CONTAINER_PENALTY : 1);
    return { c, base: body + HEADING_BOOST_WEIGHT * headingScoreOf(c), isGeneric: penalize };
  });
  const groupMax = new Map<string, number>();
  for (const { c, base } of withBaseScore) groupMax.set(c.groupKey, Math.max(groupMax.get(c.groupKey) ?? 0, base));

  const byDoc = new Map<string, { doc: Cand["doc"]; ingested: IngestedDocument; scored: Array<{ b: Cand["b"]; score: number; isGenericPenalized: boolean }> }>();
  for (const { c, base, isGeneric } of withBaseScore) {
    // Vizinhança estrutural: artigos do MESMO container de um artigo bem pontuado recebem reforço
    // proporcional ao pico do grupo — aproxima a recuperação do "dispositivo + vizinhos normativos".
    const peak = groupMax.get(c.groupKey) ?? 0;
    const score = Math.round((base + NEIGHBOR_BOOST_WEIGHT * peak) * 1000) / 1000;
    if (score < minScore) continue;
    let g = byDoc.get(c.doc.documentId);
    if (!g) { g = { doc: c.doc, ingested: c.ingested, scored: [] }; byDoc.set(c.doc.documentId, g); }
    g.scored.push({ b: c.b, score, isGenericPenalized: isGeneric });
  }

  for (const doc of context.applicableDocuments) {
    const g = byDoc.get(doc.documentId);
    if (!g || g.scored.length === 0) ignored.add(doc.documentId);
  }

  // maxPer é aplicado no chamador (após ordenar) — aqui devolvemos TODOS os candidatos pontuados.
  void maxPer;
  return { byDoc, ignored, reachableTermsCount: reachableTerms.length };
}

/** Monta o RetrievalResult final a partir de um resultado de rodada (top-N por documento). */
function buildResult(context: InstitutionalContext, byDoc: ReturnType<typeof runRetrievalPass>["byDoc"], ignored: Set<string>, maxPer: number, params: RetrieveParams, reachableTermsCount: number): RetrievalResult {
  const documents: ContextDocument[] = [];
  const passages: RetrievedPassage[] = [];
  const citations: Citation[] = [];
  const explainability: ContextExplainabilityEntry[] = [];
  const documentsLoaded: string[] = [];
  const coveredTerms = new Set<string>();
  const queryTerms = expandQueryTerms(params.query);
  let topScore = -Infinity;
  let topIsGenericPenalized = false;

  for (const doc of context.applicableDocuments) {
    const g = byDoc.get(doc.documentId);
    if (!g || g.scored.length === 0) { ignored.add(doc.documentId); continue; }
    const top = g.scored.sort((a, b) => b.score - a.score || a.b.id.localeCompare(b.b.id)).slice(0, maxPer);

    documentsLoaded.push(doc.documentId);
    documents.push({ documentId: doc.documentId, normId: doc.normId, title: doc.title, authority: doc.authority, jurisdiction: doc.jurisdiction, version: doc.version, bindingLevel: doc.bindingLevel, status: doc.status });
    explainability.push({ documentId: doc.documentId, reason: `Documento aplicável (${doc.jurisdiction}); ${top.length} trecho(s) relevante(s) para a consulta.`, authority: doc.authority, version: doc.version, bindingLevel: doc.bindingLevel, lineageId: g.ingested.knowledgeDocument.lineageId });

    for (const { b, score, isGenericPenalized } of top) {
      passages.push({ documentId: doc.documentId, normId: doc.normId, blockId: b.id, identifier: b.title, text: clipPassage(b.fragments.map(f => f.text).join("\n"), params.maxPassageChars), score });
      citations.push({ documentId: doc.documentId, reference: `${doc.title} — ${b.title}`, authority: doc.authority, version: doc.version, jurisdiction: doc.jurisdiction, bindingLevel: doc.bindingLevel, lineageId: g.ingested.knowledgeDocument.lineageId });
      const blockTokens = new Set(tokenize(b.fragments.map(f => f.text).join(" ")));
      for (const t of queryTerms) if (blockTokens.has(t)) coveredTerms.add(t);
      if (score > topScore) { topScore = score; topIsGenericPenalized = isGenericPenalized; }
    }
  }

  const maxPassageScore = passages.reduce((m, p) => Math.max(m, p.score), 0);
  const coverageRatio = reachableTermsCount > 0 ? Math.round((coveredTerms.size / reachableTermsCount) * 1000) / 1000 : 0;

  return {
    documents: documents.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    passages, citations,
    explainability: explainability.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    documentsLoaded: documentsLoaded.sort(), documentsIgnored: [...ignored].sort(),
    searchRounds: 1, coverageRatio, maxPassageScore,
    topPassageGenericContainer: passages.length > 0 && topIsGenericPenalized,
  };
}

/**
 * Recupera trechos relevantes dos documentos aplicáveis. Determinístico (ordenação estável por
 * score desc → blockId). Um documento sem trecho acima do limiar é registrado como "ignorado".
 *
 * RAG-QUALITY-001 — se a 1ª rodada cobre poucos termos da consulta (e não há passagem muito forte),
 * uma 2ª rodada mais permissiva (minScore menor, mais passagens por documento) é tentada; o resultado
 * final é o melhor entre as duas (nunca pior que a 1ª rodada). Teto de 2 rodadas — sem laço, sem IA.
 */
export function retrieveKnowledge(corpus: OfficialCorpusBuildResult, context: InstitutionalContext, params: RetrieveParams): RetrievalResult {
  const maxPer = params.maxPassagesPerDocument ?? 3;
  const minScore = params.minScore ?? 0.1;

  const pass1 = runRetrievalPass(corpus, context, params.query, maxPer, minScore);
  const result1 = buildResult(context, pass1.byDoc, new Set(pass1.ignored), maxPer, params, pass1.reachableTermsCount);

  const needsEscalation = pass1.reachableTermsCount > 0
    && result1.coverageRatio < ESCALATION_COVERAGE_THRESHOLD
    && result1.maxPassageScore < ESCALATION_SKIP_IF_MAX_SCORE_ABOVE;
  if (!needsEscalation) return result1;

  const widerMaxPer = Math.min(maxPer * 2, 8);
  const widerMinScore = Math.max(minScore / 2, 0.02);
  const pass2 = runRetrievalPass(corpus, context, params.query, widerMaxPer, widerMinScore);
  const result2 = buildResult(context, pass2.byDoc, new Set(pass2.ignored), widerMaxPer, { ...params }, pass2.reachableTermsCount);

  const improved = result2.coverageRatio > result1.coverageRatio || result2.maxPassageScore > result1.maxPassageScore;
  return improved ? { ...result2, searchRounds: 2 } : { ...result1, searchRounds: 2 };
}
