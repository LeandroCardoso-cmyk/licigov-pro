# Graph Report - server/services  (2026-07-11)

## Corpus Check
- 193 files · ~118,461 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1946 nodes · 2820 edges · 145 communities (134 shown, 11 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0fd53cdc`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- contractValidation.ts
- catalogIntegrationService.ts
- suggestions.ts
- importQueueService.ts
- importAnalyticsService.ts
- providerFailoverService.ts
- webhookService.ts
- tenantIsolationAuditService.ts
- tokenBudgetService.ts
- structuredExportService.ts
- realUsageMonitoringService.ts
- observabilityService.ts
- contextAssemblyService.ts
- disasterRecoveryService.ts
- operationalStabilityService.ts
- advancedPermissionService.ts
- zipService.ts
- environmentManagementService.ts
- Exemplos de Integração - Correções da Auditoria
- semanticObservabilityService.ts
- documentAttachmentService.ts
- draftingObservabilityService.ts
- operationalFeedbackService.ts
- providerObservabilityService.ts
- itemAnalyticsService.ts
- trIntelligenceEngine.ts
- workloadIntelligenceService.ts
- contextObservabilityService.ts
- dlqObservabilityService.ts
- documentService.ts
- itemIntelligenceService.ts
- normalizationPipelineService.ts
- retrievalEngineService.ts
- retrievalObservabilityService.ts
- semanticChunkingService.ts
- communicationLayer.ts
- copilotContextEngineService.ts
- deploymentValidationService.ts
- executionObservabilityService.ts
- graphTraversalService.ts
- hybridSearchService.ts
- serviceHealthService.ts
- ssoFoundationService.ts
- contextualRankingService.ts
- workspaceOrchestratorService.ts
- operationalCommunicationService.ts
- pilotReadinessService.ts
- promptTemplateService.ts
- externalStorageFoundation.ts
- institutionalRetrievalService.ts
- pilotReadinessScoreService.ts
- semanticIndexEngine.ts
- vectorIndexService.ts
- vectorStoreAbstractionService.ts
- aiAuditService.ts
- documentCollaborationService.ts
- legalReasoningEngine.ts
- ragObservabilityService.ts
- citationEngineService.ts
- structuredGenerationService.ts
- contractDocuments.ts
- evidenceRetrievalService.ts
- graphObservabilityService.ts
- graphRecommendationService.ts
- humanApprovalService.ts
- knowledgeGraphService.ts
- performanceOptimizationService.ts
- reindexOrchestrationService.ts
- retrievalService.ts
- securityHardeningService.ts
- stripeService.ts
- chunkingService.ts
- copilotMemoryService.ts
- documentDraftingEngine.ts
- documentRenderService.ts
- documentWorkflowService.ts
- embeddingService.ts
- featureFlagService.ts
- groundingEngineService.ts
- officialExportEngine.ts
- providerCostService.ts
- responseValidationService.ts
- aiOutputValidation.ts
- confidenceEngineService.ts
- embeddingAbstractionService.ts
- evidenceSelectionService.ts
- groundingExpansionService.ts
- groundingService.ts
- legalKnowledgeService.ts
- ontologyValidationService.ts
- promptOrchestratorService.ts
- rateLimiter.ts
- rerankingService.ts
- semanticMemoryService.ts
- taskSimulationService.ts
- agentExecutionEngine.ts
- agentPlanningService.ts
- agentSafetyService.ts
- autonomousWorkflowService.ts
- contextRankingService.ts
- documentConcurrencyService.ts
- emailService.ts
- procurementOntologyService.ts
- providerReplayService.ts
- semanticCompressionService.ts
- workspaceCollaborationService.ts
- aiUsageTracker.ts
- copilotContextService.ts
- directContractAuditReport.ts
- documentDraftService.ts
- documentTemplateService.ts
- institutionalRequestService.ts
- proposalZipGenerator.ts
- documentVersionService.ts
- jurisprudenceCorrelationService.ts
- legalValidationService.ts
- moduleLicensingService.ts
- signatureValidation.ts
- businessDomainRegistryService.ts
- copilotObservabilityService.ts
- digitalSignatureService.ts
- directContractPackage.ts
- entityExtractionService.ts
- entityResolutionService.ts
- legalOpinionExportService.ts
- providerPolicyService.ts
- requestObservabilityService.ts
- semanticMatchingOrchestrator.ts
- tenantService.ts
- cnpjValidator.ts
- copilotEvaluationService.ts
- retrievalExplainabilityService.ts
- workspaceObservabilityService.ts
- copilotPolicyService.ts
- catmatMatcher.ts
- domainNavigationService.ts

## God Nodes (most connected - your core abstractions)
1. `serviceLogger()` - 23 edges
2. `validateLegalCitations()` - 18 edges
3. `emit()` - 18 edges
4. `retrieveRelevantLaw()` - 17 edges
5. `formatRetrievedContext()` - 15 edges
6. `addTimelineEvent()` - 13 edges
7. `computeAnalytics()` - 13 edges
8. `applyTransition()` - 12 edges
9. `logActivity()` - 11 edges
10. `TrpcAuditCtx` - 11 edges

## Surprising Connections (you probably didn't know these)
- `createImportSession()` --calls--> `logActivity()`  [EXTRACTED]
  server/services/fileIngestionService.ts → server/services/activityLogService.ts
- `replayDeadLetter()` --calls--> `appendOutboxEvent()`  [EXTRACTED]
  server/services/dlqObservabilityService.ts → server/services/outboxService.ts
- `registerAttachment()` --calls--> `logActivity()`  [EXTRACTED]
  server/services/documentAttachmentService.ts → server/services/activityLogService.ts
- `createDocumento()` --calls--> `logActivity()`  [EXTRACTED]
  server/services/documentService.ts → server/services/activityLogService.ts
- `updateDocumento()` --calls--> `logActivity()`  [EXTRACTED]
  server/services/documentService.ts → server/services/activityLogService.ts

## Import Cycles
- None detected.

## Communities (145 total, 11 thin omitted)

### Community 0 - "contractValidation.ts"
Cohesion: 0.05
Nodes (46): AmendmentValueValidation, ApostilamentoValidation, ContractDurationValidation, DISPENSA_LIMITS, DispensaValidation, fetchOfficialIndex(), getIndexSourceURL(), JustificationValidation (+38 more)

### Community 1 - "catalogIntegrationService.ts"
Cohesion: 0.07
Nodes (51): cacheCatalog(), cacheKey(), CacheRecord, CATALOG_CACHE, CatalogEntry, CatalogEntryType, CatalogSyncResult, clearCatalogCache() (+43 more)

### Community 2 - "suggestions.ts"
Cohesion: 0.12
Nodes (34): documentsBlock(), fmtBrl(), OrgContext, outputInstruction(), processBlock(), ProcessContext, truncate(), genAI (+26 more)

### Community 3 - "importQueueService.ts"
Cohesion: 0.07
Nodes (29): cancelImportSession(), createImportSession(), CreateImportSessionParams, FileValidationResult, getImportSession(), log, startIngestion(), updateSessionStatus() (+21 more)

### Community 4 - "importAnalyticsService.ts"
Cohesion: 0.09
Nodes (31): avg(), buildKpi(), computeAnalytics(), computeApprovalRate(), computeAvgConfidence(), computeCorrectionRate(), computeParserAccuracy(), computePipelineSuccessRate() (+23 more)

### Community 5 - "providerFailoverService.ts"
Cohesion: 0.10
Nodes (27): ADAPTERS, _byCorrelation, executeInference(), _history, InferenceInput, replayExecution(), sha256(), _degradedOrgs (+19 more)

### Community 6 - "webhookService.ts"
Cohesion: 0.11
Nodes (26): ApiUsageMetric, CollaborationMetric, detectCollaborationSpike(), detectWebhookAnomalies(), emit(), IntegrationTrace, recordApiUsage(), recordCollaborationEvent() (+18 more)

### Community 7 - "tenantIsolationAuditService.ts"
Cohesion: 0.09
Nodes (15): CacheConfig, CacheEntry, CacheMetrics, CacheService, DEFAULT_CONFIG, detectCacheContamination(), detectOrphanedEntities(), EntityScanInput (+7 more)

### Community 8 - "tokenBudgetService.ts"
Cohesion: 0.09
Nodes (18): AIExecutionRequest, AIExecutionResult, AIModel, AIProvider, AVAILABLE_MODELS, deterministicInt(), executeWithProvider(), _executionCache (+10 more)

### Community 9 - "structuredExportService.ts"
Cohesion: 0.11
Nodes (21): AuditCategory, AuditEvent, AuditQuery, auditStore, AuditSummary, exportAuditTrail(), getAuditTimeline(), nextEventId() (+13 more)

### Community 10 - "realUsageMonitoringService.ts"
Cohesion: 0.08
Nodes (14): _alerts, ContinuousOperationAnalysis, DegradationAnalysis, detectUsageAlerts(), _events, genId(), IncidentCorrelationResult, recordUXEvent() (+6 more)

### Community 11 - "observabilityService.ts"
Cohesion: 0.11
Nodes (11): log, log, IdempotencyResult, log, LogLevel, serviceLogger(), span(), SpanResult (+3 more)

### Community 12 - "contextAssemblyService.ts"
Cohesion: 0.12
Nodes (13): assembleContextService(), AssembledContext, assembleForQuery(), AssemblyInput, AssemblyOutput, _assemblySnapshots, ContextChunk, contextualCompression() (+5 more)

### Community 13 - "disasterRecoveryService.ts"
Cohesion: 0.11
Nodes (16): _checkpoints, CheckpointType, computeIntegrityHash(), createCheckpoint(), isRecoverable(), _logs, makeCheckpointId(), _plans (+8 more)

### Community 14 - "operationalStabilityService.ts"
Cohesion: 0.11
Nodes (19): analyzeTrend(), _anomalies, AnomalySeverity, buildStabilitySnapshot(), computeStabilityScore(), DegradationLevel, detectAnomalies(), isMetricAnomalous() (+11 more)

### Community 15 - "advancedPermissionService.ts"
Cohesion: 0.11
Nodes (14): ActionType, _auditLog, auditPermissionCheck(), DepartmentPermission, _departmentPerms, genId(), grantDepartmentPermission(), grantWorkflowPermission() (+6 more)

### Community 16 - "zipService.ts"
Cohesion: 0.16
Nodes (12): documentConverter, convertToPDF(), stripInline(), generateItemsSpreadsheet(), getSpreadsheetFileName(), ProcessItem, ChecklistItem, generateChecklistMarkdown() (+4 more)

### Community 17 - "environmentManagementService.ts"
Cohesion: 0.10
Nodes (13): createEnvironment(), DEFAULT_CONFIG, Environment, EnvironmentConfig, EnvironmentHealthCheck, EnvironmentPromotion, _environments, EnvironmentStatus (+5 more)

### Community 18 - "Exemplos de Integração - Correções da Auditoria"
Cohesion: 0.10
Nodes (20): 1. Validação de Artigos Legais, 2. Validação de Aditivos de Contrato, 3. Validação de Prazo Contratual, 4. Rate Limiting em Procedures, 5. Password Security (Bcrypt Salt 12), 📁 Arquivos de Exemplo, 📋 Checklist de Integração, Contract Validation (+12 more)

### Community 19 - "semanticObservabilityService.ts"
Cohesion: 0.18
Nodes (20): candidateDivergence(), candidateInstability(), catalogLatency(), catalogSyncAnomaly(), clauseGenerationLatency(), compositionAnomaly(), confidenceDegradation(), consensusInstability() (+12 more)

### Community 20 - "documentAttachmentService.ts"
Cohesion: 0.15
Nodes (12): ActivityLogPayload, logActivity(), logFromCtx(), TrpcAuditCtx, getAttachment(), log, RegisterAttachmentParams, ScanStatus (+4 more)

### Community 21 - "draftingObservabilityService.ts"
Cohesion: 0.17
Nodes (14): clauseConflictDetected(), complianceScoreRecorded(), draftCompleteness(), DraftingMetric, DraftingTrace, draftLatency(), jurisprudenceCorrelated(), _metrics (+6 more)

### Community 22 - "operationalFeedbackService.ts"
Cohesion: 0.15
Nodes (14): anonymize(), classifySeverity(), FeedbackCategory, FeedbackItem, _feedbacks, FeedbackSeverity, FeedbackTrend, FrictionReport (+6 more)

### Community 23 - "providerObservabilityService.ts"
Cohesion: 0.13
Nodes (15): append(), computeReliabilityScore(), ErrorRecord, _errors, FallbackRecord, _fallbacks, getProviderHealth(), _latency (+7 more)

### Community 24 - "itemAnalyticsService.ts"
Cohesion: 0.25
Nodes (17): candidateAcceptanceRate(), catalogAccuracy(), ClauseUsageData, clauseUsageRate(), computeItemAnalytics(), ConfidenceWindow, ItemAnalyticsSnapshot, ItemKpi (+9 more)

### Community 25 - "trIntelligenceEngine.ts"
Cohesion: 0.19
Nodes (16): composeItemSection(), composeQuantities(), composeTR(), computeCompositionReplayKey(), groupItems(), injectLegalClauses(), ItemGroup, linkSemanticClauses() (+8 more)

### Community 26 - "workloadIntelligenceService.ts"
Cohesion: 0.12
Nodes (11): _alerts, buildWorkloadSnapshot(), detectWorkloadAlerts(), genId(), QueueHealthMetric, ReviewerWorkload, _snapshots, ThroughputTrend (+3 more)

### Community 27 - "contextObservabilityService.ts"
Cohesion: 0.18
Nodes (15): avg(), computeContextHealth(), ContextHealthSnapshot, ContextMetric, ContextMetricName, createMetric(), genId(), _metricsStore (+7 more)

### Community 28 - "dlqObservabilityService.ts"
Cohesion: 0.12
Nodes (8): DlqMetrics, log, PoisonEventPattern, replayDeadLetter(), StuckEvent, log, OutboxEventPayload, TenantContext

### Community 29 - "documentService.ts"
Cohesion: 0.18
Nodes (14): registerAttachment(), releaseLock(), createDocumento(), CreateDocumentoParams, exportDocumentToHtml(), getDocumentoById(), lockDocumento(), log (+6 more)

### Community 30 - "itemIntelligenceService.ts"
Cohesion: 0.18
Nodes (11): catmatCandidates(), DOMAIN, EnrichedItem, enrichItem(), suggestSpecifications(), assertKernelAccess(), checkKernelAccess(), KernelAccessResult (+3 more)

### Community 31 - "normalizationPipelineService.ts"
Cohesion: 0.20
Nodes (16): BatchPipelineResult, buildFailedResult(), NormalizedItem, parseLocalePtBr(), PipelineOptions, runBatchNormalization(), runNormalizationPipeline(), stageLexical() (+8 more)

### Community 32 - "retrievalEngineService.ts"
Cohesion: 0.18
Nodes (16): computeBM25Score(), computeContextualScore(), computeInstitutionalScore(), computeLexicalScore(), computeSemanticScoreMock(), CorpusItem, createQuery(), executeRetrieval() (+8 more)

### Community 33 - "retrievalObservabilityService.ts"
Cohesion: 0.20
Nodes (16): computeAvg(), computeHealthSnapshot(), computeP95(), createMetric(), generateReport(), _metrics, recordChunkEfficiency(), recordEvidenceQuality() (+8 more)

### Community 34 - "semanticChunkingService.ts"
Cohesion: 0.21
Nodes (15): buildChunks(), chunkDocument(), ChunkingResult, _chunkStore, ChunkStrategy, computeChunkStats(), countTokens(), DocumentType (+7 more)

### Community 35 - "communicationLayer.ts"
Cohesion: 0.19
Nodes (12): batchNotify(), createNotification(), emit(), nextId(), Notification, NotificationBatch, NotificationPriority, NotificationType (+4 more)

### Community 36 - "copilotContextEngineService.ts"
Cohesion: 0.23
Nodes (12): buildCopilotContext(), CopilotContext, CopilotEvidence, renderContextBlock(), SOURCE_WEIGHTS, buildGroundedPrompt(), ReasoningInput, ReasoningResult (+4 more)

### Community 37 - "deploymentValidationService.ts"
Cohesion: 0.23
Nodes (14): makeCheck(), makeReplayKey(), _reports, runFullValidation(), validateEnvironmentReadiness(), validateMigrationSafety(), validateRollbackReadiness(), validateSchemaConsistency() (+6 more)

### Community 38 - "executionObservabilityService.ts"
Cohesion: 0.18
Nodes (13): approvalLatency(), computeExecutionHealth(), executionLatency(), ExecutionObservabilityMetric, ExecutionObservabilityTrace, getExecutionTraces(), hallucinationRiskLevel(), _metrics (+5 more)

### Community 39 - "graphTraversalService.ts"
Cohesion: 0.25
Nodes (14): bfs(), buildAdjacencyMap(), dfs(), dijkstra(), getActiveEdgesForOrg(), getAdjacentEdges(), getOtherNode(), GraphEdge (+6 more)

### Community 40 - "hybridSearchService.ts"
Cohesion: 0.22
Nodes (14): applyContextualBoost(), applyTypoCorrections(), computeSemanticScoreMock(), expandQuery(), findSynonyms(), LEGAL_SYNONYMS, search(), SearchHit (+6 more)

### Community 41 - "serviceHealthService.ts"
Cohesion: 0.16
Nodes (12): assessMetricHealth(), buildHealthSnapshot(), computeSlaScore(), HealthMetric, _history, isMaxMetric(), isWithinSla(), ServiceHealthSnapshot (+4 more)

### Community 42 - "ssoFoundationService.ts"
Cohesion: 0.20
Nodes (13): buildRoleSyncPlan(), createFederatedSession(), emit(), FederatedSession, GroupMapping, IdentityMapping, IdentityProvider, IdentityProviderType (+5 more)

### Community 43 - "contextualRankingService.ts"
Cohesion: 0.15
Nodes (12): CATEGORY_BOOSTS, computeRecencyBoost(), DocumentCategory, InstitutionalRole, RankedItem, RankingContext, RankingResult, rankItems() (+4 more)

### Community 44 - "workspaceOrchestratorService.ts"
Cohesion: 0.17
Nodes (12): CopilotConflict, CopilotSelection, CopilotTask, distributeTasks(), INTENT_KEYWORDS, rankCopilots(), selectCopilot(), ConsolidatedRecommendation (+4 more)

### Community 45 - "operationalCommunicationService.ts"
Cohesion: 0.19
Nodes (11): CommunicationPriority, CommunicationRecord, CommunicationType, create(), _records, sendAlert(), sendDegradationNotice(), sendDeploymentNotification() (+3 more)

### Community 46 - "pilotReadinessService.ts"
Cohesion: 0.19
Nodes (13): adoptionChecks(), _approvals, approvePhaseTransition(), generatePilotScorecard(), generateReadinessReport(), genId(), operationalChecks(), PhaseTransitionApproval (+5 more)

### Community 47 - "promptTemplateService.ts"
Cohesion: 0.27
Nodes (12): createTemplate(), extractVariables(), genId(), parseVersion(), PromptTemplate, renderTemplate(), rollbackTemplate(), sha256() (+4 more)

### Community 48 - "externalStorageFoundation.ts"
Cohesion: 0.19
Nodes (9): createStorageSnapshot(), createSyncMetadata(), emit(), nextId(), registerAdapter(), StorageAdapter, StorageProviderType, StorageSnapshot (+1 more)

### Community 49 - "institutionalRetrievalService.ts"
Cohesion: 0.27
Nodes (12): EvidenceItem, generateId(), HistoryItem, retrieveAll(), RetrievedChunk, retrieveFromDocuments(), retrieveFromHistory(), retrieveFromKnowledgeGraph() (+4 more)

### Community 50 - "pilotReadinessScoreService.ts"
Cohesion: 0.18
Nodes (11): computeReadinessScore(), DIMENSION_LABELS, dimensionStatus(), _history, ReadinessScoreDimension, ReadinessScoreInput, ReadinessScoreResult, ReadinessScoreSnapshot (+3 more)

### Community 51 - "semanticIndexEngine.ts"
Cohesion: 0.25
Nodes (12): buildTokenMap(), IndexedEntityType, indexEntity(), IndexStats, _indexStore, searchIndex(), SemanticIndexEntry, sha20() (+4 more)

### Community 52 - "vectorIndexService.ts"
Cohesion: 0.16
Nodes (9): createVectorIndex(), detectOrphans(), getIndex(), IndexStatus, _indices, sha256(), SimilarityResult, VectorIndex (+1 more)

### Community 53 - "vectorStoreAbstractionService.ts"
Cohesion: 0.22
Nodes (12): addToIndex(), cosineSimilarity(), createIndex(), deleteFromIndex(), generateId(), getIndexStats(), indexKey(), _indices (+4 more)

### Community 54 - "aiAuditService.ts"
Cohesion: 0.26
Nodes (10): AIAuditRecord, AuditLineage, _auditLog, buildForensicSignature(), exportForensicReport(), generateId(), getLineage(), recordOperation() (+2 more)

### Community 55 - "documentCollaborationService.ts"
Cohesion: 0.19
Nodes (8): buildDocumentDiff(), computeDiff(), computeDiffSummary(), computeTextSimilarity(), DiffChange, DocumentDiff, VersionEntry, VersionLineage

### Community 56 - "legalReasoningEngine.ts"
Cohesion: 0.24
Nodes (11): extractPremises(), generateInferences(), generateRecommendations(), generateRisks(), ReasoningEngineInput, ReasoningEngineOutput, _reasoningHistory, replayReasoning() (+3 more)

### Community 57 - "ragObservabilityService.ts"
Cohesion: 0.26
Nodes (11): RAGMetric, RAGTrace, recordCitationCount(), recordConfidenceScore(), recordContextConsumption(), recordGroundingLatency(), recordHallucinationAlert(), recordInferenceLatency() (+3 more)

### Community 58 - "citationEngineService.ts"
Cohesion: 0.26
Nodes (9): ChunkItem, Citation, determineCitationType(), EvidenceItem, generateCitations(), matchResponseToEvidence(), splitSentences(), validateAllCitations() (+1 more)

### Community 59 - "structuredGenerationService.ts"
Cohesion: 0.20
Nodes (8): ClauseRecommendation, ClauseRecommendationInput, ClauseRecommendationOutput, generateClauseRecommendations(), _recommendationHistory, _generationHistory, StructuredGenerationInput, StructuredGenerationOutput

### Community 60 - "contractDocuments.ts"
Cohesion: 0.33
Nodes (11): AmendmentData, ApostilleData, ContractData, formatCurrency(), formatDateExtensive(), formatDateShort(), generateAmendmentTerm(), generateApostilleTerm() (+3 more)

### Community 61 - "evidenceRetrievalService.ts"
Cohesion: 0.20
Nodes (8): assembleEvidenceChain(), createEvidenceItem(), EvidenceChain, EvidenceItem, EvidenceStatus, _evidenceStore, EvidenceType, sha20()

### Community 62 - "graphObservabilityService.ts"
Cohesion: 0.17
Nodes (4): GraphEdge, GraphHealth, GraphMetric, GraphNode

### Community 63 - "graphRecommendationService.ts"
Cohesion: 0.32
Nodes (10): bfsWithPaths(), getActiveEdges(), getActiveNodes(), GraphEdge, GraphNode, Recommendation, recommendClauses(), recommendLegalBasis() (+2 more)

### Community 64 - "humanApprovalService.ts"
Cohesion: 0.18
Nodes (6): ApprovalServiceInput, ApprovalServiceOutput, createApprovalRequest(), sha256(), _store, _workflowById

### Community 65 - "knowledgeGraphService.ts"
Cohesion: 0.17
Nodes (3): GraphEdge, GraphNode, GraphQuery

### Community 66 - "performanceOptimizationService.ts"
Cohesion: 0.18
Nodes (5): computePerformanceSnapshot(), percentile(), PerformanceSnapshot, QueryMetrics, SlowQueryAlert

### Community 67 - "reindexOrchestrationService.ts"
Cohesion: 0.18
Nodes (6): createReindexJob(), _jobs, ReindexJob, ReindexStatus, ReindexType, sha256()

### Community 68 - "retrievalService.ts"
Cohesion: 0.18
Nodes (6): computeBM25(), _evidences, RetrievalInput, RetrievalResult, retrieve(), _sessions

### Community 69 - "securityHardeningService.ts"
Cohesion: 0.21
Nodes (8): createEventId(), detectBruteForce(), detectPermissionAnomaly(), detectSuspiciousAccess(), SecurityEvent, SecurityEventType, SecuritySeverity, SecuritySnapshot

### Community 71 - "chunkingService.ts"
Cohesion: 0.25
Nodes (6): _chunks, chunkText(), estimateTokens(), slidingWindow(), splitLegalClauses(), splitParagraphs()

### Community 72 - "copilotMemoryService.ts"
Cohesion: 0.31
Nodes (9): clearMemory(), getMemory(), MemoryEntry, memoryKey(), recordMemory(), _store, summarizeMemory(), weightedMerge() (+1 more)

### Community 73 - "documentDraftingEngine.ts"
Cohesion: 0.25
Nodes (9): buildDefaultTemplate(), _draftHistory, DraftingEngineInput, DraftingEngineOutput, _draftTemplates, getTemplate(), registerTemplate(), replayDrafting() (+1 more)

### Community 74 - "documentRenderService.ts"
Cohesion: 0.25
Nodes (9): buildRenderHash(), escapeHtml(), isFormatSupported(), log, renderDocument(), RenderOptions, RenderResult, renderToHtml() (+1 more)

### Community 75 - "documentWorkflowService.ts"
Cohesion: 0.31
Nodes (10): applyTransition(), approveDocumento(), archiveDocumento(), getDocumentOrThrow(), hasMinRole(), log, ORG_ROLE_WEIGHT, rejectDocumento() (+2 more)

### Community 76 - "embeddingService.ts"
Cohesion: 0.24
Nodes (6): batchGenerateEmbeddings(), EmbeddingProvider, _embeddings, generateDeterministicEmbedding(), generateEmbedding(), sha256()

### Community 77 - "featureFlagService.ts"
Cohesion: 0.25
Nodes (7): cache, CacheEntry, cacheGet(), cacheSet(), isFeatureEnabled(), isGlobalFlagEnabled(), log

### Community 78 - "groundingEngineService.ts"
Cohesion: 0.24
Nodes (7): createEvidence(), _evidenceStore, generateId(), groundContent(), GroundingEvidence, GroundingResult, splitSentences()

### Community 79 - "officialExportEngine.ts"
Cohesion: 0.24
Nodes (9): computeExportHash(), ExportAuditEntry, ExportMetadata, ExportRequest, ExportResult, generateDocx(), generatePdf(), renderSections() (+1 more)

### Community 80 - "providerCostService.ts"
Cohesion: 0.29
Nodes (10): checkQuota(), CostRecord, detectAnomaly(), estimateCost(), getMonthlyUsage(), getTodayUsage(), getUsageSummary(), recordUsage() (+2 more)

### Community 81 - "responseValidationService.ts"
Cohesion: 0.42
Nodes (10): analyzeContradictions(), detectHallucinations(), determineApproval(), getSignificantWords(), measureEvidenceUtilization(), measureGroundingCoverage(), sentenceHasEvidenceSupport(), splitSentences() (+2 more)

### Community 82 - "aiOutputValidation.ts"
Cohesion: 0.29
Nodes (8): detectFormat(), DocumentValidation, hasRequiredSections(), isValidMarkdown(), REQUIRED_SECTIONS, TEMPERATURE_CONFIG, validateAndCorrectAIOutput(), validateDocument()

### Community 83 - "confidenceEngineService.ts"
Cohesion: 0.33
Nodes (9): computeConfidence(), ConsolidatedConfidence, consolidateScores(), DEFAULT_WEIGHTS, evidenceConfidence(), groundingConfidence(), legalConfidence(), responseConfidence() (+1 more)

### Community 84 - "embeddingAbstractionService.ts"
Cohesion: 0.27
Nodes (6): batchGenerateEmbeddings(), deterministicVector(), _embeddingCache, EmbeddingVector, generateEmbedding(), generateId()

### Community 85 - "evidenceSelectionService.ts"
Cohesion: 0.31
Nodes (7): diversifyEvidence(), EvidenceCandidate, getWordSet(), jaccardSimilarity(), rankEvidence(), removeDuplicates(), selectEvidence()

### Community 86 - "groundingExpansionService.ts"
Cohesion: 0.38
Nodes (9): buildProvenanceGraph(), computeHallucinationRisk(), createGroundingSource(), expandGrounding(), genId(), GroundingExpansion, GroundingSource, rankSources() (+1 more)

### Community 87 - "groundingService.ts"
Cohesion: 0.33
Nodes (8): buildGrounding(), enrichPrompt(), estimateTokens(), generateId(), generateReplayKey(), GroundingResult, optimizeTokens(), orderEvidence()

### Community 88 - "legalKnowledgeService.ts"
Cohesion: 0.20
Nodes (4): GraphEdge, GraphNode, LegalHierarchyNode, LegalRef

### Community 89 - "ontologyValidationService.ts"
Cohesion: 0.29
Nodes (9): allowedRelationships(), COMPATIBILITY_MATRIX, CompatPair, NO_SELF_LOOP, NodeMatcher, OntologyValidationResult, pairMatches(), validateEdge() (+1 more)

### Community 90 - "promptOrchestratorService.ts"
Cohesion: 0.27
Nodes (8): executeChain(), _executionHistory, OrchestratorInput, OrchestratorResult, replayExecution(), sha256(), sortedVariablesJson(), StageExecution

### Community 91 - "rateLimiter.ts"
Cohesion: 0.29
Nodes (6): checkRateLimit(), RATE_LIMITS, RateLimitEntry, rateLimitMiddleware(), rateLimitStore, resetRateLimit()

### Community 92 - "rerankingService.ts"
Cohesion: 0.27
Nodes (7): contextualRerank(), legalPriorityRerank(), rerank(), RerankInput, RerankResult, RerankStrategy, semanticRerank()

### Community 93 - "semanticMemoryService.ts"
Cohesion: 0.27
Nodes (7): createMemoryLink(), findCorrelations(), findPrecedents(), getMemoryLinks(), _memoryLinks, SemanticMemoryLink, sha256()

### Community 94 - "taskSimulationService.ts"
Cohesion: 0.24
Nodes (8): maxRisk(), RISK_RANK, sha256(), SimulatedTask, simulateTasks(), _store, TaskSimulationInput, TaskSimulationOutput

### Community 95 - "agentExecutionEngine.ts"
Cohesion: 0.33
Nodes (7): AgentExecutionEngineInput, AgentExecutionEngineOutput, replayExecution(), runAgentExecution(), sha256(), simulateStageOutput(), _store

### Community 96 - "agentPlanningService.ts"
Cohesion: 0.31
Nodes (7): AgentPlanningInput, AgentPlanningOutput, computeCriticalPath(), planExecution(), replayPlan(), sha256(), _store

### Community 97 - "agentSafetyService.ts"
Cohesion: 0.25
Nodes (6): AgentSafetyInput, AgentSafetyOutput, SafetyReport, sha256(), _store, verifySafety()

### Community 98 - "autonomousWorkflowService.ts"
Cohesion: 0.31
Nodes (7): AutonomousWorkflowInput, AutonomousWorkflowOutput, AutonomousWorkflowStep, runAutonomousWorkflow(), sha256(), simulateOutput(), _store

### Community 99 - "contextRankingService.ts"
Cohesion: 0.31
Nodes (8): computeLegalScore(), computeRecencyScore(), ContextRankInput, ContextRankResult, PRIORITY_SCORES, RankedFragment, rankFragments(), sha256()

### Community 100 - "documentConcurrencyService.ts"
Cohesion: 0.28
Nodes (6): acquireLock(), getLockStatus(), LockStatus, LockType, log, parseLockType()

### Community 101 - "emailService.ts"
Cohesion: 0.36
Nodes (8): EmailNotification, resend, sendCommentAddedEmail(), sendDocumentApprovedEmail(), sendDocumentEditedEmail(), sendEmailNotification(), sendMemberAddedEmail(), sendStatusChangeEmail()

### Community 103 - "providerReplayService.ts"
Cohesion: 0.25
Nodes (5): createSnapshot(), _replayHistory, ReplayRecord, sha256(), _snapshots

### Community 104 - "semanticCompressionService.ts"
Cohesion: 0.28
Nodes (6): compressContext(), CompressionInput, CompressionResult, computeJaccard(), PRIORITY_ORDER, sha256()

### Community 105 - "workspaceCollaborationService.ts"
Cohesion: 0.33
Nodes (6): Comment, createComment(), delegateTask(), Delegation, postComment(), recordEvent()

### Community 106 - "aiUsageTracker.ts"
Cohesion: 0.54
Nodes (7): calculateCost(), estimateTokens(), MODEL_COSTS, trackCATMATMatching(), trackDocumentGeneration(), trackEmbedding(), trackRAGQuery()

### Community 107 - "copilotContextService.ts"
Cohesion: 0.25
Nodes (3): CopilotContextInput, CopilotContextOutput, _store

### Community 108 - "directContractAuditReport.ts"
Cohesion: 0.46
Nodes (7): AuditReportOptions, calculateStatistics(), formatDate(), formatDetails(), generateAuditReport(), getActionLabel(), getStatusLabel()

### Community 109 - "documentDraftService.ts"
Cohesion: 0.36
Nodes (6): discardDraft(), draftExpiresAt(), getDraft(), log, publishDraft(), saveDraft()

### Community 110 - "documentTemplateService.ts"
Cohesion: 0.32
Nodes (5): applyTemplate(), CreateTemplateParams, getTemplate(), log, updateTemplate()

### Community 111 - "institutionalRequestService.ts"
Cohesion: 0.39
Nodes (7): archiveRequest(), receiveRequest(), recordEvent(), requestInstitutionalReview(), respondRequest(), ReviewContextBundle, ReviewResult

### Community 112 - "proposalZipGenerator.ts"
Cohesion: 0.46
Nodes (6): generateMinutaContrato(), generatePropostaComercial(), generateTermoReferencia(), ProposalData, generateProposalZip(), ProposalData

### Community 113 - "documentVersionService.ts"
Cohesion: 0.33
Nodes (4): CreateVersionParams, getVersion(), log, restoreToVersion()

### Community 114 - "jurisprudenceCorrelationService.ts"
Cohesion: 0.33
Nodes (5): correlateJurisprudence(), _correlationHistory, getBuiltInReferences(), JurisprudenceCorrelationInput, JurisprudenceCorrelationOutput

### Community 115 - "legalValidationService.ts"
Cohesion: 0.33
Nodes (5): buildDefaultRules(), runLegalValidation(), _validationReports, ValidationServiceInput, ValidationServiceOutput

### Community 116 - "moduleLicensingService.ts"
Cohesion: 0.33
Nodes (3): isModuleLicensed(), LicenseValidation, validateLicense()

### Community 117 - "signatureValidation.ts"
Cohesion: 0.43
Nodes (4): generateDocumentHash(), validateBeforeSign(), validateDocumentIntegrity(), validateSignatureSequence()

### Community 118 - "businessDomainRegistryService.ts"
Cohesion: 0.47
Nodes (3): buildAllDependencies(), getDomainDependencies(), registerAll()

### Community 121 - "directContractPackage.ts"
Cohesion: 0.47
Nodes (4): generatePresentialPackage(), generateQuotationsSpreadsheet(), generateReadme(), PackageOptions

### Community 123 - "entityResolutionService.ts"
Cohesion: 0.47
Nodes (4): computeStringSimilarity(), findDuplicates(), ResolutionResult, resolveEntity()

### Community 124 - "legalOpinionExportService.ts"
Cohesion: 0.40
Nodes (4): DocumentSettings, exportLegalOpinionToPDF(), LegalOpinion, stripInline()

### Community 126 - "requestObservabilityService.ts"
Cohesion: 0.40
Nodes (3): bottleneckDomain(), pendingByDomain(), RequestMetricRow

### Community 127 - "semanticMatchingOrchestrator.ts"
Cohesion: 0.40
Nodes (5): computeReplayKey(), OrchestratorInput, OrchestratorResult, OrchestratorStageResult, runOrchestration()

### Community 128 - "tenantService.ts"
Cohesion: 0.40
Nodes (4): buildDefaultMembership(), log, resolveTenantForUser(), TenantResolution

### Community 129 - "cnpjValidator.ts"
Cohesion: 0.90
Nodes (4): cleanCNPJ(), consultCNPJ(), formatCNPJ(), validateCNPJ()

### Community 132 - "workspaceObservabilityService.ts"
Cohesion: 0.60
Nodes (3): recordApproval(), recordProductivity(), recordTaskCompletion()

## Knowledge Gaps
- **555 isolated node(s):** `baseCtx`, `ActivityLogPayload`, `ResourceType`, `ActionType`, `PermissionScope` (+550 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `serviceLogger()` connect `observabilityService.ts` to `tenantService.ts`, `importQueueService.ts`, `documentConcurrencyService.ts`, `documentRenderService.ts`, `documentWorkflowService.ts`, `documentDraftService.ts`, `documentTemplateService.ts`, `featureFlagService.ts`, `documentVersionService.ts`, `documentAttachmentService.ts`, `dlqObservabilityService.ts`, `documentService.ts`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `TrpcAuditCtx` connect `documentAttachmentService.ts` to `importQueueService.ts`, `documentConcurrencyService.ts`, `documentWorkflowService.ts`, `documentDraftService.ts`, `documentTemplateService.ts`, `documentVersionService.ts`, `documentService.ts`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `logActivity()` connect `documentAttachmentService.ts` to `importQueueService.ts`, `documentWorkflowService.ts`, `documentService.ts`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `baseCtx`, `ActivityLogPayload`, `ResourceType` to the rest of the system?**
  _557 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `contractValidation.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05446853516657853 - nodes in this community are weakly interconnected._
- **Should `catalogIntegrationService.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06610169491525424 - nodes in this community are weakly interconnected._
- **Should `suggestions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12473572938689217 - nodes in this community are weakly interconnected._