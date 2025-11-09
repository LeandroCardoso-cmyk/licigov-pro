import { APP_LOGO, APP_TITLE } from "@/const";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, LogOut, FileText, FileCheck, Scale, FileSignature, Calendar, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface ModuleCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  available: boolean;
  badge?: string;
  color: string;
}

export default function Modules() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();

  const modules: ModuleCard[] = [
    {
      id: "documents",
      title: "Geração de Documentos",
      description: "Crie ETP, TR, DFD e Editais com auxílio de IA baseada na Lei 14.133/21",
      icon: <FileText className="h-10 w-10" />,
      route: "/processos",
      available: true,
      badge: "MVP",
      color: "from-blue-500 to-cyan-500",
    },
    {
      id: "direct",
      title: "Contratação Direta",
      description: "Gerencie Dispensas de Licitação e Inexigibilidades",
      icon: <FileCheck className="h-10 w-10" />,
      route: "/contratacao-direta",
      available: false,
      color: "from-purple-500 to-pink-500",
    },
    {
      id: "legal",
      title: "Parecer Jurídico",
      description: "Obtenha pareceres jurídicos automatizados para seus processos",
      icon: <Scale className="h-10 w-10" />,
      route: "/parecer-juridico",
      available: false,
      color: "from-amber-500 to-orange-500",
    },
    {
      id: "contracts",
      title: "Contratos",
      description: "Gerencie contratos, aditivos e fiscalização de forma centralizada",
      icon: <FileSignature className="h-10 w-10" />,
      route: "/contratos",
      available: false,
      color: "from-green-500 to-emerald-500",
    },
    {
      id: "department",
      title: "Gestão do Departamento",
      description: "Acompanhe atividades, prazos e gere relatórios gerenciais completos",
      icon: <Calendar className="h-10 w-10" />,
      route: "/gestao-departamento",
      available: false,
      color: "from-indigo-500 to-blue-500",
    },
  ];

  const handleModuleClick = (module: ModuleCard) => {
    if (module.available) {
      navigate(module.route);
    } else {
      toast.info("Em breve", {
        description: `O módulo "${module.title}" está em desenvolvimento e será liberado em breve.`,
      });
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background com imagem e overlay */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background/95 to-background/90 z-10" />
        <img 
          src="/bg-modules.jpg" 
          alt="Background" 
          className="w-full h-full object-cover opacity-30"
        />
      </div>

      {/* Content */}
      <div className="relative z-20">
        {/* Header com gradiente */}
        <header className="border-b border-border/50 backdrop-blur-sm bg-card/80">
          <div className="container mx-auto px-4 sm:px-6 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img src={APP_LOGO} alt={APP_TITLE} className="h-20 sm:h-28 w-auto" />
                <div className="hidden sm:block">
                  <h1 className="text-2xl sm:text-3xl font-bold text-foreground bg-gradient-to-r from-primary to-cyan-600 bg-clip-text text-transparent">
                    {APP_TITLE}
                  </h1>
                  <p className="text-sm text-muted-foreground">Automação de Processos Licitatórios</p>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-4">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate("/configuracoes")}
                  className="rounded-full hover:bg-primary/10"
                  title="Configurações"
                >
                  <Settings className="h-5 w-5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleTheme}
                  className="rounded-full hover:bg-primary/10"
                >
                  {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                </Button>

                <div className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-full bg-muted/50">
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">{user?.name}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="rounded-full hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Mobile user info */}
            <div className="sm:hidden mt-4 flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/50">
              <div>
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {/* Welcome Section */}
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
              Bem-vindo, {user?.name?.split(" ")[0]}!
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
              Escolha o módulo que deseja acessar para gerenciar seus processos licitatórios
              de forma eficiente e automatizada
            </p>
          </div>

          {/* Modules Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
            {modules.map((module) => (
              <Card
                key={module.id}
                className={`
                  relative overflow-hidden cursor-pointer transition-all duration-300 border-2
                  ${module.available 
                    ? "hover:scale-105 hover:shadow-2xl hover:border-primary/50" 
                    : "opacity-75 hover:opacity-90"
                  }
                  ${!module.available && "cursor-not-allowed"}
                `}
                onClick={() => handleModuleClick(module)}
              >
                {/* Gradient overlay no topo do card */}
                <div className={`absolute top-0 left-0 right-0 h-2 bg-gradient-to-r ${module.color}`} />

                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className={`p-4 rounded-2xl bg-gradient-to-br ${module.color} text-white shadow-lg`}>
                      {module.icon}
                    </div>
                    {module.badge && (
                      <Badge className="bg-primary text-primary-foreground font-semibold px-3 py-1">
                        {module.badge}
                      </Badge>
                    )}
                    {!module.available && (
                      <Badge variant="secondary" className="font-semibold px-3 py-1">
                        Em breve
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-xl sm:text-2xl">{module.title}</CardTitle>
                  <CardDescription className="text-sm sm:text-base mt-2">
                    {module.description}
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <Button
                    className={`w-full ${module.available ? "bg-gradient-to-r " + module.color : ""}`}
                    disabled={!module.available}
                    variant={module.available ? "default" : "secondary"}
                  >
                    {module.available ? "Acessar Módulo" : "Em Desenvolvimento"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Footer Info */}
          <div className="text-center mt-12 sm:mt-16">
            <p className="text-sm text-muted-foreground">
              Novos módulos serão liberados gradualmente. Acompanhe as atualizações!
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
