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

// ─── Document Renderers (RC-4.2.1) ────────────────────────────────────────────
// Motores de renderização documental e sua classificação oficial.
export const DOCUMENT_RENDERERS: readonly string[] = [
  "server/services/documentConverter.ts",       // Internal Renderer (oficial)
  "server/services/officialExportEngine.ts",    // Internal Specialized Renderer
  "server/services/documentRenderService.ts",   // LEGACY (órfão)
];

// ─── Pipeline de Licitação / Geração Documental (RC-C0.1A) ────────────────────
// Descoberto na auditoria arquitetural da Sprint C0 (2026-07-20): caso especial em
// que o LEGADO é o sistema ativo em produção/staging e o CANÔNICO ainda não está
// ligado ao frontend. Ver docs/architecture/LEGACY_INVENTORY.md, seção "Licitação
// / Processo Licitatório / Geração Documental". Congelado em MAINTENANCE_ONLY na
// Sprint C0.1A — sem migração, sem remoção.
export const LEGACY_ACTIVE_MAINTENANCE_ONLY: readonly string[] = [
  "server/routers/documentsRouter.ts",
  "server/routers/processesRouter.ts",
  "server/services/gemini.ts",
  "client/src/pages/Dashboard.tsx",
  "client/src/pages/ProcessDetails.tsx",
  "client/src/pages/NewProcess.tsx",
  // RC-C0.1A.1 — isolamento multi-tenant completo já aplicado (23/23 procedures
  // tenantProcedure); permanece MAINTENANCE_ONLY por ser o legado ainda ativo em
  // /contracts/* (compat, fora do menu) — ver LEGACY_INVENTORY.md § Contracts.
  "server/routers/contractsRouter.ts",
  "server/db/contracts.ts",
  // RC-LEGAL-SEC-001 — isolamento multi-tenant completo já aplicado (13/15
  // procedures tenantProcedure; 2 deliberadamente protectedProcedure — escopo
  // por usuário, não organizacional); permanece MAINTENANCE_ONLY por ser o
  // legado ainda ativo em /parecer-juridico/* (compat, fora do menu) — ver
  // LEGACY_INVENTORY.md § LegalOpinions.
  "server/routers/legalOpinionsRouter.ts",
  "server/db/legalOpinions.ts",
];

export const CANONICAL_NOT_YET_WIRED: readonly string[] = [
  "server/routers/procurementProcessRouter.ts",
  "server/services/procurementProcessService.ts",
  "server/services/workspaceOrchestratorService.ts",
  "server/services/documentEngineService.ts",
  "server/services/officialDocumentLifecycleService.ts",
  "client/src/components/procurement/ProcessoLicitatorioHome.tsx",
  "client/src/components/procurement/DFDWorkspace.tsx",
  "client/src/components/procurement/ETPWorkspace.tsx",
  "client/src/components/procurement/TRWorkspace.tsx",
  "client/src/components/procurement/EditalWorkspace.tsx",
];

// ─── Classificação oficial das fronteiras (RC-4.2.1) ──────────────────────────
// Cada item recebe uma disposição institucional. NENHUMA remoção nesta RC.
export type BoundaryDisposition =
  | "mantem" | "migracao_futura" | "remocao_futura"
  // RC-C0.1A:
  | "manutencao_apenas"     // legado ativo, congelado — sem novas features/consumidores
  | "canonico_nao_ligado";  // arquitetura correta, mas ainda não alcançada pelo frontend

export interface BoundaryClassificationEntry {
  readonly path: string;
  readonly allowlist: string;
  readonly disposition: BoundaryDisposition;
  readonly note: string;
}

