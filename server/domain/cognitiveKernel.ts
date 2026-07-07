/**
 * Sprint 5.0.1 — Cognitive Kernel (registro oficial)
 *
 * Registra formalmente toda a infraestrutura COMPARTILHADA do LiciGov Pro. Nenhum
 * destes componentes pertence a um módulo comercial: todos pertencem ao Kernel.
 * Domínios de negócio SEMPRE acessam estes serviços via kernelAccessService —
 * nunca duplicam infraestrutura nem acessam componentes internos diretamente.
 */

import { createHash } from "crypto";

export type KernelServiceId =
  | "ai_orchestration"
  | "workflow_engine"
  | "institutional_rag"
  | "procurement_knowledge_graph"
  | "semantic_memory"
  | "provider_layer"
  | "knowledge_retrieval"
  | "copilot_infrastructure"
  | "document_engine"
  | "timeline_engine"
  | "version_engine"
  | "approval_engine"
  | "governance_engine"
  | "observability"
  | "explainability"
  | "replay_engine"
  | "integration_layer"
  | "catmat_catser_engine"
  | "adaptive_process_engine"
  | "import_engine"
  | "audit_engine"
  | "institutional_request_engine";

export type KernelServiceCategory =
  | "ai"
  | "knowledge"
  | "workflow"
  | "document"
  | "governance"
  | "integration"
  | "platform";

export interface KernelService {
  readonly id: KernelServiceId;
  readonly name: string;
  readonly category: KernelServiceCategory;
  readonly description: string;
}

export const KERNEL_SERVICES: Record<KernelServiceId, KernelService> = {
  ai_orchestration: { id: "ai_orchestration", name: "AI Orchestration", category: "ai", description: "Orquestração de inferência via pipeline oficial." },
  workflow_engine: { id: "workflow_engine", name: "Workflow Engine", category: "workflow", description: "Motor de workflows supervisionados." },
  institutional_rag: { id: "institutional_rag", name: "Institutional RAG", category: "knowledge", description: "Retrieval aumentado institucional." },
  procurement_knowledge_graph: { id: "procurement_knowledge_graph", name: "Procurement Knowledge Graph", category: "knowledge", description: "Grafo de conhecimento de licitações." },
  semantic_memory: { id: "semantic_memory", name: "Semantic Memory", category: "knowledge", description: "Memória semântica contextual." },
  provider_layer: { id: "provider_layer", name: "Provider Layer", category: "ai", description: "Abstração de provedores de IA." },
  knowledge_retrieval: { id: "knowledge_retrieval", name: "Knowledge Retrieval", category: "knowledge", description: "Recuperação de conhecimento multi-fonte." },
  copilot_infrastructure: { id: "copilot_infrastructure", name: "Copilot Infrastructure", category: "ai", description: "Infraestrutura dos copilotos cognitivos." },
  document_engine: { id: "document_engine", name: "Document Engine", category: "document", description: "Geração e versionamento de documentos." },
  timeline_engine: { id: "timeline_engine", name: "Timeline Engine", category: "platform", description: "Linha do tempo institucional." },
  version_engine: { id: "version_engine", name: "Version Engine", category: "document", description: "Versionamento e histórico." },
  approval_engine: { id: "approval_engine", name: "Approval Engine", category: "governance", description: "Aprovações humanas supervisionadas." },
  governance_engine: { id: "governance_engine", name: "Governance Engine", category: "governance", description: "Políticas e governança de IA." },
  observability: { id: "observability", name: "Observability", category: "platform", description: "Métricas e traces persistidos." },
  explainability: { id: "explainability", name: "Explainability", category: "governance", description: "Explicabilidade das inferências." },
  replay_engine: { id: "replay_engine", name: "Replay Engine", category: "platform", description: "Reprodução determinística." },
  integration_layer: { id: "integration_layer", name: "Integration Layer", category: "integration", description: "Integrações externas (ERPs, APIs públicas)." },
  catmat_catser_engine: { id: "catmat_catser_engine", name: "CATMAT/CATSER Engine", category: "integration", description: "Catálogos de materiais e serviços." },
  adaptive_process_engine: { id: "adaptive_process_engine", name: "Adaptive Process Engine", category: "workflow", description: "Montagem dinâmica de fluxos por domínio." },
  import_engine: { id: "import_engine", name: "Import Engine", category: "document", description: "Ingestão e normalização de dados importados." },
  audit_engine: { id: "audit_engine", name: "Audit Engine", category: "governance", description: "Trilhas de auditoria." },
  institutional_request_engine: { id: "institutional_request_engine", name: "Institutional Request Engine", category: "integration", description: "Troca de solicitações institucionais entre Business Domains sem acoplamento direto." },
};

export const ALL_KERNEL_SERVICE_IDS: KernelServiceId[] = Object.keys(KERNEL_SERVICES) as KernelServiceId[];

export function isKernelService(id: string): id is KernelServiceId {
  return id in KERNEL_SERVICES;
}

export function getKernelService(id: KernelServiceId): KernelService {
  return KERNEL_SERVICES[id];
}

/** Registro persistível de um Kernel Service (para a tabela kernel_services). */
export interface KernelServiceRecord {
  readonly id: string;
  readonly serviceId: KernelServiceId;
  readonly name: string;
  readonly category: KernelServiceCategory;
  readonly active: boolean;
  readonly createdAt: string;
}

export function createKernelServiceRecord(serviceId: KernelServiceId, createdAt?: string): KernelServiceRecord {
  const svc = getKernelService(serviceId);
  const id = createHash("sha256").update(`ks:${serviceId}`).digest("hex").slice(0, 20);
  return {
    id,
    serviceId,
    name: svc.name,
    category: svc.category,
    active: true,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}
