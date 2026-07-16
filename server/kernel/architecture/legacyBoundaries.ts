/**
 * RC-3.5.2 — Kernel Boundary Enforcement · Allowlists arquiteturais oficiais.
 *
 * PONTO ÚNICO de exceções arquiteturais do Cognitive Kernel. Toda exceção
 * (legado, infraestrutura sancionada, renderer interno) vive AQUI — nunca espalhada
 * pelo projeto. Os testes de fronteira (`rc352-boundary-enforcement.test.ts`) importam
 * estas listas: qualquer novo componente que cruze uma fronteira sem estar registrado
 * aqui FALHA o build de testes.
 *
 * Caminhos são repo-relativos (ex.: "server/services/zipService.ts").
 *
 * Regra de ouro: adicionar um caminho a uma allowlist é uma decisão arquitetural
 * explícita e revisável — não um atalho para contornar a fronteira.
 */

/** Classificação oficial de um componente perante o Cognitive Kernel. */
export type BoundaryClassification =
  | "official"                     // porta oficial do Kernel
  | "internal_renderer"            // implementação interna (nunca API pública)
  | "internal_specialized_renderer"// renderer especializado interno
  | "kg_infrastructure"            // infraestrutura exclusiva do Knowledge Graph
  | "legacy";                      // compatibilidade apenas

// ─── Provider Allowlist ───────────────────────────────────────────────────────
// ÚNICO ponto autorizado a INSTANCIAR um Provider (`new GeminiProvider`).
export const PROVIDER_INSTANTIATION_ALLOWLIST: readonly string[] = [
  "server/_core/ai/providerAdapter.ts", // única porta de instanciação
];

// Arquivos autorizados a importar o SDK do modelo (@google/generative-ai) /
// instanciar o cliente bruto (`new GoogleGenerativeAI`). Camada de IA + legados.
export const AI_SDK_ALLOWLIST: readonly string[] = [
  "server/_core/ai/gemini.ts",         // GeminiProvider (definição canônica do provider)
  "server/services/embeddings.ts",     // KG infrastructure (text-embedding-004)
  "server/services/gemini.ts",         // LEGACY
  "server/services/ai/suggestions.ts", // LEGACY
];

// Único componente autorizado a acessar a AIExecutionPolicy (decisões cognitivas).
export const EXECUTION_POLICY_ALLOWLIST: readonly string[] = [
  "server/services/aiExecutionEngine.ts",
];

// ─── AI Entry Allowlist (RC-4.1 — ativação cognitiva) ─────────────────────────
// invokeLLM permanece APENAS em código legado allowlistado. Nenhum novo componente
// pode usar invokeLLM — a cognição oficial passa por executeCognitiveTask.
export const INVOKE_LLM_LEGACY_ALLOWLIST: readonly string[] = [
  "server/services/legalFrameworkAssistant.ts",
  "server/services/catmatMatcher.ts",
  "server/services/directContractDocuments.ts",
  "server/services/legalOpinionService.ts",
  "server/services/examples/legalValidationExample.ts",
];

// executeAITask é o pipeline de baixo nível (RC-3.5), APOSENTADO na ativação: não possui
// callers oficiais. Definido apenas no Engine; exercitado só por testes.
export const EXECUTE_AI_TASK_ALLOWLIST: readonly string[] = [
  "server/services/aiExecutionEngine.ts", // definição
];

// ─── Document Allowlist ───────────────────────────────────────────────────────
// Componentes autorizados a chamar o DocumentConverter (renderer INTERNO).
// documentEngineService = porta oficial; os demais são LEGACY (compatibilidade).
export const DOCUMENT_CONVERTER_ALLOWLIST: readonly string[] = [
  "server/services/documentEngineService.ts",   // OFICIAL — única porta pública
  "server/services/_core/documentConverter.ts", // wrapper interno (delega ao renderer)
  // LEGACY (compatibilidade — ver LEGACY_EXPORTERS):
  "server/services/zipService.ts",
  "server/services/pdfChecklistService.ts",
  "server/routers/documentsRouter.ts",
];

// Componentes autorizados a usar o OfficialExportEngine (renderer especializado interno).
export const OFFICIAL_EXPORT_ENGINE_ALLOWLIST: readonly string[] = [
  "server/routers/exportRouter.ts",
];

// ─── AWS / Storage Allowlist ──────────────────────────────────────────────────
// Único ponto autorizado a acessar o AWS SDK.
export const AWS_SDK_ALLOWLIST: readonly string[] = [
  "server/storage.ts",
];

// ─── Legacy Export Allowlist ──────────────────────────────────────────────────
// Exportadores/geradores documentais LEGADOS. Compatibilidade apenas — não remover,
// não reescrever, não migrar. Não passam pelo OfficialDocumentLifecycleService.
export const LEGACY_EXPORTERS: readonly string[] = [
  "server/routers/documentsRouter.ts",
  "server/services/zipService.ts",
  "server/services/pdfChecklistService.ts",
  "server/services/legalOpinionExportService.ts",
  "server/services/directContractAuditReport.ts",
];

// ─── Knowledge Graph infrastructure ───────────────────────────────────────────
// Embeddings NÃO fazem parte do AIExecutionEngine — pertencem ao Knowledge Graph.
export const KNOWLEDGE_GRAPH_EMBEDDINGS: readonly string[] = [
  "server/services/embeddings.ts",
];

// ─── Business Domains (serviços oficiais) ─────────────────────────────────────
// Consomem EXCLUSIVAMENTE serviços do Kernel. Nunca acessam Provider, generateText,
// invokeLLM, DocumentConverter, Storage ou AWS diretamente.
export const BUSINESS_DOMAIN_SERVICES: readonly string[] = [
  "server/services/procurementProcessService.ts",
  "server/services/directProcurementService.ts",
  "server/services/legalOpinionWorkspaceService.ts",
  "server/services/contractService.ts",
];

/** Normaliza um caminho para comparação (remove ./ inicial e barras duplicadas). */
export function normalizeBoundaryPath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\/+/g, "/");
}

/** true se `file` (repo-relativo) está na allowlist informada. */
export function isAllowed(file: string, allowlist: readonly string[]): boolean {
  const f = normalizeBoundaryPath(file);
  return allowlist.some((a) => normalizeBoundaryPath(a) === f);
}
