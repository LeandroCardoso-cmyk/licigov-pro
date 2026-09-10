/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Provedor de corpus + índice legal para a AUTORIA (lazy cache).
 *
 * Build determinístico ÚNICO por processo do Official Knowledge Corpus (lê `data/*.txt` verbatim) e do
 * índice legal derivado (para validação anti-alucinação). NÃO é RAG/embedding: é o mesmo corpus in-memory
 * usado pela camada institucional. Um seam de teste permite injetar um corpus-fixture determinístico.
 */

import { buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import { buildCorpusLegalIndex, type CorpusLegalIndex } from "./legalReferenceValidationService";

let _corpus: OfficialCorpusBuildResult | null = null;
let _index: CorpusLegalIndex | null = null;

/** Corpus oficial memoizado para a autoria (build único, determinístico). */
export function getAuthoringCorpus(): OfficialCorpusBuildResult {
  if (!_corpus) _corpus = buildOfficialKnowledgeCorpus({ correlationId: "authoring-corpus" });
  return _corpus;
}

/** Índice legal memoizado (para verificação de existência de diploma/artigo/status). */
export function getAuthoringLegalIndex(): CorpusLegalIndex {
  if (!_index) _index = buildCorpusLegalIndex(getAuthoringCorpus());
  return _index;
}

/** Seam de teste: injeta um corpus-fixture (ou reseta com null). Reconstrói o índice sob demanda. */
export function __setAuthoringCorpusForTests(corpus: OfficialCorpusBuildResult | null): void {
  _corpus = corpus;
  _index = null;
}
