/**
 * RC-4.8 — Institutional Knowledge Pipeline · Pipeline (Fase 1).
 *
 * KnowledgePipeline, KnowledgePipelineDefinition, KnowledgePipelineStage, KnowledgePipelineContext
 * e KnowledgePipelineRegistry. Todo conhecimento institucional nasce por um pipeline. Determinístico,
 * multi-tenant. Ordem derivada do grafo de dependências dos estágios.
 */

import { createHash } from "crypto";
import type { KnowledgeDocument } from "../knowledgeDocument";
import { INSTITUTIONAL_STAGES, type PipelineStageDef, type PipelineStageId } from "./pipelineStages";

export interface KnowledgePipelineStage extends PipelineStageDef {}

export interface KnowledgePipelineDefinition {
  readonly id: string;
  readonly tenantId: number;
  readonly name: string;
  readonly version: string;
  readonly stages: readonly KnowledgePipelineStage[];
}

export interface KnowledgePipeline {
  readonly definition: KnowledgePipelineDefinition;
  /** Ordem determinística de execução (por order → id). */
  readonly order: readonly PipelineStageId[];
}

/** Contexto que acompanha uma execução (carrega o documento em produção). */
export interface KnowledgePipelineContext {
  readonly tenantId: number;
  readonly correlationId: string;
  readonly document: KnowledgeDocument;
  readonly bindingConsistent?: boolean;
  /** Perfil de quality gate ("official_norm" p/ documentos oficiais verbatim — RC-4.9). */
  readonly qualityProfile?: "general" | "official_norm";
  readonly metadata?: Record<string, unknown>;
}

/** Cria a definição oficial do pipeline institucional (16 estágios). Determinística. */
export function createInstitutionalPipelineDefinition(tenantId: number, name = "Institutional Knowledge Pipeline", version = "1.0.0"): KnowledgePipelineDefinition {
  const id = createHash("sha256").update(`kpipe:${tenantId}:${name}:${version}`).digest("hex").slice(0, 20);
  return { id, tenantId, name, version, stages: INSTITUTIONAL_STAGES.map(s => ({ ...s })) };
}

/** Monta o pipeline (ordena os estágios deterministicamente). */
export function buildPipeline(definition: KnowledgePipelineDefinition): KnowledgePipeline {
  const order = [...definition.stages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map(s => s.id);
  return { definition, order };
}

export function getStage(pipeline: KnowledgePipeline, id: PipelineStageId): KnowledgePipelineStage | null {
  return pipeline.definition.stages.find(s => s.id === id) ?? null;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface KnowledgePipelineRegistry {
  readonly definitions: readonly KnowledgePipelineDefinition[];
}

export function createPipelineRegistry(definitions: KnowledgePipelineDefinition[] = []): KnowledgePipelineRegistry {
  const sorted = [...definitions].sort((a, b) => a.id.localeCompare(b.id));
  return { definitions: sorted };
}

/** Registra uma definição (append-only; idempotente por id). */
export function registerPipeline(registry: KnowledgePipelineRegistry, definition: KnowledgePipelineDefinition): KnowledgePipelineRegistry {
  if (registry.definitions.some(d => d.id === definition.id)) return registry;
  return createPipelineRegistry([...registry.definitions, definition]);
}

export function getPipelineDefinition(registry: KnowledgePipelineRegistry, id: string): KnowledgePipelineDefinition | null {
  return registry.definitions.find(d => d.id === id) ?? null;
}
