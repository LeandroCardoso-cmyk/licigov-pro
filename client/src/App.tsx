import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Modules from "./pages/Modules";
import ProcessDetails from "./pages/ProcessDetails";
import Settings from "./pages/Settings";
import Analytics from "./pages/Analytics";
import Admin from "./pages/Admin";
import TermsOfUse from "./pages/TermsOfUse";
import PrivacyPolicy from "./pages/PrivacyPolicy";
// import AuditLogs from "./pages/AuditLogs";
import Plans from "./pages/Plans";
import SolicitarProposta from "./pages/SolicitarProposta";
// import AdminSubscriptions from "./pages/AdminSubscriptions";
import CommercialManagement from "./pages/CommercialManagement";
import AdminDocuments from "./pages/AdminDocuments";
// import AdminDefaultDashboard from "./pages/AdminDefaultDashboard";
// import AdminContractsReport from "./pages/AdminContractsReport";
// import AdminFinancialReports from "./pages/AdminFinancialReports";
import NewProcess from "./pages/NewProcess";
import ModuleSelectionDashboard from "./pages/ModuleSelectionDashboard";
import TestPage from "./pages/TestPage";
import TestPage2 from "./pages/TestPage2";
import TestPage3 from "./pages/TestPage3";
import TestPage4 from "./pages/TestPage4";
import DocumentSettings from "./pages/DocumentSettings";
import Templates from "./pages/Templates";
import ActivityReport from "./pages/ActivityReport";
import DepartmentManagement from "./pages/DepartmentManagement";
import AIUsageDashboard from "./pages/AIUsageDashboard";
import AdminPlatforms from "./pages/AdminPlatforms";
import PublicationLogs from "./pages/PublicationLogs";
import DirectContracts from "./pages/DirectContracts";
import NewDirectContract from "./pages/NewDirectContract";
import DirectContractDetails from "./pages/DirectContractDetails";
import DirectContractsAnalytics from "./pages/DirectContractsAnalytics";
import Contracts from "./pages/Contracts";
import NewContract from "./pages/NewContract";
import ContractDetails from "./pages/ContractDetails";
import ContractAlerts from "./pages/ContractAlerts";
import LegalOpinions from "./pages/LegalOpinions";
import NewLegalOpinion from "./pages/NewLegalOpinion";
import LegalOpinionDetails from "./pages/LegalOpinionDetails";
import LegalOpinionsAnalytics from "./pages/LegalOpinionsAnalytics";
import Register from "./pages/Register";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { KeyboardShortcutsTooltip } from "./components/KeyboardShortcutsTooltip";

function AuthenticatedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Component />;
}

