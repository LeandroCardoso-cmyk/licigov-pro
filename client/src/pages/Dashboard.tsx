import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Plus, FileText, Clock, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { APP_LOGO, APP_TITLE } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";

const statusLabels: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const statusColors: Record<string, string> = {
  em_etp: "bg-blue-500",
  em_tr: "bg-yellow-500",
  em_dfd: "bg-orange-500",
  em_edital: "bg-purple-500",
  concluido: "bg-green-500",
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const { data: processes, isLoading } = trpc.processes.list.useQuery();
  const { theme, toggleTheme } = useTheme();

  const handleNewProcess = () => {
    navigate("/novo-processo");
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-gradient-to-r from-card via-card to-primary/5">
        <div className="container mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                className="rounded-full"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <img src={APP_LOGO} alt={APP_TITLE} className="h-16 sm:h-20 w-auto drop-shadow-lg" />
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
      <main className="container mx-auto px-6 py-8">
        {/* Action Bar */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Meus Processos</h2>
            <p className="text-muted-foreground mt-1">
              Gerencie e acompanhe seus processos licitatórios
            </p>
          </div>
          <Button onClick={handleNewProcess} size="lg" className="gap-2">
            <Plus className="h-5 w-5" />
            Novo Processo
          </Button>
        </div>

        {/* Processes List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : processes && processes.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {processes.map((process) => (
              <Card
                key={process.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate(`/processo/${process.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{process.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">
                        {process.description || process.object}
                      </CardDescription>
                    </div>
                    <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-2" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${statusColors[process.status]}`} />
                      <span className="text-sm font-medium text-foreground">
                        {statusLabels[process.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>Atualizado em {formatDate(process.updatedAt)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Nenhum processo criado
              </h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                Comece criando seu primeiro processo licitatório. O sistema irá guiá-lo através
                da geração de todos os documentos necessários.
              </p>
              <Button onClick={handleNewProcess} className="gap-2">
                <Plus className="h-5 w-5" />
                Criar Primeiro Processo
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
