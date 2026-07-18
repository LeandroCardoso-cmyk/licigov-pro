/**
 * RC-5.0 — Institutional Knowledge Integration Layer · KnowledgeRetrievalService (Componente 2).
 *
 * Recebe o contexto institucional e consulta EXCLUSIVAMENTE o Official Knowledge Corpus (RC-4.9)
 * para selecionar documentos relevantes e recuperar trechos pertinentes — por correspondência
 * lexical DETERMINÍSTICA (SEM IA, SEM sumarização, SEM interpretação). Preserva documentId,
 * authority, version, jurisdiction, bindingLevel, citation, lineage e explainability.
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
}

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "a", "o", "e", "as", "os", "para", "por", "com", "que", "em", "no", "na", "um", "uma", "ao", "à"]);

function tokenize(s: string): string[] {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t));
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

/**
 * Recupera trechos relevantes dos documentos aplicáveis. Determinístico (ordenação estável por
 * score desc → blockId). Um documento sem trecho acima do limiar é registrado como "ignorado".
 */
export function retrieveKnowledge(corpus: OfficialCorpusBuildResult, context: InstitutionalContext, params: RetrieveParams): RetrievalResult {
  const maxPer = params.maxPassagesPerDocument ?? 3;
  const minScore = params.minScore ?? 0.1;
  const queryTerms = expandQueryTerms(params.query);
  const ingestedByNorm = new Map<string, IngestedDocument>(corpus.ingested.map(d => [d.official.normId, d]));

  type Cand = {
    doc: (typeof context.applicableDocuments)[number];
    ingested: IngestedDocument;
    b: ReturnType<typeof allBlocks>[number];
    tokens: Set<string>;
  };

  // Passo 1 — candidatos (blocos oficiais dos documentos aplicáveis) + tokens.
  const cands: Cand[] = [];
  const ignored = new Set<string>();
  for (const doc of context.applicableDocuments) {
    const ingested = ingestedByNorm.get(doc.normId);
    if (!ingested) { ignored.add(doc.documentId); continue; }
    const blocks = allBlocks(ingested.knowledgeDocument).filter(b => b.kind === "OfficialText");
    if (blocks.length === 0) { ignored.add(doc.documentId); continue; }
    for (const b of blocks) cands.push({ doc, ingested, b, tokens: new Set(tokenize(b.fragments.map(f => f.text).join(" "))) });
  }

  // IDF sobre os blocos candidatos: termos raros/específicos ("preliminar") pesam mais que genéricos
  // ("quando"). Isso ranqueia os trechos pertinentes acima do ruído — determinístico, sem embeddings.
  const N = Math.max(1, cands.length);
  const df = new Map<string, number>();
  for (const c of cands) for (const t of c.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) ?? 0))) + 1;
  const denom = queryTerms.reduce((s, t) => s + idf(t), 0) || 1;
  const scoreOf = (tokens: Set<string>): number => {
    let num = 0;
    for (const t of queryTerms) if (tokens.has(t)) num += idf(t);
    return Math.round((num / denom) * 1000) / 1000;
  };

  // Passo 2 — pontua e agrupa por documento.
  const byDoc = new Map<string, { doc: Cand["doc"]; ingested: IngestedDocument; scored: Array<{ b: Cand["b"]; score: number }> }>();
  for (const c of cands) {
    const score = scoreOf(c.tokens);
    if (score < minScore) continue;
    let g = byDoc.get(c.doc.documentId);
    if (!g) { g = { doc: c.doc, ingested: c.ingested, scored: [] }; byDoc.set(c.doc.documentId, g); }
    g.scored.push({ b: c.b, score });
  }

  const documents: ContextDocument[] = [];
  const passages: RetrievedPassage[] = [];
  const citations: Citation[] = [];
  const explainability: ContextExplainabilityEntry[] = [];
  const documentsLoaded: string[] = [];

  for (const doc of context.applicableDocuments) {
    const g = byDoc.get(doc.documentId);
    if (!g || g.scored.length === 0) { ignored.add(doc.documentId); continue; }
    const top = g.scored.sort((a, b) => b.score - a.score || a.b.id.localeCompare(b.b.id)).slice(0, maxPer);

    documentsLoaded.push(doc.documentId);
    documents.push({ documentId: doc.documentId, normId: doc.normId, title: doc.title, authority: doc.authority, jurisdiction: doc.jurisdiction, version: doc.version, bindingLevel: doc.bindingLevel, status: doc.status });
    explainability.push({ documentId: doc.documentId, reason: `Documento aplicável (${doc.jurisdiction}); ${top.length} trecho(s) relevante(s) para a consulta.`, authority: doc.authority, version: doc.version, bindingLevel: doc.bindingLevel, lineageId: g.ingested.knowledgeDocument.lineageId });

    for (const { b, score } of top) {
      passages.push({ documentId: doc.documentId, normId: doc.normId, blockId: b.id, identifier: b.title, text: clipPassage(b.fragments.map(f => f.text).join("\n"), params.maxPassageChars), score });
      citations.push({ documentId: doc.documentId, reference: `${doc.title} — ${b.title}`, authority: doc.authority, version: doc.version, jurisdiction: doc.jurisdiction, bindingLevel: doc.bindingLevel, lineageId: g.ingested.knowledgeDocument.lineageId });
    }
  }

  return {
    documents: documents.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    passages, citations,
    explainability: explainability.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    documentsLoaded: documentsLoaded.sort(), documentsIgnored: [...ignored].sort(),
  };
}
