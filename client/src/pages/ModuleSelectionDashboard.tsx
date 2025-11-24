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
  Briefcase,
  ScrollText,
  Moon,
  Sun
} from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

interface Module {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  available: boolean;
  adminOnly?: boolean;
  color: string;
  image: string;
  stats?: {
    label: string;
    value: string | number;
  };
}

const modules: Module[] = [
  {
    id: "processes",
    title: "Processos Licitatórios",
    description: "Gestão completa de licitações com geração automática de ETP, TR, DFD e Editais usando IA",
    icon: <FileText className="h-6 w-6" />,
    path: "/processos",
    available: true,
    color: "from-blue-500 to-blue-600",
    image: "/dashboard-processos.png",
    stats: {
      label: "Processos Ativos",
      value: "—"
    }
  },
  {
    id: "direct-contracting",
    title: "Contratação Direta",
    description: "Gestão de contratações diretas e dispensas de licitação conforme Lei 14.133/2021",
    icon: <FileCheck className="h-6 w-6" />,
    path: "/direct-contracts",
    available: true,
    color: "from-purple-500 to-purple-600",
    image: "/dashboard-contratacao-direta.png",
    stats: {
      label: "Contratações",
      value: "—"
    }
  },
  {
    id: "contracts",
    title: "Gestão de Contratos",
    description: "Acompanhamento de contratos, prazos, aditivos e fiscalização contratual",
    icon: <ScrollText className="h-6 w-6" />,
    path: "/contracts",
    available: true,
    color: "from-orange-500 to-orange-600",
    image: "/dashboard-contratos.png",
    stats: {
      label: "Contratos Vigentes",
      value: "—"
    }
  },
  {
    id: "legal-opinion",
    title: "Parecer Jurídico",
    description: "Análise jurídica automatizada com IA baseada na Lei 14.133/2021",
    icon: <Scale className="h-6 w-6" />,
    path: "/parecer-juridico",
    available: false,
    color: "from-red-500 to-red-600",
    image: "/dashboard-parecer-juridico.png",
    stats: {
      label: "Pareceres",
      value: "—"
    }
  },
  {
    id: "department-management",
    title: "Gestão do Departamento",
    description: "Kanban de tarefas, prazos, tramitação e controle de atividades do departamento",
    icon: <Briefcase className="h-6 w-6" />,
    path: "/gestao-departamento",
    available: true,
    color: "from-green-500 to-green-600",
    image: "/dashboard-departamento.png",
    stats: {
      label: "Tarefas Pendentes",
      value: "—"
    }
  },
];

export default function ModuleSelectionDashboard() {
  const { user, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  const { theme, toggleTheme, switchable } = useTheme();
  
  // Buscar estatísticas
  const { data: contractsOverview } = trpc.contracts.analytics.getOverview.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: processesData } = trpc.processes.list.useQuery(
    { status: undefined, year: undefined },
    { enabled: !!user }
  );

  const { data: directContractsData } = trpc.directContracts.list.useQuery(
    { type: undefined, status: undefined, year: undefined },
    { enabled: !!user }
  );

  const { data: tasksData } = trpc.tasks.list.useQuery(
    { status: undefined, priority: undefined, assignedTo: undefined },
    { enabled: !!user }
  );

  const handleModuleClick = (module: Module) => {
    if (!module.available) {
      toast.info("Em breve", {
        description: `O módulo "${module.title}" estará disponível em breve!`,
      });
      return;
    }

    navigate(module.path);
  };

  // Atualizar estatísticas dinâmicas
  const modulesWithStats = modules.map(module => {
    if (module.id === "processes" && processesData) {
      return { ...module, stats: { label: "Processos Ativos", value: processesData.length } };
    }
    if (module.id === "direct-contracting" && directContractsData) {
      return { ...module, stats: { label: "Contratações", value: directContractsData.length } };
    }
    if (module.id === "contracts" && contractsOverview) {
      return { ...module, stats: { label: "Contratos Vigentes", value: contractsOverview.activeCount } };
    }
    if (module.id === "department-management" && tasksData) {
      const pendingTasks = tasksData.filter(t => t.status !== "concluida").length;
      return { ...module, stats: { label: "Tarefas Pendentes", value: pendingTasks } };
    }
    return module;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card/80 backdrop-blur-sm border-b shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-16 drop-shadow-md" />
            <div>
              <h1 className="text-xl font-bold text-foreground">{APP_TITLE}</h1>
              <p className="text-sm text-muted-foreground">Plataforma de Gestão Pública</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {user?.role === 'admin' && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigate('/admin')}
                className="border-primary/20 hover:bg-primary/10"
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Painel Admin
              </Button>
            )}
            {switchable && toggleTheme && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
                className="border-border hover:bg-muted"
              >
                {theme === "light" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => logout()}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-7xl mx-auto">
          {/* Welcome Section */}
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-4">
              Bem-vindo, {user?.name?.split(" ")[0]}! 👋
            </h2>
            <p className="text-lg text-muted-foreground">
              Selecione um módulo abaixo para começar a trabalhar
            </p>
          </div>

          {/* Modules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {modulesWithStats.map((module) => (
              <Card
                key={module.id}
                className={`group relative overflow-hidden transition-all duration-300 hover:shadow-2xl cursor-pointer border-2 ${
                  module.available 
                    ? "hover:scale-[1.02] hover:border-primary/30" 
                    : "opacity-75 hover:opacity-90"
                }`}
                onClick={() => handleModuleClick(module)}
              >
                {/* Image Preview */}
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-muted to-muted/50">
                  <img 
                    src={module.image} 
                    alt={module.title}
                    className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110"
                  />
                  {/* Gradient Overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-t ${module.color} opacity-20 group-hover:opacity-30 transition-opacity`}></div>
                  
                  {/* Icon Badge */}
                  <div className={`absolute bottom-3 left-3 p-3 rounded-xl bg-gradient-to-br ${module.color} text-white shadow-lg`}>
                    {module.icon}
                  </div>

                  {/* Stats Badge */}
                  {module.stats && (
                    <div className="absolute top-3 right-3 bg-card/95 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-md border">
                      <p className="text-xs text-muted-foreground">{module.stats.label}</p>
                      <p className="text-lg font-bold text-foreground">{module.stats.value}</p>
                    </div>
                  )}
                </div>

                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-xl font-bold text-foreground">{module.title}</CardTitle>
                    {!module.available && (
                      <Badge variant="secondary" className="shrink-0">
                        Em Breve
                      </Badge>
                    )}
                    {module.id === "contracts" && contractsOverview && (contractsOverview.expiredCount + contractsOverview.expiring30Days) > 0 && (
                      <Badge variant="destructive" className="shrink-0 animate-pulse">
                        {contractsOverview.expiredCount + contractsOverview.expiring30Days} alertas
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-sm mt-2 text-muted-foreground">
                    {module.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  <Button
                    variant={module.available ? "default" : "outline"}
                    className={`w-full transition-all ${
                      module.available 
                        ? "bg-gradient-to-r from-primary to-accent hover:opacity-90 shadow-md hover:shadow-lg" 
                        : ""
                    }`}
                    disabled={!module.available}
                  >
                    {module.available ? (
                      <>
                        Acessar Módulo
                        <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
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
            <div className="inline-block bg-blue-50 border border-blue-200 rounded-lg px-6 py-3">
              <p className="text-sm text-blue-800">
                ✨ Novos módulos serão adicionados em breve. Fique atento às atualizações!
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
