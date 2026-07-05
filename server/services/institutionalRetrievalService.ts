import { createHash } from "crypto";
import {
  searchKnowledgeNodes,
  getEdgesForNodes,
  getNodesByIds,
} from "../db/knowledgeGraph";

export interface RetrievedChunk {
  readonly id: string;
  readonly content: string;
  readonly similarity: number;
  readonly source: string;
  readonly chunkType: string;
  readonly organizationId: number;
}

export interface LegalRef {
  readonly id: string;
  readonly lawRef: string;
  readonly article: string;
  readonly text: string;
  readonly confidence: number;
  readonly source: string;
  readonly organizationId: number;
}

export interface SimilarTR {
  readonly id: string;
  readonly trNumber: string;
  readonly description: string;
  readonly similarity: number;
  readonly organizationId: number;
}

export interface HistoryItem {
  readonly id: string;
  readonly processNumber: string;
  readonly description: string;
  readonly date: string;
  readonly relevance: number;
  readonly organizationId: number;
}

export interface EvidenceItem {
  readonly id: string;
  readonly content: string;
  readonly confidence: number;
  readonly source: string;
  readonly type: string;
  readonly organizationId: number;
}

function generateId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

export function retrieveFromDocuments(
  query: string,
  orgId: number
): RetrievedChunk[] {
  return [
    {
      id: generateId(`doc-${orgId}-${query}-0`),
      content:
        "Procedimentos para aquisição de bens comuns conforme especificações técnicas do setor requisitante.",
      similarity: 0.88,
      source: "internal_docs",
      chunkType: "document",
      organizationId: orgId,
    },
    {
      id: generateId(`doc-${orgId}-${query}-1`),
      content:
        "Orientações sobre pesquisa de preços e formação de preço de referência para processos licitatórios.",
      similarity: 0.82,
      source: "internal_docs",
      chunkType: "document",
      organizationId: orgId,
    },
  ];
}

export function retrieveFromLegal(
  query: string,
  orgId: number
): LegalRef[] {
  return [
    {
      id: generateId(`legal-${orgId}-${query}-0`),
      lawRef: "Lei 14.133/2021",
      article: "Art. 18",
      text: "O estudo técnico preliminar a que se refere o inciso XX do caput do art. 6º desta Lei deverá evidenciar o problema a ser resolvido e a melhor solução.",
      confidence: 0.95,
      source: "lei_14133",
      organizationId: orgId,
    },
    {
      id: generateId(`legal-${orgId}-${query}-1`),
      lawRef: "Lei 14.133/2021",
      article: "Art. 6º, XXIII",
      text: "Termo de referência: documento necessário para a contratação de bens e serviços, que deve conter parâmetros e elementos descritivos.",
      confidence: 0.91,
      source: "lei_14133",
      organizationId: orgId,
    },
  ];
}

export function retrieveFromTRs(
  query: string,
  orgId: number
): SimilarTR[] {
  return [
    {
      id: generateId(`tr-${orgId}-${query}-0`),
      trNumber: "TR-2024/0001",
      description:
        "Termo de Referência para aquisição de materiais de escritório",
      similarity: 0.85,
      organizationId: orgId,
    },
    {
      id: generateId(`tr-${orgId}-${query}-1`),
      trNumber: "TR-2024/0015",
      description:
        "Termo de Referência para contratação de serviços de manutenção predial",
      similarity: 0.78,
      organizationId: orgId,
    },
  ];
}

export function retrieveFromHistory(
  query: string,
  orgId: number
): HistoryItem[] {
  return [
    {
      id: generateId(`history-${orgId}-${query}-0`),
      processNumber: "2024/0042",
      description:
        "Processo de aquisição de equipamentos de informática concluído com sucesso",
      date: "2024-06-15",
      relevance: 0.80,
      organizationId: orgId,
    },
    {
      id: generateId(`history-${orgId}-${query}-1`),
      processNumber: "2024/0078",
      description:
        "Processo de contratação de serviços terceirizados de limpeza",
      date: "2024-08-22",
      relevance: 0.72,
      organizationId: orgId,
    },
  ];
}

export function retrieveFromCATMAT(
  _query: string,
  _orgId: number
): RetrievedChunk[] {
  return [];
}

export function retrieveFromTemplates(
  query: string,
  orgId: number
): RetrievedChunk[] {
  return [
    {
      id: generateId(`template-${orgId}-${query}-0`),
      content:
        "Modelo padrão de Termo de Referência para aquisições de bens comuns conforme Lei 14.133/2021.",
      similarity: 0.90,
      source: "templates",
      chunkType: "template",
      organizationId: orgId,
    },
  ];
}

/**
 * Sprint 4.8.1 — Knowledge Graph lookup para o pipeline RAG.
 *
 * Busca nós relevantes no grafo, expande as arestas incidentes (adjacência) e
 * transforma nós + relacionamentos em evidências que enriquecem o retrieval.
 * Degradação graciosa: sem DB (getDb null) retorna []. Multi-tenant por orgId.
 */
