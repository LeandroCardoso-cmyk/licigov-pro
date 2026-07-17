/**
 * RC-4.8 — Institutional Knowledge Pipeline · Amostra estrutural.
 *
 * Monta o pipeline institucional e um contexto de execução a partir do documento de exemplo
 * (RC-4.7) — genérico, sem conteúdo jurídico. Determinístico.
 */

import { createInstitutionalPipelineDefinition, buildPipeline, type KnowledgePipeline, type KnowledgePipelineContext } from "./knowledgePipeline";
import { sampleKnowledgeDocument } from "../knowledgeSample";
import type { KnowledgeDocument } from "../knowledgeDocument";

const T = "2026-01-01T00:00:00.000Z";

export function samplePipeline(tenantId: number): KnowledgePipeline {
  return buildPipeline(createInstitutionalPipelineDefinition(tenantId));
}

/** Contexto de execução com um documento que satisfaz os quality gates. */
export function samplePipelineContext(tenantId: number, correlationId = "corr-pipe", document?: KnowledgeDocument): KnowledgePipelineContext {
  return {
    tenantId, correlationId,
    document: document ?? sampleKnowledgeDocument(tenantId),
    bindingConsistent: true,
    metadata: { origin: "sample" },
  };
}

export const SAMPLE_TIMES = { startedAt: T, finishedAt: T };
