import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Modules from "./pages/Modules";
import ProcessDetails from "./pages/ProcessDetails";
import Settings from "./pages/Settings";
import Analytics from "./pages/Analytics";
import Admin from "./pages/Admin";
import TermsOfUse from "./pages/TermsOfUse";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import AuditLogs from "./pages/AuditLogs";
import Plans from "./pages/Plans";
import SolicitarProposta from "./pages/SolicitarProposta";
import AdminSubscriptions from "./pages/AdminSubscriptions";
import AdminProposals from "./pages/AdminProposals";
import AdminDocuments from "./pages/AdminDocuments";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { ConsentModal } from "./components/ConsentModal";
import { useState, useEffect } from "react";
import { trpc } from "./lib/trpc";

function AuthenticatedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={() => <AuthenticatedRoute component={Modules} />} />
      <Route path={"/processos"} component={() => <AuthenticatedRoute component={Dashboard} />} />
      <Route path="/processo/:id" component={() => <AuthenticatedRoute component={ProcessDetails} />} />
      <Route path={"/configuracoes"} component={() => <AuthenticatedRoute component={Settings} />} />
      <Route path={"/analytics"} component={() => <AuthenticatedRoute component={Analytics} />} />
      <Route path={"/admin"} component={() => <AuthenticatedRoute component={Admin} />} />
      <Route path={"/admin/assinaturas"} component={() => <AuthenticatedRoute component={AdminSubscriptions} />} />
      <Route path={"/admin/propostas"} component={() => <AuthenticatedRoute component={AdminProposals} />} />
      <Route path={"/admin/documentos"} component={() => <AuthenticatedRoute component={AdminDocuments} />} />
      <Route path={"/termos"} component={() => <AuthenticatedRoute component={TermsOfUse} />} />
      <Route path={"/privacidade"} component={() => <AuthenticatedRoute component={PrivacyPolicy} />} />
      <Route path={"/audit-logs"} component={() => <AuthenticatedRoute component={AuditLogs} />} />
      <Route path={"/planos"} component={Plans} />
      <Route path={"/solicitar-proposta"} component={SolicitarProposta} />
      <Route path={"/login"} component={Login} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { isAuthenticated } = useAuth();
  const [showConsentModal, setShowConsentModal] = useState(false);
  
  const { data: hasConsent, isLoading: checkingConsent } = trpc.lgpd.checkConsent.useQuery(
    { termsVersion: "1.0", privacyVersion: "1.0" },
    { enabled: isAuthenticated }
  );

  useEffect(() => {
    if (isAuthenticated && !checkingConsent && hasConsent !== undefined) {
      setShowConsentModal(!hasConsent);
    }
  }, [isAuthenticated, hasConsent, checkingConsent]);

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
          {isAuthenticated && (
            <ConsentModal
              open={showConsentModal}
              onConsent={() => setShowConsentModal(false)}
            />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
