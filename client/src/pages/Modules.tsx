import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, FileText, FileSignature, Scale, FileCheck, Calendar } from "lucide-react";
import { useLocation } from "wouter";

interface ModuleCard {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  route: string;
  available: boolean;
  badge?: string;
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
      icon: <FileText className="h-8 w-8" />,
      route: "/processos",
      available: true,
      badge: "MVP",
    },
    {
      id: "direct",
      title: "Contratação Direta",
      description: "Gerencie Dispensas de Licitação e Inexigibilidades",
      icon: <FileCheck className="h-8 w-8" />,
      route: "/contratacao-direta",
      available: false,
    },
    {
      id: "legal",
      title: "Parecer Jurídico",
      description: "Obtenha pareceres jurídicos automatizados para seus processos",
      icon: <Scale className="h-8 w-8" />,
      route: "/parecer-juridico",
      available: false,
    },
    {
      id: "contracts",
      title: "Contratos",
      description: "Gerencie contratos, aditivos e fiscalização de forma centralizada",
      icon: <FileSignature className="h-8 w-8" />,
      route: "/contratos",
      available: false,
    },
    {
      id: "department",
      title: "Gestão do Departamento",
      description: "Acompanhe atividades, prazos e gere relatórios gerenciais completos",
      icon: <Calendar className="h-8 w-8" />,
      route: "/gestao-departamento",
      available: false,
    },
  ];

  const handleModuleClick = (module: ModuleCard) => {
    if (module.available) {
      navigate(module.route);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={APP_LOGO} alt={APP_TITLE} className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold text-foreground">{APP_TITLE}</h1>
                <p className="text-sm text-muted-foreground">Automação de Processos Licitatórios</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full"
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <Button variant="outline" size="sm" onClick={logout}>
                  Sair
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Welcome Section */}
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Bem-vindo, {user?.name?.split(" ")[0]}!
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Escolha o módulo que deseja acessar para gerenciar seus processos licitatórios
              de forma eficiente e automatizada
            </p>
          </div>

          {/* Modules Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <Card
                key={module.id}
                className={`relative transition-all ${
                  module.available
                    ? "hover:shadow-xl hover:scale-105 cursor-pointer border-primary/20"
                    : "opacity-60 cursor-not-allowed"
                }`}
                onClick={() => handleModuleClick(module)}
              >
                {module.badge && (
                  <div className="absolute top-4 right-4">
                    <span className="bg-primary text-primary-foreground text-xs font-semibold px-2.5 py-1 rounded-full">
                      {module.badge}
                    </span>
                  </div>
                )}
                {!module.available && (
                  <div className="absolute top-4 right-4">
                    <span className="bg-muted text-muted-foreground text-xs font-semibold px-2.5 py-1 rounded-full">
                      Em breve
                    </span>
                  </div>
                )}
                <CardHeader className="pb-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${
                      module.available 
                        ? "bg-primary/10 text-primary" 
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {module.icon}
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2">{module.title}</CardTitle>
                      <CardDescription className="text-sm leading-relaxed">
                        {module.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {module.available ? (
                    <Button className="w-full" variant="default">
                      Acessar Módulo
                    </Button>
                  ) : (
                    <Button className="w-full" variant="outline" disabled>
                      Em Desenvolvimento
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Info Footer */}
          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground">
              Novos módulos serão liberados gradualmente. Acompanhe as atualizações!
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
