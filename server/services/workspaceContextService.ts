/**
 * Sprint 5.0 — Workspace Context Service
 *
 * Monta o contexto operacional completo do Workspace combinando Institutional RAG,
 * Procurement Knowledge Graph e Semantic Memory (memória dos copilotos). Degrada
 * graciosamente sem DB.
 */

import { retrieveAll, weightedMerge } from "./institutionalRetrievalService";
import { searchKnowledgeNodes } from "../db/knowledgeGraph";
import { summarizeMemory } from "./copilotMemoryService";
import {
  createWorkspaceContext,
  type WorkspaceContext,
  type WorkspaceContextEvidence,
} from "../domain/workspaceContext";
import type { CopilotType } from "../domain/institutionalCopilot";

export async function buildWorkspaceContext(params: {
  organizationId: number;
  workspaceId: string;
  query: string;
  documents?: Array<{ id: string; title: string; kind: string }>;
  memoryCopilots?: CopilotType[];
  correlationId: string;
}): Promise<WorkspaceContext> {
  const { organizationId: orgId, workspaceId, query, correlationId } = params;

  const retrieval = await retrieveAll(query, orgId);
  const merged = weightedMerge(retrieval);
  const graphNodes = await searchKnowledgeNodes(orgId, { query, limit: 12 });

  const evidences: WorkspaceContextEvidence[] = merged.slice(0, 15).map(c => ({
    id: c.id,
    content: c.content,
    source: c.source,
    relevance: c.similarity,
  }));

  // Memória agregada dos copilotos relevantes
  const memoryParts: string[] = [];
  for (const ct of params.memoryCopilots ?? []) {
    const s = summarizeMemory(orgId, ct, 3);
    if (s) memoryParts.push(`# ${ct}\n${s}`);
  }

  return createWorkspaceContext({
    workspaceId,
    organizationId: orgId,
    documents: params.documents ?? [],
    graphNodeIds: graphNodes.map(n => n.id),
    evidences,
    memorySummary: memoryParts.join("\n\n"),
    correlationId,
  });
}
