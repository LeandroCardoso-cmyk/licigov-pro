import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { APP_LOGO, APP_TITLE } from "@/const";
import {
  FileText, FileCheck, Scale, BarChart3, Loader2, Briefcase, ScrollText, Moon, Sun, History, Clock,
} from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";
import { useNavigationHistory } from "@/hooks/useNavigationHistory";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModuleCard } from "@/components/module-selection/ModuleCard";

const BASE_MODULES = [
  {
    id: "processes",
    title: "Processos Licitatórios",
    description: "Gestão completa de licitações com geração automática de ETP, TR, DFD e Editais usando IA",
    icon: <FileText className="h-6 w-6" />,
    path: "/processos",
    available: true,
    color: "from-blue-500 to-blue-600",
    image: "/dashboard-processos.png",
    stats: { label: "Processos Ativos", value: "—" },
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
    stats: { label: "Contratações", value: "—" },
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
    stats: { label: "Contratos Vigentes", value: "—" },
  },
  {
    id: "legal-opinion",
    title: "Parecer Jurídico",
    description: "Análise jurídica automatizada com IA baseada na Lei 14.133/2021",
    icon: <Scale className="h-6 w-6" />,
    path: "/parecer-juridico",
    available: true,
    color: "from-red-500 to-red-600",
    image: "/dashboard-parecer-juridico.png",
    stats: { label: "Pareceres", value: "—" },
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
    stats: { label: "Tarefas Pendentes", value: "—" },
  },
];

export default function ModuleSelectionDashboard() {
  const { user, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  const { theme, toggleTheme, switchable } = useTheme();
  const navigationHistory = useNavigationHistory();

  const { data: contractsOverview } = trpc.contracts.analytics.getOverview.useQuery(undefined, { enabled: !!user });
  const { data: processesData } = trpc.processes.list.useQuery(undefined, { enabled: !!user });
  const { data: directContractsData } = trpc.directContracts.list.useQuery(
    { type: undefined, status: undefined, year: undefined },
    { enabled: !!user }
  );
  const { data: tasksData } = trpc.tasks.list.useQuery(
    { status: undefined, priority: undefined, assignedTo: undefined },
    { enabled: !!user }
  );

  const modulesWithStats = BASE_MODULES.map((module) => {
    if (module.id === "processes" && processesData)
      return { ...module, stats: { label: "Processos Ativos", value: processesData.length } };
    if (module.id === "direct-contracting" && directContractsData)
      return { ...module, stats: { label: "Contratações", value: directContractsData.length } };
    if (module.id === "contracts" && contractsOverview)
      return { ...module, stats: { label: "Contratos Vigentes", value: contractsOverview.active } };
    if (module.id === "department-management" && tasksData)
      return { ...module, stats: { label: "Tarefas Pendentes", value: tasksData.filter((t) => t.status !== "concluida").length } };
    return module;
  });

  const handleModuleClick = (module: (typeof modulesWithStats)[number]) => {
    if (!module.available) {
      toast.info("Em breve", { description: `O módulo "${module.title}" estará disponível em breve!` });
      return;
    }
    navigate(module.path);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const contractAlerts = contractsOverview ? contractsOverview.expired + contractsOverview.expiringSoon : 0;

  return (
    <div className="min-h-screen bg-background">
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
            {user?.role === "admin" && (
              <Button variant="outline" size="sm" onClick={() => navigate("/admin")} className="border-primary/20 hover:bg-primary/10">
                <BarChart3 className="h-4 w-4 mr-2" />Painel Admin
              </Button>
            )}
            {switchable && toggleTheme && (
              <Button variant="outline" size="sm" onClick={toggleTheme} className="border-border hover:bg-muted">
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            )}
            {navigationHistory.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="border-border hover:bg-muted"><History className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="flex items-center gap-2"><Clock className="h-4 w-4" />Histórico de Navegação</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {navigationHistory.map((item, index) => (
                    <DropdownMenuItem key={`${item.path}-${index}`} onClick={() => navigate(item.path)} className="cursor-pointer">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{item.label}</span>
                        <span className="text-xs text-muted-foreground">{item.path}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => logout()}>Sair</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-4">
              Bem-vindo, {user?.name?.split(" ")[0]}! 👋
            </h2>
            <p className="text-lg text-muted-foreground">Selecione um módulo abaixo para começar a trabalhar</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {modulesWithStats.map((module) => (
              <ModuleCard
                key={module.id}
                module={module}
                alertCount={module.id === "contracts" ? contractAlerts : undefined}
                onClick={() => handleModuleClick(module)}
              />
            ))}
          </div>

          <div className="mt-16 text-center">
            <div className="inline-block bg-blue-50 border border-blue-200 rounded-lg px-6 py-3">
              <p className="text-sm text-blue-800">✨ Novos módulos serão adicionados em breve. Fique atento às atualizações!</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
