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

export const appRouter = router({
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
});

export type AppRouter = typeof appRouter;
