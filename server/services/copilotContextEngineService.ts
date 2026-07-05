/**
 * Sprint 4.9 — Copilot Context Engine Service
 *
 * Monta o contexto especializado de cada copiloto combinando o Institutional RAG
 * (retrieveAll) e o Procurement Knowledge Graph (searchKnowledgeNodes). O contexto
 * é fundamentado — nunca prompt cru. Degrada graciosamente sem DB.
 */

import { createHash } from "crypto";
import type { CopilotType } from "../domain/institutionalCopilot";
import { retrieveAll, weightedMerge, type RetrievedChunk, type LegalRef } from "./institutionalRetrievalService";
import { searchKnowledgeNodes } from "../db/knowledgeGraph";

export interface CopilotEvidence {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly relevance: number;
  readonly kind: string;
}

export interface CopilotContext {
  readonly id: string;
  readonly organizationId: number;
  readonly copilotType: CopilotType;
  readonly query: string;
  readonly evidences: readonly CopilotEvidence[];
  readonly legalRefs: readonly LegalRef[];
  readonly graphNodeIds: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

/** Pesos de fonte por domínio — cada especialista prioriza fontes distintas. */
const SOURCE_WEIGHTS: Record<CopilotType, Record<string, number>> = {
  juridico: { legal: 1.4, graph: 1.2, chunks: 0.9, trs: 0.7, history: 0.6 },
  tr_intelligence: { trs: 1.4, chunks: 1.1, graph: 1.1, legal: 1.0, history: 0.8 },
  planejamento: { chunks: 1.2, legal: 1.1, graph: 1.1, trs: 1.0, history: 1.0 },
  pregoeiro: { legal: 1.2, chunks: 1.0, graph: 1.1, trs: 0.9, history: 0.9 },
  pesquisa_precos: { history: 1.3, chunks: 1.1, trs: 1.0, graph: 0.9, legal: 0.8 },
  contratos: { chunks: 1.1, legal: 1.1, graph: 1.1, history: 1.0, trs: 0.9 },
  controle_interno: { legal: 1.3, graph: 1.2, chunks: 1.0, history: 1.0, trs: 0.8 },
  agente_contratacao: { legal: 1.2, chunks: 1.0, graph: 1.1, trs: 0.9, history: 0.8 },
};

export async function buildCopilotContext(params: {
  organizationId: number;
  copilotType: CopilotType;
  query: string;
  correlationId: string;
  maxEvidences?: number;
}): Promise<CopilotContext> {
  const { organizationId: orgId, copilotType, query, correlationId } = params;

  // 1) Institutional RAG (já inclui graphChunks do Knowledge Graph via retrieveAll)
  const retrieval = await retrieveAll(query, orgId);
  const weights = SOURCE_WEIGHTS[copilotType];
  const merged: RetrievedChunk[] = weightedMerge(retrieval, weights);

  // 2) Knowledge Graph — nós semente diretamente relevantes
  const graphNodes = await searchKnowledgeNodes(orgId, { query, limit: 10 });

  const maxEvidences = params.maxEvidences ?? 12;
  const evidences: CopilotEvidence[] = merged.slice(0, maxEvidences).map(chunk => ({
    id: chunk.id,
    content: chunk.content,
    source: chunk.source,
    relevance: chunk.similarity,
    kind: chunk.chunkType,
  }));

  const id = createHash("sha256")
    .update(`cctx:${orgId}:${copilotType}:${correlationId}`)
    .digest("hex").slice(0, 20);

  return {
    id,
    organizationId: orgId,
    copilotType,
    query,
    evidences,
    legalRefs: retrieval.legalRefs,
    graphNodeIds: graphNodes.map(n => n.id),
    correlationId,
    createdAt: new Date().toISOString(),
  };
}

/** Renderiza o contexto como bloco fundamentado para o prompt (nunca prompt cru). */
export function renderContextBlock(context: CopilotContext): string {
  const lines: string[] = [];
  lines.push(`# Contexto institucional (${context.copilotType})`);
  lines.push(`Consulta: ${context.query}`);
  if (context.legalRefs.length > 0) {
    lines.push("\n## Base legal");
    for (const ref of context.legalRefs) {
      lines.push(`- ${ref.lawRef} ${ref.article}: ${ref.text}`);
    }
  }
  if (context.evidences.length > 0) {
    lines.push("\n## Evidências recuperadas");
    for (const ev of context.evidences) {
      lines.push(`- [${ev.source}] ${ev.content} (relevância ${ev.relevance.toFixed(2)})`);
    }
  }
  return lines.join("\n");
}
