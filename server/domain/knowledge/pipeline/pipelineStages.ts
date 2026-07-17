/**
 * RC-4.8 — Institutional Knowledge Pipeline · Pipeline Stages (Fase 2).
 *
 * Catálogo declarativo dos 16 estágios institucionais que compõem o ciclo de vida do conhecimento.
 * Genérico — sem acoplamento com Lei 14.133 ou qualquer conteúdo. Determinístico.
 */

export type PipelineStageId =
  | "source_acquisition" | "corpus_validation" | "normative_resolution" | "knowledge_mapping"
  | "knowledge_document_generation" | "binding_resolution" | "relationship_resolution"
  | "quality_validation" | "consistency_validation" | "explainability_validation"
  | "review" | "approval" | "publication" | "index_update" | "graph_projection" | "registry_update";

export interface PipelineStageDef {
  readonly id: PipelineStageId;
  readonly name: string;
  readonly description: string;
  readonly order: number;
  readonly dependencies: readonly PipelineStageId[];
  /** Estágio é um quality gate obrigatório (bloqueia publicação se falhar). */
  readonly isGate: boolean;
}

export const INSTITUTIONAL_STAGES: readonly PipelineStageDef[] = [
  { id: "source_acquisition", name: "Source Acquisition", description: "Aquisição da fonte (estrutural).", order: 1, dependencies: [], isGate: false },
  { id: "corpus_validation", name: "Corpus Validation", description: "Validação do corpus.", order: 2, dependencies: ["source_acquisition"], isGate: false },
  { id: "normative_resolution", name: "Normative Resolution", description: "Resolução da estrutura normativa.", order: 3, dependencies: ["corpus_validation"], isGate: false },
  { id: "knowledge_mapping", name: "Knowledge Mapping", description: "Mapeamento do conhecimento.", order: 4, dependencies: ["normative_resolution"], isGate: false },
  { id: "knowledge_document_generation", name: "Knowledge Document Generation", description: "Geração do documento de conhecimento.", order: 5, dependencies: ["knowledge_mapping"], isGate: false },
  { id: "binding_resolution", name: "Binding Resolution", description: "Resolução de bindings.", order: 6, dependencies: ["knowledge_document_generation"], isGate: false },
  { id: "relationship_resolution", name: "Relationship Resolution", description: "Resolução de relacionamentos.", order: 7, dependencies: ["binding_resolution"], isGate: false },
  { id: "quality_validation", name: "Quality Validation", description: "Validação de qualidade.", order: 8, dependencies: ["relationship_resolution"], isGate: true },
  { id: "consistency_validation", name: "Consistency Validation", description: "Validação de consistência.", order: 9, dependencies: ["quality_validation"], isGate: true },
  { id: "explainability_validation", name: "Explainability Validation", description: "Validação de explainability.", order: 10, dependencies: ["consistency_validation"], isGate: true },
  { id: "review", name: "Review", description: "Revisão humana.", order: 11, dependencies: ["explainability_validation"], isGate: false },
  { id: "approval", name: "Approval", description: "Aprovação.", order: 12, dependencies: ["review"], isGate: true },
  { id: "publication", name: "Publication", description: "Publicação.", order: 13, dependencies: ["approval"], isGate: false },
  { id: "index_update", name: "Index Update", description: "Atualização do índice.", order: 14, dependencies: ["publication"], isGate: false },
  { id: "graph_projection", name: "Graph Projection", description: "Projeção para o Knowledge Graph.", order: 15, dependencies: ["publication"], isGate: false },
  { id: "registry_update", name: "Registry Update", description: "Atualização do registro.", order: 16, dependencies: ["index_update", "graph_projection"], isGate: false },
];

export const ALL_STAGE_IDS: PipelineStageId[] = INSTITUTIONAL_STAGES.map(s => s.id);

export function isPipelineStage(id: string): id is PipelineStageId {
  return ALL_STAGE_IDS.includes(id as PipelineStageId);
}

export function getStageDef(id: PipelineStageId): PipelineStageDef {
  return INSTITUTIONAL_STAGES.find(s => s.id === id)!;
}

/** Ids dos estágios que são quality gates obrigatórios. */
export const GATE_STAGE_IDS: PipelineStageId[] = INSTITUTIONAL_STAGES.filter(s => s.isGate).map(s => s.id);
