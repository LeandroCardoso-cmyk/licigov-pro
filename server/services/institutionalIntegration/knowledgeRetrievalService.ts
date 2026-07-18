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

/** Pontuação lexical determinística: fração de termos da consulta presentes no trecho. */
function scorePassage(queryTerms: readonly string[], text: string): number {
  if (queryTerms.length === 0) return 0;
  const hay = new Set(tokenize(text));
  const hits = queryTerms.filter(t => hay.has(t)).length;
  return Math.round((hits / queryTerms.length) * 1000) / 1000;
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
  const queryTerms = tokenize(params.query);
  const ingestedByNorm = new Map<string, IngestedDocument>(corpus.ingested.map(d => [d.official.normId, d]));

  const documents: ContextDocument[] = [];
  const passages: RetrievedPassage[] = [];
  const citations: Citation[] = [];
  const explainability: ContextExplainabilityEntry[] = [];
  const documentsLoaded: string[] = [];
  const documentsIgnored: string[] = [];

  for (const doc of context.applicableDocuments) {
    const ingested = ingestedByNorm.get(doc.normId);
    if (!ingested) { documentsIgnored.push(doc.documentId); continue; }

    const scored = allBlocks(ingested.knowledgeDocument)
      .filter(b => b.kind === "OfficialText")
      .map(b => ({ b, score: scorePassage(queryTerms, b.fragments.map(f => f.text).join(" ")) }))
      .filter(x => x.score >= minScore)
      .sort((a, b) => b.score - a.score || a.b.id.localeCompare(b.b.id))
      .slice(0, maxPer);

    if (scored.length === 0) { documentsIgnored.push(doc.documentId); continue; }

    documentsLoaded.push(doc.documentId);
    documents.push({ documentId: doc.documentId, normId: doc.normId, title: doc.title, authority: doc.authority, jurisdiction: doc.jurisdiction, version: doc.version, bindingLevel: doc.bindingLevel, status: doc.status });
    explainability.push({ documentId: doc.documentId, reason: `Documento aplicável (${doc.jurisdiction}); ${scored.length} trecho(s) relevante(s) para a consulta.`, authority: doc.authority, version: doc.version, bindingLevel: doc.bindingLevel, lineageId: ingested.knowledgeDocument.lineageId });

    for (const { b, score } of scored) {
      passages.push({ documentId: doc.documentId, normId: doc.normId, blockId: b.id, identifier: b.title, text: clipPassage(b.fragments.map(f => f.text).join("\n"), params.maxPassageChars), score });
      citations.push({ documentId: doc.documentId, reference: `${doc.title} — ${b.title}`, authority: doc.authority, version: doc.version, jurisdiction: doc.jurisdiction, bindingLevel: doc.bindingLevel, lineageId: ingested.knowledgeDocument.lineageId });
    }
  }

  return {
    documents: documents.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    passages, citations,
    explainability: explainability.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    documentsLoaded: documentsLoaded.sort(), documentsIgnored: documentsIgnored.sort(),
  };
}