export async function retrieveFromKnowledgeGraph(
  query: string,
  orgId: number
): Promise<RetrievedChunk[]> {
  const seeds = await searchKnowledgeNodes(orgId, { query, limit: 5 });
  if (seeds.length === 0) return [];

  const seedIds = seeds.map((n) => n.id);
  const edges = await getEdgesForNodes(seedIds, orgId);

  const neighborIds = new Set<string>();
  for (const e of edges) {
    neighborIds.add(e.sourceNodeId);
    neighborIds.add(e.targetNodeId);
  }
  for (const id of seedIds) neighborIds.delete(id);

  const neighbors = await getNodesByIds([...neighborIds], orgId);
  const nodeById = new Map([...seeds, ...neighbors].map((n) => [n.id, n]));

  const chunks: RetrievedChunk[] = [];

  for (const seed of seeds) {
    chunks.push({
      id: generateId(`kg-node-${seed.id}`),
      content: seed.description ? `${seed.title}: ${seed.description}` : seed.title,
      similarity: seed.confidence,
      source: "knowledge_graph",
      chunkType: seed.nodeType,
      organizationId: orgId,
    });
  }

  for (const edge of edges) {
    const s = nodeById.get(edge.sourceNodeId);
    const t = nodeById.get(edge.targetNodeId);
    if (!s || !t) continue;
    const relation = `${s.title} —[${edge.relationshipType}]→ ${t.title}`;
    chunks.push({
      id: generateId(`kg-edge-${edge.id}`),
      content: edge.justification ? `${relation}: ${edge.justification}` : relation,
      similarity: edge.confidence * edge.weight,
      source: "knowledge_graph",
      chunkType: "graph_relationship",
      organizationId: orgId,
    });
  }

  return chunks;
}

export async function retrieveAll(
  query: string,
  orgId: number
): Promise<{
  chunks: RetrievedChunk[];
  legalRefs: LegalRef[];
  similarTRs: SimilarTR[];
  history: HistoryItem[];
  evidence: EvidenceItem[];
  graphChunks: RetrievedChunk[];
}> {
  const [chunks, legalRefs, similarTRs, history, graphChunks] = await Promise.all([
    Promise.resolve(retrieveFromDocuments(query, orgId)),
    Promise.resolve(retrieveFromLegal(query, orgId)),
    Promise.resolve(retrieveFromTRs(query, orgId)),
    Promise.resolve(retrieveFromHistory(query, orgId)),
    retrieveFromKnowledgeGraph(query, orgId),
  ]);

  const evidence: EvidenceItem[] = chunks.map((chunk) => ({
    id: generateId(`evidence-${chunk.id}`),
    content: chunk.content,
    confidence: chunk.similarity,
    source: chunk.source,
    type: chunk.chunkType,
    organizationId: chunk.organizationId,
  }));

  return { chunks, legalRefs, similarTRs, history, evidence, graphChunks };
}

export function weightedMerge(
  sources: {
    chunks: RetrievedChunk[];
    legalRefs: LegalRef[];
    similarTRs: SimilarTR[];
    history: HistoryItem[];
    evidence: EvidenceItem[];
    graphChunks?: RetrievedChunk[];
  },
  weights?: Record<string, number>
): RetrievedChunk[] {
  const w = {
    chunks: weights?.chunks ?? 1.0,
    legal: weights?.legal ?? 1.2,
    trs: weights?.trs ?? 0.9,
    history: weights?.history ?? 0.7,
    evidence: weights?.evidence ?? 1.1,
    // Relacionamentos do grafo são evidências fortemente fundamentadas
    graph: weights?.graph ?? 1.15,
  };

  const merged: RetrievedChunk[] = [];

  for (const gchunk of sources.graphChunks ?? []) {
    merged.push({
      id: gchunk.id,
      content: gchunk.content,
      similarity: gchunk.similarity * w.graph,
      source: gchunk.source,
      chunkType: gchunk.chunkType,
      organizationId: gchunk.organizationId,
    });
  }

  for (const chunk of sources.chunks) {
    merged.push({
      id: chunk.id,
      content: chunk.content,
      similarity: chunk.similarity * w.chunks,
      source: chunk.source,
      chunkType: chunk.chunkType,
      organizationId: chunk.organizationId,
    });
  }

  for (const ref of sources.legalRefs) {
    merged.push({
      id: ref.id,
      content: `${ref.lawRef} ${ref.article}: ${ref.text}`,
      similarity: ref.confidence * w.legal,
      source: ref.source,
      chunkType: "legal",
      organizationId: ref.organizationId,
    });
  }

  for (const tr of sources.similarTRs) {
    merged.push({
      id: tr.id,
      content: `${tr.trNumber}: ${tr.description}`,
      similarity: tr.similarity * w.trs,
      source: "similar_trs",
      chunkType: "tr",
      organizationId: tr.organizationId,
    });
  }

  for (const item of sources.history) {
    merged.push({
      id: item.id,
      content: `${item.processNumber}: ${item.description}`,
      similarity: item.relevance * w.history,
      source: "history",
      chunkType: "history",
      organizationId: item.organizationId,
    });
  }

  for (const ev of sources.evidence) {
    merged.push({
      id: ev.id,
      content: ev.content,
      similarity: ev.confidence * w.evidence,
      source: ev.source,
      chunkType: ev.type,
      organizationId: ev.organizationId,
    });
  }

  merged.sort((a, b) => b.similarity - a.similarity);

  return merged;
}
