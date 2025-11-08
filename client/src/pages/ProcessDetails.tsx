import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  FileText,
  Download,
  Edit,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { APP_LOGO } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

const statusLabels: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const documentLabels: Record<string, string> = {
  etp: "Estudo Técnico Preliminar (ETP)",
  tr: "Termo de Referência (TR)",
  dfd: "Documento Formalizador de Demanda (DFD)",
  edital: "Edital",
};

export default function ProcessDetails() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const params = useParams();
  const processId = parseInt(params.id || "0");

  const { data: process, isLoading: processLoading } = trpc.processes.getById.useQuery({
    id: processId,
  });

  const { data: documents, isLoading: documentsLoading } = trpc.documents.listByProcess.useQuery({
    processId,
  });

  const { data: activities } = trpc.activities.listByProcess.useQuery({
    processId,
  });

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (cents: number | null | undefined) => {
    if (!cents) return "R$ 0,00";
    return (cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  const handleDownloadPDF = (documentId: number) => {
    toast.info("Funcionalidade de download em desenvolvimento");
  };

  const handleDownloadDOCX = (documentId: number) => {
    toast.info("Funcionalidade de download em desenvolvimento");
  };

  if (processLoading || documentsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Processo não encontrado</h2>
        <Button onClick={() => navigate("/dashboard")}>Voltar ao Dashboard</Button>
      </div>
    );
  }

  const etpDocument = documents?.find((doc) => doc.type === "etp");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6">
          <div className="flex h-20 items-center justify-between">
            <div className="flex items-center gap-6">
              <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 w-auto" />
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={toggleTheme}>
                  {theme === "dark" ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
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
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <Button
          variant="ghost"
          className="mb-6 -ml-4"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Dashboard
        </Button>

        {/* Process Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{process.name}</h1>
              <p className="text-muted-foreground">{process.object}</p>
            </div>
            <Badge variant="secondary" className="text-sm px-4 py-2">
              {statusLabels[process.status]}
            </Badge>
          </div>

          {/* Process Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Valor Estimado</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(process.estimatedValue)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Modalidade</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground capitalize">
                  {process.modality?.replace("_", " ")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Categoria</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground capitalize">
                  {process.category}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Timeline */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Linha do Tempo dos Documentos</CardTitle>
            <CardDescription>Acompanhe o progresso da geração dos documentos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              {(["etp", "tr", "dfd", "edital"] as const).map((docType, index) => {
                const doc = documents?.find((d: any) => d.type === docType);
                const isCompleted = !!doc;
                const isCurrent = process.status === `em_${docType}`;

                return (
                  <div key={docType} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          isCompleted
                            ? "bg-green-500 text-white"
                            : isCurrent
                            ? "bg-blue-500 text-white animate-pulse"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-6 w-6" />
                        ) : isCurrent ? (
                          <Clock className="h-6 w-6" />
                        ) : (
                          <FileText className="h-6 w-6" />
                        )}
                      </div>
                      <p className="text-xs font-medium mt-2 text-center">
                        {docType.toUpperCase()}
                      </p>
                    </div>
                    {index < 3 && (
                      <div
                        className={`flex-1 h-1 mx-2 ${
                          isCompleted ? "bg-green-500" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Document Content */}
        {etpDocument ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{documentLabels[etpDocument.type]}</CardTitle>
                  <CardDescription>
                    Gerado em {formatDate(etpDocument.createdAt)} • Versão {etpDocument.version}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(etpDocument.id)}>
                    <Download className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(etpDocument.id)}>
                    <Download className="mr-2 h-4 w-4" />
                    DOCX
                  </Button>
                  <Button variant="default" size="sm">
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Streamdown>{etpDocument.content || ""}</Streamdown>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Gerando ETP...
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                A inteligência artificial está analisando os dados do processo e gerando o Estudo
                Técnico Preliminar baseado na Lei 14.133/21. Isso pode levar alguns segundos.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Activity Log */}
        {activities && activities.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Log de Atividades</CardTitle>
              <CardDescription>Histórico de ações realizadas neste processo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activities.map((activity: any) => (
                  <div key={activity.id} className="flex items-start gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                    <div className="flex-1">
                      <p className="text-foreground">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(activity.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
