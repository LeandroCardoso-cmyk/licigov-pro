/**
 * RC-4.8 — Institutional Knowledge Pipeline · Graph Orchestration (Fase 8).
 *
 * Projeta automaticamente para o Knowledge Graph: Pipeline, Execution, Stages, Publications,
 * Knowledge, Bindings, Corpus e Lineage. Determinística (ordenação estável). Sem conteúdo jurídico.
 */

import type { KnowledgePipeline } from "./knowledgePipeline";
import type { KnowledgePipelineResult } from "./pipelineExecution";
import type { PublicationSnapshot } from "./publicationEngine";

export interface PipelineGraphNode {
  readonly id: string;
  readonly semanticType: "pipeline" | "execution" | "stage" | "publication" | "knowledge" | "lineage";
  readonly attributes: Record<string, unknown>;
}
export interface PipelineGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}
export interface PipelineProjection {
  readonly nodes: readonly PipelineGraphNode[];
  readonly edges: readonly PipelineGraphEdge[];
}

/** Projeção determinística de uma execução de pipeline (+ publicação opcional). */
export function projectPipeline(pipeline: KnowledgePipeline, result: KnowledgePipelineResult, publication?: PublicationSnapshot): PipelineProjection {
  const nodes: PipelineGraphNode[] = [];
  const edges: PipelineGraphEdge[] = [];

  const pipeNode = `pipe:${pipeline.definition.id}`;
  const execNode = `exec:${result.execution.pipelineExecutionId}`;
  nodes.push({ id: pipeNode, semanticType: "pipeline", attributes: { tenantId: pipeline.definition.tenantId, name: pipeline.definition.name, version: pipeline.definition.version, stages: pipeline.order.length } });
  nodes.push({ id: execNode, semanticType: "execution", attributes: { status: result.execution.status, executed: result.execution.executedStages.length, failedStage: result.execution.failedStage } });
  edges.push({ from: pipeNode, to: execNode, type: "executed_as" });

  for (const s of result.stageResults) {
    const sn = `stage:${result.execution.pipelineExecutionId}:${s.stageId}`;
    nodes.push({ id: sn, semanticType: "stage", attributes: { stageId: s.stageId, status: s.status, order: s.order } });
    edges.push({ from: execNode, to: sn, type: "ran_stage" });
  }

  // Knowledge + lineage.
  const knowNode = `knowledge:${result.execution.lineage}`;
  nodes.push({ id: knowNode, semanticType: "knowledge", attributes: { lineageId: result.execution.lineage } });
  edges.push({ from: execNode, to: knowNode, type: "produces" });
  nodes.push({ id: `lineage:${result.execution.lineage}`, semanticType: "lineage", attributes: {} });
  edges.push({ from: knowNode, to: `lineage:${result.execution.lineage}`, type: "lineage" });

  if (publication) {
    const pubNode = `pub:${publication.snapshotId}`;
    nodes.push({ id: pubNode, semanticType: "publication", attributes: { semver: publication.version.semver, revision: publication.version.revision, docKey: publication.manifest.docKey } });
    edges.push({ from: execNode, to: pubNode, type: "published_as" });
    edges.push({ from: pubNode, to: knowNode, type: "publishes" });
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  return { nodes, edges };
}
