/**
 * RC-4.5.1 — Institutional Corpus Framework · Legal Knowledge Integration (Part 6).
 *
 * Toda LegalKnowledgeUnit (RC-4.5) pode PERTENCER a um Corpus — nunca diretamente ao sistema,
 * sempre dentro de uma Coleção de um Corpus. O vínculo (CorpusKnowledgeLink) PRESERVA
 * versionamento, replay safety, explainability e auditabilidade da unidade. Baixo acoplamento:
 * a Legal Knowledge Foundation NÃO importa esta camada. Determinístico.
 */

import { createHash } from "crypto";
import type { LegalKnowledgeUnit } from "../legalKnowledge/legalKnowledgeUnit";
import type { InstitutionalCorpus } from "./institutionalCorpus";
import { addMember, type KnowledgeCollection } from "./knowledgeCollection";

export interface CorpusKnowledgeLink {
  readonly id: string;
  readonly tenantId: number;
  readonly corpusId: string;
  readonly collectionId: string;
  /** Unidade jurídica vinculada (por id — nunca conteúdo). */
  readonly unitId: string;
  /** Preservação de versionamento/replay da unidade no momento do vínculo. */
  readonly unitLineageId: string;
  readonly unitVersion: number;
  readonly unitReplayHash: string;
  /** Explicação (explainability) do vínculo — nunca implícita. */
  readonly explanation: string;
  readonly createdAt: string;
}

export interface AttachLegalKnowledgeParams {
  corpus: InstitutionalCorpus;
  collection: KnowledgeCollection;
  unit: LegalKnowledgeUnit;
  explanation: string;
  createdAt?: string;
}

export interface AttachLegalKnowledgeResult {
  readonly link: CorpusKnowledgeLink;
  /** Coleção atualizada (append-only) com a unidade como membro. */
  readonly collection: KnowledgeCollection;
}

/**
 * Vincula uma LegalKnowledgeUnit a um Corpus, através de uma Coleção. Multi-tenant (valida
 * isolamento: corpus, coleção e unidade devem pertencer ao mesmo tenant). Determinístico.
 * Preserva versionamento/replay/explainability. Nunca insere conteúdo jurídico.
 */
export function attachLegalKnowledge(params: AttachLegalKnowledgeParams): AttachLegalKnowledgeResult {
  const { corpus, collection, unit } = params;
  if (corpus.tenantId !== collection.tenantId || corpus.tenantId !== unit.tenantId) {
    throw new Error("attachLegalKnowledge: isolamento multi-tenant violado (corpus/coleção/unidade em tenants distintos)");
  }
  if (collection.corpusId !== corpus.id) {
    throw new Error("attachLegalKnowledge: a coleção não pertence ao corpus informado");
  }
  const id = createHash("sha256").update(`corpuslink:${corpus.tenantId}:${corpus.id}:${collection.id}:${unit.id}`).digest("hex").slice(0, 20);
  const link: CorpusKnowledgeLink = {
    id, tenantId: corpus.tenantId, corpusId: corpus.id, collectionId: collection.id,
    unitId: unit.id, unitLineageId: unit.lineageId, unitVersion: unit.version, unitReplayHash: unit.replayHash,
    explanation: params.explanation, createdAt: params.createdAt ?? unit.createdAt,
  };
  const updated = addMember(collection, { kind: "legal_unit", refId: unit.id, note: params.explanation }, params.createdAt ?? collection.createdAt);
  return { link, collection: updated };
}