export const BOUNDARY_CLASSIFICATIONS: readonly BoundaryClassificationEntry[] = [
  // AI SDK — mantém (camada oficial) / legado migração futura
  { path: "server/_core/ai/gemini.ts", allowlist: "AI_SDK_ALLOWLIST", disposition: "mantem", note: "GeminiProvider — provider canônico." },
  { path: "server/services/embeddings.ts", allowlist: "AI_SDK_ALLOWLIST", disposition: "mantem", note: "Infra de embeddings do Knowledge Graph." },
  { path: "server/services/gemini.ts", allowlist: "AI_SDK_ALLOWLIST", disposition: "migracao_futura", note: "Geração legada — migrar para AIExecutionEngine." },
  { path: "server/services/ai/suggestions.ts", allowlist: "AI_SDK_ALLOWLIST", disposition: "migracao_futura", note: "Sugestões legadas — migrar para AIExecutionEngine." },
  // invokeLLM — migração futura (bypass do pipeline cognitivo)
  { path: "server/services/legalFrameworkAssistant.ts", allowlist: "INVOKE_LLM_LEGACY_ALLOWLIST", disposition: "migracao_futura", note: "Migrar para executeCognitiveTask." },
  { path: "server/services/catmatMatcher.ts", allowlist: "INVOKE_LLM_LEGACY_ALLOWLIST", disposition: "migracao_futura", note: "Migrar para CATMAT_MATCHING task." },
  { path: "server/services/directContractDocuments.ts", allowlist: "INVOKE_LLM_LEGACY_ALLOWLIST", disposition: "migracao_futura", note: "Migrar para DIRECT_PROCUREMENT_REASONING." },
  { path: "server/services/legalOpinionService.ts", allowlist: "INVOKE_LLM_LEGACY_ALLOWLIST", disposition: "migracao_futura", note: "Migrar para LEGAL_ANALYSIS/REASONING." },
  { path: "server/services/examples/legalValidationExample.ts", allowlist: "INVOKE_LLM_LEGACY_ALLOWLIST", disposition: "remocao_futura", note: "Exemplo — remover em limpeza." },
  // Document renderers
  { path: "server/services/documentConverter.ts", allowlist: "DOCUMENT_RENDERERS", disposition: "mantem", note: "Internal Renderer oficial." },
  { path: "server/services/officialExportEngine.ts", allowlist: "DOCUMENT_RENDERERS", disposition: "mantem", note: "Renderer especializado interno (exportRouter)." },
  { path: "server/services/documentRenderService.ts", allowlist: "DOCUMENT_RENDERERS", disposition: "remocao_futura", note: "Órfão — remover em limpeza pós-RC-5." },
  // Legacy exporters
  { path: "server/services/zipService.ts", allowlist: "LEGACY_EXPORTERS", disposition: "mantem", note: "Compatibilidade — pacote ZIP." },
  { path: "server/services/pdfChecklistService.ts", allowlist: "LEGACY_EXPORTERS", disposition: "mantem", note: "Compatibilidade — checklist PDF." },
  { path: "server/services/legalOpinionExportService.ts", allowlist: "LEGACY_EXPORTERS", disposition: "mantem", note: "Compatibilidade — export de parecer." },
  { path: "server/services/directContractAuditReport.ts", allowlist: "LEGACY_EXPORTERS", disposition: "mantem", note: "Compatibilidade — relatório de auditoria." },
  { path: "server/routers/documentsRouter.ts", allowlist: "LEGACY_EXPORTERS", disposition: "mantem", note: "Router legado de documentos." },
  // executeAITask — aposentado
  { path: "server/services/aiExecutionEngine.ts", allowlist: "EXECUTE_AI_TASK_ALLOWLIST", disposition: "mantem", note: "Definição; executeAITask aposentado (0 callers)." },
  // ─── RC-C0.1A — Licitação / Geração Documental ────────────────────────────
  // Legado ATIVO em produção/staging (não órfão) — congelado em MAINTENANCE_ONLY.
  { path: "server/routers/documentsRouter.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Único caminho hoje para gerar DFD/ETP/TR/Edital/Ata/Parecer. Sem novos tipos documentais, sem novos consumidores." },
  { path: "server/routers/processesRouter.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Criação/leitura de processo licitatório legado. Alimenta documentsRouter." },
  { path: "server/services/gemini.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Já classificado migracao_futura em AI_SDK_ALLOWLIST; aqui registrado também como parte do pipeline documental ativo — ver LEGACY_INVENTORY.md." },
  { path: "client/src/pages/Dashboard.tsx", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Rota /processos, no menu principal como \"Processo Licitatório\" — não é tela de compatibilidade, é a tela ativa." },
  { path: "client/src/pages/ProcessDetails.tsx", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Rota /processo/:id — botão \"Gerar com IA\" chama documentsRouter.generateDocument." },
  { path: "client/src/pages/NewProcess.tsx", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Rota /novo-processo — cria processo via processesRouter.create." },
  // Canônico correto arquiteturalmente, mas órfão do frontend — não é legado.
  { path: "server/routers/procurementProcessRouter.ts", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "tenantProcedure, sem consumidor de frontend registrado em App.tsx." },
  { path: "server/services/procurementProcessService.ts", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Também em BUSINESS_DOMAIN_SERVICES (não cruza fronteiras do Kernel) — aqui registrado quanto a NÃO estar alcançado pelo frontend." },
  { path: "server/services/workspaceOrchestratorService.ts", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "orchestrateMultiCopilot — grounding/copilots do pipeline canônico." },
  { path: "server/services/documentEngineService.ts", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "generateOfficialDocument — porta oficial de geração, sem consumidor via /processos." },
  { path: "server/services/officialDocumentLifecycleService.ts", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Versionamento append-only (official_documents) — não recebe tráfego do fluxo de Licitação hoje." },
  { path: "client/src/components/procurement/ProcessoLicitatorioHome.tsx", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Nenhuma rota em App.tsx monta este componente." },
  { path: "client/src/components/procurement/DFDWorkspace.tsx", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Só importa (importDFD) — não gera DFD por IA. Órfão do frontend." },
  { path: "client/src/components/procurement/ETPWorkspace.tsx", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Botão \"Gerar rascunho de ETP\" (procurementProcess.generateETP) — órfão do frontend." },
  { path: "client/src/components/procurement/TRWorkspace.tsx", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Botão \"Gerar rascunho de TR\" (procurementProcess.generateTR) — órfão do frontend." },
  { path: "client/src/components/procurement/EditalWorkspace.tsx", allowlist: "CANONICAL_NOT_YET_WIRED", disposition: "canonico_nao_ligado", note: "Botão \"Gerar edital\" (procurementProcess.generateNotice) — órfão do frontend." },
  // ─── RC-C0.1A.1 — Contratos legado: isolamento completo, ainda MAINTENANCE_ONLY ──
  { path: "server/routers/contractsRouter.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "23/23 procedures em tenantProcedure (auditoria completa RC-C0.1A.1) — ainda ativo em /contracts/* (compat). Ver LEGACY_INVENTORY.md § Contracts." },
  { path: "server/db/contracts.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Repository org-scoped (RC-C0.1A.1); getContractById (sem filtro) ficou órfã após RC-LEGAL-SEC-001 remover seu último consumidor (legalOpinionsRouter.ts) — mantida por cautela, não removida nesta sprint." },
  // ─── RC-LEGAL-SEC-001 — Parecer Jurídico legado: isolamento completo, ainda MAINTENANCE_ONLY ──
  { path: "server/routers/legalOpinionsRouter.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "13/15 procedures em tenantProcedure (2 deliberadamente protectedProcedure — escopo por usuário). Ver LEGACY_INVENTORY.md § LegalOpinions." },
  { path: "server/db/legalOpinions.ts", allowlist: "LEGACY_ACTIVE_MAINTENANCE_ONLY", disposition: "manutencao_apenas", note: "Repository org-scoped (RC-LEGAL-SEC-001); digital_signatures (getDigitalSignatureById/ByDocument/invalidate/createDigitalSignature) auditada e não corrigida — órfã/inalcançável (opinion.signatureId não existe no schema)." },
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
