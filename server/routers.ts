import { router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import { authRouter } from "./routers/authRouter";
import { processesRouter } from "./routers/processesRouter";
import { documentsRouter } from "./routers/documentsRouter";
import { editalParametersRouter } from "./routers/editalParametersRouter";
import { activitiesRouter } from "./routers/activitiesRouter";
import { collaborationRouter } from "./routers/collaborationRouter";
import { notificationsRouter } from "./routers/notificationsRouter";
import { documentSettingsRouter } from "./routers/documentSettingsRouter";
import { commentsRouter } from "./routers/commentsRouter";
import { lgpdRouter } from "./routers/lgpdRouter";
import { adminRouter } from "./routers/adminRouter";
import { analyticsRouter } from "./routers/analyticsRouter";
import { billingRouter } from "./routers/billingRouter";
import { commercialRouter } from "./routers/commercialRouter";
import { companyDocumentsRouter } from "./routers/companyDocumentsRouter";
import { catmatRouter } from "./routers/catmatRouter";
import { taskRouter } from "./routers/taskRouter";
import { departmentTasksRouter } from "./routers/departmentTasksRouter";
import { templatesRouter } from "./routers/templatesRouter";
import { aiUsageRouter } from "./routers/aiUsageRouter";
import { platformsRouter } from "./routers/platformsRouter";
import { downloadRouter } from "./routers/downloadRouter";
import { directContractsRouter } from "./routers/directContractsRouter";
import { contractsRouter } from "./routers/contractsRouter";
import { contactRouter } from "./routers/contactRouter";
import { legalOpinionsRouter } from "./routers/legalOpinionsRouter";
import { aiAssistantRouter } from "./routers/aiAssistantRouter";
import { organizationsRouter } from "./routers/organizationsRouter";
import { itemTrRouter } from "./routers/itemTrRouter";
import { reviewWorkspaceRouter } from "./routers/reviewWorkspaceRouter";
import { clauseRouter } from "./routers/clauseRouter";
import { trCompositionRouter } from "./routers/trCompositionRouter";
import { itemAnalyticsRouter } from "./routers/itemAnalyticsRouter";
import { exportRouter } from "./routers/exportRouter";
import { productionReadinessRouter } from "./routers/productionReadinessRouter";
import { collaborationCommentsRouter } from "./routers/collaborationCommentsRouter";
import { webhookRouter } from "./routers/webhookRouter";
import { structuredExportRouter } from "./routers/structuredExportRouter";
import { pilotReadinessRouter } from "./routers/pilotReadinessRouter";
import { onboardingRouter } from "./routers/onboardingRouter";
import { deploymentRouter }  from "./routers/deploymentRouter";
import { stabilityRouter }   from "./routers/stabilityRouter";
import { contextRouter }     from "./routers/contextRouter";
import { promptOrchestrationRouter } from "./routers/promptOrchestrationRouter";
import { legalReasoningRouter } from "./routers/legalReasoningRouter";
import { draftingRouter } from "./routers/draftingRouter";
import { agentExecutionRouter } from "./routers/agentExecutionRouter";
import { approvalWorkflowRouter } from "./routers/approvalWorkflowRouter";
import { providerRouter } from "./routers/providerRouter";
import { providerGovernanceRouter } from "./routers/providerGovernanceRouter";
import { semanticRetrievalRouter } from "./routers/semanticRetrievalRouter";
import { semanticGovernanceRouter } from "./routers/semanticGovernanceRouter";
import { institutionalRagRouter } from "./routers/institutionalRagRouter";
import { ragGovernanceRouter } from "./routers/ragGovernanceRouter";
import { knowledgeGraphRouter } from "./routers/knowledgeGraphRouter";
import { ontologyRouter } from "./routers/ontologyRouter";
import { copilotRouter } from "./routers/copilotRouter";
import { copilotGovernanceRouter } from "./routers/copilotGovernanceRouter";
import { workspaceRouter } from "./routers/workspaceRouter";
import { workspaceGovernanceRouter } from "./routers/workspaceGovernanceRouter";

export const appRouter = router({
  organizations: organizationsRouter,
  system: systemRouter,
  contact: contactRouter,
  auth: authRouter,
  processes: processesRouter,
  documents: documentsRouter,
  editalParameters: editalParametersRouter,
  activities: activitiesRouter,
  collaboration: collaborationRouter,
  notifications: notificationsRouter,
  documentSettings: documentSettingsRouter,
  comments: commentsRouter,
  lgpd: lgpdRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
  billing: billingRouter,
  commercial: commercialRouter,
  companyDocuments: companyDocumentsRouter,
  catmat: catmatRouter,
  tasks: taskRouter,
  departmentTasks: departmentTasksRouter,
  templates: templatesRouter,
  aiUsage: aiUsageRouter,
  platforms: platformsRouter,
  downloads: downloadRouter,
  directContracts: directContractsRouter,
  contracts: contractsRouter,
  legalOpinions: legalOpinionsRouter,
  aiAssistant: aiAssistantRouter,
  itemTr: itemTrRouter,
  reviewWorkspace: reviewWorkspaceRouter,
  clauses: clauseRouter,
  trComposition: trCompositionRouter,
  itemAnalytics: itemAnalyticsRouter,
  exports: exportRouter,
  productionReadiness: productionReadinessRouter,
  collaborationComments: collaborationCommentsRouter,
  webhooks: webhookRouter,
  structuredExports: structuredExportRouter,
  pilotReadiness: pilotReadinessRouter,
  onboarding:     onboardingRouter,
  deployment:          deploymentRouter,
  stability:           stabilityRouter,
  context:             contextRouter,
  promptOrchestration: promptOrchestrationRouter,
  legalReasoning: legalReasoningRouter,
  drafting:       draftingRouter,
  agentExecution:   agentExecutionRouter,
  approvalWorkflow: approvalWorkflowRouter,
  providers:        providerRouter,
  providerGovernance: providerGovernanceRouter,
  semanticRetrieval:  semanticRetrievalRouter,
  semanticGovernance: semanticGovernanceRouter,
  institutionalRag:    institutionalRagRouter,
  ragGovernance:       ragGovernanceRouter,
  knowledgeGraph:      knowledgeGraphRouter,
  ontology:            ontologyRouter,
  copilot:             copilotRouter,
  copilotGovernance:   copilotGovernanceRouter,
  workspace:           workspaceRouter,
  workspaceGovernance: workspaceGovernanceRouter,
});

export type AppRouter = typeof appRouter;
