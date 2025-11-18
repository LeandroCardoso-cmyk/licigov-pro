import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE } from "@/const";
import { 
  FileText, 
  FileCheck, 
  Scale, 
  BarChart3,
  ArrowRight,
  Loader2,
  Briefcase
} from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Module {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  available: boolean;
  adminOnly?: boolean;
  color: string;
}

const modules: Module[] = [
  {
    id: "processes",
    title: "Processos Licitatórios",
    description: "Gestão completa de licitações com geração automática de ETP, TR, DFD e Editais usando IA",
    icon: <FileText className="h-8 w-8" />,
    path: "/processos",
    available: true,
    color: "from-blue-500 to-blue-600",
  },

  {
    id: "direct-contracting",
    title: "Contratação Direta",
    description: "Gestão de contratações diretas e dispensas de licitação conforme Lei 14.133/2021",
    icon: <FileCheck className="h-8 w-8" />,
    path: "/direct-contracts",
    available: true,
    color: "from-purple-500 to-purple-600",
  },
  {
    id: "contracts",
    title: "Gestão de Contratos",
    description: "Acompanhamento de contratos, prazos, aditivos e fiscalização contratual",
    icon: <BarChart3 className="h-8 w-8" />,
    path: "/contracts",
    available: true,
    color: "from-orange-500 to-orange-600",
  },
  {
    id: "legal-opinion",
    title: "Parecer Jurídico",
    description: "Solicitação e acompanhamento de pareceres jurídicos para processos licitatórios",
    icon: <Scale className="h-8 w-8" />,
    path: "/parecer-juridico",
    available: false,
    color: "from-red-500 to-red-600",
  },
  {
    id: "department-management",
    title: "Gestão do Departamento",
    description: "Kanban de tarefas, prazos, tramitação e controle de atividades do departamento",
    icon: <Briefcase className="h-8 w-8" />,
    path: "/gestao-departamento",
    available: true,
    color: "from-green-500 to-green-600",
  },
];

export default function ModuleSelectionDashboard() {
  const { user, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  
  // Buscar alertas de contratos
  const { data: contractsOverview } = trpc.contracts.analytics.getOverview.useQuery(undefined, {
    enabled: !!user,
  });

  const handleModuleClick = (module: Module) => {
    if (!module.available) {
      toast.info("Em breve", {
        description: `O módulo "${module.title}" estará disponível em breve!`,
      });
      return;
    }

    navigate(module.path);
  };

  // Propostas Comerciais não aparece no dashboard, apenas no painel admin
  const filteredModules = modules;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-12" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">{APP_TITLE}</h1>
              <p className="text-sm text-gray-600">Plataforma de Gestão Pública</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-600">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Welcome Section */}
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Bem-vindo, {user?.name?.split(" ")[0]}! 👋
            </h2>
            <p className="text-lg text-gray-600">
              Selecione um módulo abaixo para começar a trabalhar
            </p>
          </div>

          {/* Modules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredModules.map((module) => (
              <Card
                key={module.id}
                className={`relative overflow-hidden transition-all duration-300 hover:shadow-xl cursor-pointer ${
                  module.available ? "hover:scale-105" : "opacity-75"
                }`}
                onClick={() => handleModuleClick(module)}
              >
                {/* Gradient Header */}
                <div className={`h-32 bg-gradient-to-br ${module.color} flex items-center justify-center text-white`}>
                  {module.icon}
                </div>

                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-xl">{module.title}</CardTitle>
                    {!module.available && (
                      <Badge variant="secondary" className="shrink-0">
                        Em Breve
                      </Badge>
                    )}
                    {module.id === "contracts" && contractsOverview && (contractsOverview.expiredCount + contractsOverview.expiring30Days) > 0 && (
                      <Badge variant="destructive" className="shrink-0">
                        {contractsOverview.expiredCount + contractsOverview.expiring30Days} alertas
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-sm mt-2">
                    {module.description}
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <Button
                    variant={module.available ? "default" : "outline"}
                    className="w-full"
                    disabled={!module.available}
                  >
                    {module.available ? (
                      <>
                        Acessar Módulo
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    ) : (
                      "Em Desenvolvimento"
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Footer Info */}
          <div className="mt-16 text-center">
            <p className="text-sm text-gray-600">
              Novos módulos serão adicionados em breve. Fique atento às atualizações!
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