// Wrapper components para evitar re-criação em cada render
const ModuleSelectionRoute = () => <AuthenticatedRoute component={ModuleSelectionDashboard} />;
const ModulesRoute = () => <AuthenticatedRoute component={Modules} />;
const ProcessesRoute = () => <AuthenticatedRoute component={Dashboard} />;
const NewProcessRoute = () => <AuthenticatedRoute component={NewProcess} />;
const DocumentSettingsRoute = () => <AuthenticatedRoute component={DocumentSettings} />;
const ProcessDetailsRoute = () => <AuthenticatedRoute component={ProcessDetails} />;
const SettingsRoute = () => <AuthenticatedRoute component={Settings} />;
const AnalyticsRoute = () => <AuthenticatedRoute component={Analytics} />;
const AdminRoute = () => <AuthenticatedRoute component={Admin} />;
// const AdminSubscriptionsRoute = () => <AuthenticatedRoute component={AdminSubscriptions} />;
const CommercialManagementRoute = () => <AuthenticatedRoute component={CommercialManagement} />;
const AdminDocumentsRoute = () => <AuthenticatedRoute component={AdminDocuments} />;
// const AdminDefaultDashboardRoute = () => <AuthenticatedRoute component={AdminDefaultDashboard} />;
// const AdminContractsReportRoute = () => <AuthenticatedRoute component={AdminContractsReport} />;
// const AdminFinancialReportsRoute = () => <AuthenticatedRoute component={AdminFinancialReports} />;
const TermsOfUseRoute = () => <AuthenticatedRoute component={TermsOfUse} />;
const PrivacyPolicyRoute = () => <AuthenticatedRoute component={PrivacyPolicy} />;
// const AuditLogsRoute = () => <AuthenticatedRoute component={AuditLogs} />;
const TestPage4Route = () => <AuthenticatedRoute component={TestPage4} />;
const TemplatesRoute = () => <AuthenticatedRoute component={Templates} />;
const ActivityReportRoute = () => <AuthenticatedRoute component={ActivityReport} />;
const DepartmentManagementRoute = () => <AuthenticatedRoute component={DepartmentManagement} />;
const AIUsageDashboardRoute = () => <AuthenticatedRoute component={AIUsageDashboard} />;
const AdminPlatformsRoute = () => <AuthenticatedRoute component={AdminPlatforms} />;
const PublicationLogsRoute = () => <AuthenticatedRoute component={PublicationLogs} />;
const DirectContractsRoute = () => <AuthenticatedRoute component={DirectContracts} />;
const NewDirectContractRoute = () => <AuthenticatedRoute component={NewDirectContract} />;
const DirectContractDetailsRoute = () => <AuthenticatedRoute component={DirectContractDetails} />;
const LegalOpinionsRoute = () => <AuthenticatedRoute component={LegalOpinions} />;
const LegalOpinionsAnalyticsRoute = () => <AuthenticatedRoute component={LegalOpinionsAnalytics} />;
const NewLegalOpinionRoute = () => <AuthenticatedRoute component={NewLegalOpinion} />;
const LegalOpinionDetailsRoute = () => <AuthenticatedRoute component={LegalOpinionDetails} />;

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={LandingPage} />
      <Route path={"/dashboard"} component={ModuleSelectionRoute} />
      <Route path={"/processos"} component={ProcessesRoute} />
      <Route path={"/gestao-comercial"} component={CommercialManagementRoute} />
      <Route path={"/novo-processo"} component={NewProcessRoute} />
      <Route path={"/personalizacao-documentos"} component={DocumentSettingsRoute} />
      <Route path={"/templates"} component={TemplatesRoute} />
      <Route path={"/auditoria"} component={ActivityReportRoute} />
      <Route path={"/gestao-departamento"} component={DepartmentManagementRoute} />      <Route path={"/admin/ai-costs"} component={AIUsageDashboardRoute} />
      <Route path={"/admin/platforms"} component={AdminPlatformsRoute} />
      <Route path={'/admin/publication-logs'} component={PublicationLogsRoute} />
      <Route path={'/direct-contracts'} component={DirectContractsRoute} />
      <Route path={'/direct-contracts/analytics'} component={() => <AuthenticatedRoute component={DirectContractsAnalytics} />} />
      <Route path={'/direct-contracts/new'} component={NewDirectContractRoute} />
      <Route path={'/direct-contracts/:id'} component={DirectContractDetailsRoute} />
      <Route path={'/contracts'} component={() => <AuthenticatedRoute component={Contracts} />} />
      <Route path={'/contracts/new'} component={() => <AuthenticatedRoute component={NewContract} />} />
      <Route path={'/contracts/alerts'} component={() => <AuthenticatedRoute component={ContractAlerts} />} />
      <Route path={'/contracts/:id'} component={() => <AuthenticatedRoute component={ContractDetails} />} />
      <Route path={'/parecer-juridico'} component={LegalOpinionsRoute} />
      <Route path={'/parecer-juridico/analytics'} component={LegalOpinionsAnalyticsRoute} />
      <Route path={'/parecer-juridico/novo'} component={NewLegalOpinionRoute} />
      <Route path={'/parecer-juridico/:id'} component={LegalOpinionDetailsRoute} />
      <Route path="/processo/:id" component={ProcessDetailsRoute} />
      <Route path={"/configuracoes"} component={SettingsRoute} />
      <Route path={"/analytics"} component={AnalyticsRoute} />
      <Route path={"/admin"} component={AdminRoute} />
      {/* <Route path={"/admin/assinaturas"} component={AdminSubscriptionsRoute} /> */}
      <Route path={"/admin/propostas"} component={CommercialManagementRoute} />
      <Route path={"/admin/documentos"} component={AdminDocumentsRoute} />
      {/* <Route path={"/admin/inadimplencia"} component={AdminDefaultDashboardRoute} /> */}
      {/* <Route path={"/admin/contratos-limite"} component={AdminContractsReportRoute} /> */}
      {/* <Route path={"/admin/relatorios-financeiros"} component={AdminFinancialReportsRoute} /> */}
      <Route path={"/termos"} component={TermsOfUseRoute} />
      <Route path={"/privacidade"} component={PrivacyPolicyRoute} />
      {/* <Route path={"/audit-logs"} component={AuditLogsRoute} /> */}
      <Route path={"/planos"} component={Plans} />
      <Route path={"/solicitar-proposta"} component={SolicitarProposta} />
      <Route path={"/test"} component={TestPage} />
      <Route path={"/test2"} component={TestPage2} />
      <Route path={"/test3"} component={TestPage3} />
      <Route path={"/test4"} component={TestPage4Route} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Atalhos de teclado globais (ESC, Ctrl+Home)
  useKeyboardNavigation();

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <KeyboardShortcutsTooltip />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
