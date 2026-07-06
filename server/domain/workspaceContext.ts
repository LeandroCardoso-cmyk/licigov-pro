/**
 * Sprint 5.0 — Workspace Context
 *
 * Agrega todo o contexto operacional de um Workspace: documentos, nós do
 * Knowledge Graph, evidências do Institutional RAG, memória e recomendações.
 * Estrutura determinística montada pelo workspaceContextService.
 */

import { createHash } from "crypto";

export interface WorkspaceContextDocument {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
}

export interface WorkspaceContextEvidence {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly relevance: number;
}

export interface WorkspaceContext {
  readonly id: string;
  readonly workspaceId: string;
  readonly organizationId: number;
  readonly documents: readonly WorkspaceContextDocument[];
  readonly graphNodeIds: readonly string[];
  readonly evidences: readonly WorkspaceContextEvidence[];
  readonly memorySummary: string;
  readonly recommendationIds: readonly string[];
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createWorkspaceContext(params: {
  workspaceId: string;
  organizationId: number;
  documents?: WorkspaceContextDocument[];
  graphNodeIds?: string[];
  evidences?: WorkspaceContextEvidence[];
  memorySummary?: string;
  recommendationIds?: string[];
  correlationId: string;
  createdAt?: string;
}): WorkspaceContext {
  const id = createHash("sha256")
    .update(`wctx:${params.organizationId}:${params.workspaceId}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    workspaceId: params.workspaceId,
    organizationId: params.organizationId,
    documents: params.documents ?? [],
    graphNodeIds: params.graphNodeIds ?? [],
    evidences: params.evidences ?? [],
    memorySummary: params.memorySummary ?? "",
    recommendationIds: params.recommendationIds ?? [],
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Densidade de contexto (0-1): quão fundamentado está o workspace. */
export function contextDensity(ctx: WorkspaceContext): number {
  const signals = [
    ctx.documents.length > 0,
    ctx.graphNodeIds.length > 0,
    ctx.evidences.length > 0,
    ctx.memorySummary.length > 0,
  ];
  return signals.filter(Boolean).length / signals.length;
}
